"use client";

import { useEffect } from "react";

// =============================================================================
// Enregistrement du service worker (bloc 5D-2)
// =============================================================================
// Composant sans rendu : il n'existe que pour son effet. Placé dans le layout,
// il s'exécute une fois par chargement d'application.
//
// ⚠️ IL NE RECHARGE JAMAIS LA PAGE. Le motif répandu — écouter
// `controllerchange` et appeler `location.reload()` — est précisément ce qui
// produit les applications qui se rechargent en boucle. Une nouvelle version
// prend la main à la navigation suivante, ce qui suffit largement.
// =============================================================================

export function ServiceWorker() {
  useEffect(() => {
    // `serviceWorker` est ABSENT sur une origine non sécurisée (http hors
    // localhost) et en navigation privée sur certains navigateurs. Le tester
    // évite un TypeError qui remonterait jusqu'à la racine de l'application.
    if (!("serviceWorker" in navigator)) {
      return;
    }

    // Enregistré APRÈS le chargement complet : le faire pendant laisse le
    // service worker se battre avec la page pour la bande passante, ce qui
    // retarde le premier affichage sans rien accélérer.
    const enregistrer = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Un échec d'enregistrement n'est PAS une panne de l'application :
        // celle-ci fonctionne exactement pareil sans lui. On n'affiche donc
        // rien à l'usager, qui n'aurait de toute façon rien à y faire.
      });
    };

    if (document.readyState === "complete") {
      enregistrer();
      return;
    }

    window.addEventListener("load", enregistrer);
    return () => window.removeEventListener("load", enregistrer);
  }, []);

  return null;
}
