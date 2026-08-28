// =============================================================================
// Estimation carbone d'un itinéraire (étape 5A-6)
// =============================================================================
// Construit sur `apiFetch` (5A-2), comme les autres fichiers `*-api.ts`.
// Aucune nouvelle couche HTTP, aucune dépendance.
//
// PUBLIC : aucun jeton. Le contrôleur backend le dit explicitement — « exiger
// un compte pour savoir combien émet un trajet en bus n'aurait aucun sens ».
// =============================================================================

import { apiFetch } from "./api";
import type { CarbonResult, CarbonSegmentInput, ItinerarySegment } from "./types";

/**
 * Traduit les étapes d'un itinéraire en segments pour le calcul carbone.
 *
 * LA CONVERSION EST TRIVIALE, ET C'EST UNE BONNE NOUVELLE : les deux contrats
 * parlent la même langue. `POST /api/carbone` ne demande QUE `mode` et
 * `distanceM` — « la durée, les arrêts ou les noms de lignes n'interviennent
 * pas, les émissions se mesurant au kilomètre et non à la minute ».
 *
 * DEUX POINTS VÉRIFIÉS PLUTÔT QUE SUPPOSÉS :
 *
 *   - l'unité est le MÈTRE des deux côtés (`distanceM`). Aucune conversion,
 *     donc aucune occasion de se tromper d'un facteur 1000 ;
 *   - `@IsInt()` refuse les décimaux. Les distances viennent de
 *     `NetworkLink.distanceM`, une colonne `Int` : elles sont entières par
 *     construction. Rien à arrondir.
 *
 * AUCUN SEGMENT N'EST ÉCARTÉ, et c'est délibéré. La marche et le vélo ont un
 * facteur d'émission de **0 g/km** côté microservice : ce sont des modes
 * calculables, pas des modes inconnus. Les retirer fausserait le résultat —
 * `carCo2Grams` est calculé sur la distance TOTALE soumise, donc omettre la
 * marche réduirait artificiellement les économies affichées.
 */
export function versSegmentsCarbone(
  segments: ItinerarySegment[],
): CarbonSegmentInput[] {
  return segments.map((segment) => ({
    mode: segment.mode,
    distanceM: segment.distanceM,
  }));
}

/**
 * Estime l'empreinte d'un itinéraire COMPLET, en un seul appel.
 *
 * POURQUOI PAS UN APPEL PAR ÉTAPE. Le contrat accepte un TABLEAU de segments
 * et rend le bilan de l'ensemble : total, équivalent voiture, économies,
 * éco-score et répartition par mode. Découper puis additionner soi-même
 * serait à la fois plus lent et FAUX — l'éco-score est un ratio, il ne
 * s'additionne pas, et le recomposer reviendrait à inventer une formule.
 *
 * Erreurs attendues :
 *   400  segments vides ou distance non entière (validation NestJS)
 *   422  un mode reconnu mais SANS facteur d'émission — `ESCOOTER`
 *        aujourd'hui. Ce n'est pas une panne : le refus est légitime, et
 *        le microservice refuse plutôt que d'inventer un chiffre.
 *   503  microservice FastAPI injoignable ou en erreur
 */
export function estimerCarbone(
  segments: ItinerarySegment[],
  signal?: AbortSignal,
): Promise<CarbonResult> {
  return apiFetch<CarbonResult>("/carbone", {
    method: "POST",
    body: { segments: versSegmentsCarbone(segments) },
    signal,
  });
}
