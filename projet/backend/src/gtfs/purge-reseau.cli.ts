import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

// =============================================================================
// Purge du réseau d'un ancien territoire (Phase 6)
// =============================================================================
// Usage :
//
//   npm run gtfs:purge -- <prefixe>          affiche ce qui SERAIT supprimé
//   npm run gtfs:purge -- <prefixe> --oui    supprime réellement
//
// Exemple : `npm run gtfs:purge -- IDFM: --oui`
//
// ═══ POURQUOI UNE COMMANDE PLUTÔT QU'UN `DELETE` À LA MAIN ═══
//
// Recadrer le territoire de démonstration suppose de retirer le réseau
// précédent : garder 35 490 arrêts d'Île-de-France à côté de 1 348 arrêts
// strasbourgeois rendrait le produit incohérent.
//
// C'est une opération DESTRUCTRICE et LONGUE À DÉFAIRE (le flux d'origine pèse
// 109 Mo et son import dure un quart d'heure). Elle mérite donc d'être écrite,
// relue et testée comme du code — pas tapée dans un terminal.
//
// ═══ CE QUI N'EST JAMAIS SUPPRIMÉ ═══
//
// ⚠️ AUCUNE DONNÉE D'USAGER. Ni compte, ni trajet enregistré, ni
// enregistrement carbone, ni préférence, ni adresse favorite.
//
// ⚠️ AUCUN ARRÊT RÉFÉRENCÉ PAR UN TRAJET ENREGISTRÉ. Un arrêt cité par le
// `Segment` d'un usager est conservé même si plus aucune ligne ne le dessert :
// le supprimer détruirait son historique. C'est exactement la règle que suit
// déjà `elaguerArretsNonDesservis` à l'import.
//
// ⚠️ PAR DÉFAUT, RIEN N'EST SUPPRIMÉ. Sans `--oui`, la commande se contente de
// compter et d'afficher. Une suppression de cette ampleur ne doit pas pouvoir
// résulter d'une faute de frappe.
// =============================================================================

async function main(): Promise<void> {
  const logger = new Logger('PurgeReseau');
  const arguments_ = process.argv.slice(2);

  const confirme = arguments_.includes('--oui');
  const prefixe = arguments_.find((a) => !a.startsWith('--'));

  if (!prefixe) {
    logger.error(
      'Usage : npm run gtfs:purge -- <prefixe> [--oui]\n' +
        'Exemple : npm run gtfs:purge -- IDFM: --oui',
    );
    process.exitCode = 1;
    return;
  }

  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const prisma = application.get(PrismaService);

    // Les lignes visées : celles dont l'identifiant de flux porte le préfixe.
    const lignes = await prisma.transitLine.findMany({
      where: { gtfsRouteId: { startsWith: prefixe } },
      select: { id: true },
    });

    const lineIds = lignes.map((ligne) => ligne.id);

    const liaisons = await prisma.networkLink.count({
      where: { lineId: { in: lineIds } },
    });

    // ⚠️ LA CLAUSE QUI PROTÈGE L'HISTORIQUE. Un arrêt cité par le segment d'un
    // usager n'est jamais supprimé, même orphelin de toute liaison.
    const arretsSupprimables = {
      gtfsStopId: { startsWith: prefixe },
      segmentsFrom: { none: {} },
      segmentsTo: { none: {} },
    } as const;

    const arrets = await prisma.stop.count({ where: arretsSupprimables });

    const arretsProteges = await prisma.stop.count({
      where: {
        gtfsStopId: { startsWith: prefixe },
        OR: [{ segmentsFrom: { some: {} } }, { segmentsTo: { some: {} } }],
      },
    });

    logger.log(`Préfixe visé : « ${prefixe} »`);
    logger.log(`  lignes    : ${lignes.length}`);
    logger.log(`  liaisons  : ${liaisons}`);
    logger.log(`  arrêts    : ${arrets}`);
    logger.log(
      `  arrêts CONSERVÉS car cités par un trajet enregistré : ${arretsProteges}`,
    );

    // ⚠️ LES CORRESPONDANCES PARTENT EN CASCADE, sans être comptées ci-dessus.
    // Elles appartiennent à une ligne de service (« URBANFLOW:TRANSFER ») que
    // le préfixe ne vise pas, mais leurs DEUX extrémités sont des arrêts
    // supprimés — et `NetworkLink` déclare `onDelete: Cascade` sur `fromStop`
    // comme sur `toStop`. Le dire évite la surprise d'un compte qui ne tombe
    // pas juste.
    const correspondances = await prisma.networkLink.count({
      where: {
        line: { gtfsRouteId: { not: { startsWith: prefixe } } },
        fromStop: { gtfsStopId: { startsWith: prefixe } },
      },
    });

    if (correspondances > 0) {
      logger.log(
        `  correspondances retirées EN CASCADE avec ces arrêts : ${correspondances}`,
      );
    }

    if (!confirme) {
      logger.warn(
        'Aucune suppression : relancez avec --oui pour appliquer réellement.',
      );
      return;
    }

    // Une seule transaction : soit tout part, soit rien. Un état intermédiaire
    // — des liaisons sans ligne — rendrait le graphe incohérent.
    //
    // ⚠️ `timeout` RELEVÉ À 15 MINUTES. Le défaut de Prisma est de 5 secondes :
    // très en deçà de ce que demande la suppression d'un réseau entier
    // (35 000 arrêts, 270 000 liaisons). Sans ce relèvement, la transaction
    // était annulée EN SILENCE après cinq secondes — et rien n'était purgé.
    await prisma.$transaction(
      async (tx) => {
        // 1. Les liaisons des lignes visées.
        await tx.networkLink.deleteMany({ where: { lineId: { in: lineIds } } });

        // 2. Les correspondances (portées par une autre ligne de service) dont
        //    une extrémité est un arrêt à retirer.
        //
        // ⚠️ RETIRÉES EXPLICITEMENT, ET AVANT LES ARRÊTS. La suppression d'un
        // arrêt cascade sur `NetworkLink` par `fromStop` ET `toStop` : laissée
        // à la cascade, elle repart arrêt par arrêt — des centaines de
        // milliers de lignes, plusieurs minutes. Ici, deux requêtes
        // ensemblistes indexées sur le préfixe GTFS suffisent.
        //
        // ⚠️ `where` RELATIONNEL, PAS UNE LISTE D'IDENTIFIANTS. Prisma
        // plafonne à 32 767 paramètres liés ; 35 000 arrêts la dépassent.
        const extremiteVisee = { gtfsStopId: { startsWith: prefixe } };
        await tx.networkLink.deleteMany({
          where: { fromStop: extremiteVisee },
        });
        await tx.networkLink.deleteMany({
          where: { toStop: extremiteVisee },
        });

        // 3. Les lignes, puis les arrêts orphelins et non protégés.
        await tx.transitLine.deleteMany({ where: { id: { in: lineIds } } });
        await tx.stop.deleteMany({ where: arretsSupprimables });
      },
      { timeout: 15 * 60 * 1000, maxWait: 30 * 1000 },
    );

    logger.log('Purge effectuée. Aucune donnée d’usager n’a été touchée.');
  } finally {
    await application.close();
  }
}

void main();
