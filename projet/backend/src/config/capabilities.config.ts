// =============================================================================
// Ce que cette installation SAIT RÉELLEMENT FAIRE (sprint soutenance)
// =============================================================================
// ═══ LE PROBLÈME QUE CE FICHIER RÈGLE ═══
//
// Une interface de mobilité est truffée de promesses : « vélo », « à pied »,
// « temps réel », « prochain passage ». Chacune n'est tenable que si une
// source de données existe DERRIÈRE. Or plusieurs de ces sources exigent une
// clé, un abonnement ou un serveur qu'un déploiement de démonstration n'a pas.
//
// Le réflexe habituel — afficher le bouton quand même, et le laisser échouer —
// est un mensonge d'interface. Le réflexe inverse — masquer la fonctionnalité
// — en est un autre, plus discret : l'usager croit que le produit ne sait pas
// le faire, alors qu'il ne le sait pas ICI.
//
// Ce module rend donc explicite, POUR CHAQUE PROMESSE, si elle est configurée.
// L'interface peut alors dire la vérité : « Routage piéton détaillé non
// configuré sur ce territoire » plutôt que de dessiner une ligne droite et de
// l'appeler un trajet à pied.
//
// ═══ RÈGLE ABSOLUE ═══
//
// Une capacité est « disponible » UNIQUEMENT si sa source est configurée. On
// ne déduit jamais la disponibilité d'autre chose — ni de la présence d'un
// mode dans le GTFS, ni d'un défaut « raisonnable ». Absent = indisponible.
// =============================================================================

/**
 * État d'une source de données, du point de vue de l'honnêteté d'affichage.
 *
 *   `CONFIGURED`      la source est renseignée : la promesse est tenable ;
 *   `NOT_CONFIGURED`  rien n'est renseigné : l'interface doit le DIRE.
 *
 * ⚠️ IL N'Y A PAS DE TROISIÈME VALEUR « PEUT-ÊTRE ». Un doute se tranche du
 * côté de `NOT_CONFIGURED` : annoncer une capacité absente coûte la confiance
 * de l'usager, taire une capacité présente ne coûte qu'un déploiement à
 * corriger.
 */
export type EtatSource = 'CONFIGURED' | 'NOT_CONFIGURED';

export interface RoutingCapability {
  status: EtatSource;

  /**
   * Nom du fournisseur, quand il y en a un : « osrm », « valhalla »…
   *
   * ⚠️ PUBLIC, donc jamais une URL portant une clé. L'adresse du serveur
   * reste côté backend : le frontend n'appelle pas le routeur directement.
   */
  provider: string | null;
}

/**
 * Coordonnées légales de l'exploitant, pour les mentions obligatoires.
 *
 * ⚠️ AUCUNE VALEUR PAR DÉFAUT INVENTÉE. Un nom de société ou une adresse de
 * courriel fabriqués sur une page « Mentions légales » ne seraient pas un
 * texte de remplissage : ce seraient de fausses coordonnées de responsable de
 * traitement, sur la page même qui doit les donner. `null` fait afficher un
 * encadré disant que l'installation est une démonstration.
 */
export interface LegalIdentity {
  entityName: string | null;
  contactEmail: string | null;
  privacyContactEmail: string | null;
}

export interface CapabilitiesConfig {
  /**
   * Routage piéton porte-à-porte, rue par rue.
   *
   * Non configuré, l'application continue de proposer la marche vers l'arrêt —
   * mais elle l'annonce comme une ESTIMATION à vol d'oiseau, jamais comme un
   * itinéraire de rues.
   */
  walkRouting: RoutingCapability;

  /**
   * Routage cyclable.
   *
   * ⚠️ SANS RAPPORT AVEC VÉLHOP. Connaître les stations de vélos en
   * libre-service ne donne aucun graphe cyclable : savoir où sont les vélos ne
   * dit pas par où l'on roule. Les deux capacités sont donc distinctes, et
   * `bikeRouting` ne devient jamais disponible parce que le GBFS répond.
   */
  bikeRouting: RoutingCapability;

  /**
   * Temps réel du réseau de transport (positions, retards, perturbations).
   *
   * Sur l'Eurométropole, la source existe — la CTS publie un flux SIRI-Lite —
   * mais elle exige un jeton nominatif. Sans ce jeton, `NOT_CONFIGURED` :
   * l'interface affiche les perturbations déjà importées en les datant, et dit
   * que le direct n'est pas branché.
   */
  transitRealtime: RoutingCapability;

  legal: LegalIdentity;
}

/**
 * Lit une variable d'environnement, en traitant le vide comme l'absence.
 *
 * ⚠️ `TRANSIT_REALTIME_PROVIDER=` (déclarée, vide) doit valoir « absente ».
 * Sans ce `trim()`, une variable laissée vide dans un fichier `.env` de
 * déploiement rendrait la capacité « configurée » avec un nom vide.
 */
function texte(valeur: string | undefined): string | null {
  if (valeur === undefined || valeur.trim() === '') {
    return null;
  }

  return valeur.trim();
}

/**
 * Une capacité de routage est disponible SI ET SEULEMENT SI son fournisseur
 * ET son adresse de base sont tous deux renseignés.
 *
 * ⚠️ LES DEUX, PAS L'UN OU L'AUTRE. Un fournisseur sans adresse ne peut être
 * appelé ; une adresse sans fournisseur ne dit pas quel dialecte parler. Un
 * déploiement à moitié configuré est un déploiement non configuré.
 */
function routage(provider?: string, baseUrl?: string): RoutingCapability {
  const nom = texte(provider);
  const adresse = texte(baseUrl);

  if (nom === null || adresse === null) {
    return { status: 'NOT_CONFIGURED', provider: null };
  }

  // ⚠️ `baseUrl` N'EST PAS RENVOYÉE. Elle peut porter un jeton dans son
  // chemin ou sa chaîne de requête ; ce qui sort d'ici est servi à tout
  // visiteur par `GET /api/capabilities`.
  return { status: 'CONFIGURED', provider: nom };
}

export function capabilitiesConfig(
  env: NodeJS.ProcessEnv = process.env,
): CapabilitiesConfig {
  return {
    walkRouting: routage(env.WALK_ROUTING_PROVIDER, env.WALK_ROUTING_BASE_URL),
    bikeRouting: routage(env.BIKE_ROUTING_PROVIDER, env.BIKE_ROUTING_BASE_URL),
    transitRealtime: routage(
      env.TRANSIT_REALTIME_PROVIDER,
      env.TRANSIT_REALTIME_BASE_URL,
    ),
    legal: {
      entityName: texte(env.LEGAL_ENTITY_NAME),
      contactEmail: texte(env.LEGAL_CONTACT_EMAIL),
      privacyContactEmail: texte(env.PRIVACY_CONTACT_EMAIL),
    },
  };
}
