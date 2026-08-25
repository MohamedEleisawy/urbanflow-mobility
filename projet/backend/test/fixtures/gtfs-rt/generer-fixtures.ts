/**
 * Génération des fixtures binaires GTFS-Realtime (étape 4F-1B).
 *
 * POURQUOI UN SCRIPT, ET PAS UN TÉLÉCHARGEMENT. Un test qui appelle une API
 * réelle n'est pas un test : il échoue quand le réseau tombe, et son résultat
 * change quand l'opérateur change ses données. Les fixtures sont donc
 * fabriquées ici, une fois, et versionnées.
 *
 * POURQUOI PAS UN FICHIER ÉCRIT À LA MAIN. Protocol Buffers est binaire :
 * personne ne l'écrit à la main. On l'encode avec la bibliothèque officielle.
 *
 * POURQUOI CE N'EST PAS CIRCULAIRE. On pourrait objecter que décoder ce qu'on
 * vient d'encoder avec la même bibliothèque ne prouve rien. La fixture est
 * justement écrite SUR DISQUE et relue comme des octets bruts : les tests de
 * décodage partent d'un fichier, pas d'un objet encodé dans le même processus.
 * Ils vérifient donc la chaîne complète octets → FeedMessage, exactement comme
 * le fera un vrai flux.
 *
 * REPRODUCTION :
 *   cd projet/backend
 *   npx ts-node test/fixtures/gtfs-rt/generer-fixtures.ts
 *
 * Le script est déterministe : les horodatages sont figés, relancer le script
 * réécrit des fichiers identiques octet pour octet.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { transit_realtime } from 'gtfs-realtime-bindings';

const DOSSIER = __dirname;

/// Horodatages FIGÉS. Un `Date.now()` produirait une fixture différente à
/// chaque exécution, et des tests dont le résultat dépend du jour.
const HORODATAGE_FLUX = 1_764_590_400; // 2025-12-01T12:00:00Z
const DEBUT_PERTURBATION = 1_764_586_800; // 2025-12-01T11:00:00Z
const FIN_PERTURBATION = 1_764_597_600; // 2025-12-01T14:00:00Z

const ecrire = (nom: string, octets: Uint8Array): void => {
  writeFileSync(join(DOSSIER, nom), octets);
  console.log(`${nom} — ${octets.byteLength} octets`);
};

// ---------------------------------------------------------------------------
// 1. Flux valide, avec une alerte représentative
// ---------------------------------------------------------------------------
//
// Une seule entité, mais complète : période d'activité, entité concernée,
// cause, effet, titre et description. C'est le matériau dont 4F-1C aura
// besoin — cette étape se contente de vérifier qu'il traverse le décodage.
const fluxValide = transit_realtime.FeedMessage.encode({
  header: {
    gtfsRealtimeVersion: '2.0',
    incrementality: transit_realtime.FeedHeader.Incrementality.FULL_DATASET,
    timestamp: HORODATAGE_FLUX,
  },
  entity: [
    {
      id: 'alerte-ligne-a-travaux',
      alert: {
        activePeriod: [{ start: DEBUT_PERTURBATION, end: FIN_PERTURBATION }],
        informedEntity: [{ routeId: 'ROUTE_A', stopId: 'STOP_1' }],
        cause: transit_realtime.Alert.Cause.MAINTENANCE,
        effect: transit_realtime.Alert.Effect.REDUCED_SERVICE,
        headerText: {
          translation: [{ text: 'Travaux sur la ligne A', language: 'fr' }],
        },
        descriptionText: {
          translation: [
            {
              text: 'Service réduit entre 11h et 14h en raison de travaux.',
              language: 'fr',
            },
          ],
        },
      },
    },
  ],
}).finish();

ecrire('flux-valide.pb', fluxValide);

// ---------------------------------------------------------------------------
// 2. Flux sans fin annoncée
// ---------------------------------------------------------------------------
//
// Le cas qui a motivé la migration 4F-1A : `end` est absent. On le fige ici
// pour que 4F-1C dispose du matériau, et pour prouver dès maintenant que le
// décodage ne s'y casse pas les dents.
const fluxSansFin = transit_realtime.FeedMessage.encode({
  header: { gtfsRealtimeVersion: '2.0', timestamp: HORODATAGE_FLUX },
  entity: [
    {
      id: 'alerte-sans-fin',
      alert: {
        activePeriod: [{ start: DEBUT_PERTURBATION }],
        informedEntity: [{ routeId: 'ROUTE_B' }],
        effect: transit_realtime.Alert.Effect.NO_SERVICE,
        headerText: {
          translation: [{ text: 'Interruption de durée indéterminée' }],
        },
      },
    },
  ],
}).finish();

ecrire('flux-sans-fin.pb', fluxSansFin);

// ---------------------------------------------------------------------------
// 3. Flux vide de perturbations, mais parfaitement valide
// ---------------------------------------------------------------------------
//
// « Aucune alerte » n'est PAS une erreur : c'est la réponse normale d'un
// réseau qui fonctionne. Distinguer ce cas d'un flux illisible est tout
// l'objet de la vérification d'en-tête du décodeur.
const fluxSansEntite = transit_realtime.FeedMessage.encode({
  header: { gtfsRealtimeVersion: '2.0', timestamp: HORODATAGE_FLUX },
  entity: [],
}).finish();

ecrire('flux-sans-entite.pb', fluxSansEntite);

// ---------------------------------------------------------------------------
// 4. Version majeure inconnue
// ---------------------------------------------------------------------------
//
// Un hypothétique GTFS-RT 3.0 : décodable en apparence, mais dont on ne sait
// rien. Le décodeur doit refuser plutôt qu'interpréter au hasard.
const versionInconnue = transit_realtime.FeedMessage.encode({
  header: { gtfsRealtimeVersion: '3.0', timestamp: HORODATAGE_FLUX },
  entity: [],
}).finish();

ecrire('version-inconnue.pb', versionInconnue);

// ---------------------------------------------------------------------------
// 5. Flux tronqué
// ---------------------------------------------------------------------------
//
// Le cas d'une connexion coupée en cours de téléchargement : les premiers
// octets sont authentiques, la fin manque.
ecrire(
  'flux-tronque.pb',
  fluxValide.subarray(0, Math.floor(fluxValide.length / 2)),
);

// ---------------------------------------------------------------------------
// 6. En-tête présent mais sans version
// ---------------------------------------------------------------------------
//
// Un producteur défectueux, ou un message dont le champ `header` existe mais
// est vide. Protocol Buffers l'accepte — c'est précisément pourquoi le
// décodeur doit vérifier la version lui-même.
const enteteSansVersion = transit_realtime.FeedMessage.encode({
  header: { gtfsRealtimeVersion: '', timestamp: HORODATAGE_FLUX },
  entity: [],
}).finish();

ecrire('entete-sans-version.pb', enteteSansVersion);

// ===========================================================================
// Fixtures de l'étape 4F-1C — import métier
// ===========================================================================
//
// Les fixtures ci-dessus servaient à prouver le DÉCODAGE. Celles-ci servent
// à prouver le MAPPING et l'IDEMPOTENCE : elles nomment donc des lignes et
// des arrêts que le test e2e crée réellement en base.

/// Alerte de référence : une ligne, un arrêt, une période complète.
const importNominal = transit_realtime.FeedMessage.encode({
  header: { gtfsRealtimeVersion: '2.0', timestamp: HORODATAGE_FLUX },
  entity: [
    {
      id: 'alerte-import-1',
      alert: {
        activePeriod: [{ start: DEBUT_PERTURBATION, end: FIN_PERTURBATION }],
        informedEntity: [{ routeId: 'ROUTE_A' }, { stopId: 'STOP_1' }],
        cause: transit_realtime.Alert.Cause.MAINTENANCE,
        effect: transit_realtime.Alert.Effect.REDUCED_SERVICE,
        severityLevel: transit_realtime.Alert.SeverityLevel.WARNING,
        headerText: {
          translation: [{ text: 'Travaux ligne A', language: 'fr' }],
        },
      },
    },
  ],
}).finish();

ecrire('import-nominal.pb', importNominal);

/// LA MÊME alerte, aggravée et désormais sans fin annoncée.
///
/// Même `id` : c'est ce qui doit produire une MISE À JOUR et non un doublon.
/// L'absence de `end` prouve en outre qu'une fin connue peut redevenir
/// inconnue — endTime doit alors repasser à NULL.
const importModifie = transit_realtime.FeedMessage.encode({
  header: { gtfsRealtimeVersion: '2.0', timestamp: HORODATAGE_FLUX },
  entity: [
    {
      id: 'alerte-import-1',
      alert: {
        activePeriod: [{ start: DEBUT_PERTURBATION }],
        informedEntity: [{ routeId: 'ROUTE_A' }],
        cause: transit_realtime.Alert.Cause.STRIKE,
        effect: transit_realtime.Alert.Effect.NO_SERVICE,
        severityLevel: transit_realtime.Alert.SeverityLevel.SEVERE,
        headerText: {
          translation: [{ text: 'Grève ligne A', language: 'fr' }],
        },
      },
    },
  ],
}).finish();

ecrire('import-modifie.pb', importModifie);

/// Flux d'épreuve : neuf entités, un sort différent pour chacune.
///
/// C'est la fixture qui rend le rapport d'import vérifiable ligne à ligne.
const importMixte = transit_realtime.FeedMessage.encode({
  header: { gtfsRealtimeVersion: '2.0', timestamp: HORODATAGE_FLUX },
  entity: [
    // 1. Importable sans réserve.
    {
      id: 'mixte-valide',
      alert: {
        activePeriod: [{ start: DEBUT_PERTURBATION, end: FIN_PERTURBATION }],
        informedEntity: [{ routeId: 'ROUTE_A' }],
        severityLevel: transit_realtime.Alert.SeverityLevel.INFO,
        effect: transit_realtime.Alert.Effect.DETOUR,
      },
    },
    // 2. Ne cible qu'un trajet : rien de représentable dans Alert.
    {
      id: 'mixte-trajet',
      alert: {
        activePeriod: [{ start: DEBUT_PERTURBATION }],
        informedEntity: [{ trip: { tripId: 'TRIP_0812' } }],
        severityLevel: transit_realtime.Alert.SeverityLevel.WARNING,
      },
    },
    // 3. severityLevel absent → UNKNOWN_SEVERITY par défaut.
    {
      id: 'mixte-severite-inconnue',
      alert: {
        activePeriod: [{ start: DEBUT_PERTURBATION }],
        informedEntity: [{ routeId: 'ROUTE_A' }],
      },
    },
    // 4. Deux périodes disjointes : le modèle n'en tient qu'une.
    {
      id: 'mixte-deux-periodes',
      alert: {
        activePeriod: [
          { start: DEBUT_PERTURBATION, end: FIN_PERTURBATION },
          { start: FIN_PERTURBATION + 86_400 },
        ],
        informedEntity: [{ routeId: 'ROUTE_A' }],
        severityLevel: transit_realtime.Alert.SeverityLevel.WARNING,
      },
    },
    // 5. Aucune période : startTime serait indéterminable.
    {
      id: 'mixte-sans-periode',
      alert: {
        informedEntity: [{ routeId: 'ROUTE_A' }],
        severityLevel: transit_realtime.Alert.SeverityLevel.WARNING,
      },
    },
    // 6. Pas une alerte du tout.
    {
      id: 'mixte-trip-update',
      tripUpdate: { trip: { tripId: 'TRIP_0900' } },
    },
    // 7. Importable, mais amputée d'une entité concernée.
    {
      id: 'mixte-partiel',
      alert: {
        activePeriod: [{ start: DEBUT_PERTURBATION }],
        informedEntity: [
          { routeId: 'ROUTE_A' },
          { trip: { tripId: 'TRIP_1015' } },
        ],
        severityLevel: transit_realtime.Alert.SeverityLevel.WARNING,
        effect: transit_realtime.Alert.Effect.SIGNIFICANT_DELAYS,
      },
    },
    // 8. Un bus ET un tramway : un seul champ affectedMode.
    {
      id: 'mixte-mode-ambigu',
      alert: {
        activePeriod: [{ start: DEBUT_PERTURBATION }],
        informedEntity: [{ routeId: 'ROUTE_A' }, { routeId: 'ROUTE_T' }],
        severityLevel: transit_realtime.Alert.SeverityLevel.SEVERE,
      },
    },
    // 9. Ligne absente de notre référentiel : aucun mode déductible.
    {
      id: 'mixte-ligne-inconnue',
      alert: {
        activePeriod: [{ start: DEBUT_PERTURBATION }],
        informedEntity: [{ routeId: 'ROUTE_INCONNUE' }],
        severityLevel: transit_realtime.Alert.SeverityLevel.INFO,
      },
    },
  ],
}).finish();

ecrire('import-mixte.pb', importMixte);

/// Alerte ne nommant AUCUNE ligne : seul un arrêt est cité.
///
/// Le mode ne peut alors venir que des liaisons du réseau qui desservent cet
/// arrêt — une requête que seul le test e2e peut exercer réellement.
const importArretSeul = transit_realtime.FeedMessage.encode({
  header: { gtfsRealtimeVersion: '2.0', timestamp: HORODATAGE_FLUX },
  entity: [
    {
      id: 'alerte-arret-seul',
      alert: {
        activePeriod: [{ start: DEBUT_PERTURBATION }],
        informedEntity: [{ stopId: 'STOP_1' }],
        severityLevel: transit_realtime.Alert.SeverityLevel.INFO,
        effect: transit_realtime.Alert.Effect.ACCESSIBILITY_ISSUE,
      },
    },
  ],
}).finish();

ecrire('import-arret-seul.pb', importArretSeul);

// ===========================================================================
// Fixtures de l'étape 4F-2A — texte utilisateur
// ===========================================================================
//
// GTFS-Realtime ne transporte pas une chaîne mais une LISTE de traductions.
// Ces fixtures couvrent les combinaisons que la règle de choix doit trancher.

/// Enveloppe un texte + sa langue dans un TranslatedString.
const traduit = (
  paires: { text: string; language?: string }[],
): transit_realtime.ITranslatedString => ({ translation: paires });

/// Fabrique un flux d'une seule alerte valide, dont seuls les textes varient.
const fluxTexte = (
  id: string,
  textes: {
    headerText?: transit_realtime.ITranslatedString;
    descriptionText?: transit_realtime.ITranslatedString;
  },
): Uint8Array =>
  transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: '2.0', timestamp: HORODATAGE_FLUX },
    entity: [
      {
        id,
        alert: {
          activePeriod: [{ start: DEBUT_PERTURBATION }],
          informedEntity: [{ routeId: 'ROUTE_A' }],
          severityLevel: transit_realtime.Alert.SeverityLevel.WARNING,
          ...textes,
        },
      },
    ],
  }).finish();

/// Français présent parmi plusieurs langues, et PAS en première position :
/// la règle doit le trouver, pas se contenter du premier venu.
ecrire(
  'texte-multilingue.pb',
  fluxTexte('texte-multilingue', {
    headerText: traduit([
      { text: 'Works on line A', language: 'en' },
      { text: 'Arbeiten an Linie A', language: 'de' },
      { text: 'Travaux sur la ligne A', language: 'fr' },
    ]),
    descriptionText: traduit([
      { text: 'Reduced service until 2pm.', language: 'en' },
      { text: 'Service réduit jusqu’à 14h.', language: 'fr' },
    ]),
  }),
);

/// Aucun français : on retient la PREMIÈRE traduction disponible plutôt que
/// de priver le voyageur d'un avertissement réel.
ecrire(
  'texte-sans-francais.pb',
  fluxTexte('texte-sans-francais', {
    headerText: traduit([
      { text: 'Works on line A', language: 'en' },
      { text: 'Arbeiten an Linie A', language: 'de' },
    ]),
    descriptionText: traduit([{ text: 'Reduced service.', language: 'en' }]),
  }),
);

/// Flux monolingue : `language` absent. protobufjs rendra "" — la règle ne
/// doit ni le confondre avec "fr", ni écarter le texte pour autant.
ecrire(
  'texte-sans-langue.pb',
  fluxTexte('texte-sans-langue', {
    headerText: traduit([{ text: 'Perturbation en cours' }]),
  }),
);

/// Titre seul, sans description — le cas le plus courant en production.
ecrire(
  'texte-header-seul.pb',
  fluxTexte('texte-header-seul', {
    headerText: traduit([{ text: 'Ligne A interrompue', language: 'fr' }]),
  }),
);

/// Description seule, sans titre : l'inverse doit marcher aussi.
ecrire(
  'texte-description-seule.pb',
  fluxTexte('texte-description-seule', {
    descriptionText: traduit([
      { text: 'Un véhicule est immobilisé.', language: 'fr' },
    ]),
  }),
);

/// TranslatedString présent mais vide, et traduction au texte blanc : deux
/// façons pour un flux de ne rien dire tout en remplissant le champ.
ecrire(
  'texte-vide.pb',
  fluxTexte('texte-vide', {
    headerText: traduit([]),
    descriptionText: traduit([{ text: '   ', language: 'fr' }]),
  }),
);

/// LA MÊME alerte que import-nominal.pb, mais dépouillée de son texte.
///
/// C'est le cas décisif : un opérateur peut retirer un titre publié par
/// erreur. La colonne doit alors repasser à NULL, et non conserver
/// l'ancienne valeur.
ecrire(
  'import-texte-retire.pb',
  transit_realtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: '2.0', timestamp: HORODATAGE_FLUX },
    entity: [
      {
        id: 'alerte-import-1',
        alert: {
          activePeriod: [{ start: DEBUT_PERTURBATION, end: FIN_PERTURBATION }],
          informedEntity: [{ routeId: 'ROUTE_A' }, { stopId: 'STOP_1' }],
          cause: transit_realtime.Alert.Cause.MAINTENANCE,
          effect: transit_realtime.Alert.Effect.REDUCED_SERVICE,
          severityLevel: transit_realtime.Alert.SeverityLevel.WARNING,
        },
      },
    ],
  }).finish(),
);
