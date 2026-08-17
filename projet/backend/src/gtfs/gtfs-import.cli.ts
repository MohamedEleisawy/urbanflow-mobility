// =============================================================================
// Script d'import GTFS en ligne de commande (étape 4C-4-3)
// =============================================================================
//   npm run gtfs:import -- <dossier> [codeExploitant]
//
// Exemple :
//   npm run gtfs:import -- test/fixtures/gtfs RATP
//
// Pourquoi un script et pas un endpoint HTTP ?
// Le dossier de conception prévoit à terme un endpoint réservé à
// l'administrateur (UC10, POST /api/admin/*), mais cela suppose le rôle
// ADMIN, qui n'est pas encore implémenté. Un import est de toute façon une
// opération d'exploitation, longue et manuelle : la ligne de commande y est
// parfaitement adaptée, et cela évite d'exposer une route dangereuse sans
// protection.
//
// NestFactory.createApplicationContext démarre l'application SANS serveur
// HTTP : on récupère juste l'injection de dépendances pour utiliser les
// services, puis on referme proprement.
// =============================================================================

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { GtfsImportService } from './gtfs-import.service';

async function main(): Promise<void> {
  const [dossier, codeExploitant] = process.argv.slice(2);

  if (!dossier) {
    console.error(
      'Usage : npm run gtfs:import -- <dossier> [codeExploitant]\n' +
        'Exemple : npm run gtfs:import -- test/fixtures/gtfs RATP',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(GtfsImportService);

  try {
    await service.importReferential(dossier, codeExploitant ?? '');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
