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
  RouteSegment,
  SearchItineraryRequest,
  Stop,
} from "./types";

/**
 * Tous les arrêts du réseau.
 *
 * POURQUOI CHARGER LA LISTE ENTIÈRE. Le backend n'expose AUCUNE recherche
 * d'arrêt par nom : `StopsController` ne déclare que `GET /` et `GET /:id`.
 * Il n'existe pas non plus de géocodage — rien ne transforme « Gare du Nord »
 * en coordonnées.
 *
 * Charger la liste et faire choisir l'usager est donc la seule façon
 * d'obtenir des coordonnées sans inventer un contrat. C'est acceptable
 * aujourd'hui : le réseau de démonstration compte six arrêts, et un import
 * GTFS réel en mettrait quelques milliers — un champ de saisie avec
 * autocomplétion côté serveur deviendrait alors nécessaire, et c'est un
 * ajout BACKEND, pas un contournement frontend.
 */
export function listerArrets(): Promise<Stop[]> {
  return apiFetch<Stop[]>("/stops");
}

/**
 * Recherche des itinéraires entre deux points.
 *
 * ⚠️ LE BACKEND ATTEND DES COORDONNÉES, pas des identifiants d'arrêt : il
 * cherche lui-même l'arrêt le PLUS PROCHE de chaque point, dans un rayon de
 * 2 km. Passer un `stopId` n'est pas prévu par le contrat.
 *
 * Rend 0, 1 ou 2 itinéraires :
 *   - `FASTEST` et `SHORTEST`, calculés par deux exécutions de Dijkstra ;
 *   - un SEUL quand les deux chemins sont identiques (le backend
 *     déduplique) ;
 *   - AUCUN quand les deux points tombent sur le même arrêt, quand aucun
 *     arrêt n'est à moins de 2 km, ou quand le réseau n'offre pas de chemin.
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
 * LE CLIENT DÉSIGNE, IL NE DÉCRIT PAS. Chaque segment n'envoie que le triplet
 * `(lineId, fromStopId, toStopId)` — exactement la clé unique de
 * `NetworkLink`. Le serveur ira lire lui-même le mode, la distance, la durée,
 * la ligne et l'exploitant.
 *
 * Ce que le frontend affiche (durée, distance, empreinte) reste donc à
 * l'écran, mais n'est JAMAIS transmis comme vérité : le serveur recalcule
 * tout à partir du réseau.
 */
export function versRequeteEnregistrement(
  segments: ItinerarySegment[],
  origine: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): EnregistrerItineraireRequest {
  return {
    originLat: origine.latitude,
    originLng: origine.longitude,
    destinationLat: destination.latitude,
    destinationLng: destination.longitude,
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
