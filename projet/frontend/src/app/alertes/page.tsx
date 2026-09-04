import { redirect } from "next/navigation";

// =============================================================================
// Ancienne adresse des perturbations (sprint soutenance)
// =============================================================================
// L'écran des perturbations a été RETIRÉ : aucune source de temps réel n'est
// configurée, et une page qui n'affiche jamais aucune perturbation rassure à
// tort. Voir `app/perturbations/page.tsx`.
//
// ⚠️ CETTE REDIRECTION N'EST PAS UNE POLITESSE. Des liens existent : le
// manifeste PWA, des favoris, l'historique des navigateurs. Supprimer l'URL
// donnerait une 404 à quelqu'un qui avait mis la page de côté.
//
// Redirection de SERVEUR (307) : elle a lieu avant tout rendu, sans éclair de
// page vide ni script à charger.
// =============================================================================
export default function AlertesPage() {
  redirect("/recherche");
}
