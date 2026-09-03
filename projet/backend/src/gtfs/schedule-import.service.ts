import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GtfsImportReport } from './gtfs-import-report';
import { GtfsReaderService } from './gtfs-reader.service';

// =============================================================================
// Import du calendrier et des horaires de passage (sprint soutenance)
// =============================================================================
// ═══ CE QUE CETTE ÉTAPE REND POSSIBLE ═══
//
// Avant elle, le produit ne connaissait que des durées TYPIQUES : « le tram D
// met 4 minutes entre ces deux arrêts ». Il ne savait ni quel jour la ligne
// circule, ni à quelle heure. Deux mensonges en découlaient :
//
//   - une durée annoncée qui EXCLUAIT l'attente ;
//   - des lignes de nuit proposées en plein jour.
//
// ═══ POURQUOI UN SERVICE SÉPARÉ DE `GtfsImportService` ═══
//
// Le volume. `stop_times.txt` de la CTS pèse 48 Mo pour 710 000 lignes —
// à lui seul, plus que tout le reste du flux réuni. Le mêler à l'import du
// référentiel donnerait une méthode qu'on ne peut plus lire, et empêcherait
// de réimporter les horaires sans retoucher au réseau.
//
// ═══ IDEMPOTENCE ═══
//
// Un réimport ne doit pas empiler 710 000 lignes de plus. On SUPPRIME donc
// d'abord les passages des lignes concernées, puis on réinsère.
//
// ⚠️ « DES LIGNES CONCERNÉES », ET NON TOUTE LA TABLE. Un `deleteMany({})`
// effacerait les horaires d'un second réseau importé à côté — précisément le
// genre de destruction silencieuse qu'on ne remarque qu'en production.
// =============================================================================

/// Taille des lots d'insertion.
///
/// 5 000 : au-delà, la requête `INSERT` dépasse les limites de paramètres du
/// pilote PostgreSQL sur une table à six colonnes ; en deçà, on paie le
/// coût d'un aller-retour pour trop peu de lignes. Mesuré sur le flux réel :
/// 710 000 passages en 142 lots.
const TAILLE_LOT = 5_000;

interface CourseConnue {
  lineId: string;
  serviceId: string;
  headsign: string | null;
}

@Injectable()
export class ScheduleImportService {
  private readonly logger = new Logger(ScheduleImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: GtfsReaderService,
  ) {}

  /**
   * Importe `calendar.txt`, `calendar_dates.txt` puis les passages.
   *
   * ⚠️ NE LÈVE PAS SI LE CALENDRIER EST ABSENT. Ces deux fichiers sont
   * FACULTATIFS dans la spécification GTFS. Un flux sans eux s'importe
   * exactement comme avant, et l'interface annonce alors honnêtement qu'elle
   * ne connaît pas les prochains passages — plutôt que d'en inventer.
   */
  async importSchedules(
    folder: string,
    operatorCode: string,
    report: GtfsImportReport,
  ): Promise<void> {
    const services = await this.importServices(folder, operatorCode, report);

    if (services.size === 0) {
      this.logger.warn(
        'Aucun service de calendrier importé : les prochains passages ' +
          'resteront indisponibles. Ce n’est une anomalie que si le flux ' +
          'contenait calendar.txt.',
      );
      return;
    }

    await this.importExceptions(folder, services, report);
    await this.importDepartures(folder, services, report);
  }

  /**
   * Vrai si le fichier existe dans le dossier extrait.
   *
   * `access` plutôt qu'un `try` autour de la lecture : distinguer « fichier
   * absent » (normal) de « fichier illisible » (anomalie) exige de poser la
   * question avant, sinon les deux remontent la même exception.
   */
  private async present(folder: string, fichier: string): Promise<boolean> {
    try {
      await access(join(folder, fichier));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Le préfixe qui isole les services d'un réseau de ceux d'un autre.
   *
   * ⚠️ INDISPENSABLE. Deux flux publient couramment un service nommé
   * « Semaine » ou « 1 » ; sans préfixe, `gtfsServiceId` étant unique,
   * l'import du second ÉCRASERAIT le calendrier du premier — et les horaires
   * du premier réseau se mettraient à suivre le calendrier du second.
   */
  private prefixer(operatorCode: string, serviceId: string): string {
    return operatorCode ? `${operatorCode}:${serviceId}` : serviceId;
  }

  /**
   * `calendar.txt` → table `transit_services`.
   *
   * Rend la correspondance `service_id du flux` → `id interne`, dont les
   * deux étapes suivantes ont besoin.
   */
  private async importServices(
    folder: string,
    operatorCode: string,
    report: GtfsImportReport,
  ): Promise<Map<string, string>> {
    const parGtfsId = new Map<string, string>();

    if (!(await this.present(folder, 'calendar.txt'))) {
      return parGtfsId;
    }

    for await (const service of this.reader.readCalendars(
      join(folder, 'calendar.txt'),
      report,
    )) {
      const cle = this.prefixer(operatorCode, service.serviceId);

      const donnees = {
        monday: service.days[0],
        tuesday: service.days[1],
        wednesday: service.days[2],
        thursday: service.days[3],
        friday: service.days[4],
        saturday: service.days[5],
        sunday: service.days[6],
        startDate: service.startDate,
        endDate: service.endDate,
      };

      const enregistre = await this.prisma.transitService.upsert({
        where: { gtfsServiceId: cle },
        update: donnees,
        create: { ...donnees, gtfsServiceId: cle },
      });

      // ⚠️ LA CLÉ DE LA MAP EST L'IDENTIFIANT BRUT DU FLUX, pas le préfixé :
      // `trips.txt` référence les services par leur nom d'origine.
      parGtfsId.set(service.serviceId, enregistre.id);
      report.countValid('calendar');
    }

    return parGtfsId;
  }

  /**
   * `calendar_dates.txt` → table `transit_service_exceptions`.
   *
   * Une exception visant un service INCONNU est écartée, jamais créée à la
   * volée : un service sans jours ni période de validité ne dit rien.
   */
  private async importExceptions(
    folder: string,
    services: ReadonlyMap<string, string>,
    report: GtfsImportReport,
  ): Promise<void> {
    if (!(await this.present(folder, 'calendar_dates.txt'))) {
      return;
    }

    for await (const exception of this.reader.readCalendarDates(
      join(folder, 'calendar_dates.txt'),
      report,
    )) {
      const serviceId = services.get(exception.serviceId);

      if (!serviceId) {
        report.countIgnored('calendarDates', 'outOfScope');
        continue;
      }

      await this.prisma.transitServiceException.upsert({
        where: { serviceId_date: { serviceId, date: exception.date } },
        update: { added: exception.added },
        create: { serviceId, date: exception.date, added: exception.added },
      });

      report.countValid('calendarDates');
    }
  }

  /**
   * `trips.txt` + `stop_times.txt` → table `stop_departures`.
   *
   * ═══ POURQUOI ON RELIT `trips.txt` ICI ═══
   *
   * `NetworkBuilderService` le lit déjà, mais pour en tirer autre chose : la
   * ligne et le tracé de chaque course. Il ignore le service et la girouette,
   * qui sont précisément ce dont on a besoin. Relire un fichier de 2,8 Mo
   * coûte moins qu'un couplage entre deux étapes qui n'ont pas le même objet.
   */
  private async importDepartures(
    folder: string,
    services: ReadonlyMap<string, string>,
    report: GtfsImportReport,
  ): Promise<void> {
    const lignes = await this.chargerLignes();
    const arrets = await this.chargerArrets();

    // --- les courses retenues -------------------------------------------------
    const courses = new Map<string, CourseConnue>();

    // ⚠️ LE LECTEUR FILTRE LUI-MÊME sur les lignes connues : lui passer
    // l'ensemble évite de traverser 30 837 courses pour en écarter la moitié
    // ici, et fait compter correctement les lignes hors périmètre au bilan.
    for await (const trip of this.reader.readTrips(
      join(folder, 'trips.txt'),
      report,
      new Set(lignes.keys()),
    )) {
      const lineId = lignes.get(trip.routeId);
      const serviceId = services.get(trip.serviceId);

      // ⚠️ UNE COURSE DONT LA LIGNE N'A PAS ÉTÉ IMPORTÉE EST ÉCARTÉE. C'est
      // le cas normal quand un périmètre de modes a été demandé : les
      // courses de bus d'un import « tram seulement » n'ont nulle part où
      // aller. Ce n'est pas une anomalie du flux.
      if (!lineId || !serviceId) {
        continue;
      }

      courses.set(trip.tripId, {
        lineId,
        serviceId,
        headsign: trip.headsign,
      });
    }

    if (courses.size === 0) {
      return;
    }

    // --- table nette pour ces lignes -----------------------------------------
    const lineIds = [...new Set([...courses.values()].map((c) => c.lineId))];

    await this.prisma.stopDeparture.deleteMany({
      where: { lineId: { in: lineIds } },
    });

    // --- les passages ---------------------------------------------------------
    let lot: {
      lineId: string;
      stopId: string;
      serviceId: string;
      departureSec: number;
      headsign: string | null;
    }[] = [];
    let ecrits = 0;

    const vider = async () => {
      if (lot.length === 0) {
        return;
      }

      await this.prisma.stopDeparture.createMany({ data: lot });
      ecrits += lot.length;
      lot = [];
    };

    for await (const passage of this.reader.readStopTimes(
      join(folder, 'stop_times.txt'),
      report,
      new Set(arrets.keys()),
      new Set(courses.keys()),
    )) {
      const course = courses.get(passage.tripId);
      const stopId = arrets.get(passage.stopId);

      if (!course || !stopId) {
        continue;
      }

      lot.push({
        lineId: course.lineId,
        stopId,
        serviceId: course.serviceId,
        departureSec: passage.departureTimeSec,
        headsign: course.headsign,
      });

      if (lot.length >= TAILLE_LOT) {
        await vider();
      }
    }

    await vider();

    this.logger.log(`Passages théoriques importés : ${ecrits}`);
  }

  private async chargerLignes(): Promise<Map<string, string>> {
    const lignes = await this.prisma.transitLine.findMany({
      where: { gtfsRouteId: { not: null } },
      select: { id: true, gtfsRouteId: true },
    });

    return new Map(lignes.map((l) => [l.gtfsRouteId as string, l.id]));
  }

  private async chargerArrets(): Promise<Map<string, string>> {
    const arrets = await this.prisma.stop.findMany({
      where: { gtfsStopId: { not: null } },
      select: { id: true, gtfsStopId: true },
    });

    return new Map(arrets.map((a) => [a.gtfsStopId as string, a.id]));
  }
}
