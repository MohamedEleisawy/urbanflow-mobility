import { apiFetch } from "./api";

// =============================================================================
// Stations Vélib' (Phase 5)
// =============================================================================
// ⚠️ LE FRONTEND N'APPELLE JAMAIS GBFS DIRECTEMENT. Il passe par notre backend,
// pour trois raisons détaillées côté serveur (`VelibService`) :
//
//   1. les deux flux pèsent ~730 ko pour 1 519 stations — un cache serveur les
//      sert tous, un téléchargement par navigateur serait absurde ;
//   2. le fournisseur ne promet aucun en-tête CORS ;
//   3. le contrat public reste `/api/velib/*` : changer de fournisseur ne
//      touchera pas une ligne d'interface.
// =============================================================================

/**
 * Fraîcheur d'une donnée.
 *
 * ⚠️ CE TYPE EXISTE POUR QUE « TEMPS RÉEL » NE SOIT JAMAIS ÉCRIT À TORT.
 * `STATIC` = référentiel (nom, position) ; `REALTIME` = mesuré, horodaté ;
 * `UNKNOWN` = la source ne dit pas quand elle a mesuré.
 */
export type DataFreshness = "STATIC" | "REALTIME" | "UNKNOWN";

export interface VelibStation {
  stationId: string;
  /** Code lisible sur la borne — distinct de l'identifiant machine. */
  stationCode: string | null;
  name: string;
  latitude: number;
  longitude: number;
  capacity: number | null;

  /**
   * ⚠️ `null` SIGNIFIE « NON PUBLIÉ », JAMAIS « AUCUN ». `0` et `null` doivent
   * rester discernables à l'écran : « aucun vélo électrique » et « nous ne
   * savons pas » ne disent pas la même chose à quelqu'un qui attend un vélo.
   */
  mechanical: number | null;
  electric: number | null;
  bikesAvailable: number | null;
  docksAvailable: number | null;

  isRenting: boolean | null;
  isReturning: boolean | null;
  isInstalled: boolean | null;

  /** Instant de la mesure, en ISO. `null` = non horodatée. */
  lastReported: string | null;
  freshness: DataFreshness;

  /** Distance au point demandé. `null` hors recherche de proximité. */
  distanceM: number | null;
}

export interface VelibStationsResponse {
  stations: VelibStation[];
  /** Nombre de stations correspondant à la demande, avant plafonnement. */
  total: number;
  /** Instant où le SERVEUR a lu le flux — distinct de `lastReported`. */
  fetchedAt: string;
  attribution: string;
}

/**
 * Stations autour d'un point, de la plus proche à la plus éloignée.
 *
 * Erreurs attendues :
 *   400  coordonnées absentes ou hors bornes, rayon trop large
 *   503  flux Vélib' injoignable, en erreur ou illisible
 *
 * Une liste VIDE n'est pas une erreur : « aucune station à moins de 800 m »
 * est une réponse que l'interface doit savoir afficher.
 */
export function velibProches(
  latitude: number,
  longitude: number,
  options: { radiusM?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<VelibStationsResponse> {
  const parametres = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
  });

  if (options.radiusM !== undefined) {
    parametres.set("radiusM", String(options.radiusM));
  }

  if (options.limit !== undefined) {
    parametres.set("limit", String(options.limit));
  }

  return apiFetch<VelibStationsResponse>(`/velib/nearby?${parametres.toString()}`, {
    signal,
  });
}
