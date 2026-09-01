import type { NextFunction, Request, Response } from 'express';

// =============================================================================
// En-têtes de sécurité de l'API (étape 7-1)
// =============================================================================
// L'audit 6-7 a relevé qu'aucun en-tête de sécurité n'était posé côté backend,
// alors que le frontend en pose cinq (`next.config.ts`). CLAUDE.md §7 les
// exige. Ce module comble l'écart.
//
// ═══ HELMET, OU QUATRE EN-TÊTES ÉCRITS À LA MAIN ? ═══
//
// La question a été posée avant d'installer quoi que ce soit.
//
//   helmet 8.3.0 : AUCUNE dépendance transitive, 105 Ko décompressés,
//   maintenu, ~15 en-têtes. Ce n'est pas une mauvaise bibliothèque — c'est
//   même la réponse par défaut, et la bonne, pour une application web.
//
// Deux faits ont fait pencher autrement, et aucun n'est « c'est trop lourd » :
//
// 1. CETTE API NE SERT QUE DU JSON. Elle ne rend aucun document HTML, ne
//    charge aucun script, aucune image, aucune police. La majorité des
//    en-têtes de helmet décrivent le comportement d'une PAGE : ils seraient
//    posés sans jamais s'appliquer à quoi que ce soit.
//
// 2. HELMET NE S'INSTALLERAIT PAS SANS RÉFLEXION ICI. Sa politique de
//    contenu par défaut est écrite pour une page qui charge des ressources,
//    et ses en-têtes d'isolation d'origine (CORP / COEP) demandent un examen
//    dès lors que l'API est consommée depuis une AUTRE origine — ce qui est
//    précisément notre cas. Le travail de décision serait le même ; seule la
//    quantité de code non lu changerait.
//
// Quatre en-têtes que je peux nommer, justifier et tester valent mieux que
// quinze dont j'aurais à vérifier lesquels s'appliquent.
//
// ⚠️ CE CHOIX A UNE DATE DE PÉREMPTION, et elle est écrite : le jour où ce
// backend servira une page HTML — documentation Swagger, page d'erreur
// rédigée, portail d'administration servi par Nest — helmet redeviendra la
// bonne réponse, et ce fichier devra lui céder la place.
// =============================================================================

/**
 * Pose les en-têtes de sécurité sur CHAQUE réponse de l'API.
 *
 * Fonction de middleware Express ordinaire, appliquée via `app.use()` dans la
 * configuration partagée : elle n'a besoin d'aucune injection, et un
 * `NestMiddleware` avec sa classe et son module d'enregistrement n'apporterait
 * rien de plus ici.
 */
export function entetesDeSecurite(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // ⚠️ Express annonce « X-Powered-By: Express » sur chaque réponse — un
  // renseignement offert gratuitement à qui cherche une faille connue.
  //
  // Retiré ICI plutôt que par `app.disable('x-powered-by')` dans `main.ts`,
  // pour deux raisons : l'instance Express n'est accessible que via
  // `getHttpAdapter().getInstance()`, qui est typé `any` — et surtout, le
  // désactiver là-bas obligerait chaque test e2e à répéter la ligne. Un seul
  // endroit décide des en-têtes de cette API.
  //
  // Express le pose au tout début de la requête ; le retirer ici, avant
  // l'envoi de la réponse, suffit.
  res.removeHeader('X-Powered-By');

  // Empêche le navigateur de DEVINER le type d'une réponse. Sans lui, un
  // corps JSON contenant du HTML pourrait être interprété comme une page
  // dans certains contextes hérités.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // L'API ne rend aucune page : elle n'a jamais de raison d'être affichée
  // dans un cadre. `frame-ancestors` de la CSP ci-dessous dit la même chose
  // aux navigateurs récents ; celui-ci couvre les plus anciens.
  res.setHeader('X-Frame-Options', 'DENY');

  // `default-src 'none'` : cette réponse n'a le droit de charger RIEN.
  //
  // Sur du JSON, la politique ne s'applique à rien — et c'est justement
  // l'intérêt : elle neutralise le cas où une page HTML sortirait d'ici par
  // accident (trace d'erreur d'Express, page 404 par défaut).
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'",
  );

  // Une requête d'API n'a aucune raison d'annoncer d'où elle vient : l'URL
  // référente pourrait contenir un identifiant.
  res.setHeader('Referrer-Policy', 'no-referrer');

  // ⚠️ HSTS UNIQUEMENT EN PRODUCTION, et c'est délibéré.
  //
  // L'en-tête ordonne au navigateur de n'utiliser QUE HTTPS pour ce domaine
  // pendant un an. Les navigateurs l'ignorent sur une connexion en clair —
  // l'envoyer en développement local serait donc sans effet, mais surtout
  // il affirmerait une propriété (« ce service est en HTTPS ») que le
  // développement local ne possède pas.
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }

  next();
}
