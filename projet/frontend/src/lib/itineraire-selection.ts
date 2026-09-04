// =============================================================================
// Itinéraire retenu, transmis d'un écran à l'autre (Phase 4)
// =============================================================================
// L'écran `/itineraire` a besoin de l'itinéraire choisi sur `/recherche`.
// Trois façons de le lui donner, et une seule tient :
//
//   1. L'URL. Un itinéraire réel pèse plusieurs kilo-octets — treize segments
//      avec leur géométrie GeoJSON pour Gare de Lyon → Gare du Nord. Aucun
//      navigateur ne garantit une URL de cette taille, et elle serait
//      illisible.
//
//   2. Un état React partagé. Il ne survit pas à un rechargement, ni à
//      l'ouverture du lien dans un nouvel onglet.
//
//   3. `sessionStorage`. Il survit au rechargement, meurt avec l'onglet, et
//      n'est jamais envoyé au serveur. C'est ce qu'on retient.
//
// ⚠️ RELANCER LA RECHERCHE CÔTÉ `/itineraire` AURAIT ÉTÉ PIRE : rien ne
// garantit que le moteur rendrait EXACTEMENT le même trajet (le réseau peut
// avoir été réimporté entre-temps), et l'usager verrait un itinéraire
// différent de celui qu'il a choisi.
//
// ═══ CE QUI EST STOCKÉ, ET CE QUI NE L'EST PAS ═══
//
// L'itinéraire et les DEUX LIBELLÉS saisis par l'usager. Pas de nom de compte,
// pas de jeton, pas d'identifiant : `sessionStorage` est lisible par tout
// script de l'origine, et rien de ce qui est ici ne doit pouvoir servir à
// authentifier qui que ce soit.
// =============================================================================

import type { Itinerary } from "./types";

/**
 * Clé de stockage.
 *
 * Le préfixe `urbanflow.` est le même que celui du jeton d'authentification :
 * il évite toute collision avec un autre outil servi depuis la même origine.
 */
const CLE = "urbanflow.itineraire";

/** Les deux points, tels que l'usager les a nommés. */
export interface PointNomme {
  label: string;
  latitude: number;
  longitude: number;
}

export interface SelectionItineraire {
  itineraire: Itinerary;
  origine: PointNomme;
  destination: PointNomme;
  /** Horodatage de la sélection, en ISO — sert à dater ce que l'écran montre. */
  choisiA: string;
}

/**
 * Mémorise l'itinéraire retenu.
 *
 * ⚠️ NE LÈVE JAMAIS. `sessionStorage` peut être indisponible — navigation
 * privée sur certains navigateurs, quota atteint, stockage désactivé par
 * politique. Ce n'est pas une raison pour casser un clic : l'écran suivant
 * dira simplement qu'il n'a rien trouvé.
 */
export function memoriserSelection(selection: SelectionItineraire): boolean {
  try {
    window.sessionStorage.setItem(CLE, JSON.stringify(selection));
    return true;
  } catch {
    return false;
  }
}

/**
 * Le texte brut mémorisé, ou `null`. Ne lève jamais.
 *
 * ⚠️ SÉPARÉ DE L'ANALYSE, et pour une raison précise : `useSyncExternalStore`
 * exige un instantané STABLE — deux appels successifs sans changement doivent
 * rendre une valeur égale au sens de `Object.is`. Une chaîne le garantit ; un
 * objet fraîchement analysé, non : il serait à chaque fois une nouvelle
 * référence, et React boucherait indéfiniment.
 */
export function lireBrut(): string | null {
  try {
    return window.sessionStorage.getItem(CLE);
  } catch {
    return null;
  }
}

/**
 * Analyse le texte mémorisé, ou rend `null`.
 *
 * ⚠️ TOUT EST REVÉRIFIÉ. Le contenu de `sessionStorage` est modifiable par
 * n'importe quel script de l'origine, et survit à un déploiement qui aurait
 * changé la forme des données. Le lire en le castant en `SelectionItineraire`
 * ferait planter l'écran sur une valeur d'hier ou d'un autre onglet.
 *
 * On ne valide pas TOUT le contenu — ce serait réécrire un validateur de
 * schéma — mais assez pour que l'écran ne puisse pas s'effondrer : la présence
 * des champs qu'il lit sans condition.
 */
export function analyserSelection(brut: string | null): SelectionItineraire | null {
  if (brut === null) {
    return null;
  }

  try {
    const valeur: unknown = JSON.parse(brut);
    return estSelection(valeur) ? valeur : null;
  } catch {
    // JSON tronqué ou corrompu : on ne sait rien en tirer.
    return null;
  }
}

/** Raccourci : lecture et analyse en un appel. Ne lève jamais. */
export function lireSelection(): SelectionItineraire | null {
  return analyserSelection(lireBrut());
}

/**
 * Abonnement exigé par `useSyncExternalStore`.
 *
 * ⚠️ IL N'ÉCOUTE RIEN, ET C'EST CORRECT. `sessionStorage` n'émet pas
 * d'événement `storage` pour l'onglet qui l'écrit (la spécification réserve
 * cet événement aux AUTRES onglets), et un onglet ne partage pas son
 * `sessionStorage`. La valeur ne peut donc pas changer sous les pieds de cet
 * écran : il n'y a rien à écouter.
 */
export function souscrireSelection(): () => void {
  return () => {
    // Rien à désabonner.
  };
}

/**
 * Instantané côté SERVEUR : `undefined`, qui signifie « pas encore lu ».
 *
 * ⚠️ `undefined` ET NON `null`. `null` voudrait dire « rien de mémorisé », et
 * l'écran afficherait « cet itinéraire n'est plus disponible » pendant le
 * prérendu, puis le trajet après hydratation — un message d'erreur qui
 * clignote à chaque chargement.
 */
export function instantaneServeur(): undefined {
  return undefined;
}

/** Oublie l'itinéraire retenu. Ne lève jamais. */
export function oublierSelection(): void {
  try {
    window.sessionStorage.removeItem(CLE);
  } catch {
    // Rien à faire : l'écran suivant traitera l'absence comme un `null`.
  }
}

function estPointNomme(valeur: unknown): valeur is PointNomme {
  if (typeof valeur !== "object" || valeur === null) {
    return false;
  }

  const point = valeur as Record<string, unknown>;

  return (
    typeof point.label === "string" &&
    typeof point.latitude === "number" &&
    Number.isFinite(point.latitude) &&
    typeof point.longitude === "number" &&
    Number.isFinite(point.longitude)
  );
}

function estSelection(valeur: unknown): valeur is SelectionItineraire {
  if (typeof valeur !== "object" || valeur === null) {
    return false;
  }

  const selection = valeur as Record<string, unknown>;

  if (
    !estPointNomme(selection.origine) ||
    !estPointNomme(selection.destination) ||
    typeof selection.choisiA !== "string"
  ) {
    return false;
  }

  const itineraire = selection.itineraire as Record<string, unknown> | undefined;

  if (typeof itineraire !== "object" || itineraire === null) {
    return false;
  }

  if (!Array.isArray(itineraire.segments)) {
    return false;
  }

  // ═══ UN TRAJET PEUT N'AVOIR AUCUN TRONÇON : IL EST À PIED ═══
  //
  // ⚠️ CETTE VÉRIFICATION EXIGEAIT AUTREFOIS `segments.length > 0`, au motif
  // que l'écran lisait `segments[0]` sans condition. Conséquence mesurée :
  // « 19 rue Finkmatt » → « 6 rue des Cigognes » se calculait bien, mais
  // cliquer sur le résultat ouvrait une page VIDE — la sélection était écrite,
  // puis refusée à la relecture.
  //
  // Un itinéraire doit décrire un DÉPLACEMENT RÉEL : au moins un tronçon, ou
  // au moins une marche. C'est cela qu'on vérifie, et non la présence d'un
  // véhicule.
  const marche = (cle: string) => {
    const valeur = itineraire[cle];
    return (
      typeof valeur === "object" &&
      valeur !== null &&
      typeof (valeur as Record<string, unknown>).distanceM === "number"
    );
  };

  if (
    itineraire.segments.length === 0 &&
    !marche("walkAccess") &&
    !marche("walkEgress")
  ) {
    return false;
  }

  return (
    typeof itineraire.criterion === "string" &&
    typeof itineraire.totalDurationMin === "number" &&
    typeof itineraire.totalDistanceM === "number" &&
    typeof itineraire.numberOfTransfers === "number" &&
    typeof itineraire.carbon === "object" &&
    itineraire.carbon !== null
  );
}
