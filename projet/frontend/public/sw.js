// =============================================================================
// Service worker — UrbanFlow Mobility (bloc 5D-2)
// =============================================================================
// La contrainte C1 du sujet exige « manifest, service worker, installable ».
// Le manifeste et l'installabilité ont été traités au bloc 5C-4 ; il manquait
// le service worker, volontairement écarté alors.
//
// ═══ CE QU'IL NE METTRA JAMAIS EN CACHE ═══
//
// Un service worker voit passer TOUTES les requêtes de l'application. Mal
// écrit, il devient une faille : il servirait à un usager les données d'un
// autre resté connecté avant lui sur le même appareil, ou afficherait une
// perturbation terminée depuis trois heures.
//
// Quatre refus, appliqués dans cet ordre par `doitEtreMisEnCache` :
//
//   1. TOUT CE QUI N'EST PAS UN GET. Une écriture ne se rejoue pas.
//   2. TOUTE AUTRE ORIGINE. L'API (`NEXT_PUBLIC_API_URL`) et les tuiles
//      OpenStreetMap sont sur d'autres origines : elles ne sont même pas
//      interceptées.
//   3. TOUTE REQUÊTE PORTANT UN `Authorization`. Ceinture et bretelles : même
//      si l'API venait un jour à partager notre origine, une réponse
//      authentifiée ne serait pas stockée.
//   4. TOUT CE QUI N'EST PAS UN ACTIF DE BUILD. Seuls `/_next/static/` et les
//      icônes sont mis en cache — des fichiers au nom horodaté, immuables par
//      construction. Le HTML, lui, passe toujours par le réseau.
//
// Autrement dit : ce service worker accélère le chargement de l'ENVELOPPE, et
// ne connaît RIEN des données. C'est la seule stratégie qu'on puisse tenir
// sans risque sur une application où presque tout est personnel.
//
// ═══ IL NE RECHARGE JAMAIS LA PAGE ═══
//
// Aucun `location.reload()` sur `controllerchange` : c'est le motif classique
// des applications qui rechargent en boucle. La bascule vers une nouvelle
// version se fait à la navigation suivante, comme n'importe quelle page.
// =============================================================================

/**
 * Le nom du cache PORTE SA VERSION.
 *
 * Changer ce numéro suffit à invalider tout l'ancien contenu : l'ancien cache
 * est supprimé à l'activation. Sans versionnement, un actif corrompu resterait
 * servi indéfiniment, sans moyen de s'en débarrasser à distance.
 */
const CACHE = "urbanflow-v1";

/**
 * Ce qui est mis en cache dès l'installation.
 *
 * UNIQUEMENT la page de repli hors ligne et les icônes. Surtout pas les pages
 * réelles : `/mon-espace` ou `/historique` contiennent des données
 * personnelles, et `/alertes` serait périmée avant d'être relue.
 */
const PRECHARGES = ["/hors-ligne", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    caches.open(CACHE).then((cache) =>
      // `Promise.allSettled` et non `all` : si la page de repli est
      // momentanément indisponible, l'installation ne doit pas échouer
      // entièrement — le service worker reste utile pour le reste.
      Promise.allSettled(PRECHARGES.map((chemin) => cache.add(chemin))),
    ),
  );

  // Prend la main sans attendre la fermeture des onglets ouverts. Sans risque
  // ici : seuls des actifs immuables et horodatés sont servis depuis le cache,
  // jamais du HTML — aucune version ne peut donc en contredire une autre.
  self.skipWaiting();
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((noms) =>
        Promise.all(noms.filter((nom) => nom !== CACHE).map((nom) => caches.delete(nom))),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Cette requête peut-elle être servie depuis le cache ?
 *
 * Rend `false` par DÉFAUT : tout ce qui n'est pas explicitement reconnu passe
 * par le réseau. Une liste d'autorisation, jamais une liste d'interdiction —
 * une interdiction oubliée met en cache une donnée personnelle, une
 * autorisation oubliée ne coûte qu'une requête réseau.
 */
function doitEtreMisEnCache(requete) {
  if (requete.method !== "GET") {
    return false;
  }

  // Une réponse authentifiée n'est jamais partagée, même par erreur.
  if (requete.headers.has("Authorization")) {
    return false;
  }

  const url = new URL(requete.url);

  // Une autre origine : l'API, les tuiles OpenStreetMap, les polices. Rien à
  // faire ici — ces réponses ne nous appartiennent pas.
  if (url.origin !== self.location.origin) {
    return false;
  }

  // Garde-fou explicite : si l'API venait un jour à partager notre origine
  // (déploiement derrière un même domaine), elle resterait exclue.
  if (url.pathname.startsWith("/api/")) {
    return false;
  }

  // Actifs de build : leur nom contient une empreinte, ils ne changent donc
  // jamais de contenu à URL constante. C'est ce qui rend le cache sûr.
  return url.pathname.startsWith("/_next/static/") || /^\/icon-[\w-]+\.png$/.test(url.pathname);
}

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;

  // Une NAVIGATION passe toujours par le réseau : le HTML peut contenir des
  // données personnelles, et une page servie depuis le cache montrerait
  // l'état d'une session précédente. Le cache ne sert que de FILET quand le
  // réseau est absent (contrainte C10, « connectivité variable »).
  if (requete.mode === "navigate") {
    evenement.respondWith(fetch(requete).catch(() => caches.match("/hors-ligne")));
    return;
  }

  if (!doitEtreMisEnCache(requete)) {
    // On ne répond pas : le navigateur poursuit normalement, exactement comme
    // si aucun service worker n'existait.
    return;
  }

  evenement.respondWith(
    caches.match(requete).then((enCache) => {
      if (enCache) {
        return enCache;
      }

      return fetch(requete).then((reponse) => {
        // Seules les réponses complètes et valides sont conservées : stocker
        // une 404 ou une réponse partielle la figerait pour toute la durée
        // de vie du cache.
        if (reponse.ok && reponse.status === 200) {
          const copie = reponse.clone();
          void caches.open(CACHE).then((cache) => cache.put(requete, copie));
        }
        return reponse;
      });
    }),
  );
});
