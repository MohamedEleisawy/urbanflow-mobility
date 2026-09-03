import { apiFetch } from "./api";

// =============================================================================
// Capacités de l'installation (sprint soutenance)
// =============================================================================
// ═══ POURQUOI CE MODULE EXISTE ═══
//
// Une interface de mobilité est truffée de promesses : « vélo », « à pied »,
// « temps réel », « prochain passage ». Chacune n'est tenable que si une source
// existe derrière — et plusieurs de ces sources exigent une clé qu'un
// déploiement de démonstration n'a pas.
//
// Plutôt que d'afficher le bouton et de le laisser échouer, l'application
// DEMANDE au backend ce qu'il sait faire, et le dit à l'usager.
//
// ⚠️ AUCUNE URL, AUCUNE CLÉ NE TRANSITE PAR CET ENDPOINT. Seuls des états et
// des noms de fournisseurs.
// =============================================================================

export type EtatSource = "CONFIGURED" | "NOT_CONFIGURED";

export interface CapaciteRoutage {
  status: EtatSource;
  /** Nom du fournisseur : « osrm », « valhalla »… `null` si non configuré. */
  provider: string | null;
}

export interface IdentiteLegale {
  /**
   * Raison sociale de l'exploitant.
   *
   * ⚠️ `null` EST UNE RÉPONSE LÉGITIME, et l'interface doit l'afficher comme
   * telle. Inventer un nom sur une page « Mentions légales » ne serait pas du
   * texte de remplissage : ce serait une fausse identité de responsable de
   * traitement, sur la page même qui doit la donner.
   */
  entityName: string | null;
  contactEmail: string | null;
  privacyContactEmail: string | null;
}

export interface Capacites {
  /** Routage piéton porte-à-porte, rue par rue. */
  walkRouting: CapaciteRoutage;

  /**
   * Routage cyclable.
   *
   * ⚠️ SANS RAPPORT AVEC VÉLHOP. Savoir où sont les vélos en libre-service ne
   * dit pas par où l'on roule : les deux capacités sont distinctes.
   */
  bikeRouting: CapaciteRoutage;

  /** Temps réel du réseau (positions, retards, perturbations). */
  transitRealtime: CapaciteRoutage;

  legal: IdentiteLegale;
}

/**
 * Ce que cette installation sait réellement faire.
 *
 * Ne peut pas rendre de valeur partielle : le backend a toujours une réponse,
 * une variable absente valant « non configuré ». Un échec RÉSEAU reste
 * possible — l'appelant doit alors se comporter comme si rien n'était
 * configuré, jamais l'inverse.
 */
export function capacites(signal?: AbortSignal): Promise<Capacites> {
  return apiFetch<Capacites>("/capabilities", { signal });
}
