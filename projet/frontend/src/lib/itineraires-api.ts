// =============================================================================
// Recherche d'itinéraire (étape 5A-5)
// =============================================================================
// Deux routes, construites sur `apiFetch` (5A-2), comme `auth-api.ts` et
// `espace-api.ts`. Aucune nouvelle couche HTTP.
//
// LES DEUX SONT PUBLIQUES : aucun jeton n'est transmis. Le dossier place
// « UC01 Rechercher un itinéraire » et « UC07 Consulter la carte » dans le
// bloc « Mobilité (Libre accès) », et les contrôleurs le confirment — ni
// `@UseGuards`, ni `@CurrentUser`.
// =============================================================================

import { apiFetch } from "./api";
import type {
  Itinerary,
  ItinerarySegment,
  RouteHistoryItem,
  PaginatedStops,
  RouteSegment,
  SearchItineraryRequest,
  TransportMode,
} from "./types";

/**
 * Paramètres de `GET /api/stops`.
 *
 * ⚠️ `lat` et `lon` VONT ENSEMBLE : le backend refuse l'un sans l'autre (400).
 */
export interface RequeteArrets {
  page?: number;
  limit?: number;
  /** Fragment de nom, au moins deux caractères. */
  query?: string;
  lat?: number;
  lon?: number;
  /** Rayon en mètres, 5 000 au maximum. */
  radiusM?: number;
}

/**
 * Arrêts du réseau — TOUJOURS bornés (Phase 4).
 *
 * ═══ CE QUI A CHANGÉ, ET POURQUOI ═══
 *
 * Cette fonction rendait `Stop[]` : la table ENTIÈRE. C'était acceptable tant
 * que le réseau tenait en quelques milliers d'arrêts, et c'était même
 * documenté comme tel. Ça ne l'est plus : le backend en compte 1 934 et en
 * comptera plus de 35 000 une fois le bus importé — plusieurs mégaoctets de
 * JSON à chaque chargement de page.
 *
 * L'endpoint est donc borné, et cette fonction rend maintenant une PAGE.
 * Trois façons de demander, combinables :
 *
 *   { page, limit }        parcours ;
 *   { query }              recherche par nom ;
 *   { lat, lon, radiusM }  voisinage, ordonné du plus proche au plus loin.
 *
 * ⚠️ L'ÉCRAN DE RECHERCHE N'EN A PLUS BESOIN pour afficher un itinéraire :
 * depuis la Phase 4, chaque segment porte les noms ET les coordonnées de ses
 * deux arrêts. Il n'y a plus aucune résolution d'identifiant à faire côté
 * client.
 */
export function listerArrets(
  requete: RequeteArrets = {},
  signal?: AbortSignal,
): Promise<PaginatedStops> {
  const parametres = new URLSearchParams();

  for (const [cle, valeur] of Object.entries(requete)) {
    if (valeur !== undefined) {
      parametres.set(cle, String(valeur));
    }
  }

  const suffixe = parametres.toString();

  return apiFetch<PaginatedStops>(`/stops${suffixe ? `?${suffixe}` : ""}`, {
    signal,
  });
}

/**
 * Arrêts autour d'un point, du plus proche au plus éloigné.
 *
 * Raccourci de lecture pour le cas le plus courant côté carte : « qu'y a-t-il
 * autour de ce que je regarde ? ».
 */
export function arretsProches(
  latitude: number,
  longitude: number,
  options: { radiusM?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<PaginatedStops> {
  return listerArrets(
    { lat: latitude, lon: longitude, ...options },
    signal,
  );
}

/**
 * Recherche des itinéraires entre deux points.
 *
 * ⚠️ LE BACKEND ATTEND DES COORDONNÉES, pas des identifiants d'arrêt : il
 * cherche lui-même l'arrêt le PLUS PROCHE de chaque point, dans un rayon de
 * 2 km. Passer un `stopId` n'est pas prévu par le contrat.
 *
 * Rend 0 à 3 itinéraires, un par critère :
 *   - `FASTEST`           le plus rapide ;
 *   - `FEWEST_TRANSFERS`  le moins de changements de ligne ;
 *   - `LOWEST_CO2`        le moins émetteur.
 *
 * ⚠️ DEUX CRITÈRES PEUVENT DÉSIGNER LE MÊME TRAJET — c'est même le cas
 * normal sur un réseau homogène. Le backend déduplique alors et ne le rend
 * qu'une fois, sous le premier critère de cette liste. L'interface ne doit
 * donc JAMAIS supposer que les trois sont présents.
 *
 * Aucun itinéraire n'est rendu quand les deux points tombent sur les mêmes
 * quais, quand aucun arrêt n'est à moins de 2 km, ou quand le réseau n'offre
 * pas de chemin.
 *
 * Ce dernier cas répond **200 avec un tableau vide**, jamais une erreur :
 * « aucun itinéraire » est une réponse, pas une panne.
 *
 * Erreur attendue : 400 si une coordonnée est absente ou hors bornes
 * (`@IsLatitude`, `@IsLongitude` côté backend).
 */
export function rechercherItineraires(
  requete: SearchItineraryRequest,
  signal?: AbortSignal,
): Promise<Itinerary[]> {
  // POST et non GET, alors que la requête ne crée rien : c'est le choix du
  // backend (« les critères de recherche sont un objet JSON »), et il répond
  // d'ailleurs 200 et non 201.
  return apiFetch<Itinerary[]>("/routes/search", {
    method: "POST",
    body: requete,
    signal,
  });
}

// ---------------------------------------------------------------------------
// Enregistrement d'un itinéraire (étape 5A-7)
// ---------------------------------------------------------------------------

/**
 * Corps attendu par `POST /api/routes`.
 *
 * ⚠️ REMARQUER CE QUI N'Y FIGURE PAS : ni durée, ni distance, ni CO₂, ni
 * éco-score. Ces champs ont été RETIRÉS du contrat à l'étape 4E-3B, et le
 * `ValidationPipe` global les REJETTE désormais en 400 s'ils sont envoyés
 * (`whitelist` + `forbidNonWhitelisted`).
 *
 * La raison est écrite dans le DTO backend : les laisser au client était une
 * « faille d'intégrité » — n'importe qui pouvait enregistrer un trajet en
 * voiture en déclarant `ecoScore: 100`.
 *
 * ⚠️ `originLng` / `destinationLng`, avec « Lng » — alors que la RECHERCHE
 * emploie `fromLon` / `toLon`. Les deux contrats ne s'accordent pas sur
 * l'abréviation ; se tromper produirait un 400 difficile à diagnostiquer.
 */
export interface EnregistrerItineraireRequest {
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  segments: { lineId: string; fromStopId: string; toStopId: string }[];
  /**
   * `WALK` / `BIKE` pour un trajet DIRECT (boutons « À pied » / « À vélo ») :
   * `segments` est alors vide, le serveur recalcule distance et durée
   * lui-même. Absent pour un trajet multimodal ordinaire.
   */
  mode?: "WALK" | "BIKE";
}

/**
 * Itinéraire tel que le backend le rend après création.
 *
 * La route relue, avec ses segments — mais SANS `carbonRecords`, que le
 * `include` de la création ne demande pas. Le type `RouteDetail` serait donc
 * inexact ici : il promettrait un champ absent.
 */
export type ItineraireEnregistre = RouteHistoryItem & {
  segments: RouteSegment[];
};

/**
 * Traduit un itinéraire trouvé en corps de requête.
 *
 * LE CLIENT DÉSIGNE, IL NE DÉCRIT PAS. Pour un trajet MULTIMODAL, chaque
 * segment n'envoie que le triplet `(lineId, fromStopId, toStopId)` — exactement
 * la clé unique de `NetworkLink`. Le serveur ira lire lui-même le mode, la
 * distance, la durée, la ligne et l'exploitant.
 *
 * Pour un trajet DIRECT (« À pied » / « À vélo »), il n'y a rien à désigner :
 * aucune liaison réseau. On envoie alors `mode` et une liste de segments VIDE,
 * et le serveur recalcule distance et durée depuis les coordonnées.
 *
 *   - `segments: []`                          → trajet à pied  (`mode: "WALK"`)
 *   - un seul segment, `mode === "BIKE"`      → trajet à vélo   (`mode: "BIKE"`)
 *   - sinon                                   → trajet multimodal (triplets)
 *
 * Ce que le frontend affiche (durée, distance, empreinte) reste à l'écran mais
 * n'est JAMAIS transmis comme vérité : le serveur recalcule tout.
 */
export function versRequeteEnregistrement(
  segments: ItinerarySegment[],
  origine: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): EnregistrerItineraireRequest {
  const base = {
    originLat: origine.latitude,
    originLng: origine.longitude,
    destinationLat: destination.latitude,
    destinationLng: destination.longitude,
  };

  const modeDirect: "WALK" | "BIKE" | null =
    segments.length === 0
      ? "WALK"
      : segments.length === 1 && segments[0].mode === "BIKE"
        ? "BIKE"
        : null;

  if (modeDirect) {
    return { ...base, mode: modeDirect, segments: [] };
  }

  return {
    ...base,
    segments: segments.map((segment) => ({
      lineId: segment.lineId,
      fromStopId: segment.fromStopId,
      toStopId: segment.toStopId,
    })),
  };
}

/**
 * Enregistre un itinéraire pour l'usager authentifié. Répond 201.
 *
 * `userId` vient TOUJOURS du jeton, jamais du corps : il n'y a donc rien à
 * transmettre de ce côté.
 *
 * Erreurs attendues :
 *   400  triplet inconnu du réseau, segments qui ne s'enchaînent pas,
 *        ou champ interdit envoyé (durée, distance, ecoScore…)
 *   401  jeton absent, expiré ou invalide
 *   422  un mode sans facteur d'émission — le calcul carbone refuse
 *   503  microservice carbone injoignable ou incohérent
 */
export function enregistrerItineraire(
  requete: EnregistrerItineraireRequest,
  jeton: string,
): Promise<ItineraireEnregistre> {
  return apiFetch<ItineraireEnregistre>("/routes", {
    method: "POST",
    body: requete,
    token: jeton,
  });
}

/**
 * Supprime un trajet enregistré (étape 5A-9).
 *
 * Répond **204 No Content** : la suppression a réussi, il n'y a rien à
 * renvoyer. `apiFetch` le sait déjà et n'essaie pas de lire un corps vide.
 *
 * `userId` vient du jeton : le backend vérifie la propriété avant de
 * supprimer, et rien n'est à transmettre de ce côté.
 *
 * Erreurs attendues :
 *   400  identifiant qui n'est pas un UUID (`ParseUUIDPipe`)
 *   401  jeton absent, expiré ou invalide
 *   404  trajet inexistant **OU appartenant à quelqu'un d'autre** — le
 *        backend répond volontairement la MÊME chose dans les deux cas, « pour
 *        ne pas révéler l'existence d'un itinéraire qui ne nous appartient
 *        pas ». L'interface ne doit donc pas non plus faire la différence.
 *
 * ⚠️ AUCUN 403 n'est jamais renvoyé : le distinguer reviendrait à confirmer
 * que le trajet existe.
 */
export function supprimerTrajet(jeton: string, id: string): Promise<void> {
  return apiFetch<void>(`/routes/${id}`, {
    method: "DELETE",
    token: jeton,
  });
}

// ---------------------------------------------------------------------------
// Modes réellement présents dans le réseau (Phase 7)
// ---------------------------------------------------------------------------

export interface NetworkMode {
  mode: TransportMode;
  /** Nombre de lignes de ce mode. Un mode absent n'est pas dans la liste. */
  lineCount: number;
}

/**
 * Les modes que le réseau CHARGÉ contient réellement.
 *
 * ⚠️ L'ENUM N'EST PAS LE RÉSEAU. `TransportMode` compte huit valeurs ; le flux
 * de la CTS n'en apporte que deux. Afficher un filtre par valeur d'enum
 * proposerait de filtrer sur un mode qui ne rendra jamais rien.
 */
export function modesDuReseau(signal?: AbortSignal): Promise<{ modes: NetworkMode[] }> {
  return apiFetch<{ modes: NetworkMode[] }>("/stops/modes", { signal });
}
