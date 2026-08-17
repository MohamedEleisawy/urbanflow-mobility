import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GtfsReaderService } from './gtfs-reader.service';
import { GtfsImportReport } from './gtfs-import-report';
import { describeRouteType, mapRouteType } from './route-type.mapping';
import { NetworkBuilderService } from './network-builder.service';
import { GtfsSourceService } from './gtfs-source.service';

/**
 * Import du RÉFÉRENTIEL GTFS : les arrêts et les lignes (étape 4C-4-3).
 *
 * Périmètre volontairement limité à `stops.txt` et `routes.txt`. La
 * construction des liaisons du réseau à partir de `stop_times.txt` fait
 * l'objet de l'étape suivante (4C-4-4) : ce sont deux problèmes distincts,
 * et les mélanger rendrait chacun plus difficile à tester.
 *
 * IDEMPOTENCE : tout repose sur `upsert` et sur les contraintes uniques
 * `gtfsStopId` / `gtfsRouteId` posées à l'étape 4C-4-1. Réimporter le même
 * flux met à jour les enregistrements existants au lieu d'en créer de
 * nouveaux — on peut donc relancer un import autant de fois qu'on veut, par
 * exemple après une mise à jour des horaires d'été.
 */
@Injectable()
export class GtfsImportService {
  private readonly logger = new Logger(GtfsImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: GtfsReaderService,
    private readonly networkBuilder: NetworkBuilderService,
    private readonly sourceService: GtfsSourceService,
  ) {}

  /**
   * Importe un flux GTFS depuis N'IMPORTE QUELLE source (étape 4C-4-5) :
   * un dossier local, une archive .zip locale, ou une URL http(s).
   *
   * C'est le point d'entrée à utiliser. Le service ne sait rien du ZIP ni
   * du réseau : il demande un dossier au GtfsSourceService, puis applique
   * exactement le même traitement dans les trois cas.
   *
   * @param source       dossier, chemin d'archive .zip, ou URL
   * @param operatorCode code d'exploitant attribué aux arrêts importés
   */
  async importFromSource(
    source: string,
    operatorCode = '',
  ): Promise<GtfsImportReport> {
    const flux = await this.sourceService.resolve(source);

    try {
      return await this.importReferential(flux.folder, operatorCode);
    } finally {
      // Les fichiers temporaires sont supprimés même si l'import échoue.
      await flux.cleanup();
    }
  }

  /**
   * Lit `stops.txt` et `routes.txt` du dossier indiqué et les écrit en base.
   *
   * @param folder       dossier contenant les fichiers GTFS décompressés
   * @param operatorCode code d'exploitant attribué aux arrêts importés
   *                     (stops.txt ne contient pas cette information)
   */
  async importReferential(
    folder: string,
    operatorCode = '',
  ): Promise<GtfsImportReport> {
    const report = new GtfsImportReport();

    // L'ordre est imposé par les dépendances : les liaisons référencent des
    // arrêts et des lignes, qui doivent donc exister d'abord.
    await this.importStops(folder, operatorCode, report);
    await this.importLines(folder, report);
    await this.networkBuilder.buildNetwork(folder, report);

    // Le bilan est journalisé, jamais silencieux : c'est la seule façon de
    // savoir ce qu'un flux réel contenait vraiment.
    for (const ligne of report.toLines()) {
      this.logger.log(ligne);
    }

    return report;
  }

  private async importStops(
    folder: string,
    operatorCode: string,
    report: GtfsImportReport,
  ): Promise<void> {
    const chemin = join(folder, 'stops.txt');

    // `for await` : les arrêts arrivent un par un depuis le lecteur en flux,
    // et chacun est écrit immédiatement. On n'accumule jamais tout le
    // fichier en mémoire, même pour un réseau de plusieurs milliers d'arrêts.
    for await (const arret of this.reader.readStops(chemin, report)) {
      const donnees = {
        name: arret.stopName,
        latitude: arret.latitude,
        longitude: arret.longitude,
        pmrAccessible: arret.pmrAccessible,
        operatorCode,
      };

      await this.prisma.stop.upsert({
        // La clé de rapprochement est l'identifiant GTFS, jamais notre UUID
        // interne : c'est ce qui permet de retrouver un arrêt déjà importé.
        where: { gtfsStopId: arret.stopId },
        update: donnees,
        create: { ...donnees, gtfsStopId: arret.stopId },
      });

      report.countImported('stops');
    }
  }

  private async importLines(
    folder: string,
    report: GtfsImportReport,
  ): Promise<void> {
    const chemin = join(folder, 'routes.txt');

    for await (const ligne of this.reader.readRoutes(chemin, report)) {
      const mode = mapRouteType(ligne.routeType);

      if (mode === null) {
        // Ligne parfaitement valide, mais dont le mode n'a pas d'équivalent
        // (train, ferry...). On la COMPTE et on la JOURNALISE : jamais un
        // rejet silencieux.
        report.countUnsupportedRouteType(ligne.routeType);
        this.logger.warn(
          `Ligne "${ligne.routeId}" non importée : route_type ` +
            `${describeRouteType(ligne.routeType)} sans équivalent dans ModeTransport`,
        );
        continue;
      }

      const donnees = {
        name: this.nomDeLigne(ligne.shortName, ligne.longName, ligne.routeId),
        mode,
        operator: ligne.agencyId,
      };

      await this.prisma.transitLine.upsert({
        where: { gtfsRouteId: ligne.routeId },
        update: donnees,
        create: { ...donnees, gtfsRouteId: ligne.routeId },
      });

      report.countImported('transitLines');
    }
  }

  /**
   * Règle de repli pour le nom d'une ligne.
   *
   * GTFS fournit deux noms : un court ("4") et un long ("Porte de
   * Clignancourt - Mairie de Montrouge"). Le champ `name` étant obligatoire
   * en base, il faut toujours une valeur :
   *
   *   nom court → sinon nom long → sinon l'identifiant GTFS.
   *
   * Le nom court est privilégié car c'est celui que l'usager voit sur le
   * quai. L'identifiant en dernier recours n'est pas élégant, mais il vaut
   * mieux qu'une chaîne vide : au moins la ligne reste identifiable.
   */
  private nomDeLigne(
    shortName: string,
    longName: string,
    routeId: string,
  ): string {
    return shortName || longName || routeId;
  }
}
