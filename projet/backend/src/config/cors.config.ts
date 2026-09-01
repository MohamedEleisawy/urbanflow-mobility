import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

// =============================================================================
// Politique CORS — SOURCE UNIQUE (étape 7-1)
// =============================================================================
// ═══ POURQUOI CE FICHIER EXISTE ═══
//
// La configuration vivait dans `main.ts`, et le test e2e la RECOPIAIT :
//
//   // On reproduit la configuration CORS de main.ts.
//   app.enableCors({ methods: ['GET', 'POST', 'DELETE'], ... });
//
// Le test validait donc sa propre copie. Quand `PATCH /users/me/preferences`
// est apparu à l'étape 5E, la liste des méthodes n'a été mise à jour NI dans
// `main.ts`, NI dans le test — et rien n'a échoué : supertest parle au serveur
// sans navigateur, et CORS est une protection du NAVIGATEUR.
//
// Le symptôme serait apparu au pire endroit possible : dans la console d'un
// usager, sur l'enregistrement de ses préférences, avec un message parlant du
// préflight et non du code fautif.
//
// Ce module est désormais importé par `main.ts` ET par le test. Une méthode
// ajoutée ici l'est partout ; un oubli devient impossible plutôt
// qu'improbable.
// =============================================================================

/**
 * Verbes HTTP réellement exposés par l'API.
 *
 * Relevé exhaustif des décorateurs de route (`@Get`, `@Post`, `@Patch`,
 * `@Delete`) et des appels du frontend (`apiFetch`) :
 *
 *   GET     lectures : /stops, /alerts, /routes, /users/me, /admin/*…
 *   POST    /users, /auth/login, /routes/search, /routes, /carbone, /stops…
 *   PATCH   /users/me/preferences — AJOUTÉ EN 7-1, il manquait
 *   DELETE  /users/me, /routes/:id, /admin/users/:id
 *
 * ⚠️ PAS DE `PUT`. Aucune route ne l'emploie, et aucun appel frontend ne
 * l'envoie. L'annoncer ne « bloquerait » rien de plus, mais décrirait une
 * capacité inexistante — la même raison qui a fait limiter cette liste au
 * départ.
 *
 * `OPTIONS` n'y figure pas non plus : c'est la requête préalable elle-même,
 * traitée par le middleware CORS, jamais une route applicative.
 */
export const METHODES_EXPOSEES = ['GET', 'POST', 'PATCH', 'DELETE'] as const;

/**
 * Origines autorisées à appeler l'API depuis un navigateur.
 *
 * JAMAIS `*`. Le dossier de conception l'écrit noir sur blanc (§3.1.2) :
 * « Les en-têtes CORS sont configurés pour n'accepter que les requêtes du
 * domaine Vercel du frontend ». Une origine générique laisserait n'importe
 * quel site appeler cette API depuis le navigateur d'un usager connecté.
 *
 * Plusieurs origines se déclarent séparées par des virgules — le déploiement
 * (Vercel) et le développement local peuvent coexister.
 */
export function originesAutorisees(): string[] {
  const configurees = process.env.FRONTEND_URL?.trim();

  // Repli sur le port de développement, comme CARBON_SERVICE_URL (4D-2) : il
  // est PLAUSIBLE, puisque c'est là que `npm run dev` sert le frontend. Un
  // repli n'est légitime que lorsqu'il correspond à une réalité.
  if (!configurees) {
    return ['http://localhost:3000'];
  }

  return configurees
    .split(',')
    .map((origine) => origine.trim())
    .filter(Boolean);
}

/**
 * Options passées à `app.enableCors()`.
 *
 * Lues À CHAQUE APPEL, jamais figées dans une constante de module : un test
 * qui modifie `FRONTEND_URL` doit voir sa valeur prise en compte.
 */
export function optionsCors(): CorsOptions {
  return {
    origin: originesAutorisees(),
    // `readonly` du `as const` retiré : l'interface attend un tableau mutable.
    methods: [...METHODES_EXPOSEES],
    // Authorization : le jeton JWT. Content-Type : les corps JSON.
    allowedHeaders: ['Content-Type', 'Authorization'],
    // PAS de `credentials: true` : l'authentification passe par un en-tête
    // Authorization, pas par un cookie. L'activer ouvrirait l'envoi
    // automatique de cookies entre origines sans qu'aucun cookie n'existe.
  };
}
