import { Injectable, NotFoundException } from '@nestjs/common';
import { ModeTransport, Prisma, Stop } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStopDto } from './dto/create-stop.dto';
import { FindStopsQueryDto } from './dto/find-stops-query.dto';
import { NetworkModesResponseDto } from './dto/network-modes.dto';
import { haversineDistanceM } from '../common/geo/distance.util';
import { minutesDeMarche } from '../common/geo/marche.util';
import { territoryConfig } from '../config/territory.config';
import {
  ArretProcheDto,
  LigneDesservieDto,
  NearbyQueryDto,
  NearbyResponseDto,
  ProchainPassageDto,
} from './dto/nearby-query.dto';
import { ScheduleService } from '../schedule/schedule.service';
import type { Passage } from '../schedule/schedule.service';

/**
 * Un arrêt rendu par `GET /api/stops`.
 *
 * `distanceM` n'est renseigné que si la requête portait un point : c'est
 * alors la distance à vol d'oiseau depuis ce point. `null` sinon — et non
 * zéro, qui signifierait « vous y êtes ».
 */
export type StopAvecDistance = Stop & { distanceM: number | null };

export interface PageDArrets {
  items: StopAvecDistance[];
  page: number;
  limit: number;
  total: number;
}

/**
 * Degrés de latitude correspondant à un mètre.
 *
 * Un degré de latitude vaut ~111 320 m partout sur le globe : contrairement à
 * la longitude, il ne dépend pas de l'endroit où l'on se trouve.
 */
const DEGRES_LAT_PAR_METRE = 1 / 111_320;

@Injectable()
export class StopsService {
  constructor(
    private readonly prisma: PrismaService,
    // ⚠️ INJECTÉ POUR « AUTOUR DE MOI » UNIQUEMENT. Le reste de ce service ne
    // connaît pas les horaires : `findAll` rend des arrêts nus, et c'est ce
    // qui lui permet de rester rapide sur des milliers d'éléments.
    private readonly schedule: ScheduleService,
  ) {}

  // Un Stop n'appartient à personne : c'est une donnée de référence du
  // réseau de transport, partagée par tous les usagers. Il n'y a donc pas
  // de vérification de propriété ici, contrairement aux Routes.
  create(dto: CreateStopDto) {
    return this.prisma.stop.create({ data: dto });
  }

  /**
   * Arrêts du réseau, TOUJOURS bornés (Phase 4).
   *
   * ⚠️ IL N'EXISTE PLUS AUCUN CHEMIN RENVOYANT TOUS LES ARRÊTS. C'est le
   * point de toute la méthode : `findMany()` sans borne renvoyait 1 934
   * arrêts aujourd'hui, et en renverrait plus de 35 000 une fois le bus
   * importé — plusieurs mégaoctets de JSON à chaque chargement de page.
   *
   * Deux chemins, selon qu'un point est donné ou non. Ils sont écrits
   * séparément parce qu'ils n'ont pas la même vérité à établir.
   */
  async findAll(query: FindStopsQueryDto): Promise<PageDArrets> {
    if (query.lat !== undefined && query.lon !== undefined) {
      return this.autourDe(query, query.lat, query.lon);
    }

    return this.parPage(query);
  }

  /**
   * Parcours paginé, éventuellement filtré par nom.
   *
   * La pagination est faite PAR POSTGRESQL (`skip`/`take`) : c'est le cas où
   * le nombre total d'arrêts concernés n'est pas borné à l'avance, et où il
   * serait donc faux de tout charger pour découper ensuite.
   *
   * DEUX CLÉS DE TRI, et pas seulement le nom. Sans ORDRE TOTAL, PostgreSQL
   * ne garantit rien pour deux arrêts homonymes — et le réseau réel en est
   * plein, un même nom désignant un quai par ligne. Combiné à skip/take,
   * cela ne rend pas seulement l'ordre instable : la page 2 peut réafficher
   * une ligne de la page 1, ou en sauter une. C'est la leçon de l'étape
   * 4E-4A, appliquée ici.
   */
  private async parPage(query: FindStopsQueryDto): Promise<PageDArrets> {
    const { page, limit } = query;
    const where = this.filtreDeNom(query.query);

    const [total, items] = await Promise.all([
      this.prisma.stop.count({ where }),
      this.prisma.stop.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      // `null` et non 0 : aucun point n'a été donné, il n'y a pas de
      // distance à annoncer.
      items: items.map((stop) => ({ ...stop, distanceM: null })),
      page,
      limit,
      total,
    };
  }

  /**
   * Arrêts autour d'un point, du plus proche au plus éloigné.
   *
   * ═══ POURQUOI LE FILTRAGE FINAL EST EN MÉMOIRE ═══
   *
   * PostgreSQL ne sait pas comparer une distance à vol d'oiseau sans PostGIS,
   * et le schéma stocke volontairement latitude et longitude en colonnes
   * `Float` (décision de l'étape 2A). On procède donc en deux temps :
   *
   *   1. un RECTANGLE en SQL — comparaisons de `Float`, que PostgreSQL sait
   *      faire, et qui ramène un ensemble BORNÉ ;
   *   2. le CERCLE exact en mémoire, par la formule de Haversine.
   *
   * Le rectangle circonscrit au cercle contient au plus 4/π ≈ 1,27 fois plus
   * d'arrêts que le cercle : charger le premier pour obtenir le second ne
   * coûte donc jamais qu'un quart de lignes en trop. Et le rayon étant
   * plafonné à 5 km, cet ensemble reste petit même avec le bus importé.
   *
   * C'est ce qui permet de rendre un `total` EXACT — le nombre d'arrêts
   * réellement dans le cercle — plutôt que le nombre d'arrêts dans le
   * rectangle, qui serait un chiffre faux affiché à l'usager.
   */
  private async autourDe(
    query: FindStopsQueryDto,
    latitude: number,
    longitude: number,
  ): Promise<PageDArrets> {
    const { page, limit, radiusM } = query;

    const marges = this.margesDuRectangle(latitude, radiusM);

    const candidats = await this.prisma.stop.findMany({
      where: {
        ...this.filtreDeNom(query.query),
        latitude: {
          gte: latitude - marges.latitude,
          lte: latitude + marges.latitude,
        },
        longitude: {
          gte: longitude - marges.longitude,
          lte: longitude + marges.longitude,
        },
      },
      // Ordre stable en entrée : il départage les distances rigoureusement
      // égales et rend la pagination reproductible.
      orderBy: { id: 'asc' },
    });

    const dansLeCercle = candidats
      .map((stop) => ({
        ...stop,
        distanceM: Math.round(
          haversineDistanceM(
            latitude,
            longitude,
            stop.latitude,
            stop.longitude,
          ),
        ),
      }))
      .filter((stop) => stop.distanceM <= radiusM)
      // Départage par identifiant à distance égale : deux requêtes identiques
      // doivent rendre le même ordre (règle de déterminisme, étape 4C-2).
      .sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id));

    const debut = (page - 1) * limit;

    return {
      items: dansLeCercle.slice(debut, debut + limit),
      page,
      limit,
      total: dansLeCercle.length,
    };
  }

  /**
   * Demi-largeur et demi-hauteur, en degrés, du rectangle circonscrit au
   * cercle de rayon `radiusM`.
   *
   * ⚠️ LA LONGITUDE SE RESSERRE AVEC LA LATITUDE. Un degré de longitude vaut
   * 111 km à l'équateur mais seulement 73 km à Paris. Utiliser la même marge
   * pour les deux axes produirait, sous nos latitudes, un rectangle bien trop
   * étroit en longitude : des arrêts pourtant dans le cercle seraient
   * absents de la réponse.
   *
   * `Math.max(cos φ, …)` évite la division par zéro aux pôles, où tous les
   * méridiens se rejoignent. Aucun réseau de transport ne s'y trouve, mais un
   * `Infinity` traversant une requête Prisma serait une panne, pas un
   * résultat vide.
   */
  private margesDuRectangle(
    latitude: number,
    radiusM: number,
  ): { latitude: number; longitude: number } {
    const margeLat = radiusM * DEGRES_LAT_PAR_METRE;
    const cosinus = Math.max(Math.cos((latitude * Math.PI) / 180), 1e-6);

    return { latitude: margeLat, longitude: margeLat / cosinus };
  }

  /**
   * Filtre par nom, ou aucun filtre.
   *
   * `mode: 'insensitive'` délègue l'insensibilité à la casse à PostgreSQL.
   * ⚠️ La valeur reste un PARAMÈTRE de la requête préparée : un `%` ou une
   * apostrophe dans la saisie sont traités comme des caractères ordinaires,
   * jamais comme de la syntaxe SQL.
   */
  private filtreDeNom(recherche?: string): Prisma.StopWhereInput {
    if (recherche === undefined) {
      return {};
    }

    return { name: { contains: recherche, mode: 'insensitive' } };
  }

  /**
   * Les modes de transport réellement présents DANS LE TERRITOIRE DESSERVI.
   *
   * ⚠️ COMPTE LES LIGNES, PAS LES ARRÊTS. Un arrêt ne porte aucun mode : c'est
   * la LIGNE qui en a un, depuis l'étape 4C-4-1.
   *
   * ⚠️ UN MODE ABSENT N'APPARAÎT PAS DANS LA RÉPONSE. C'est ce qui permet à
   * l'interface de n'afficher que des filtres qui rendront quelque chose —
   * plutôt que de proposer « Métro » sur un réseau qui n'en a pas.
   *
   * ═══ POURQUOI LE FILTRE TERRITORIAL, ET NON UN SIMPLE `groupBy` ═══
   *
   * La base peut contenir PLUSIEURS réseaux : l'import est additif, et rien
   * n'oblige à purger le précédent. Un `groupBy` nu répondait donc
   * « METRO : 16 lignes » sur une installation strasbourgeoise, parce que le
   * réseau d'Île-de-France y séjournait encore — et l'interface proposait un
   * filtre « Métro » qui n'aurait jamais rien rendu.
   *
   * Une ligne compte donc si elle dessert AU MOINS UN ARRÊT du territoire.
   * La réponse suit alors la configuration, sans dépendre de l'ordre des
   * imports ni d'une purge manuelle.
   */
  async findNetworkModes(): Promise<NetworkModesResponseDto> {
    const territoire = territoryConfig();
    const marges = this.margesDuRectangle(
      territoire.centerLat,
      territoire.radiusM,
    );

    const cadre = {
      latitude: {
        gte: territoire.centerLat - marges.latitude,
        lte: territoire.centerLat + marges.latitude,
      },
      longitude: {
        gte: territoire.centerLon - marges.longitude,
        lte: territoire.centerLon + marges.longitude,
      },
    };

    const groupes = await this.prisma.transitLine.groupBy({
      by: ['mode'],
      // ⚠️ RECTANGLE, ET NON CERCLE. Le mode d'une ligne ne change pas à
      // quelques centaines de mètres près : la précision d'un cercle exact ne
      // servirait à rien, et coûterait un chargement en mémoire.
      where: { links: { some: { fromStop: cadre } } },
      _count: { _all: true },
      orderBy: { mode: 'asc' },
    });

    return {
      modes: groupes.map((groupe) => ({
        mode: groupe.mode,
        lineCount: groupe._count._all,
      })),
    };
  }

  async findOne(id: string) {
    const stop = await this.prisma.stop.findUnique({ where: { id } });

    if (!stop) {
      throw new NotFoundException(`Arrêt ${id} introuvable`);
    }

    return stop;
  }

  // ---------------------------------------------------------------------------
  // « Autour de moi » (war room)
  // ---------------------------------------------------------------------------
  /**
   * Les arrêts les plus proches d'un point, avec leurs lignes et leur prochain
   * passage.
   *
   * ═══ POURQUOI UN ENDPOINT DÉDIÉ, ET NON `GET /api/stops?lat=…` ═══
   *
   * Celui-là existe déjà et trie par distance. Il rend des ARRÊTS NUS — ni
   * lignes, ni horaires — parce que c'est ce dont la carte a besoin, et qu'il
   * est paginé sur des milliers d'éléments.
   *
   * « Autour de moi » répond à une autre question : « que puis-je prendre, et
   * quand ? ». Elle exige de joindre les lignes et d'interroger le calendrier —
   * un coût qu'on ne veut pas payer sur une liste de 200 arrêts de carte.
   *
   * ⚠️ AUCUNE DONNÉE PERSONNELLE. Comme le reste du référentiel de transport,
   * cet endpoint ne lit ni `Route` ni `Segment`. Le point transmis n'est ni
   * stocké, ni journalisé.
   */
  async findNearby(query: NearbyQueryDto): Promise<NearbyResponseDto> {
    const { lat, lon, radiusM, limit } = query;

    const marges = this.margesDuRectangle(lat, radiusM);

    // ⚠️ RECTANGLE D'ABORD, CERCLE ENSUITE. PostgreSQL sait filtrer un
    // rectangle avec un index ; la distance orthodromique, non. On charge donc
    // le rectangle circonscrit — quelques dizaines d'arrêts sur 800 m — puis on
    // écarte les coins en mémoire.
    const candidats = await this.prisma.stop.findMany({
      where: {
        latitude: { gte: lat - marges.latitude, lte: lat + marges.latitude },
        longitude: { gte: lon - marges.longitude, lte: lon + marges.longitude },
      },
      orderBy: { id: 'asc' },
    });

    const proches = candidats
      .map((stop) => ({
        stop,
        distanceM: Math.round(
          haversineDistanceM(lat, lon, stop.latitude, stop.longitude),
        ),
      }))
      .filter((entree) => entree.distanceM <= radiusM)
      // Départage par identifiant à distance égale : deux requêtes identiques
      // doivent rendre le même ordre (règle de déterminisme, étape 4C-2).
      .sort(
        (a, b) =>
          a.distanceM - b.distanceM || a.stop.id.localeCompare(b.stop.id),
      )
      .slice(0, limit);

    if (proches.length === 0) {
      return { stops: [], departuresFreshness: 'UNKNOWN' };
    }

    const ids = proches.map((entree) => entree.stop.id);
    const lignes = await this.lignesParArret(ids);

    // ⚠️ UNE SEULE INTERROGATION DU CALENDRIER, PAS UNE PAR ARRÊT. Huit appels
    // séquentiels multiplieraient par huit la latence de l'écran le plus
    // utilisé de l'application.
    const passages = await this.schedule.prochainsPassages(
      ids,
      new Date(),
      ids.length * 4,
    );

    const groupes = this.regrouperParLieu(proches, lignes, passages);

    return {
      // ═══ LA FRAÎCHEUR PORTE SUR CES ARRÊTS-CI, PAS SUR LA BASE ENTIÈRE ═══
      //
      // ⚠️ CORRIGÉ APRÈS MESURE. La première version demandait
      // `horairesDisponibles()`, qui répond « oui » dès qu'UN réseau de la base
      // est horodaté. Sur une installation portant deux réseaux — l'un avec
      // horaires, l'autre sans — elle annonçait donc `STATIC` sur des arrêts
      // dont aucun passage n'était connu.
      //
      // Le résultat se lisait « ces lignes ne circulent plus », alors que la
      // phrase exacte était « nous ne connaissons pas leurs horaires ». C'est
      // exactement le mensonge que ce champ existe pour éviter.
      departuresFreshness: passages.length > 0 ? 'STATIC' : 'UNKNOWN',
      stops: groupes,
    };
  }

  /**
   * Regroupe les quais d'un même lieu en une seule entrée.
   *
   * ═══ LE PROBLÈME, MESURÉ SUR LE RÉSEAU RÉEL ═══
   *
   *     Autour de Gare de Lyon, dans un rayon de 600 m :
   *       82 m  Gare de Lyon    bus 63
   *       84 m  Gare de Lyon    bus 72, N32, N35
   *       84 m  Gare de Lyon    métro 14
   *       92 m  Gare de Lyon    métro 14
   *
   * Quatre lignes d'écran pour un seul lieu. Île-de-France Mobilités publie UN
   * ARRÊT PAR QUAI : « Gare de Lyon » existe en vingt et un exemplaires. Une
   * liste « autour de moi » qui les énumère est illisible, et dit quatre fois
   * la même chose à quelqu'un qui veut simplement savoir où aller.
   *
   * ⚠️ REGROUPEMENT D'AFFICHAGE UNIQUEMENT. Le MOTEUR D'ITINÉRAIRES, lui,
   * continue de voir chaque quai séparément — c'est indispensable, et l'avoir
   * oublié avait déjà coûté un bug : rattacher un lieu à un seul quai coupait
   * la moitié des correspondances. Ici, on ne calcule rien : on affiche.
   *
   * ⚠️ L'IDENTIFIANT RENDU EST CELUI DU QUAI LE PLUS PROCHE, et c'est un choix
   * défendable : c'est celui vers lequel on marchera. Les autres restent
   * atteignables par la recherche d'itinéraire, qui les connaît tous.
   */
  private regrouperParLieu(
    proches: readonly { stop: Stop; distanceM: number }[],
    lignes: ReadonlyMap<string, LigneDesservieDto[]>,
    passages: readonly Passage[],
  ): ArretProcheDto[] {
    const parNom = new Map<string, ArretProcheDto>();

    for (const { stop, distanceM } of proches) {
      const lignesDuQuai = lignes.get(stop.id) ?? [];
      const existant = parNom.get(stop.name);

      if (!existant) {
        parNom.set(stop.name, {
          id: stop.id,
          name: stop.name,
          latitude: stop.latitude,
          longitude: stop.longitude,
          distanceM,
          walkMin: this.minutesDeMarche(distanceM),
          pmrAccessible: stop.pmrAccessible,
          lines: lignesDuQuai,
          nextDeparture: this.premierPassage(passages, lignesDuQuai),
        });
        continue;
      }

      // ⚠️ LES LIGNES DES AUTRES QUAIS SONT FUSIONNÉES. Ne garder que celles
      // du quai le plus proche afficherait « Gare de Lyon — bus 63 » et
      // tairait le métro 14, qui part du quai d'à côté.
      const connues = new Set(existant.lines.map((ligne) => ligne.id));

      for (const ligne of lignesDuQuai) {
        if (!connues.has(ligne.id)) {
          existant.lines.push(ligne);
        }
      }

      existant.lines.sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      );

      // ⚠️ UN QUAI PLUS PROCHE NE PEUT PAS APPARAÎTRE ENSUITE : la liste est
      // déjà triée par distance croissante. `pmrAccessible` suit en revanche
      // le OU logique — le lieu est accessible dès qu'UN de ses quais l'est.
      existant.pmrAccessible = existant.pmrAccessible || stop.pmrAccessible;
      existant.nextDeparture ??= this.premierPassage(passages, lignesDuQuai);
    }

    return [...parNom.values()];
  }

  /**
   * Temps de marche estimé pour une distance À VOL D'OISEAU.
   *
   * ⚠️ C'EST UNE ESTIMATION, ET L'INTERFACE DOIT L'ANNONCER COMME TELLE. Aucun
   * routeur piéton n'est configuré : on ne connaît ni les rues, ni les
   * traversées, ni les dénivelés. Une voie ferrée entre deux points peut
   * doubler le trajet réel.
   *
   * 4,5 km/h : la vitesse de marche retenue par la plupart des calculateurs
   * d'itinéraires pour un adulte en milieu urbain. Elle n'est pas inventée ici
   * — elle est SEULEMENT appliquée à une distance qui, elle, est incomplète.
   *
   * ⚠️ MINIMUM UNE MINUTE. « 0 min de marche » se lit comme « vous y êtes »,
   * ce qui est faux à cinquante mètres d'un quai.
   */
  private minutesDeMarche(distanceM: number): number {
    // ⚠️ LA RÈGLE VIT DANS `common/geo/marche.util.ts`, et pas ici. Le moteur
    // d'itinéraires en a besoin lui aussi pour chiffrer la marche d'approche :
    // deux copies auraient fini par annoncer deux durées différentes pour la
    // même distance, sur deux écrans du même produit.
    return minutesDeMarche(distanceM);
  }

  /**
   * Les lignes desservant chacun des arrêts donnés.
   *
   * ⚠️ ON REGARDE `linksFrom`, pas les deux extrémités. Un arrêt terminus n'a
   * pas de liaison sortante sur sa ligne — mais il en a une entrante, et il
   * apparaîtrait sans ligne. Les deux sens sont donc pris.
   */
  private async lignesParArret(
    ids: readonly string[],
  ): Promise<Map<string, LigneDesservieDto[]>> {
    const liaisons = await this.prisma.networkLink.findMany({
      where: {
        OR: [{ fromStopId: { in: [...ids] } }, { toStopId: { in: [...ids] } }],
        // ⚠️ LA MARCHE N'EST PAS UNE LIGNE, et l'afficher comme telle était un
        // défaut visible : « Gare de Lyon — Correspondance » apparaissait à
        // côté du métro 14, comme si l'on pouvait prendre la correspondance.
        //
        // Cette « ligne » est un ARTEFACT INTERNE : l'import fabrique une
        // ligne WALK pour porter les liaisons piétonnes entre quais. Elle a
        // sa place dans le graphe, aucune sur un panneau.
        line: { mode: { not: ModeTransport.WALK } },
      },
      select: {
        fromStopId: true,
        toStopId: true,
        line: { select: { id: true, name: true, mode: true } },
      },
    });

    const parArret = new Map<string, Map<string, LigneDesservieDto>>();

    for (const liaison of liaisons) {
      for (const arretId of [liaison.fromStopId, liaison.toStopId]) {
        if (!ids.includes(arretId)) {
          continue;
        }

        // Une `Map` par arrêt : une ligne dessert un arrêt une seule fois,
        // quel que soit le nombre de liaisons qui l'y relient.
        const deja =
          parArret.get(arretId) ?? new Map<string, LigneDesservieDto>();
        deja.set(liaison.line.id, {
          id: liaison.line.id,
          name: liaison.line.name,
          mode: liaison.line.mode,
        });
        parArret.set(arretId, deja);
      }
    }

    return new Map(
      [...parArret].map(([arretId, lignes]) => [
        arretId,
        // Ordre stable : `name` d'abord, `id` pour départager deux lignes
        // homonymes (un « 4 » de métro et un « 4 » de bus).
        [...lignes.values()].sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        ),
      ]),
    );
  }

  /**
   * Le premier passage concernant l'une des lignes de cet arrêt.
   *
   * ⚠️ `prochainsPassages` A ÉTÉ APPELÉ POUR TOUS LES ARRÊTS À LA FOIS : on
   * filtre donc ici sur les lignes de CET arrêt. Sans ce filtre, un arrêt
   * afficherait le prochain passage d'un arrêt voisin — plausible, et faux.
   */
  private premierPassage(
    passages: readonly Passage[],
    lignes: readonly LigneDesservieDto[],
  ): ProchainPassageDto | null {
    if (lignes.length === 0) {
      return null;
    }

    const idsLignes = new Set(lignes.map((ligne) => ligne.id));
    const passage = passages.find((candidat) => idsLignes.has(candidat.lineId));

    if (!passage) {
      return null;
    }

    return {
      lineId: passage.lineId,
      lineName: passage.lineName,
      mode: passage.mode,
      headsign: passage.headsign,
      departureAt: passage.departureAt.toISOString(),
      waitMin: passage.waitMin,
    };
  }
}
