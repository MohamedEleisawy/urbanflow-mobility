import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { haversineDistanceM } from '../common/geo/distance.util';
import { GtfsReaderService } from './gtfs-reader.service';
import { GtfsImportReport } from './gtfs-import-report';
import { GtfsStopTime } from './gtfs-row.types';
import { mediane } from './median.util';

/// Un arrêt du référentiel déjà importé, avec ce qu'il faut pour calculer
/// une distance.
interface ArretConnu {
  id: string;
  latitude: number;
  longitude: number;
}

/// Toutes les durées observées pour une même liaison (ligne + 2 arrêts).
interface Candidat {
  lineId: string;
  fromStopId: string;
  toStopId: string;
  dureesSec: number[];
}

/**
 * Construction du réseau : `stop_times.txt` → `NetworkLink` (étape 4C-4-4).
 *
 * PRINCIPE. Un fichier stop_times décrit des PASSAGES : « le trajet T1
 * dessert l'arrêt A à 8h00, puis B à 8h05, puis C à 8h12 ». Le graphe, lui,
 * a besoin d'ARÊTES : « la ligne 4 relie A à B en 5 minutes ».
 *
 * Le passage de l'un à l'autre se fait en trois temps :
 *
 *   1. pour chaque trajet, former les paires d'arrêts CONSÉCUTIFS
 *      (A→B, B→C — jamais A→C, qui n'est pas un tronçon) ;
 *   2. regrouper toutes les paires par (ligne, arrêt départ, arrêt arrivée) ;
 *   3. pour chaque groupe, retenir la MÉDIANE des durées observées.
 *
 * C'est l'étape 2 qui fait qu'une ligne passant 200 fois par jour sur A→B
 * ne produit qu'UNE liaison, et non 200.
 */
@Injectable()
export class NetworkBuilderService {
  private readonly logger = new Logger(NetworkBuilderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: GtfsReaderService,
  ) {}

  async buildNetwork(folder: string, report: GtfsImportReport): Promise<void> {
    // --- 1. Le référentiel, déjà importé à l'étape 4C-4-3 ------------------
    // On repart de la BASE et non des fichiers : les arrêts et les lignes y
    // sont déjà, avec leurs identifiants internes dont nous avons besoin.
    const arrets = await this.chargerArrets();
    const lignes = await this.chargerLignes();

    if (arrets.size === 0 || lignes.size === 0) {
      this.logger.warn(
        'Aucun arrêt ou aucune ligne issus de GTFS en base : ' +
          'le référentiel doit être importé avant le réseau.',
      );
      return;
    }

    // --- 2. trips.txt : quel trajet appartient à quelle ligne ? ------------
    const ligneParTrajet = await this.chargerTrajets(folder, report, lignes);

    // --- 3. stop_times.txt : former les paires et accumuler les durées ----
    const candidats = await this.collecterCandidats(
      folder,
      report,
      arrets,
      ligneParTrajet,
    );

    // --- 4. Médiane et écriture -------------------------------------------
    await this.ecrireLiaisons(candidats, arrets, report);
  }

  private async chargerArrets(): Promise<Map<string, ArretConnu>> {
    const arrets = await this.prisma.stop.findMany({
      where: { gtfsStopId: { not: null } },
      select: { id: true, gtfsStopId: true, latitude: true, longitude: true },
    });

    return new Map(
      arrets.map((arret) => [
        arret.gtfsStopId as string,
        { id: arret.id, latitude: arret.latitude, longitude: arret.longitude },
      ]),
    );
  }

  private async chargerLignes(): Promise<Map<string, string>> {
    const lignes = await this.prisma.transitLine.findMany({
      where: { gtfsRouteId: { not: null } },
      select: { id: true, gtfsRouteId: true },
    });

    return new Map(
      lignes.map((ligne) => [ligne.gtfsRouteId as string, ligne.id]),
    );
  }

  /// trip_id → identifiant interne de la ligne.
  private async chargerTrajets(
    folder: string,
    report: GtfsImportReport,
    lignes: Map<string, string>,
  ): Promise<Map<string, string>> {
    const ligneParTrajet = new Map<string, string>();
    const chemin = join(folder, 'trips.txt');

    for await (const trajet of this.reader.readTrips(
      chemin,
      report,
      new Set(lignes.keys()),
    )) {
      const lineId = lignes.get(trajet.routeId);
      if (lineId) {
        ligneParTrajet.set(trajet.tripId, lineId);
      }
    }

    return ligneParTrajet;
  }

  /**
   * Parcourt stop_times.txt en flux et accumule les durées par liaison.
   *
   * GESTION DE LA MÉMOIRE. stop_times est de loin le plus gros fichier d'un
   * flux GTFS. On ne le charge donc jamais entièrement : on ne garde en
   * mémoire que les passages du TRAJET EN COURS, et on les traite dès que
   * le trajet change.
   *
   * Cela suppose que le fichier soit groupé par trip_id — ce que la
   * spécification GTFS recommande et que tous les flux respectent en
   * pratique. Plutôt que de le supposer en silence, on DÉTECTE le cas
   * contraire : si un trajet déjà traité réapparaît plus loin, l'anomalie
   * est comptée dans le rapport.
   */
  private async collecterCandidats(
    folder: string,
    report: GtfsImportReport,
    arrets: Map<string, ArretConnu>,
    ligneParTrajet: Map<string, string>,
  ): Promise<Map<string, Candidat>> {
    const candidats = new Map<string, Candidat>();
    const trajetsDejaTraites = new Set<string>();

    let trajetCourant: string | null = null;
    let passages: GtfsStopTime[] = [];

    const traiterTrajetCourant = () => {
      if (trajetCourant !== null) {
        this.ajouterPaires(
          trajetCourant,
          passages,
          candidats,
          arrets,
          ligneParTrajet,
          report,
        );
        trajetsDejaTraites.add(trajetCourant);
      }
    };

    for await (const passage of this.reader.readStopTimes(
      join(folder, 'stop_times.txt'),
      report,
      new Set(arrets.keys()),
      new Set(ligneParTrajet.keys()),
    )) {
      if (passage.tripId !== trajetCourant) {
        traiterTrajetCourant();

        if (trajetsDejaTraites.has(passage.tripId)) {
          report.countUnsortedStopTimes();
        }

        trajetCourant = passage.tripId;
        passages = [];
      }

      passages.push(passage);
    }

    // Le dernier trajet du fichier n'est suivi d'aucun changement.
    traiterTrajetCourant();

    return candidats;
  }

  /// Transforme les passages d'UN trajet en paires d'arrêts consécutifs.
  private ajouterPaires(
    tripId: string,
    passages: GtfsStopTime[],
    candidats: Map<string, Candidat>,
    arrets: Map<string, ArretConnu>,
    ligneParTrajet: Map<string, string>,
    report: GtfsImportReport,
  ): void {
    const lineId = ligneParTrajet.get(tripId);

    if (!lineId || passages.length < 2) {
      // Un trajet à un seul arrêt ne produit aucun tronçon : ce n'est pas
      // une erreur, il n'y a simplement rien à en tirer.
      return;
    }

    // L'ordre du fichier n'est pas garanti : c'est stop_sequence qui fait foi.
    const ordonnes = [...passages].sort(
      (a, b) => a.stopSequence - b.stopSequence,
    );

    for (let i = 0; i < ordonnes.length - 1; i++) {
      const depart = ordonnes[i];
      const arrivee = ordonnes[i + 1];

      // Durée du tronçon : de l'instant où l'on quitte l'arrêt de départ à
      // l'instant où l'on atteint le suivant.
      const dureeSec = arrivee.arrivalTimeSec - depart.departureTimeSec;

      if (dureeSec < 0) {
        // Arriver avant d'être parti est impossible : la paire est écartée
        // et comptée, sans interrompre le reste de l'import.
        report.countInvalidPair();
        continue;
      }

      const departInterne = arrets.get(depart.stopId);
      const arriveeInterne = arrets.get(arrivee.stopId);

      if (!departInterne || !arriveeInterne) {
        report.countInvalidPair();
        continue;
      }

      report.countValidPair();

      // La clé de regroupement. A→B et B→A donnent deux clés différentes :
      // le sens est porté par l'ordre des arrêts, jamais par direction_id.
      const cle = `${lineId}|${departInterne.id}|${arriveeInterne.id}`;
      const existant = candidats.get(cle);

      if (existant) {
        existant.dureesSec.push(dureeSec);
      } else {
        candidats.set(cle, {
          lineId,
          fromStopId: departInterne.id,
          toStopId: arriveeInterne.id,
          dureesSec: [dureeSec],
        });
      }
    }
  }

  /// Calcule la durée représentative de chaque liaison et l'écrit en base.
  private async ecrireLiaisons(
    candidats: Map<string, Candidat>,
    arrets: Map<string, ArretConnu>,
    report: GtfsImportReport,
  ): Promise<void> {
    // Les coordonnées sont indexées par identifiant interne pour retrouver
    // rapidement les deux extrémités d'une liaison.
    const parId = new Map<string, ArretConnu>();
    for (const arret of arrets.values()) {
      parId.set(arret.id, arret);
    }

    for (const candidat of candidats.values()) {
      const medianeSec = mediane(candidat.dureesSec);

      if (medianeSec === null) {
        continue;
      }

      const depart = parId.get(candidat.fromStopId);
      const arrivee = parId.get(candidat.toStopId);

      if (!depart || !arrivee) {
        continue;
      }

      const donnees = {
        // CONVENTION DE CONVERSION (étape 4C-4-4).
        //
        // La médiane est calculée en SECONDES, donc sans perte. Mais
        // NetworkLink.durationMin est un ENTIER de minutes : une médiane de
        // 10,5 min doit être arrondie.
        //
        // On arrondit AU PLUS PROCHE (Math.round), et non au supérieur.
        // Arrondir systématiquement vers le haut introduirait un biais qui
        // s'ACCUMULE : sur un itinéraire de dix tronçons, on ajouterait
        // jusqu'à dix minutes fictives. L'arrondi au plus proche, lui, se
        // compense statistiquement.
        durationMin: Math.round(medianeSec / 60),
        // stop_times ne fournit aucune distance : on la calcule à vol
        // d'oiseau entre les deux arrêts (fonction réutilisée de 4C-1).
        distanceM: Math.round(
          haversineDistanceM(
            depart.latitude,
            depart.longitude,
            arrivee.latitude,
            arrivee.longitude,
          ),
        ),
      };

      await this.prisma.networkLink.upsert({
        // La contrainte unique posée à l'étape 4C-4-1 est ce qui rend
        // l'import réexécutable : réimporter le même flux met à jour la
        // liaison au lieu d'en créer une seconde.
        where: {
          lineId_fromStopId_toStopId: {
            lineId: candidat.lineId,
            fromStopId: candidat.fromStopId,
            toStopId: candidat.toStopId,
          },
        },
        update: donnees,
        create: {
          ...donnees,
          lineId: candidat.lineId,
          fromStopId: candidat.fromStopId,
          toStopId: candidat.toStopId,
        },
      });

      report.countImported('networkLinks');
    }
  }
}
