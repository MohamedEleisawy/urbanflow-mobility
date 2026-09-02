import { redirect } from "next/navigation";

// =============================================================================
// Racine du site (refonte mobilité)
// =============================================================================
// ═══ CE QUI A REMPLACÉ QUOI ═══
//
// `/` présentait auparavant une page de présentation : un titre, quatre
// encadrés décrivant ce que l'application savait faire, et un bouton menant
// enfin à la recherche.
//
// UrbanFlow est une application de mobilité, pas une plaquette. Un usager qui
// l'ouvre veut un itinéraire, pas la liste de ses fonctionnalités — et le
// texte qui la décrivait avait d'autant moins de raison d'être que l'écran de
// recherche, lui, la démontre.
//
// ═══ POURQUOI UNE REDIRECTION, ET NON UNE COPIE DE L'ÉCRAN ═══
//
// Deux routes rendant le même écran, ce sont deux écrans à faire évoluer
// ensemble — et le jour où l'un change, l'autre ne suit pas. `redirect()`
// garde UNE seule implémentation.
//
// C'est une redirection de SERVEUR (307) : elle a lieu avant tout rendu, sans
// éclair de page vide ni script à charger. La solution la plus simple que
// Next.js propose pour ce cas, et celle que sa documentation recommande.
//
// ⚠️ `/recherche` reste l'adresse canonique. La changer en `/` ferait perdre
// les liens existants — dont ceux de l'en-tête et du manifeste PWA.
export default function AccueilPage() {
  redirect("/recherche");
}
