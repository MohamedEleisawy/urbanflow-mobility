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
