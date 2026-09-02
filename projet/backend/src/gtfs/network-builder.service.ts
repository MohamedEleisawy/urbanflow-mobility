import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { haversineDistanceM } from '../common/geo/distance.util';
import { GtfsReaderService } from './gtfs-reader.service';
import { GtfsImportReport } from './gtfs-import-report';
import { GtfsStopTime } from './gtfs-row.types';
import {
  choisirShape,
  decouperTrace,
  versGeoJson,
  type PointTrace,
} from './shape-geometry';
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
  /**
   * Tracés observés sur cette liaison, et leur nombre de passages.
   *
   * Une même paire d'arrêts est desservie par PLUSIEURS `shape_id` dans
   * 87,6 % des cas (mesuré sur le réseau réel) : services partiels,
   * branches, variantes de terminus. `choisirShape` tranche — et la mesure
   * montre que ce choix est sans conséquence, les tracés découpés entre
   * deux arrêts consécutifs coïncidant à moins de 5 m dans 99,2 % des cas.
   */
  shapes: Map<string, number>;
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
    const { ligneParTrajet, shapeParTrajet } = await this.chargerTrajets(
      folder,
      report,
      lignes,
    );

    const candidats = await this.collecterCandidats(
      folder,
      report,
      arrets,
      ligneParTrajet,
      shapeParTrajet,
    );

    // Phase 1B : les tracés ne sont chargés QU'APRÈS les candidats, et
    // uniquement ceux réellement retenus — sur le flux réel, 280 tracés sur
    // les 2 026 lignes du fichier de 129 Mo.
    const traces = await this.chargerTraces(folder, report, candidats);

    await this.ecrireLiaisons(candidats, arrets, traces, report);
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
  ): Promise<{
    ligneParTrajet: Map<string, string>;
    shapeParTrajet: Map<string, string>;
  }> {
    const ligneParTrajet = new Map<string, string>();
    const shapeParTrajet = new Map<string, string>();
    const chemin = join(folder, 'trips.txt');

    for await (const trajet of this.reader.readTrips(
      chemin,
      report,
      new Set(lignes.keys()),
    )) {
      const lineId = lignes.get(trajet.routeId);
      if (lineId) {
        ligneParTrajet.set(trajet.tripId, lineId);
        // `shapeId` est facultatif : un flux sans `shapes.txt` laisse
        // simplement cette table vide, et l'import se poursuit sans
        // géométrie.
        if (trajet.shapeId) {
          shapeParTrajet.set(trajet.tripId, trajet.shapeId);
        }
      }
    }

    return { ligneParTrajet, shapeParTrajet };
  }

  /**
   * Charge les tracés réellement nécessaires (Phase 1B).
   *
   * ⚠️ FILTRÉ AVANT LECTURE. `shapes.txt` pèse 129 Mo sur le flux réel
   * d'Île-de-France Mobilités, tous modes confondus. Seuls les tracés
   * retenus par `choisirShape` sont conservés en mémoire — les autres sont
   * écartés au fil de la lecture, sans jamais être accumulés.
   *
   * Le fichier étant FACULTATIF dans la spécification GTFS, son absence
   * n'est pas une erreur : la méthode rend une table vide, et les liaisons
   * seront écrites sans géométrie.
   */
  private async chargerTraces(
    folder: string,
    report: GtfsImportReport,
    candidats: Map<string, Candidat>,
  ): Promise<Map<string, PointTrace[]>> {
    const traces = new Map<string, PointTrace[]>();

    const retenus = new Set<string>();
    for (const candidat of candidats.values()) {
      const choix = choisirShape(candidat.shapes);
      if (choix) {
        retenus.add(choix);
      }
    }

    const chemin = join(folder, 'shapes.txt');

    if (retenus.size === 0 || !existsSync(chemin)) {
      this.logger.log(
        'Aucun tracé à charger : le flux ne fournit pas shapes.txt, ' +
          'ou aucune liaison ne s’y rattache. Les liaisons seront écrites ' +
          'sans géométrie.',
      );
      return traces;
    }

    // Les points arrivent dans l'ordre du fichier ; on les ordonne ensuite
    // par `shape_pt_sequence`, seul ordre que la spécification garantisse.
    const brut = new Map<string, { sequence: number; point: PointTrace }[]>();

    for await (const point of this.reader.readShapes(chemin, report, retenus)) {
      const liste = brut.get(point.shapeId) ?? [];
      liste.push({
        sequence: point.sequence,
        point: { latitude: point.latitude, longitude: point.longitude },
      });
      brut.set(point.shapeId, liste);
    }

    for (const [shapeId, points] of brut) {
      points.sort((a, b) => a.sequence - b.sequence);
      traces.set(
        shapeId,
        points.map((p) => p.point),
      );
    }

    this.logger.log(
      `Tracés chargés : ${traces.size} sur ${retenus.size} retenus.`,
    );

    return traces;
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
    shapeParTrajet: Map<string, string>,
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
          shapeParTrajet,
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
    shapeParTrajet: Map<string, string>,
    report: GtfsImportReport,
  ): void {
    const lineId = ligneParTrajet.get(tripId);
    // Le tracé emprunté par CE trajet. `undefined` quand le flux ne fournit
    // pas `shapes.txt` : la liaison sera alors écrite sans géométrie.
    const shapeId = shapeParTrajet.get(tripId);

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
        if (shapeId) {
          existant.shapes.set(shapeId, (existant.shapes.get(shapeId) ?? 0) + 1);
        }
      } else {
        candidats.set(cle, {
          lineId,
          fromStopId: departInterne.id,
          toStopId: arriveeInterne.id,
          dureesSec: [dureeSec],
          // On COMPTE les passages par tracé : `choisirShape` retiendra le
          // plus fréquent, c'est-à-dire celui réellement le plus emprunté.
          shapes: new Map<string, number>(shapeId ? [[shapeId, 1]] : []),
        });
      }
    }
  }

  /// Calcule la durée représentative de chaque liaison et l'écrit en base.
  private async ecrireLiaisons(
    candidats: Map<string, Candidat>,
    arrets: Map<string, ArretConnu>,
    traces: Map<string, PointTrace[]>,
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
        // Phase 1B. ⚠️ La distance ci-dessus reste celle À VOL D'OISEAU,
        // même lorsqu'une géométrie existe : la recalculer le long du tracé
        // modifierait les durées, l'historique et les calculs carbone déjà
        // validés. La géométrie sert à DESSINER, pas à recalculer.
        geometry: this.geometrieDe(candidat, depart, arrivee, traces, report),
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

  /**
   * Découpe le tracé retenu entre les deux arrêts d'une liaison (Phase 1B).
   *
   * Rend `undefined` — et JAMAIS une ligne droite déguisée — dans trois cas :
   * aucun tracé observé, tracé absent du fichier, ou découpe impossible
   * (l'arrivée se projetant avant le départ). L'interface retombera alors
   * sur un tracé arrêt → arrêt, en l'annonçant explicitement.
   */
  private geometrieDe(
    candidat: Candidat,
    depart: ArretConnu,
    arrivee: ArretConnu,
    traces: Map<string, PointTrace[]>,
    report: GtfsImportReport,
  ): Prisma.InputJsonValue | undefined {
    const shapeId = choisirShape(candidat.shapes);
    const trace = shapeId ? traces.get(shapeId) : undefined;

    if (!trace) {
      return undefined;
    }

    const portion = decouperTrace(
      trace,
      { latitude: depart.latitude, longitude: depart.longitude },
      { latitude: arrivee.latitude, longitude: arrivee.longitude },
    );

    const geoJson = portion ? versGeoJson(portion) : null;

    if (!geoJson) {
      // Incohérence réelle entre l'ordre des arrêts et celui du tracé.
      // Comptée plutôt que tue : le bilan d'import doit la faire apparaître.
      report.countIgnored('shapes', 'outOfScope');
      return undefined;
    }

    report.countImported('geometries');

    // ⚠️ La conversion est nécessaire, et elle est SANS RISQUE. Prisma exige
    // une signature d'index sur les objets JSON (`InputJsonObject`), qu'une
    // interface TypeScript nommée ne porte jamais. `LineStringGeoJson` est
    // pourtant un objet JSON parfaitement valide — c'est une limite du
    // typage de Prisma, pas un doute sur la donnée.
    //
    // Le type NOMMÉ est conservé partout ailleurs : c'est lui qui garantit
    // l'ordre [longitude, latitude], et un `Record<string, unknown>` dès
    // l'origine aurait fait disparaître cette garantie.
    return geoJson as unknown as Prisma.InputJsonValue;
  }
}
