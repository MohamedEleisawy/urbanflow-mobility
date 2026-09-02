// =============================================================================
// Script d'import GTFS en ligne de commande (étape 4C-4-3)
// =============================================================================
//   npm run gtfs:import -- <source> [codeExploitant]
//
// La source peut être (étape 4C-4-5) :
//   - un dossier    : npm run gtfs:import -- test/fixtures/gtfs RATP
//   - une archive   : npm run gtfs:import -- ./reseau.zip RATP
//   - une URL       : npm run gtfs:import -- https://exemple.fr/reseau.zip RATP
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
import { ModeTransport } from '@prisma/client';
import { AppModule } from '../app.module';
import { GtfsImportService } from './gtfs-import.service';

/**
 * Traduit `--modes=METRO,TRAM` en périmètre d'import.
 *
 * Sans l'option, rend `undefined` : tous les modes que `mapRouteType` sait
 * traduire sont importés, c'est-à-dire le comportement d'avant la Phase 1.
 *
 * Une valeur inconnue ARRÊTE la commande plutôt que d'être ignorée : un
 * import silencieusement plus large que demandé produirait 53 437 arrêts au
 * lieu de 1 383, et l'écart ne se verrait qu'à l'usage.
 */
function analyserModes(
  option?: string,
): ReadonlySet<ModeTransport> | undefined {
  if (!option) {
    return undefined;
  }

  const demandes = option
    .slice('--modes='.length)
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);

  const connus = new Set<string>(Object.values(ModeTransport));
  const inconnus = demandes.filter((m) => !connus.has(m));

  if (demandes.length === 0 || inconnus.length > 0) {
    console.error(
      `Modes inconnus : ${inconnus.join(', ') || '(aucun mode fourni)'}
` + `Modes acceptés : ${[...connus].sort().join(', ')}`,
    );
    process.exit(1);
  }

  return new Set(demandes as ModeTransport[]);
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);

  // ⚠️ `--modes` est retiré AVANT la lecture positionnelle : sans cela,
  // `npm run gtfs:import -- flux.zip --modes=METRO` prendrait « --modes=… »
  // pour le code exploitant.
  const optionModes = arguments_.find((a) => a.startsWith('--modes='));
  const positionnels = arguments_.filter((a) => !a.startsWith('--'));
  const [source, codeExploitant] = positionnels;

  const modes = analyserModes(optionModes);

  if (!source) {
    console.error(
      'Usage : npm run gtfs:import -- <source> [codeExploitant]\n' +
        'La source peut être un dossier, une archive .zip ou une URL http(s).\n' +
        'Exemple : npm run gtfs:import -- test/fixtures/gtfs RATP',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(GtfsImportService);

  try {
    await service.importFromSource(source, codeExploitant ?? '', modes);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
