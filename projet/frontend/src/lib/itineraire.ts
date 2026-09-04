import type {
  Itinerary,
  ItinerarySegment,
  ItineraryWalkLeg,
  TransportMode,
} from "./types";

// =============================================================================
// Lecture d'un itinéraire : regroupement des étapes (refonte UX)
// =============================================================================
// ═══ LE PROBLÈME ═══
//
// Le backend rend un segment PAR TRONÇON entre deux arrêts consécutifs. Un
// trajet de cinq stations sur la ligne 8 produit donc cinq segments :
//
//   Métro 8 : Créteil-Préfecture → Créteil-Université
//   Métro 8 : Créteil-Université → Créteil-l'Échat
//   Métro 8 : Créteil-l'Échat    → Maisons-Alfort
//   …
//
// C'est la bonne granularité pour un graphe. C'est la mauvaise pour un
// lecteur : personne ne pense « cinq tronçons », on pense « cinq arrêts sur
// la ligne 8 ». Un lecteur d'écran, lui, entendrait cinq fois « Métro 8 ».
//
// ═══ CE QUE FAIT CE MODULE ═══
//
//   WALK · METRO 8 · METRO 8 · METRO 8 · METRO 8 · WALK
//   →
//   Marche · Métro 8 (4 arrêts) · Marche
//
// ⚠️ AUCUNE ÉTAPE N'EST PERDUE. Chaque groupe conserve ses segments d'origine
// dans `segments` : l'interface peut replier le détail, jamais l'effacer.
//
// Fonctions PURES — aucun React, aucun réseau. Elles se testent avec des
// objets simples, et c'est ce qui permet de verrouiller les règles de fusion.
// =============================================================================

/**
 * Plusieurs tronçons consécutifs empruntant la MÊME ligne.
 *
 * Les totaux sont des SOMMES des segments regroupés — jamais des estimations.
 */
export interface GroupeEtapes {
  mode: TransportMode;
  /** Identifiant de la ligne. C'est LUI qui décide de la fusion, pas le nom. */
  lineId: string;
  lineName: string;
  operator: string;
  /** Premier arrêt du groupe. */
  depart: string;
  /** Dernier arrêt du groupe. */
  arrivee: string;
  /**
   * Nombre d'arrêts PARCOURUS, c'est-à-dire de tronçons.
   *
   * ⚠️ Trois tronçons desservent quatre arrêts en comptant le point de
   * départ. On annonce donc « 3 arrêts » au sens de « trois arrêts plus
   * loin » — la formulation qu'emploient les réseaux eux-mêmes.
   */
  nombreArrets: number;
  distanceM: number;
  durationMin: number;
  /** Les segments d'origine, dans l'ordre. Jamais vide. */
  segments: ItinerarySegment[];
}

/**
 * Regroupe les tronçons consécutifs d'une même ligne.
 *
 * ═══ LE CRITÈRE DE FUSION EST `lineId`, PAS `lineName` ═══
 *
 * Deux lignes distinctes peuvent porter le même nom — le réseau réel en
 * contient, et un test du backend le vérifie déjà (« distingue deux lignes
 * concurrentes de MÊME nom par leur lineId »). Fusionner sur le nom
 * fabriquerait un trajet qui n'existe pas : « restez dans la ligne 8 » alors
 * qu'il faut changer de quai.
 *
 * Le `mode` est vérifié en plus par prudence : deux lignes de modes
 * différents ne devraient jamais partager un identifiant, mais l'affirmer
 * explicitement coûte une comparaison.
 *
 * ⚠️ SEULS LES SEGMENTS CONSÉCUTIFS fusionnent. Reprendre la ligne 8 après un
 * détour par la ligne 1 produit DEUX groupes — c'est bien deux fois qu'on y
 * monte.
 */
export function regrouperSegments(segments: readonly ItinerarySegment[]): GroupeEtapes[] {
  const groupes: GroupeEtapes[] = [];

  for (const segment of segments) {
    const dernier = groupes[groupes.length - 1];

    if (dernier && dernier.lineId === segment.lineId && dernier.mode === segment.mode) {
      dernier.segments.push(segment);
      dernier.arrivee = segment.toStopName;
      dernier.nombreArrets += 1;
      dernier.distanceM += segment.distanceM;
      dernier.durationMin += segment.durationMin;
      continue;
    }

    groupes.push({
      mode: segment.mode,
      lineId: segment.lineId,
      lineName: segment.lineName,
      operator: segment.operator,
      depart: segment.fromStopName,
      arrivee: segment.toStopName,
      nombreArrets: 1,
      distanceM: segment.distanceM,
      durationMin: segment.durationMin,
      segments: [segment],
    });
  }

  return groupes;
}

/**
 * Résumé lisible des modes empruntés — « Métro 8 + Marche ».
 *
 * ⚠️ LES DOUBLONS SONT RETIRÉS, mais l'ORDRE est conservé : un trajet
 * « Marche, Métro 8, Marche » se résume en « Marche + Métro 8 », pas en
 * « Marche + Métro 8 + Marche ». Répéter n'apprend rien.
 *
 * @param libelles table des libellés de modes (`LIBELLES_MODES`), passée en
 *   paramètre plutôt qu'importée : ce module reste ainsi indépendant de la
 *   langue d'affichage.
 */
export function resumerModes(
  groupes: readonly GroupeEtapes[],
  libelles: Record<TransportMode, string>,
): string {
  const vus = new Set<string>();
  const parties: string[] = [];

  for (const groupe of groupes) {
    // Une ligne nommée se dit par son nom (« Métro 8 ») ; la marche n'a pas
    // de numéro, on n'annonce donc que le mode.
    const libelle =
      groupe.mode === "WALK" ? libelles.WALK : `${libelles[groupe.mode]} ${groupe.lineName}`.trim();

    if (!vus.has(libelle)) {
      vus.add(libelle);
      parties.push(libelle);
    }
  }

  return parties.join(" + ");
}

/**
 * Nombre de CHANGEMENTS de véhicule.
 *
 * ⚠️ Ce n'est PAS le nombre de groupes moins un. La marche entre deux quais
 * n'est pas un véhicule : un trajet « Marche → Métro 8 → Marche » compte
 * ZÉRO changement, alors qu'il contient trois groupes.
 *
 * On ne compte donc que les groupes motorisés, moins un.
 */
export function nombreDeChangements(groupes: readonly GroupeEtapes[]): number {
  const motorises = groupes.filter((g) => g.mode !== "WALK").length;

  return Math.max(0, motorises - 1);
}

/**
 * Les modes réellement empruntés par un itinéraire, sans doublon.
 *
 * Sert aux filtres et aux badges : savoir si un trajet « contient du métro »
 * ne demande pas de parcourir ses trente tronçons.
 */
export function modesEmpruntes(itineraire: Itinerary): TransportMode[] {
  return [...new Set(itineraire.segments.map((s) => s.mode))];
}

// =============================================================================
// Étapes RÉELLEMENT parcourues, marche comprise
// =============================================================================

/**
 * Identifiants des deux extrémités demandées par l'usager.
 *
 * ⚠️ SYNTHÉTIQUES, ET STRICTEMENT LOCAUX. Un identifiant d'arrêt réel est un
 * UUID : la collision est donc impossible. Ces deux valeurs ne quittent JAMAIS
 * le navigateur — elles ne servent qu'à l'affichage et au guidage. Les envoyer
 * pour enregistrer un trajet ferait échouer la clé étrangère côté serveur, et
 * c'est précisément pour cela que `walkAccess` / `walkEgress` restent des
 * champs à part dans le contrat public.
 */
export const ID_ORIGINE = "__origine__";
export const ID_DESTINATION = "__destination__";

/**
 * Convertit une marche d'approche ou de sortie en étape parcourable.
 *
 * ⚠️ CE N'EST PAS UN TRONÇON DE RÉSEAU DÉGUISÉ. Le `lineId` synthétique et le
 * `geometrySource: "STRAIGHT"` disent tous deux qu'aucune voie publiée ne
 * sous-tend ce trait. La fonction existe pour que le GUIDAGE puisse traiter
 * uniformément « marchez jusqu'à l'arrêt » et « prenez le tram » — pas pour
 * faire passer une estimation pour une donnée d'opérateur.
 */
function etapeDeMarche(
  marche: ItineraryWalkLeg,
  depuis: { id: string; nom: string },
  vers: { id: string; nom: string },
): ItinerarySegment {
  return {
    fromStopId: depuis.id,
    fromStopName: depuis.nom,
    fromStopLat: marche.fromLat,
    fromStopLon: marche.fromLon,
    toStopId: vers.id,
    toStopName: vers.nom,
    toStopLat: marche.toLat,
    toStopLon: marche.toLon,
    mode: "WALK",
    lineName: "",
    operator: "",
    lineId: `${depuis.id}-${vers.id}`,
    gtfsLineId: null,
    distanceM: marche.distanceM,
    durationMin: marche.durationMin,
    geometry: null,
    geometrySource: "STRAIGHT",
  };
}

/**
 * Toutes les étapes du trajet, dans l'ordre : marche d'approche, tronçons du
 * réseau, marche de sortie.
 *
 * ═══ POURQUOI LE GUIDAGE EN A BESOIN ═══
 *
 * ⚠️ `/navigation` ne suivait que `itineraire.segments`. Deux conséquences,
 * toutes deux mesurées :
 *
 *   1. un trajet ENTIÈREMENT À PIED n'avait aucune étape : le guidage ne
 *      pouvait ni situer l'usager, ni conclure à l'arrivée, ni afficher quoi
 *      que ce soit ;
 *   2. même sur un trajet en tram, la marche jusqu'au premier arrêt n'était
 *      pas guidée — la navigation commençait à un endroit où l'usager n'était
 *      pas encore.
 *
 * Les libellés des deux bouts viennent de l'usager : c'est LUI qui a nommé son
 * départ et sa destination.
 */
export function etapesDuTrajet(
  itineraire: {
    segments: readonly ItinerarySegment[];
    walkAccess: ItineraryWalkLeg | null;
    walkEgress: ItineraryWalkLeg | null;
  },
  origine: { label: string },
  destination: { label: string },
): ItinerarySegment[] {
  const etapes: ItinerarySegment[] = [];
  const premier = itineraire.segments[0];
  const dernier = itineraire.segments[itineraire.segments.length - 1];

  if (itineraire.walkAccess) {
    etapes.push(
      etapeDeMarche(
        itineraire.walkAccess,
        { id: ID_ORIGINE, nom: origine.label },
        premier
          ? { id: premier.fromStopId, nom: premier.fromStopName }
          : // Marche de bout en bout : l'autre extrémité est la destination.
            { id: ID_DESTINATION, nom: destination.label },
      ),
    );
  }

  etapes.push(...itineraire.segments);

  if (itineraire.walkEgress && dernier) {
    etapes.push(
      etapeDeMarche(
        itineraire.walkEgress,
        { id: dernier.toStopId, nom: dernier.toStopName },
        { id: ID_DESTINATION, nom: destination.label },
      ),
    );
  }

  return etapes;
}
