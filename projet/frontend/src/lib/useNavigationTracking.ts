"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { messageGeolocalisation, type RaisonEchec } from "./geolocalisation";
import type { PositionSuivie } from "./navigation-suivi";

// =============================================================================
// Suivi GPS continu (Phase 5)
// =============================================================================
// ⚠️ CE HOOK NE DÉMARRE JAMAIS TOUT SEUL. Il expose `demarrer()`, et rien ne
// se passe avant que l'usager ne l'appelle. Une invite de permission qui
// surgit au chargement d'une page est une invite qu'on refuse par réflexe — et
// suivre une position sans geste explicite serait une collecte de donnée
// personnelle sans consentement, ce que le RGPD proscrit.
//
// ⚠️ AUCUNE TRACE N'EST CONSERVÉE. Seule la DERNIÈRE position est gardée en
// mémoire ; les précédentes sont écrasées. Rien n'est envoyé au serveur, rien
// n'est écrit dans le stockage du navigateur. Le GPS sert à se situer sur un
// trajet en cours, pas à constituer un historique de déplacements.
// =============================================================================

/** Ce que le hook rend à l'écran de navigation. */
export interface SuiviNavigation {
  /** Dernière position mesurée, ou `null` avant le premier relevé. */
  position: PositionSuivie | null;

  /** Le suivi est-il actif ? */
  actif: boolean;

  /**
   * Pourquoi le suivi a échoué, en clair. `null` s'il n'a pas échoué.
   *
   * ⚠️ LE MESSAGE DIT QUOI FAIRE. « Autorisation refusée » se répare dans les
   * réglages, « délai dépassé » se réessaie : les confondre laisserait
   * l'usager sans recours.
   */
  erreur: string | null;

  /** Cause technique de l'échec, pour l'appelant qui veut distinguer. */
  raison: RaisonEchec | null;

  demarrer: () => void;
  arreter: () => void;
}

/**
 * Suit la position de l'usager tant qu'il le demande.
 *
 * ⚠️ `watchPosition`, PAS `getCurrentPosition` EN BOUCLE. Le premier laisse
 * l'appareil décider quand une nouvelle mesure vaut la peine d'être remontée ;
 * le second rallumerait la puce à intervalle fixe, y compris à l'arrêt. La
 * différence se mesure en heures d'autonomie.
 */
export function useNavigationTracking(): SuiviNavigation {
  const [position, setPosition] = useState<PositionSuivie | null>(null);
  const [actif, setActif] = useState(false);
  const [raison, setRaison] = useState<RaisonEchec | null>(null);

  /**
   * Identifiant du suivi en cours.
   *
   * Dans une référence et non dans un état : le modifier ne doit provoquer
   * aucun rendu, et `arreter()` doit pouvoir le lire sans dépendre d'une
   * fermeture périmée.
   */
  const veille = useRef<number | null>(null);

  const arreter = useCallback(() => {
    if (veille.current !== null) {
      // ⚠️ SANS `clearWatch`, LA PUCE RESTE ALLUMÉE. Le suivi survivrait à la
      // fermeture de l'écran de navigation, viderait la batterie et
      // continuerait de collecter une position dont plus personne n'a besoin.
      navigator.geolocation.clearWatch(veille.current);
      veille.current = null;
    }

    setActif(false);
  }, []);

  const demarrer = useCallback(() => {
    // Déjà en cours : ne pas ouvrir un second suivi, qui doublerait les
    // relevés et la consommation.
    if (veille.current !== null) {
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setRaison("non-supportee");
      setActif(false);
      return;
    }

    setRaison(null);
    setActif(true);

    veille.current = navigator.geolocation.watchPosition(
      (mesure) => {
        setPosition({
          latitude: mesure.coords.latitude,
          longitude: mesure.coords.longitude,
          // ⚠️ JAMAIS INVENTÉS. Un appareil qui ne mesure ni le cap ni la
          // vitesse rend `null` : la carte doit alors s'abstenir de dessiner
          // une flèche de direction plutôt que d'en dessiner une fausse.
          accuracyM: nombreOuNull(mesure.coords.accuracy),
          headingDeg: nombreOuNull(mesure.coords.heading),
          speedMs: nombreOuNull(mesure.coords.speed),
          timestamp: mesure.timestamp,
        });
        // Une mesure reçue efface une erreur passagère : le GPS est revenu.
        setRaison(null);
      },
      (echec) => {
        setRaison(raisonDe(echec));
        // ⚠️ ON N'ARRÊTE PAS LE SUIVI SUR UNE ERREUR PASSAGÈRE. Un tunnel
        // produit un « position indisponible » dont on sort quelques secondes
        // plus tard ; couper la veille obligerait l'usager à tout relancer.
        // Un refus de permission, lui, est définitif : rien ne sert
        // d'attendre.
        if (raisonDe(echec) === "permission-refusee") {
          arreter();
        }
      },
      {
        // ⚠️ HAUTE PRÉCISION ICI, contrairement au remplissage de formulaire.
        // Se situer sur un trajet demande de distinguer deux rues ; trouver
        // l'arrêt le plus proche dans un rayon de 2 km, non. Le coût en
        // batterie est assumé parce que l'usager a explicitement démarré une
        // navigation.
        enableHighAccuracy: true,
        timeout: 15_000,
        // ⚠️ ZÉRO, ET C'EST ESSENTIEL. Réutiliser une position en cache
        // pendant une navigation ferait suivre un fantôme : l'usager avance,
        // le point reste.
        maximumAge: 0,
      },
    );
  }, [arreter]);

  // ⚠️ ARRÊT AU DÉMONTAGE, sans condition. Quitter l'écran de navigation —
  // par un lien, un retour arrière, une fermeture d'onglet — doit éteindre la
  // puce. C'est la fuite la plus coûteuse que ce hook puisse produire.
  useEffect(() => arreter, [arreter]);

  return {
    position,
    actif,
    erreur: raison === null ? null : messageGeolocalisation(raison),
    raison,
    demarrer,
    arreter,
  };
}

/**
 * Un nombre exploitable, ou `null`.
 *
 * `coords.heading` et `coords.speed` valent `null` sur la plupart des
 * appareils à l'arrêt, et `NaN` sur certains. Les deux doivent devenir
 * « non mesuré », jamais zéro : « cap 0° » signifie plein nord.
 */
function nombreOuNull(valeur: number | null | undefined): number | null {
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
}

/**
 * Traduit le code d'erreur du navigateur.
 *
 * Les constantes sont comparées par leur VALEUR NUMÉRIQUE et non via
 * `GeolocationPositionError.PERMISSION_DENIED` : cette classe n'existe pas
 * dans tous les environnements, et y accéder lèverait une exception là où
 * l'on est justement en train d'en traiter une.
 */
function raisonDe(echec: GeolocationPositionError): RaisonEchec {
  switch (echec.code) {
    case 1:
      return "permission-refusee";
    case 3:
      return "delai-depasse";
    default:
      return "indisponible";
  }
}
