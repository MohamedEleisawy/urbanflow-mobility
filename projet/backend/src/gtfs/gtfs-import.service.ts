import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ModeTransport, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { haversineDistanceM } from '../common/geo/distance.util';
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
/// Identifiant réservé de la ligne de service portant les correspondances.
///
/// Le préfixe `URBANFLOW:` la distingue de toute ligne d'opérateur, qui
/// porte le sien (`IDFM:` ici). Aucune collision possible.
export const LIGNE_CORRESPONDANCE_ID = 'URBANFLOW:TRANSFER';

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
    modes?: ReadonlySet<ModeTransport>,
  ): Promise<GtfsImportReport> {
    const flux = await this.sourceService.resolve(source);

    try {
      return await this.importReferential(flux.folder, operatorCode, modes);
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
  /**
   * @param modes périmètre demandé. `undefined` = tous les modes que
   *   `mapRouteType` sait traduire — le comportement d'origine.
   *
   *   Le flux réel d'Île-de-France Mobilités compte 2 026 lignes, dont
   *   1 967 de bus : les importer toutes produirait 53 437 arrêts, alors que
   *   `GET /api/stops` n'est pas paginé et que la recherche d'itinéraire
   *   charge tout le graphe en mémoire à chaque appel. Le filtre existe pour
   *   que le périmètre soit une DÉCISION, et non une conséquence subie.
   */
  async importReferential(
    folder: string,
    operatorCode = '',
    modes?: ReadonlySet<ModeTransport>,
  ): Promise<GtfsImportReport> {
    const report = new GtfsImportReport();

    // L'ordre est imposé par les dépendances : les liaisons référencent des
    // arrêts et des lignes, qui doivent donc exister d'abord.
    await this.importStops(folder, operatorCode, report);
    await this.importLines(folder, report, modes);
    await this.networkBuilder.buildNetwork(folder, report);

    // ⚠️ L'ORDRE DES DEUX ÉTAPES SUIVANTES EST CRITIQUE, et il a été corrigé
    // après un import réel raté.
    //
    // On élague D'ABORD les arrêts qu'aucune ligne du périmètre ne dessert,
    // et on importe les correspondances ENSUITE, restreintes aux survivants.
    //
    // Dans l'autre sens, `transfers.txt` reliait les 35 530 arrêts encore en
    // base — bus et RER compris. Ces arrêts se retrouvaient porteurs d'une
    // liaison, échappaient donc à l'élagage, et le réseau passait de 1 383
    // à 34 770 arrêts : exactement le volume que le filtre de périmètre
    // existe pour éviter.
    await this.elaguerArretsNonDesservis(report);

    // Les correspondances relient les quais entre eux : sans elles, chaque
    // ligne forme un chemin ISOLÉ et aucun changement n'est possible.
    await this.importTransfers(folder, report);

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
    modes?: ReadonlySet<ModeTransport>,
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

      // Hors périmètre demandé : la ligne est parfaitement traduisible, elle
      // n'est simplement pas voulue. Motif DISTINCT de `unsupportedRouteType`
      // — le bilan doit permettre de dire « 1 967 lignes de bus écartées par
      // choix » sans les confondre avec des données inexploitables.
      if (modes && !modes.has(mode)) {
        report.countIgnored('routes', 'outOfScope');
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

  /**
   * Supprime les arrêts qu'aucune liaison ne dessert (Phase 1).
   *
   * ═══ POURQUOI CETTE ÉTAPE EXISTE ═══
   *
   * `stops.txt` décrit TOUS les arrêts du réseau — 53 437 sur le flux réel
   * d'Île-de-France Mobilités — sans dire lesquels relèvent de quel mode.
   * L'information ne vit que dans `stop_times.txt` croisé avec `trips.txt` :
   * filtrer AVANT l'import supposerait une lecture supplémentaire du plus
   * gros fichier du flux (778 Mo).
   *
   * On importe donc tout, puis on retire ce que le réseau construit n'utilise
   * pas. Le coût est payé UNE FOIS, à l'import ; le bénéfice est permanent,
   * `GET /api/stops` n'étant pas paginé.
   *
   * ⚠️ NE SUPPRIME QUE CE QUI EST VRAIMENT ORPHELIN. Un arrêt référencé par
   * un `Segment` — donc par le trajet enregistré d'un usager — est conservé
   * même sans liaison : le supprimer détruirait un historique personnel.
   * Un arrêt saisi à la main (`gtfsStopId` nul) n'est pas concerné non plus.
   */
  private async elaguerArretsNonDesservis(
    report: GtfsImportReport,
  ): Promise<void> {
    const supprimes = await this.prisma.stop.deleteMany({
      where: {
        gtfsStopId: { not: null },
        linksFrom: { none: {} },
        linksTo: { none: {} },
        segmentsFrom: { none: {} },
        segmentsTo: { none: {} },
      },
    });

    if (supprimes.count > 0) {
      report.countPrunedStops(supprimes.count);
      this.logger.log(
        `${supprimes.count} arrêts non desservis par le périmètre retenu ont été retirés.`,
      );
    }
  }

  /**
   * Importe `transfers.txt` comme liaisons de marche (Phase 1).
   *
   * ═══ POURQUOI CETTE ÉTAPE EXISTE ═══
   *
   * Île-de-France Mobilités publie UN ARRÊT PAR LIGNE ET PAR QUAI :
   * « Châtelet » existe en plusieurs exemplaires, un par ligne qui le
   * dessert. Sans correspondances, le graphe est une collection de chemins
   * isolés — un usager ne peut jamais changer de ligne, et une recherche
   * Bastille → Châtelet rend zéro proposition alors que les deux arrêts sont
   * sur la ligne 1.
   *
   * ═══ UNE LIGNE DE SERVICE, ET POURQUOI ═══
   *
   * `NetworkLink` exige un `lineId` : une liaison appartient toujours à une
   * ligne. Or une correspondance n'appartient à AUCUNE ligne de transport.
   *
   * Plutôt que de rendre `lineId` facultatif — ce qui aurait touché le
   * schéma, le moteur et tout l'affichage — on crée UNE ligne de service, de
   * mode `WALK`, nommée « Correspondance ». Le motif existait déjà : le jeu
   * de démonstration portait une ligne « À pied » de même nature.
   *
   * ⚠️ ELLE N'EST JAMAIS PRÉSENTÉE COMME UNE LIGNE DE MÉTRO. Son mode est
   * `WALK`, son nom est « Correspondance » : l'interface affiche « Marche »,
   * et le calcul carbone lui applique 0 g/km — ce qui est exact, on marche.
   *
   * ═══ IDEMPOTENCE ═══
   *
   * `@@unique([lineId, fromStopId, toStopId])` : réimporter le même flux met
   * à jour les mêmes lignes, il n'en crée pas de secondes.
   */
  private async importTransfers(
    folder: string,
    report: GtfsImportReport,
  ): Promise<void> {
    const chemin = join(folder, 'transfers.txt');

    if (!existsSync(chemin)) {
      this.logger.log(
        'Aucun transfers.txt : le réseau sera importé sans correspondances.',
      );
      return;
    }

    const arrets = await this.prisma.stop.findMany({
      where: { gtfsStopId: { not: null } },
      select: { id: true, gtfsStopId: true, latitude: true, longitude: true },
    });

    if (arrets.length === 0) {
      return;
    }

    const parGtfsId = new Map(arrets.map((a) => [a.gtfsStopId as string, a]));

    const ligneMarche = await this.ligneDeCorrespondance();

    for await (const transfert of this.reader.readTransfers(
      chemin,
      report,
      new Set(parGtfsId.keys()),
    )) {
      const depart = parGtfsId.get(transfert.fromStopId);
      const arrivee = parGtfsId.get(transfert.toStopId);

      if (!depart || !arrivee) {
        continue;
      }

      const donnees = {
        // ⚠️ LA DURÉE VIENT DE L'OPÉRATEUR, jamais d'une estimation. Sur le
        // flux réel, les 191 816 correspondances sont de type 2 et portent
        // toutes leur `min_transfer_time`. Le repli à 3 minutes ne sert que
        // pour un flux qui l'omettrait — GTFS ne l'impose pas hors type 2.
        durationMin: Math.max(
          1,
          Math.round((transfert.minTransferTimeSec ?? 180) / 60),
        ),
        distanceM: Math.round(
          haversineDistanceM(
            depart.latitude,
            depart.longitude,
            arrivee.latitude,
            arrivee.longitude,
          ),
        ),
        // Aucune géométrie : `shapes.txt` décrit des parcours de véhicules,
        // pas des couloirs de correspondance. Inventer une ligne droite entre
        // deux quais serait un tracé faux.
        geometry: Prisma.DbNull,
      };

      await this.prisma.networkLink.upsert({
        where: {
          lineId_fromStopId_toStopId: {
            lineId: ligneMarche,
            fromStopId: depart.id,
            toStopId: arrivee.id,
          },
        },
        update: donnees,
        create: {
          ...donnees,
          lineId: ligneMarche,
          fromStopId: depart.id,
          toStopId: arrivee.id,
        },
      });

      report.countImported('transfers');
    }
  }

  /**
   * La ligne de service portant les correspondances, créée au besoin.
   *
   * `gtfsRouteId` est une valeur RÉSERVÉE, préfixée `URBANFLOW:` — elle ne
   * peut donc entrer en collision avec aucun identifiant d'opérateur, qui
   * porte toujours son propre préfixe (`IDFM:` chez Île-de-France Mobilités).
   */
  private async ligneDeCorrespondance(): Promise<string> {
    const donnees = {
      name: 'Correspondance',
      mode: ModeTransport.WALK,
      operator: 'UrbanFlow',
    };

    const ligne = await this.prisma.transitLine.upsert({
      where: { gtfsRouteId: LIGNE_CORRESPONDANCE_ID },
      update: donnees,
      create: { ...donnees, gtfsRouteId: LIGNE_CORRESPONDANCE_ID },
      select: { id: true },
    });

    return ligne.id;
  }
}
