"use client";

import { useEffect } from "react";

// =============================================================================
// Enregistrement du service worker (bloc 5D)
// =============================================================================
// ═══ ⚠️ EN PRODUCTION UNIQUEMENT, ET CE N'EST PAS UNE PRÉCAUTION DE STYLE ═══
//
// Le service worker met `/_next/static/*` en cache SANS JAMAIS REVALIDER
// (`sw.js` : `if (enCache) return enCache;`). Ce choix repose sur une
// hypothèse écrite dans son propre commentaire :
//
//   « leur nom contient une empreinte, ils ne changent donc jamais de
//     contenu à URL constante »
//
// C'est VRAI après `next build`. C'est FAUX avec `next dev` : Turbopack
// réutilise les mêmes URL de fragments d'une recompilation à l'autre, avec un
// contenu différent.
//
// Conséquence observée, et diagnostiquée sur ce projet : le navigateur
// recevait un ancien fragment servi par le cache pendant que le serveur en
// avait un nouveau. Next détectait l'incohérence, rechargeait la page — qui
// recevait de nouveau le fragment périmé. **Boucle de rechargement infinie**,
// visible côté serveur comme un flot ininterrompu de `GET /recherche 200`.
//
// Enregistrer le service worker en développement n'apporte par ailleurs
// RIEN : on ne teste pas le mode hors-ligne sur un serveur qui recompile à
// chaque frappe.
//
// ═══ POURQUOI ON DÉSINSTALLE ACTIVEMENT EN DÉVELOPPEMENT ═══
//
// Ne plus l'enregistrer ne suffit pas. Un service worker déjà installé SURVIT
// au changement de code : il reste actif, continue de servir ses fragments
// périmés, et la boucle persiste. Il faut donc le retirer explicitement — et
// vider son cache, faute de quoi le prochain enregistrement le retrouverait.
// =============================================================================

export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    // --- Développement : on désinstalle, on ne s'enregistre pas ------------
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((enregistrements) => Promise.all(enregistrements.map((e) => e.unregister())))
        .then(() =>
          "caches" in window
            ? caches.keys().then((noms) => Promise.all(noms.map((n) => caches.delete(n))))
            : undefined,
        )
        // Un échec ici n'a rien de grave : le navigateur peut refuser l'accès
        // aux caches selon le contexte. On ne casse pas la page pour autant.
        .catch(() => undefined);

      return;
    }

    // --- Production : enregistrement normal --------------------------------
    const enregistrer = () => {
      // `catch` silencieux : un enregistrement refusé — navigation privée,
      // réglage du navigateur — ne doit pas faire échouer la page. Le mode
      // hors-ligne est un CONFORT, pas une condition de fonctionnement.
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Ignoré volontairement.
      });
    };

    // Attendre `load` : l'enregistrement déclenche le préchargement des
    // ressources, qui entrerait sinon en concurrence avec l'affichage
    // initial de la page.
    if (document.readyState === "complete") {
      enregistrer();
      return;
    }

    window.addEventListener("load", enregistrer);
    return () => window.removeEventListener("load", enregistrer);
  }, []);

  return null;
}
