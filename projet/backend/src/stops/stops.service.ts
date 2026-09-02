import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Stop } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStopDto } from './dto/create-stop.dto';
import { FindStopsQueryDto } from './dto/find-stops-query.dto';
import { haversineDistanceM } from '../common/geo/distance.util';

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
  constructor(private readonly prisma: PrismaService) {}

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

  async findOne(id: string) {
    const stop = await this.prisma.stop.findUnique({ where: { id } });

    if (!stop) {
      throw new NotFoundException(`Arrêt ${id} introuvable`);
    }

    return stop;
  }
}
