import { createReadStream } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse';
import {
  GtfsCalendar,
  GtfsCalendarDate,
  GtfsRoute,
  GtfsShapePoint,
  GtfsTransfer,
  GtfsStop,
  GtfsStopTime,
  GtfsTrip,
} from './gtfs-row.types';
import { GtfsFileName, GtfsImportReport } from './gtfs-import-report';
import { parseGtfsDate, parseGtfsTime } from './gtfs-time.util';

/// Une ligne brute de CSV : toutes les colonnes sont des chaînes.
type RawRow = Record<string, string>;

/**
 * Lecture d'un flux GTFS, fichier par fichier.
 *
 * DEUX PRINCIPES gouvernent ce service :
 *
 * 1. LECTURE EN FLUX. Un fichier stop_times.txt réel pèse couramment
 *    plusieurs centaines de Mo. On ne le charge JAMAIS entièrement en
 *    mémoire : `createReadStream` lit par petits morceaux, csv-parse les
 *    transforme en lignes au fil de l'eau, et chaque méthode est un
 *    GÉNÉRATEUR ASYNCHRONE (`async *`) qui restitue les lignes une par une.
 *    L'appelant les consomme avec `for await`, sans jamais tout accumuler.
 *
 * 2. UNE LIGNE INVALIDE N'ARRÊTE PAS LA LECTURE. Elle est comptée dans le
 *    rapport avec son motif, et la lecture continue. Seule une erreur de
 *    FICHIER (absent, illisible) interrompt le traitement — c'est une
 *    distinction importante : l'une est une donnée imparfaite, l'autre un
 *    problème de configuration.
 */
@Injectable()
export class GtfsReaderService {
  /// Ouvre un fichier CSV en flux et restitue ses lignes brutes.
  private async *readCsv(filePath: string): AsyncGenerator<RawRow, void> {
    const source = createReadStream(filePath);
    const parseur = parse({
      // Utilise la première ligne comme noms de colonnes.
      columns: true,
      // Les fichiers GTFS commencent souvent par un BOM UTF-8 : un caractère
      // invisible en tout début de fichier. Sans cette option, le nom de la
      // première colonne contiendrait ce caractère fantôme et ne
      // correspondrait jamais à "stop_id".
      bom: true,
      skip_empty_lines: true,
      trim: true,
      // Une ligne qui n'a pas le bon nombre de colonnes ne doit pas faire
      // exploser le parseur : on la laisse passer et notre validation la
      // rejettera proprement (champ obligatoire manquant).
      relax_column_count: true,
    });

    // `pipe` ne transmet PAS les erreurs de la source vers la destination.
    // Sans cette ligne, un fichier absent laisserait la lecture bloquée
    // indéfiniment au lieu de lever une erreur. On détruit donc le parseur
    // avec l'erreur, ce qui la fait remonter dans le `for await` ci-dessous.
    source.on('error', (error) => parseur.destroy(error));
    source.pipe(parseur);

    try {
      for await (const ligne of parseur) {
        yield ligne as RawRow;
      }
    } catch (error) {
      // Erreur de FICHIER : on la remonte avec un message explicite.
      throw new Error(
        `Lecture impossible du fichier GTFS "${filePath}" : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /// Renvoie la valeur d'une colonne, ou undefined si absente/vide.
  private champ(ligne: RawRow, nom: string): string | undefined {
    const valeur = ligne[nom];
    return valeur === undefined || valeur === '' ? undefined : valeur;
  }

  /// Convertit en nombre fini, ou null.
  private nombre(valeur: string | undefined): number | null {
    if (valeur === undefined) {
      return null;
    }
    const converti = Number(valeur);
    return Number.isFinite(converti) ? converti : null;
  }

  // ---------------------------------------------------------------------------
  // stops.txt
  // ---------------------------------------------------------------------------
  async *readStops(
    filePath: string,
    report: GtfsImportReport,
  ): AsyncGenerator<GtfsStop, void> {
    const fichier: GtfsFileName = 'stops';

    for await (const ligne of this.readCsv(filePath)) {
      report.countRow(fichier);

      const stopId = this.champ(ligne, 'stop_id');
      const stopName = this.champ(ligne, 'stop_name');

      if (!stopId || !stopName) {
        report.countIgnored(fichier, 'missingRequiredField');
        continue;
      }

      // location_type : 0 (ou vide) = un vrai arrêt ; 1 = station,
      // 2 = accès, 3 = zone de correspondance, 4 = point d'embarquement.
      // Notre modèle ne connaît que les arrêts desservis : les autres sont
      // ÉCARTÉS VOLONTAIREMENT — ce n'est pas une erreur du flux.
      const locationType = this.champ(ligne, 'location_type') ?? '0';
      if (locationType !== '0') {
        report.countFiltered(fichier, 'unsupportedLocationType');
        continue;
      }

      const latitude = this.nombre(this.champ(ligne, 'stop_lat'));
      const longitude = this.nombre(this.champ(ligne, 'stop_lon'));

      if (latitude === null || longitude === null) {
        report.countIgnored(fichier, 'invalidCoordinates');
        continue;
      }

      if (
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        report.countIgnored(fichier, 'invalidCoordinates');
        continue;
      }

      report.countValid(fichier);

      yield {
        stopId,
        stopName,
        latitude,
        longitude,
        // 1 = accessible ; 2 = non accessible ; 0 ou absent = inconnu.
        // Faute de champ "inconnu" côté Prisma, seul 1 donne true.
        pmrAccessible: this.champ(ligne, 'wheelchair_boarding') === '1',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // routes.txt
  // ---------------------------------------------------------------------------
  async *readRoutes(
    filePath: string,
    report: GtfsImportReport,
  ): AsyncGenerator<GtfsRoute, void> {
    const fichier: GtfsFileName = 'routes';

    for await (const ligne of this.readCsv(filePath)) {
      report.countRow(fichier);

      const routeId = this.champ(ligne, 'route_id');
      const routeTypeBrut = this.champ(ligne, 'route_type');

      if (!routeId || routeTypeBrut === undefined) {
        report.countIgnored(fichier, 'missingRequiredField');
        continue;
      }

      const routeType = this.nombre(routeTypeBrut);

      if (routeType === null || !Number.isInteger(routeType)) {
        report.countIgnored(fichier, 'invalidNumber');
        continue;
      }

      // On conserve route_type BRUT : la traduction vers ModeTransport
      // (et donc le filtrage des types non supportés) appartient à 4C-4-3.
      report.countValid(fichier);

      yield {
        routeId,
        // On n'invente aucune valeur : une chaîne vide reste vide, et
        // l'étape suivante décidera de la règle de repli.
        shortName: this.champ(ligne, 'route_short_name') ?? '',
        longName: this.champ(ligne, 'route_long_name') ?? '',
        routeType,
        agencyId: this.champ(ligne, 'agency_id') ?? '',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // trips.txt
  // ---------------------------------------------------------------------------
  /// `knownRouteIds` permet de détecter les trajets qui référencent une
  /// ligne inexistante. La vérification est faite EN MÉMOIRE : aucune
  /// requête en base n'est nécessaire, et le jeu d'identifiants de lignes
  /// reste petit même pour un grand réseau.
  async *readTrips(
    filePath: string,
    report: GtfsImportReport,
    knownRouteIds: ReadonlySet<string>,
  ): AsyncGenerator<GtfsTrip, void> {
    const fichier: GtfsFileName = 'trips';

    for await (const ligne of this.readCsv(filePath)) {
      report.countRow(fichier);

      const tripId = this.champ(ligne, 'trip_id');
      const routeId = this.champ(ligne, 'route_id');

      if (!tripId || !routeId) {
        report.countIgnored(fichier, 'missingRequiredField');
        continue;
      }

      if (!knownRouteIds.has(routeId)) {
        report.countIgnored(fichier, 'unknownRoute');
        continue;
      }

      const directionBrute = this.champ(ligne, 'direction_id');
      const directionId = this.nombre(directionBrute);

      report.countValid(fichier);

      yield {
        tripId,
        routeId,
        serviceId: this.champ(ligne, 'service_id') ?? '',
        directionId,
        // Facultatif : un flux sans `shapes.txt` n'a pas cette colonne.
        headsign: this.champ(ligne, 'trip_headsign') ?? null,
        shapeId: this.champ(ligne, 'shape_id') ?? null,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // stop_times.txt
  // ---------------------------------------------------------------------------
  /// Le fichier le plus volumineux du flux. Les deux ensembles
  /// d'identifiants reçus restent en mémoire (ils sont petits), tandis que
  /// les passages, eux, ne sont jamais accumulés.
  async *readStopTimes(
    filePath: string,
    report: GtfsImportReport,
    knownStopIds: ReadonlySet<string>,
    knownTripIds: ReadonlySet<string>,
  ): AsyncGenerator<GtfsStopTime, void> {
    const fichier: GtfsFileName = 'stopTimes';

    for await (const ligne of this.readCsv(filePath)) {
      report.countRow(fichier);

      const tripId = this.champ(ligne, 'trip_id');
      const stopId = this.champ(ligne, 'stop_id');
      const sequenceBrute = this.champ(ligne, 'stop_sequence');

      if (!tripId || !stopId || sequenceBrute === undefined) {
        report.countIgnored(fichier, 'missingRequiredField');
        continue;
      }

      if (!knownTripIds.has(tripId)) {
        report.countIgnored(fichier, 'unknownTrip');
        continue;
      }

      if (!knownStopIds.has(stopId)) {
        report.countIgnored(fichier, 'unknownStop');
        continue;
      }

      const stopSequence = this.nombre(sequenceBrute);

      if (stopSequence === null || !Number.isInteger(stopSequence)) {
        report.countIgnored(fichier, 'invalidNumber');
        continue;
      }

      // Horaires en secondes depuis minuit : GTFS autorise 25:10:00.
      const arrivalTimeSec = parseGtfsTime(this.champ(ligne, 'arrival_time'));
      const departureTimeSec = parseGtfsTime(
        this.champ(ligne, 'departure_time'),
      );

      if (arrivalTimeSec === null || departureTimeSec === null) {
        report.countIgnored(fichier, 'invalidTime');
        continue;
      }

      report.countValid(fichier);

      yield { tripId, stopId, stopSequence, arrivalTimeSec, departureTimeSec };
    }
  }

  /**
   * Lit `shapes.txt` en flux (Phase 1B).
   *
   * ⚠️ FICHIER FACULTATIF. La spécification GTFS ne l'impose pas, et le jeu de
   * démonstration du projet n'en a pas. L'appelant doit donc vérifier son
   * existence AVANT d'appeler cette méthode : un flux sans géométrie n'est
   * pas un flux invalide.
   *
   * `knownShapeIds` évite de charger les tracés de lignes hors périmètre —
   * sur le flux réel d'Île-de-France Mobilités, `shapes.txt` pèse 129 Mo
   * pour 2 026 lignes, dont 33 seulement nous concernent.
   *
   * Les points sont rendus TELS QUELS, sans tri : c'est l'appelant qui les
   * regroupe par tracé et les ordonne par `shape_pt_sequence`. Trier ici
   * supposerait de tout garder en mémoire, ce que la lecture en flux existe
   * précisément pour éviter.
   */
  async *readShapes(
    filePath: string,
    report: GtfsImportReport,
    knownShapeIds: ReadonlySet<string>,
  ): AsyncGenerator<GtfsShapePoint, void> {
    const fichier: GtfsFileName = 'shapes';

    for await (const ligne of this.readCsv(filePath)) {
      report.countRow(fichier);

      const shapeId = this.champ(ligne, 'shape_id');
      const latBrute = this.champ(ligne, 'shape_pt_lat');
      const lonBrute = this.champ(ligne, 'shape_pt_lon');
      const sequenceBrute = this.champ(ligne, 'shape_pt_sequence');

      if (!shapeId || latBrute === undefined || lonBrute === undefined) {
        report.countIgnored(fichier, 'missingRequiredField');
        continue;
      }

      if (!knownShapeIds.has(shapeId)) {
        // Hors périmètre : ce n'est pas une anomalie, seulement un tracé qui
        // ne nous concerne pas.
        report.countIgnored(fichier, 'outOfScope');
        continue;
      }

      const latitude = this.nombre(latBrute);
      const longitude = this.nombre(lonBrute);
      const sequence = this.nombre(sequenceBrute);

      // Mêmes bornes que pour les arrêts : une coordonnée hors intervalle
      // n'est pas un point du globe.
      if (
        latitude === null ||
        longitude === null ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        report.countIgnored(fichier, 'invalidCoordinates');
        continue;
      }

      if (sequence === null || !Number.isInteger(sequence)) {
        report.countIgnored(fichier, 'invalidNumber');
        continue;
      }

      report.countValid(fichier);

      yield { shapeId, latitude, longitude, sequence };
    }
  }

  /**
   * Lit `transfers.txt` en flux (Phase 1 — correspondances).
   *
   * ⚠️ FICHIER FACULTATIF, comme `shapes.txt`. L'appelant vérifie son
   * existence avant d'appeler : un flux sans correspondances n'est pas un flux
   * invalide, il décrit simplement un réseau où l'on ne change pas.
   *
   * `knownStopIds` écarte les correspondances dont l'un des deux arrêts est
   * hors périmètre — sur le flux réel, la très grande majorité, puisque seuls
   * métro et tram sont importés.
   */
  async *readTransfers(
    filePath: string,
    report: GtfsImportReport,
    knownStopIds: ReadonlySet<string>,
  ): AsyncGenerator<GtfsTransfer, void> {
    const fichier: GtfsFileName = 'transfers';

    for await (const ligne of this.readCsv(filePath)) {
      report.countRow(fichier);

      const fromStopId = this.champ(ligne, 'from_stop_id');
      const toStopId = this.champ(ligne, 'to_stop_id');

      if (!fromStopId || !toStopId) {
        report.countIgnored(fichier, 'missingRequiredField');
        continue;
      }

      // Une correspondance d'un arrêt vers LUI-MÊME n'apprend rien et
      // produirait une boucle de coût nul dans le graphe.
      if (fromStopId === toStopId) {
        report.countIgnored(fichier, 'outOfScope');
        continue;
      }

      if (!knownStopIds.has(fromStopId) || !knownStopIds.has(toStopId)) {
        report.countIgnored(fichier, 'unknownStop');
        continue;
      }

      const transferType = this.nombre(this.champ(ligne, 'transfer_type')) ?? 0;

      // ⚠️ TYPE 3 = « correspondance IMPOSSIBLE ». L'importer créerait un
      // chemin que l'opérateur déclare inexistant.
      if (transferType === 3) {
        report.countIgnored(fichier, 'outOfScope');
        continue;
      }

      report.countValid(fichier);

      yield {
        fromStopId,
        toStopId,
        transferType,
        minTransferTimeSec: this.nombre(this.champ(ligne, 'min_transfer_time')),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // calendar.txt (sprint soutenance)
  // ---------------------------------------------------------------------------
  /**
   * Les services hebdomadaires réguliers.
   *
   * ⚠️ UNE LIGNE MAL FORMÉE EST ÉCARTÉE, JAMAIS RÉPARÉE. Un `start_date`
   * illisible pourrait « raisonnablement » être remplacé par aujourd'hui —
   * et l'on afficherait alors des horaires pour un service dont on ignore la
   * période de validité. Mieux vaut un service en moins qu'un horaire faux.
   */
  async *readCalendars(
    filePath: string,
    report: GtfsImportReport,
  ): AsyncGenerator<GtfsCalendar, void> {
    const fichier: GtfsFileName = 'calendar';

    for await (const ligne of this.readCsv(filePath)) {
      report.countRow(fichier);

      const serviceId = this.champ(ligne, 'service_id');
      const debut = parseGtfsDate(this.champ(ligne, 'start_date'));
      const fin = parseGtfsDate(this.champ(ligne, 'end_date'));

      if (!serviceId || debut === null || fin === null) {
        report.countIgnored(fichier, 'missingRequiredField');
        continue;
      }

      // ⚠️ UNE BORNE INVERSÉE N'EST PAS CORRIGÉE PAR PERMUTATION. Un flux qui
      // annonce une fin avant son début décrit un service dont on ne sait
      // rien ; échanger les deux inventerait une période de validité.
      if (fin.getTime() < debut.getTime()) {
        report.countIgnored(fichier, 'invalidValue');
        continue;
      }

      // `'1'` et rien d'autre : la spécification n'admet que 0 ou 1, et une
      // valeur inattendue doit valoir « non desservi » plutôt que « desservi ».
      const jour = (nom: string) => this.champ(ligne, nom) === '1';

      yield {
        serviceId,
        days: [
          jour('monday'),
          jour('tuesday'),
          jour('wednesday'),
          jour('thursday'),
          jour('friday'),
          jour('saturday'),
          jour('sunday'),
        ],
        startDate: debut,
        endDate: fin,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // calendar_dates.txt (sprint soutenance)
  // ---------------------------------------------------------------------------
  /**
   * Les exceptions : jours fériés retirés, dimanches exceptionnels ajoutés.
   *
   * Ce sont précisément les jours où un usager vérifie ses horaires — le
   * 1er mai, le 25 décembre. Les ignorer donnerait un calendrier faux là où
   * il compte le plus.
   */
  async *readCalendarDates(
    filePath: string,
    report: GtfsImportReport,
  ): AsyncGenerator<GtfsCalendarDate, void> {
    const fichier: GtfsFileName = 'calendarDates';

    for await (const ligne of this.readCsv(filePath)) {
      report.countRow(fichier);

      const serviceId = this.champ(ligne, 'service_id');
      const date = parseGtfsDate(this.champ(ligne, 'date'));
      const type = this.champ(ligne, 'exception_type');

      if (!serviceId || date === null) {
        report.countIgnored(fichier, 'missingRequiredField');
        continue;
      }

      // ⚠️ AUCUNE TROISIÈME VALEUR N'EST DEVINÉE. La spécification définit 1
      // et 2 ; tout le reste est une ligne qu'on ne sait pas interpréter.
      if (type !== '1' && type !== '2') {
        report.countIgnored(fichier, 'invalidValue');
        continue;
      }

      yield { serviceId, date, added: type === '1' };
    }
  }
}
