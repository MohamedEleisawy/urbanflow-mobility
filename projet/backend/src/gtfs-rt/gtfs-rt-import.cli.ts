// =============================================================================
// Script d'import des alertes GTFS-Realtime (étape 4F-1D)
// =============================================================================
//   npm run gtfs-rt:import                  ← utilise GTFS_RT_URL
//   npm run gtfs-rt:import -- <url>         ← force une autre adresse
//
// POURQUOI UN SCRIPT, ET PAS UN ENDPOINT. C'est le seul mécanisme de
// déclenchement que le projet possède : `gtfs-import.cli.ts` (4C-4-3) fait
// exactement cela pour le GTFS statique, et pour deux raisons qui valent
// encore ici.
//
//   1. Le dossier de conception réserve `POST /api/admin/*` au chargement des
//      « fichiers GTFS statiques » et au CRUD du réseau. GTFS-RT n'y figure
//      pas : créer cette route serait inventer une décision que le dossier
//      n'a pas prise.
//   2. Le rôle ADMIN n'existe pas encore. Exposer une route d'ingestion sans
//      protection ouvrirait à n'importe qui la possibilité de faire
//      télécharger 25 Mo à notre serveur, en boucle.
//
// POURQUOI PAS DE PLANIFICATEUR NON PLUS. Un flux temps réel se recharge
// toutes les 30 à 60 secondes, et le dossier parle bien de temps réel — mais
// il décrit une lecture « à chaque calcul d'itinéraire », pas un import
// périodique. Ajouter un cron ici trancherait une question d'architecture qui
// n'est pas encore posée. Le GTFS statique, dont le dossier dit pourtant
// qu'il est téléchargé « périodiquement », s'est arrêté au même endroit :
// un script, appelé quand on le décide.
//
// NestFactory.createApplicationContext démarre l'application SANS serveur
// HTTP : on récupère juste l'injection de dépendances, puis on referme.
// =============================================================================

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { GtfsRtImportService } from './gtfs-rt-import.service';

async function main(): Promise<void> {
  // L'adresse est facultative : le service se replie sur GTFS_RT_URL, et
  // signale lui-même l'absence des deux.
  const [url] = process.argv.slice(2);

  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(GtfsRtImportService);

  try {
    const rapport = await service.importFromUrl(url);

    // Le bilan détaillé est déjà journalisé par le service. On y ajoute le
    // seul chiffre qui intéresse un exploitant pressé.
    console.log(
      `Import GTFS-RT terminé : ${rapport.entities.created} créées, ` +
        `${rapport.entities.updated} mises à jour, ` +
        `${rapport.entities.rejected} non importées.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  // Trois familles d'échec, distinguables par leur TYPE et non par leur texte
  // (étape 4F-1D) : flux injoignable (503), flux illisible (422), et
  // configuration absente. Ici, toutes finissent en code de sortie 1 — mais
  // un futur appelant HTTP pourra les traduire sans lire un message.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
