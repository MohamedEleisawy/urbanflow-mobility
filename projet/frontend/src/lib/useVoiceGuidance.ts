"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

// =============================================================================
// Guidage vocal (Phase 5)
// =============================================================================
// ⚠️ LA VOIX NE REMPLACE JAMAIS LE TEXTE. L'instruction courante est TOUJOURS
// affichée à l'écran ; la voix la double, pour qui a les mains prises ou les
// yeux ailleurs. Une application qui ne parlerait que serait inutilisable en
// milieu bruyant, et inaccessible aux personnes sourdes.
//
// ⚠️ AUCUN SON SANS GESTE DE L'USAGER. Le guidage est éteint par défaut. Une
// application qui se met à parler toute seule dans un métro est une
// application qu'on coupe — et plusieurs navigateurs refusent d'ailleurs la
// synthèse vocale tant qu'aucune interaction n'a eu lieu.
// =============================================================================

export interface GuidageVocal {
  /** La synthèse vocale est-elle disponible dans ce navigateur ? */
  disponible: boolean;

  /** Le guidage est-il activé par l'usager ? */
  actif: boolean;

  basculer: () => void;

  /**
   * Énonce une instruction, si le guidage est actif.
   *
   * `cle` identifie l'instruction : la même clé deux fois de suite ne
   * reparle pas. Voir la note sur la répétition ci-dessous.
   */
  annoncer: (cle: string, texte: string) => void;

  /** Coupe immédiatement ce qui est en cours de lecture. */
  taire: () => void;
}

/**
 * Guidage vocal, adossé à `window.speechSynthesis`.
 *
 * @param langue étiquette BCP 47 (« fr-FR », « en-US », « es-ES »). Elle
 *               détermine la voix choisie par le navigateur : une phrase
 *               française lue par une voix anglaise est inintelligible.
 */
export function useVoiceGuidance(langue: string): GuidageVocal {
  const [actif, setActif] = useState(false);

  /**
   * ⚠️ `useSyncExternalStore`, ET NON un effet qui pose un état.
   *
   * Deux raisons, les mêmes que pour `sessionStorage` sur `/itineraire` :
   * `window` n'existe pas au rendu serveur, et poser l'état depuis un effet
   * déclenche `react-hooks/set-state-in-effect` du compilateur React.
   *
   * L'instantané serveur rend `false` : au prérendu, on ne peut rien
   * promettre. Il devient `true` après hydratation si le navigateur suit.
   */
  const disponible = useSyncExternalStore(
    souscrireVide,
    () => synthese() !== null,
    () => false,
  );

  /**
   * Clé de la DERNIÈRE instruction énoncée.
   *
   * ⚠️ C'EST CE QUI REND LE GUIDAGE SUPPORTABLE. Le GPS émet plusieurs relevés
   * par seconde ; sans cette mémoire, « Marchez 180 mètres » serait répété
   * sans fin, les énoncés s'empileraient dans la file d'attente de la
   * synthèse, et la voix parlerait encore de la rue précédente une minute plus
   * tard.
   */
  const derniereCle = useRef<string | null>(null);

  const taire = useCallback(() => {
    // `cancel()` vide la file ET interrompt l'énoncé en cours.
    synthese()?.cancel();
  }, []);

  const basculer = useCallback(() => {
    setActif((precedent) => {
      const suivant = !precedent;

      if (!suivant) {
        taire();
        // On oublie la dernière clé : en réactivant, l'usager doit réentendre
        // où il en est, pas attendre l'instruction suivante.
        derniereCle.current = null;
      }

      return suivant;
    });
  }, [taire]);

  const annoncer = useCallback(
    (cle: string, texte: string) => {
      const voix = synthese();

      if (!actif || voix === null) {
        return;
      }

      // Même instruction que la dernière fois : rien à dire.
      if (derniereCle.current === cle) {
        return;
      }

      derniereCle.current = cle;

      // ⚠️ ON COUPE AVANT DE PARLER. Sans cela, une nouvelle instruction
      // attendrait la fin de la précédente : à l'approche d'une
      // correspondance, l'usager entendrait « descendez à Châtelet » alors
      // qu'il en est déjà reparti.
      voix.cancel();

      const enonce = new SpeechSynthesisUtterance(texte);
      enonce.lang = langue;
      voix.speak(enonce);
    },
    [actif, langue],
  );

  // ⚠️ SILENCE AU DÉMONTAGE. `speechSynthesis` vit sur `window`, pas sur le
  // composant : quitter l'écran de navigation sans couper laisserait la voix
  // terminer sa phrase sur une autre page.
  useEffect(() => taire, [taire]);

  return { disponible, actif, basculer, annoncer, taire };
}

/**
 * La synthèse vocale du navigateur, ou `null`.
 *
 * ⚠️ ON TESTE LA VALEUR, PAS LA PRÉSENCE DE LA CLÉ. `"speechSynthesis" in
 * window` reste vrai quand la propriété existe mais vaut `undefined` — ce que
 * font certains environnements et navigateurs restreints. Le test passerait,
 * et l'appel suivant lèverait un `TypeError` en pleine navigation.
 */
/**
 * Abonnement exigé par `useSyncExternalStore`.
 *
 * ⚠️ IL N'ÉCOUTE RIEN, ET C'EST CORRECT : un navigateur n'acquiert pas la
 * synthèse vocale en cours de session. La valeur ne peut pas changer.
 */
function souscrireVide(): () => void {
  return () => {
    // Rien à désabonner.
  };
}

function synthese(): SpeechSynthesis | null {
  if (typeof window === "undefined") {
    return null;
  }

  const voix: SpeechSynthesis | undefined = window.speechSynthesis;

  return typeof voix?.speak === "function" ? voix : null;
}
