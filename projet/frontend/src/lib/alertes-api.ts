// =============================================================================
// Perturbations du réseau (bloc 5C-3)
// =============================================================================
// UNE SEULE ROUTE, et elle est PUBLIQUE : aucun jeton n'est transmis.
// `AlertsController` ne pose aucun `@UseGuards`, et le dossier place
// « UC02 Consulter les alertes » en libre accès. Le dossier demande d'ailleurs
// explicitement que l'application reste utilisable sans compte lorsque celui-ci
// n'est pas nécessaire — c'est le cas ici.
// =============================================================================

import { apiFetch } from "./api";
import type { AlertsResponse } from "./types";

/**
 * Les perturbations en cours, telles que le backend les trie.
 *
 * ⚠️ L'ORDRE VIENT DU SERVEUR, il ne se retrie pas côté client. Le service
 * classe par gravité décroissante (SEVERE → WARNING → INFO), puis par date de
 * début décroissante, puis par identifiant. Retrier ici produirait un ordre
 * différent de celui que le backend documente et teste.
 *
 * ⚠️ L'ENDPOINT N'EST PAS PAGINÉ. Il applique un plafond serveur (`limit`,
 * 200) et signale par `truncated` que des alertes ont été omises. Il n'existe
 * ni `page`, ni `offset` : inventer une pagination côté client ne ramènerait
 * jamais les alertes manquantes.
 *
 * Une réponse vide (`items: []`) est une réponse, pas une panne : elle veut
 * dire « aucune perturbation en cours ».
 */
export function listerAlertes(signal?: AbortSignal): Promise<AlertsResponse> {
  return apiFetch<AlertsResponse>("/alerts", { signal });
}
