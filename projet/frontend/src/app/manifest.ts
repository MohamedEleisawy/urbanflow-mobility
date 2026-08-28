import type { MetadataRoute } from "next";

// =============================================================================
// Manifeste d'application web (bloc 5C-4)
// =============================================================================
// Convention de fichier de cette version de Next.js : `app/manifest.ts` est
// servi à `/manifest.webmanifest`, et la balise <link rel="manifest"> est
// posée automatiquement — rien à ajouter dans le layout.
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
//  01-metadata/manifest.md)
//
// ═══ POURQUOI AUCUN SERVICE WORKER ═══
//
// Le guide PWA de cette version le dit explicitement :
//
//   « Notably, you can trigger install prompts without needing offline
//     support. »
//
// L'objectif de l'étape est que l'application soit INSTALLABLE. Un manifeste
// valide et des icônes y suffisent. Un service worker ajouterait un cache
// dont les risques sont réels et documentés dans la consigne :
//
//   - il intercepterait les réponses AUTHENTIFIÉES (`/routes`, `/users/me`,
//     `/suivi-carbone`) et pourrait servir à un usager les données d'un autre
//     resté connecté avant lui sur le même appareil ;
//   - il mettrait en cache des PERTURBATIONS PÉRIMÉES — précisément
//     l'information qu'on ne peut pas se permettre d'afficher fausse ;
//   - il survit à la désinstallation de l'application et se met à jour selon
//     ses propres règles, ce qui en fait la source classique de pages qui
//     rechargent en boucle.
//
// Aucune stratégie de cache hors-ligne n'a été démontrée nécessaire ici. Le
// jour où elle le sera, elle devra désigner explicitement ce qui est
// cachable — et les réponses authentifiées n'en feront pas partie.
// =============================================================================

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "UrbanFlow Mobility",
    // `short_name` est ce qui s'affiche SOUS l'icône, sur un écran d'accueil
    // de téléphone : au-delà d'une douzaine de caractères, le système le
    // tronque avec des points de suspension.
    short_name: "UrbanFlow",
    description:
      "Planifiez vos trajets multimodaux, consultez les perturbations du réseau et mesurez l'empreinte carbone de vos déplacements.",

    // L'accueil, et non un écran protégé : l'application s'ouvre sur du
    // contenu consultable sans compte.
    start_url: "/",
    scope: "/",
    lang: "fr",

    // `standalone` : sans barre d'adresse, comme une application native.
    // `fullscreen` masquerait aussi l'heure et la batterie, ce qui n'a pas de
    // sens pour un service qu'on consulte en marchant.
    display: "standalone",
    orientation: "portrait",

    // Les couleurs de l'identité visuelle (§2.8.2 du dossier), déjà déclarées
    // dans `globals.css` : le fond gris clair de l'application, et le bleu de
    // la barre système.
    background_color: "#f5f5f5",
    theme_color: "#1e3a5f",

    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // `maskable` : Android découpe l'icône selon la forme du thème (cercle,
      // goutte, carré arrondi). Sans une variante prévue pour cela, le tracé
      // se ferait rogner sur les bords.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
