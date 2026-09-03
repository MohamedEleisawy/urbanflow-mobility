import { apiFetch } from "./api";

// =============================================================================
// Territoire desservi (Phase 6)
// =============================================================================
// ⚠️ POURQUOI LE FRONTEND NE LIT PAS SA PROPRE VARIABLE D'ENVIRONNEMENT.
//
// Il le pourrait — `NEXT_PUBLIC_TERRITORY_*` fonctionnerait. Ce serait alors
// DEUX sources de vérité à tenir accordées : un déploiement qui changerait le
// territoire côté backend sans toucher au frontend afficherait une carte
// centrée sur une ville et des arrêts d'une autre.
//
// Une seule variable, un seul endpoint : le frontend demande où il se trouve.
// =============================================================================

export interface Territoire {
  /** Identifiant court et stable : « strasbourg ». */
  name: string;
  /** Nom affiché : « Eurométropole de Strasbourg ». */
  displayName: string;
  country: string;
  /** Centre de la carte à l'ouverture — PAS la position de l'usager. */
  centerLat: number;
  centerLon: number;
  /** Rayon indicatif du territoire, en mètres. */
  radiusM: number;
}

/**
 * Le territoire desservi par cette installation.
 *
 * Ne peut pas rendre une liste vide : le backend a toujours des valeurs par
 * défaut. Un échec réseau, lui, reste possible — l'appelant doit prévoir un
 * repli, faute de quoi la carte n'aurait aucun centre.
 */
export function territoire(signal?: AbortSignal): Promise<Territoire> {
  return apiFetch<Territoire>("/territory", { signal });
}
