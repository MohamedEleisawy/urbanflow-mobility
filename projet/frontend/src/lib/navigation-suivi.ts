import { messageGeolocalisation, type RaisonEchec } from "./geolocalisation";
import type { ItinerarySegment } from "./types";

// =============================================================================
// Suivi de trajet — logique PURE (Phase 5)
// =============================================================================
// Ce module ne contient AUCUN React et n'appelle AUCUNE API du navigateur. Il
// ne fait que des mathématiques sur des nombres : projeter un point sur un
// segment, mesurer un écart, décider d'une instruction.
//
// C'est ce qui le rend testable sans jsdom, sans GPS et sans horloge — et
// c'est là que vivent les seules règles qu'un bug rendrait dangereuses.
// =============================================================================

import { haversineDistanceM } from "./geo";

/**
 * Où en est la navigation.
 *
 * ⚠️ CES CINQ ÉTATS NE SE VALENT PAS et ne doivent jamais être fondus :
 *
 *   `idle`          rien n'a commencé — le GPS n'est PAS sollicité ;
 *   `tracking`      suivi en cours, position connue ;
 *   `recalculating` l'usager s'est écarté, on cherche un nouveau trajet ;
 *   `completed`     arrivée atteinte ;
 *   `error`         le suivi est impossible, et on dit pourquoi.
 */
export type EtatNavigation =
  | "idle"
  | "tracking"
  | "recalculating"
  | "completed"
  | "error";

/** Une position mesurée par l'appareil. */
export interface PositionSuivie {
  latitude: number;
  longitude: number;
  /**
   * Rayon d'incertitude en mètres, tel que l'appareil l'annonce.
   *
   * ⚠️ JAMAIS INVENTÉ. `null` quand l'appareil ne le fournit pas — la carte
   * doit alors s'abstenir de dessiner un cercle de précision plutôt que d'en
   * dessiner un faux.
   */
  accuracyM: number | null;
  /** Cap en degrés, si l'appareil le mesure. */
  headingDeg: number | null;
  /** Vitesse en m/s, si l'appareil la mesure. */
  speedMs: number | null;
  /** Instant de la mesure, en millisecondes. */
  timestamp: number;
}

/**
 * Écart au-delà duquel on considère que l'usager n'est plus sur le trajet.
 *
 * ═══ D'OÙ VIENT CE NOMBRE ═══
 *
 * Il n'est PAS arbitraire : c'est l'ordre de grandeur de l'imprécision d'un
 * GPS de téléphone en ville. Entre les immeubles, une position à 30–50 m de la
 * réalité est courante — recalculer en dessous ferait donc « dévier » un
 * usager parfaitement sur sa route, en boucle.
 *
 * ⚠️ IL EST COMPARÉ À LA PRÉCISION ANNONCÉE. Une position donnée à ±200 m ne
 * peut pas prouver une déviation de 80 m : `estHorsTrajet` refuse de conclure
 * quand l'incertitude dépasse l'écart mesuré. C'est ce qui empêche un GPS
 * dégradé de déclencher des recalculs en rafale.
 */
export const SEUIL_DEVIATION_M = 80;

/**
 * Distance à la destination en deçà de laquelle le trajet est terminé.
 *
 * Un arrêt fait plusieurs dizaines de mètres, et la position finale est
 * imprécise : exiger d'atteindre le point exact ne terminerait jamais un
 * trajet.
 */
export const SEUIL_ARRIVEE_M = 40;

/**
 * Délai minimal entre deux recalculs.
 *
 * ⚠️ SANS CE VERROU, un usager réellement sorti du trajet déclencherait une
 * recherche par mesure GPS — soit plusieurs par seconde. Le serveur serait
 * martelé et l'écran clignoterait entre deux itinéraires.
 */
export const COOLDOWN_RECALCUL_MS = 15_000;

/**
 * Projette un point sur un segment de droite et rend la distance.
 *
 * ═══ POURQUOI PROJETER, ET NON MESURER LA DISTANCE AUX EXTRÉMITÉS ═══
 *
 * Un tronçon de métro fait souvent plus d'un kilomètre. Quelqu'un qui se
 * trouve au MILIEU du trajet est à 500 m de chaque extrémité : mesurer la
 * distance aux arrêts conclurait qu'il a dévié de 500 m, alors qu'il est
 * exactement sur la voie.
 *
 * On mesure donc la distance à la LIGNE, pas à ses bouts.
 *
 * ⚠️ APPROXIMATION PLANE ASSUMÉE. On projette en degrés corrigés du cosinus de
 * la latitude, puis on mesure en Haversine. Sur quelques centaines de mètres —
 * l'échelle d'un tronçon — l'erreur est très inférieure à la précision d'un
 * GPS de téléphone. Une projection géodésique exacte serait du calcul payé
 * pour rien.
 */
export function distanceAuSegment(
  point: { latitude: number; longitude: number },
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  // Correction de la longitude : un degré y vaut 111 km à l'équateur mais
  // 73 km à Paris. Sans elle, la projection serait déformée d'un tiers.
  const cos = Math.cos((point.latitude * Math.PI) / 180);

  const px = point.longitude * cos;
  const py = point.latitude;
  const ax = a.longitude * cos;
  const ay = a.latitude;
  const bx = b.longitude * cos;
  const by = b.latitude;

  const dx = bx - ax;
  const dy = by - ay;
  const norme = dx * dx + dy * dy;

  if (norme === 0) {
    // Segment de longueur nulle : les deux extrémités sont confondues.
    return haversineDistanceM(point.latitude, point.longitude, a.latitude, a.longitude);
  }

  // Position du projeté le long du segment, bornée à [0, 1] : au-delà des
  // extrémités, le point le plus proche EST l'extrémité.
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / norme));

  const projeteLon = (ax + t * dx) / cos;
  const projeteLat = ay + t * dy;

  return haversineDistanceM(point.latitude, point.longitude, projeteLat, projeteLon);
}

/**
 * Distance de l'usager au trajet : le plus petit écart à l'un des segments.
 *
 * Rend `Infinity` si l'itinéraire est vide — il n'y a alors rien dont on
 * puisse s'écarter, et un `0` laisserait croire qu'on est dessus.
 */
export function ecartAuTrajet(
  position: { latitude: number; longitude: number },
  segments: readonly ItinerarySegment[],
): number {
  let minimum = Infinity;

  for (const segment of segments) {
    const ecart = distanceAuSegment(
      position,
      { latitude: segment.fromStopLat, longitude: segment.fromStopLon },
      { latitude: segment.toStopLat, longitude: segment.toStopLon },
    );

    if (ecart < minimum) {
      minimum = ecart;
    }
  }

  return minimum;
}

/**
 * L'usager s'est-il réellement écarté du trajet ?
 *
 * ⚠️ « JE NE SAIS PAS » N'EST PAS « IL A DÉVIÉ ». Quand la précision annoncée
 * par l'appareil dépasse l'écart mesuré, la mesure ne prouve rien : dans un
 * tunnel ou entre deux immeubles, une position à ±300 m « prouverait » une
 * déviation de 100 m à chaque relevé, et l'application recalculerait sans fin
 * un trajet que l'usager suit correctement.
 */
export function estHorsTrajet(
  position: PositionSuivie,
  segments: readonly ItinerarySegment[],
): boolean {
  if (segments.length === 0) {
    return false;
  }

  const ecart = ecartAuTrajet(position, segments);

  if (ecart <= SEUIL_DEVIATION_M) {
    return false;
  }

  // La position est-elle assez sûre pour conclure ?
  if (position.accuracyM !== null && position.accuracyM >= ecart) {
    return false;
  }

  return true;
}

/** L'usager est-il arrivé ? */
export function estArrive(
  position: { latitude: number; longitude: number },
  segments: readonly ItinerarySegment[],
): boolean {
  const dernier = segments[segments.length - 1];

  if (!dernier) {
    return false;
  }

  return (
    haversineDistanceM(
      position.latitude,
      position.longitude,
      dernier.toStopLat,
      dernier.toStopLon,
    ) <= SEUIL_ARRIVEE_M
  );
}

/**
 * Le segment sur lequel l'usager se trouve, et ce qu'il lui reste.
 *
 * Le segment courant est celui dont il est le plus proche : c'est la seule
 * définition qui ne suppose pas qu'il a suivi le trajet dans l'ordre.
 */
export interface AvancementTrajet {
  /// Index du segment courant dans l'itinéraire.
  index: number;
  /// Distance restante jusqu'à la destination, en mètres.
  distanceRestanteM: number;
  /// Durée restante annoncée, en minutes.
  dureeRestanteMin: number;
}

export function avancement(
  position: { latitude: number; longitude: number },
  segments: readonly ItinerarySegment[],
): AvancementTrajet | null {
  if (segments.length === 0) {
    return null;
  }

  let index = 0;
  let minimum = Infinity;

  for (const [rang, segment] of segments.entries()) {
    const ecart = distanceAuSegment(
      position,
      { latitude: segment.fromStopLat, longitude: segment.fromStopLon },
      { latitude: segment.toStopLat, longitude: segment.toStopLon },
    );

    if (ecart < minimum) {
      minimum = ecart;
      index = rang;
    }
  }

  // Ce qui reste : la fin du segment courant, puis les suivants EN ENTIER.
  const restants = segments.slice(index + 1);

  const distanceRestanteM =
    haversineDistanceM(
      position.latitude,
      position.longitude,
      segments[index].toStopLat,
      segments[index].toStopLon,
    ) + restants.reduce((somme, segment) => somme + segment.distanceM, 0);

  // ⚠️ LA DURÉE DU SEGMENT COURANT EST COMPTÉE EN ENTIER, et ce n'est pas une
  // approximation paresseuse : la durée d'un tronçon de métro ne se découpe
  // pas au prorata de la distance parcourue — le véhicule n'est pas encore
  // passé. Annoncer « il vous reste 1,4 minute » serait plus précis en
  // apparence et plus faux en réalité.
  const dureeRestanteMin =
    segments[index].durationMin +
    restants.reduce((somme, segment) => somme + segment.durationMin, 0);

  return { index, distanceRestanteM, dureeRestanteMin };
}

// =============================================================================
// Instructions
// =============================================================================

/**
 * L'instruction à afficher — et, si l'usager le veut, à énoncer.
 *
 * ⚠️ TOUT VIENT DES DONNÉES. Aucune instruction de type « tournez à droite » :
 * elle exigerait une géométrie de voirie et un cap, que le réseau ne fournit
 * pas. On ne dit que ce que le trajet dit réellement : quel mode, quelle
 * ligne, quel arrêt, combien de mètres.
 */
export interface Instruction {
  /**
   * Clé stable de l'instruction.
   *
   * Sert à ne pas répéter deux fois de suite la même phrase — à l'écran comme
   * à la voix.
   */
  cle: string;
  texte: string;
}

/**
 * Tout ce qu'il faut pour formuler une instruction dans la langue courante.
 *
 * ⚠️ AUCUN TEXTE N'EST ÉCRIT EN DUR DANS CE MODULE. Il est purement logique :
 * il décide QUOI dire, l'appelant décide COMMENT le dire. C'est ce qui permet
 * de l'internationaliser sans le modifier, et de le tester sans dépendre de
 * la langue.
 */
export interface LibellesInstruction {
  /** Nom lisible d'un mode — « Métro », « Train »… */
  mode: (mode: string) => string;
  /** « Marchez 180 m jusqu'à Châtelet » */
  marcher: (distance: string, arret: string) => string;
  /** « Prenez le Métro 4, descendez à Châtelet » */
  prendre: (mode: string, ligne: string, arret: string) => string;
  arrivee: string;
  recalcul: string;
}

/**
 * Fabrique l'instruction correspondant à l'état courant.
 *
 * Rend `null` quand il n'y a rien à dire — un trajet vide, par exemple.
 */
export function instructionCourante(
  etat: EtatNavigation,
  segments: readonly ItinerarySegment[],
  index: number,
  libelles: LibellesInstruction,
  formaterDistance: (metres: number) => string,
): Instruction | null {
  if (etat === "completed") {
    return { cle: "arrivee", texte: libelles.arrivee };
  }

  if (etat === "recalculating") {
    return { cle: "recalcul", texte: libelles.recalcul };
  }

  const segment = segments[index];

  if (!segment) {
    return null;
  }

  if (segment.mode === "WALK") {
    return {
      cle: `marche-${index}`,
      texte: libelles.marcher(
        formaterDistance(segment.distanceM),
        segment.toStopName,
      ),
    };
  }

  return {
    cle: `prendre-${index}`,
    texte: libelles.prendre(
      libelles.mode(segment.mode),
      segment.lineName,
      segment.toStopName,
    ),
  };
}

/** Traduit un échec de géolocalisation en message destiné à l'usager. */
export function messageEchecSuivi(raison: RaisonEchec): string {
  return messageGeolocalisation(raison);
}
