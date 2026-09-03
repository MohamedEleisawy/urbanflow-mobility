// =============================================================================
// Territoire de démonstration (Phase 6)
// =============================================================================
// ═══ POURQUOI CE FICHIER EXISTE ═══
//
// UrbanFlow est une plateforme de mobilité urbaine, pas une application
// parisienne. Jusqu'ici pourtant, plusieurs valeurs enfermaient le produit
// dans un territoire : le centre de carte du frontend était les coordonnées de
// Paris, écrites en dur, et l'import GTFS visait un flux d'Île-de-France.
//
// Le sujet décrit une métropole d'environ 500 000 habitants. Île-de-France en
// compte douze millions : le réseau importé (35 490 arrêts, 1 963 lignes de
// bus) était non seulement hors sujet, mais dégradait le calcul d'itinéraire.
//
// ═══ CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS ═══
//
// Il RASSEMBLE en un point les quelques valeurs qui dépendent réellement du
// territoire : un nom, un centre de carte, un rayon d'affichage.
//
// Il ne fait RIEN d'autre. Le moteur d'itinéraires, le calcul carbone, le
// graphe, l'import GTFS et le proxy GBFS restent entièrement génériques : ils
// ne connaissent ni Strasbourg ni Paris, seulement des arrêts, des liaisons et
// des coordonnées. Changer de métropole ne demande donc que de changer ces
// variables et de relancer un import.
//
// ⚠️ AUCUN NOM DE VILLE N'EST CODÉ EN DUR DANS LA LOGIQUE MÉTIER. Le seul
// endroit où « Strasbourg » apparaît est une VALEUR PAR DÉFAUT ci-dessous,
// remplaçable par une variable d'environnement.
// =============================================================================

/**
 * Le territoire desservi par cette installation.
 *
 * Ces valeurs sont PUBLIQUES : elles sont servies telles quelles au frontend
 * par `GET /api/territory`. Rien de secret ne doit y entrer.
 */
export interface TerritoryConfig {
  /// Identifiant court, stable, sans espace ni accent : « strasbourg ».
  name: string;

  /// Nom affiché à l'usager : « Eurométropole de Strasbourg ».
  displayName: string;

  /// Code pays ISO 3166-1 alpha-2.
  country: string;

  /**
   * Centre de la carte à l'ouverture, avant toute recherche.
   *
   * ⚠️ CE N'EST PAS LA POSITION DE L'USAGER. La carte s'ouvre sur le
   * territoire desservi ; la position n'est demandée que sur un geste
   * explicite (voir `useNavigationTracking`).
   */
  centerLat: number;
  centerLon: number;

  /**
   * Rayon indicatif du territoire, en mètres.
   *
   * Sert au cadrage initial de la carte et à borner les recherches de
   * voisinage. Ce n'est pas une frontière administrative : un arrêt situé
   * juste au-delà reste parfaitement utilisable.
   */
  radiusM: number;

  /**
   * Fuseau horaire du territoire, au format IANA : « Europe/Paris ».
   *
   * ⚠️ INDISPENSABLE AUX HORAIRES, ET AJOUTÉ APRÈS COUP. Un horaire GTFS est
   * exprimé en HEURE LOCALE DU RÉSEAU. Sans ce fuseau, « le prochain tram à
   * 08:42 » se calculerait dans le fuseau du SERVEUR : hébergé en UTC, il
   * annoncerait à 10 h 40 locales un passage déjà parti depuis deux heures.
   *
   * C'est bien une propriété du TERRITOIRE, pas du déploiement : elle suit la
   * métropole desservie, comme son centre de carte.
   */
  timezone: string;
}

/**
 * Territoire par défaut : l'Eurométropole de Strasbourg.
 *
 * ═══ POURQUOI STRASBOURG ═══
 *
 * Le sujet décrit « une métropole de 500 000 habitants ». L'Eurométropole en
 * compte environ 510 000 — l'ordre de grandeur exact.
 *
 * Et surtout, ses données de mobilité sont RÉELLEMENT OUVERTES et complètes :
 * la CTS publie un GTFS statique librement téléchargeable, et Vélhop un flux
 * GBFS standard en licence CC0. C'est ce qui permet de démontrer la plateforme
 * sur des données vraies plutôt que sur un jeu d'essai.
 *
 * ⚠️ CES VALEURS SONT DES DÉFAUTS, PAS DES CONSTANTES. Toutes sont
 * remplaçables par une variable d'environnement : déployer UrbanFlow sur une
 * autre métropole ne demande aucune modification de code.
 */
const DEFAUTS: TerritoryConfig = {
  name: 'strasbourg',
  displayName: 'Eurométropole de Strasbourg',
  country: 'FR',
  // Place Kléber, centre géographique et symbolique de la métropole.
  centerLat: 48.5834,
  centerLon: 7.7452,
  // ~12 km : l'Eurométropole s'étend de Vendenheim à Illkirch.
  radiusM: 12_000,
  timezone: 'Europe/Paris',
};

/**
 * Lit un nombre dans l'environnement, ou rend le défaut.
 *
 * ⚠️ UNE VALEUR ILLISIBLE REND LE DÉFAUT, elle ne devient pas `NaN`. Un
 * `NaN` traverserait silencieusement le contrat public et placerait la carte
 * nulle part — un défaut connu vaut mieux qu'une coordonnée impossible.
 */
function nombre(valeur: string | undefined, defaut: number): number {
  // ⚠️ UNE CHAÎNE VIDE N'EST PAS ZÉRO. `Number('')` vaut 0 et passe le test de
  // finitude : sans cette garde, un `TERRITORY_RADIUS_M=` laissé vide dans un
  // fichier `.env` donnerait un rayon nul, et la carte ne montrerait rien.
  // « Non renseigné » doit rendre le défaut, comme une variable absente.
  if (valeur === undefined || valeur.trim() === '') {
    return defaut;
  }

  const lu = Number(valeur);

  return Number.isFinite(lu) ? lu : defaut;
}

/**
 * Lit une chaîne dans l'environnement, en traitant le vide comme l'absence.
 *
 * Même raison que pour `nombre()` : `TERRITORY_TIMEZONE=` laissé vide dans un
 * fichier `.env` donnerait un fuseau vide, que `Intl` refuserait en levant.
 */
function texteOuDefaut(valeur: string | undefined, defaut: string): string {
  if (valeur === undefined || valeur.trim() === '') {
    return defaut;
  }

  return valeur.trim();
}

/**
 * La configuration territoriale effective.
 *
 * ⚠️ LUE À CHAQUE APPEL, et non figée au chargement du module : les tests
 * doivent pouvoir changer d'environnement entre deux cas sans réimporter le
 * module.
 */
export function territoryConfig(): TerritoryConfig {
  return {
    name: process.env.TERRITORY_NAME ?? DEFAUTS.name,
    displayName: process.env.TERRITORY_DISPLAY_NAME ?? DEFAUTS.displayName,
    country: process.env.TERRITORY_COUNTRY ?? DEFAUTS.country,
    centerLat: nombre(process.env.TERRITORY_CENTER_LAT, DEFAUTS.centerLat),
    centerLon: nombre(process.env.TERRITORY_CENTER_LON, DEFAUTS.centerLon),
    radiusM: nombre(process.env.TERRITORY_RADIUS_M, DEFAUTS.radiusM),
    timezone: texteOuDefaut(process.env.TERRITORY_TIMEZONE, DEFAUTS.timezone),
  };
}
