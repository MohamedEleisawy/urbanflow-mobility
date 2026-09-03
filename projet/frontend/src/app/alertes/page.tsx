import { redirect } from "next/navigation";

// =============================================================================
// Ancienne adresse des perturbations (sprint soutenance)
// =============================================================================
// L'écran vit désormais sur `/perturbations`, un mot que l'usager reconnaît :
// « alertes » désigne aussi bien des notifications de compte, et l'en-tête
// affichait déjà « Perturbations » vers une URL nommée autrement.
//
// ⚠️ CETTE REDIRECTION N'EST PAS UNE POLITESSE. Des liens existent : le
// manifeste PWA, des favoris, l'historique des navigateurs. Supprimer l'URL
// donnerait une 404 à quelqu'un qui avait mis la page de côté.
//
// Redirection de SERVEUR (307) : elle a lieu avant tout rendu, sans éclair de
// page vide ni script à charger.
// =============================================================================
export default function AlertesPage() {
  redirect("/perturbations");
}
