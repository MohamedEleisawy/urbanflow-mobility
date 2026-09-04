import { apiFetch } from "./api";
import type { TransportMode } from "./types";

// =============================================================================
// « Autour de moi » (war room)
// =============================================================================
// Les arrêts les plus proches d'un point, avec leurs lignes et leur prochain
// passage. Répond à la question qu'on se pose en sortant de chez soi : « que
// puis-je prendre, et quand ? ».
// =============================================================================

export interface LigneDesservie {
  id: string;
  name: string;
  mode: TransportMode;
}

export interface ProchainPassage {
  lineId: string;
  lineName: string;
  mode: TransportMode;
  /** Destination affichée en girouette, quand le flux la publie. */
  headsign: string | null;
  /** Instant du départ, en ISO 8601. */
  departureAt: string;
  waitMin: number;
}

export interface ArretProche {
  id: string;
  name: string;
  latitude: number;
  longitude: number;

  /**
   * Distance À VOL D'OISEAU, en mètres.
   *
   * ⚠️ L'INTERFACE DOIT LE DIRE. Aucun routeur piéton n'est configuré : la
   * distance réelle à pied est plus longue, parfois beaucoup — une voie ferrée
   * ou un fleuve entre les deux points.
   */
  distanceM: number;

  /** Temps de marche ESTIMÉ, dérivé de la distance à vol d'oiseau. */
  walkMin: number;

  pmrAccessible: boolean;

  /** Les lignes desservant ce lieu, tous quais confondus. */
  lines: LigneDesservie[];

  /**
   * Le prochain passage, ou `null`.
   *
   * ⚠️ `null` NE SIGNIFIE PAS « PLUS DE SERVICE ». Il couvre aussi « ce réseau
   * n'a pas d'horaires importés ». C'est `departuresFreshness` qui distingue
   * les deux, et l'interface DOIT s'en servir.
   */
  nextDeparture: ProchainPassage | null;
}

export interface AutourReponse {
  stops: ArretProche[];

  /**
   * `STATIC`  : horaires THÉORIQUES de l'opérateur — ni retard, ni suppression.
   * `UNKNOWN` : aucun horaire connu pour ces arrêts.
   *
   * ⚠️ `REALTIME` N'EXISTE PAS. Aucune source temps réel n'alimente ces
   * horaires, et prétendre le contraire serait le mensonge le plus banal d'une
   * application de transport.
   */
  departuresFreshness: "STATIC" | "UNKNOWN";
}

/**
 * Les arrêts autour d'un point.
 *
 * ⚠️ LE POINT N'EST NI STOCKÉ NI JOURNALISÉ côté serveur. Il sert à une
 * requête, puis il est oublié.
 */
export function arretsAutourDe(
  lat: number,
  lon: number,
  options: { radiusM?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<AutourReponse> {
  const parametres = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
  });

  if (options.radiusM !== undefined) {
    parametres.set("radiusM", String(options.radiusM));
  }

  if (options.limit !== undefined) {
    parametres.set("limit", String(options.limit));
  }

  return apiFetch<AutourReponse>(`/stops/nearby?${parametres.toString()}`, {
    signal,
  });
}
