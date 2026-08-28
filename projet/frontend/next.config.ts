import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  /**
   * En-têtes de sécurité (bloc 5D-2).
   *
   * Repris du guide PWA de cette version de Next.js
   * (`node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`,
   * § « Securing your application »), et exigés par la contrainte C4 du sujet
   * (« sécurité des données conformément aux standards OWASP »).
   *
   * ⚠️ CE SONT DES EN-TÊTES DE DÉVELOPPEMENT ET DE `next start`. Derrière un
   * proxy de production (Vercel, Render, nginx), c'est lui qui a le dernier
   * mot : `Strict-Transport-Security` en particulier n'a de sens qu'en HTTPS
   * et se pose au niveau du proxy, raison pour laquelle il n'est pas déclaré
   * ici — l'annoncer sur `http://localhost` n'aurait aucun effet et
   * masquerait qu'il reste à configurer au déploiement.
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Empêche le navigateur de deviner un type MIME : un fichier servi
          // en `text/plain` ne peut plus être exécuté comme du script.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Interdit l'inclusion dans une iframe — le vecteur du
          // détournement de clic (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          // Ne divulgue pas l'URL complète aux autres origines. Important
          // ici : nos URL contiennent des identifiants de trajet
          // (`/historique/<uuid>`), qui n'ont pas à fuiter vers le serveur de
          // tuiles OpenStreetMap.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Aucune de ces API n'est utilisée par l'application… sauf la
          // géolocalisation, ajoutée au bloc 5D-1, et restreinte à notre
          // propre origine : une iframe tierce ne pourrait pas s'en servir.
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=(), payment=()",
          },
        ],
      },
      {
        // ⚠️ L'EN-TÊTE LE PLUS IMPORTANT DE CE FICHIER.
        //
        // `no-store` sur `/sw.js` : sans lui, le navigateur peut conserver
        // l'ancien service worker jusqu'à 24 h et continuer de l'exécuter
        // alors qu'une nouvelle version est déployée. C'est ainsi que
        // survivent les service workers fantômes — ceux qui interceptent
        // encore les requêtes d'un projet qui n'existe plus.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          // Le service worker ne charge aucun script tiers, et ne doit jamais
          // pouvoir le faire.
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
