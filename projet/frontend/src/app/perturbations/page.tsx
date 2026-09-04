import { redirect } from "next/navigation";

// =============================================================================
// Perturbations — page publique RETIRÉE
// =============================================================================
// ═══ POURQUOI CETTE PAGE N'EXISTE PLUS ═══
//
// Elle promettait les perturbations du réseau. Or aucune source ne les
// fournit : la CTS ne publie pas de GTFS-RT, et son flux SIRI-Lite exige un
// jeton nominatif que cette installation n'a pas. `GET /api/capabilities`
// répond `transitRealtime: NOT_CONFIGURED`, et `GET /api/alerts` rend une
// liste vide — non pas parce que le réseau va bien, mais parce que personne ne
// nous dit comment il va.
//
// Une page qui annonce « perturbations en cours » et n'en montre jamais aucune
// n'informe pas : elle RASSURE À TORT. Un usager en conclut que sa ligne
// circule normalement. Mieux vaut ne rien promettre.
//
// ═══ CE QUI RESTE, ET POURQUOI ═══
//
// ⚠️ L'API `GET /api/alerts` EST CONSERVÉE, ainsi que le module backend et
// l'import GTFS-RT. Le jour où une source est configurée, les perturbations
// s'affichent déjà sur `/itineraire` — mais UNIQUEMENT pour les lignes
// réellement empruntées, là où l'information est actionnable.
//
// ⚠️ REDIRECTION, ET NON SUPPRESSION PURE. Des liens existent : favoris,
// historique de navigateur, ancienne adresse `/alertes`. Retirer l'URL
// donnerait une 404 à quelqu'un qui avait mis la page de côté.
// =============================================================================
export default function PerturbationsPage() {
  redirect("/recherche");
}
