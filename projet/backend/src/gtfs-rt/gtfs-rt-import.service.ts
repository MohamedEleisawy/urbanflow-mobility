import { Injectable, Logger } from '@nestjs/common';
import { ModeTransport } from '@prisma/client';
import { transit_realtime } from 'gtfs-realtime-bindings';
import { PrismaService } from '../prisma/prisma.service';
import { GtfsRtSourceService } from './gtfs-rt-source.service';
import { GtfsRtDecoderService } from './gtfs-rt-decoder.service';
import { GtfsRtImportReport } from './gtfs-rt-import-report';
import {
  AlertImportData,
  GtfsRtModeLookup,
  mapAlertEntity,
} from './gtfs-rt-alert.mapper';

/**
 * Import des alertes GTFS-Realtime en base (étape 4F-1C).
 *
 * Dernier maillon de la chaîne ouverte en 4F-1B :
 *
 *     URL → source → decoder → IMPORTER → PostgreSQL
 *
 * RESPONSABILITÉ : orchestrer et écrire. Les décisions métier — quelle
 * sévérité, quel mode, quelle entité retenir — appartiennent toutes au
 * mapper, qui ne touche pas à la base. Ce service ne fait que lui fournir ce
 * que la base sait, puis écrire ce qu'il rend.
 *
 * IDEMPOTENCE : `upsert` sur `gtfsAlertId`, exactement comme GtfsImportService
 * le fait sur `gtfsStopId` et `gtfsRouteId` depuis 4C-4-3. Réimporter le même
 * flux met à jour les alertes existantes au lieu d'en créer de nouvelles — un
 * flux temps réel est rechargé toutes les 30 secondes, cette propriété n'est
 * donc pas un confort mais une nécessité.
 */
@Injectable()
export class GtfsRtImportService {
  private readonly logger = new Logger(GtfsRtImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly source: GtfsRtSourceService,
    private readonly decoder: GtfsRtDecoderService,
  ) {}

  /**
   * Importe les alertes d'un flux GTFS-RT distant.
   *
   * Point d'entrée à utiliser. Le service ne sait rien du réseau ni du
   * protobuf : il enchaîne les deux briques de 4F-1B, puis importe.
   *
   * @param url adresse du flux ; à défaut, GTFS_RT_URL est utilisée.
   */
  async importFromUrl(url?: string): Promise<GtfsRtImportReport> {
    const adresse = this.resoudreUrl(url);

    const octets = await this.source.fetchFeed(adresse);
    const message = this.decoder.decode(octets);

    return this.importFeed(message);
  }

  /**
   * Détermine l'adresse du flux : argument d'abord, GTFS_RT_URL ensuite
   * (étape 4F-1D).
   *
   * POURQUOI DEUX SOURCES, ET DANS CET ORDRE. Le GTFS statique reçoit sa
   * source en ARGUMENT (`npm run gtfs:import -- <source>`), et c'est justifié :
   * on importe l'archive de la RATP, puis celle d'un autre réseau, puis un
   * dossier local pour tester. La source change à chaque appel.
   *
   * Un flux temps réel est l'inverse : UNE adresse, celle du réseau exploité,
   * relue indéfiniment. La retaper à chaque import serait une invitation à la
   * faute de frappe, et l'écrire dans le code serait un codage en dur.
   * `GTFS_RT_URL` est donc le défaut — et l'argument reste possible, pour
   * garder la convention du projet et permettre d'essayer un autre flux sans
   * toucher à la configuration.
   *
   * AUCUNE URL PAR DÉFAUT DANS LE CODE. Contrairement à CARBON_SERVICE_URL,
   * qui se replie sur localhost:8000 (4D-2), il n'existe aucun repli sensé
   * ici : l'adresse dépend entièrement du réseau exploité. En inventer une
   * ferait échouer l'import sur une adresse que personne n'a choisie, avec un
   * message d'erreur trompeur.
   */
  private resoudreUrl(url?: string): string {
    const adresse = url?.trim() || process.env.GTFS_RT_URL?.trim();

    if (!adresse) {
      throw new Error(
        'Aucune URL de flux GTFS-RT : passez-la en argument (npm run gtfs-rt:import -- <url>) ' +
          'ou définissez GTFS_RT_URL (voir projet/backend/.env.example).',
      );
    }

    return adresse;
  }

  /**
   * Importe les alertes d'un FeedMessage déjà décodé.
   *
   * Séparé de `importFromUrl` pour la même raison qu'en 4F-1B : on doit
   * pouvoir tester l'import sans réseau.
   */
  async importFeed(
    message: transit_realtime.IFeedMessage,
  ): Promise<GtfsRtImportReport> {
    const report = new GtfsRtImportReport();
    const entites = message.entity ?? [];

    // Une seule requête par type, restreinte aux identifiants que le flux
    // mentionne réellement : on ne charge jamais tout le réseau en mémoire
    // pour importer trois alertes.
    const lookup = await this.chargerModes(entites);

    for (const entite of entites) {
      report.countEntity();

      const donnees = mapAlertEntity(entite, lookup, report);
      if (!donnees) {
        // Le mapper a déjà inscrit le motif dans le rapport.
        continue;
      }

      await this.ecrire(donnees, report);
    }

    for (const ligne of report.toLines()) {
      this.logger.log(ligne);
    }

    return report;
  }

  /**
   * Écrit une alerte, en distinguant création et mise à jour.
   *
   * POURQUOI UNE LECTURE AVANT L'UPSERT. `upsert` seul ne dit pas ce qu'il a
   * fait : il rend la ligne finale, identique dans les deux cas. Or le
   * rapport doit annoncer « 3 créées, 2 mises à jour » — sans quoi rien ne
   * distinguerait un premier import d'un réimport, et l'idempotence
   * deviendrait invérifiable.
   */
  private async ecrire(
    donnees: AlertImportData,
    report: GtfsRtImportReport,
  ): Promise<void> {
    const { gtfsAlertId, ...champs } = donnees;

    const existante = await this.prisma.alert.findUnique({
      where: { gtfsAlertId },
      select: { id: true },
    });

    await this.prisma.alert.upsert({
      // La clé de rapprochement est l'identifiant du flux, jamais notre UUID
      // interne : même règle qu'en 4C-4-3.
      where: { gtfsAlertId },
      update: champs,
      create: { ...champs, gtfsAlertId },
    });

    if (existante) {
      report.countUpdated();
    } else {
      report.countCreated();
    }
  }

  /**
   * Demande à la base ce qu'elle sait des lignes et arrêts nommés par le flux.
   *
   * Le mode d'une alerte n'est PAS dans le flux GTFS-Realtime : celui-ci ne
   * transmet que des identifiants. Il se déduit du référentiel importé en
   * 4C-4 — `TransitLine.mode`, alimenté depuis `route_type`. C'est une
   * déduction à partir de données réelles, pas une supposition.
   */
  private async chargerModes(
    entites: transit_realtime.IFeedEntity[],
  ): Promise<GtfsRtModeLookup> {
    const { routeIds, stopIds } = this.identifiantsCites(entites);

    const modeParLigne = new Map<string, ModeTransport>();
    const modesParArret = new Map<string, Set<ModeTransport>>();

    if (routeIds.size > 0) {
      const lignes = await this.prisma.transitLine.findMany({
        where: { gtfsRouteId: { in: [...routeIds] } },
        select: { gtfsRouteId: true, mode: true },
      });

      for (const ligne of lignes) {
        if (ligne.gtfsRouteId) {
          modeParLigne.set(ligne.gtfsRouteId, ligne.mode);
        }
      }
    }

    if (stopIds.size > 0) {
      // Le lien arrêt → mode passe par les liaisons du réseau : une liaison
      // porte une ligne, et une ligne porte un mode.
      const identifiants = [...stopIds];
      const liaisons = await this.prisma.networkLink.findMany({
        where: {
          OR: [
            { fromStop: { gtfsStopId: { in: identifiants } } },
            { toStop: { gtfsStopId: { in: identifiants } } },
          ],
        },
        select: {
          line: { select: { mode: true } },
          fromStop: { select: { gtfsStopId: true } },
          toStop: { select: { gtfsStopId: true } },
        },
      });

      for (const liaison of liaisons) {
        for (const arret of [liaison.fromStop, liaison.toStop]) {
          if (!arret.gtfsStopId || !stopIds.has(arret.gtfsStopId)) {
            continue;
          }

          const modes =
            modesParArret.get(arret.gtfsStopId) ?? new Set<ModeTransport>();
          modes.add(liaison.line.mode);
          modesParArret.set(arret.gtfsStopId, modes);
        }
      }
    }

    return { modeParLigne, modesParArret };
  }

  /**
   * Relève les identifiants cités par le flux, sans rien interpréter.
   *
   * Volontairement PLUS LARGE que ce que le mapper retiendra : ce pré-passage
   * ne juge pas, il prépare une requête. Charger le mode d'une ligne qui sera
   * finalement écartée ne coûte rien ; l'inverse obligerait à requêter la
   * base une fois par alerte.
   */
  private identifiantsCites(entites: transit_realtime.IFeedEntity[]): {
    routeIds: Set<string>;
    stopIds: Set<string>;
  } {
    const routeIds = new Set<string>();
    const stopIds = new Set<string>();

    for (const entite of entites) {
      for (const selecteur of entite.alert?.informedEntity ?? []) {
        const routeId = selecteur.routeId?.trim();
        const stopId = selecteur.stopId?.trim();

        if (routeId) {
          routeIds.add(routeId);
        }
        if (stopId) {
          stopIds.add(stopId);
        }
      }
    }

    return { routeIds, stopIds };
  }
}
