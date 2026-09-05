import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModeTransport, Prisma, Stop } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CarbonService } from '../carbon/carbon.service';
import { ScheduleService } from '../schedule/schedule.service';
import type { CirculationDuMoment } from '../schedule/schedule.service';
import { CarbonResultDto } from '../carbon/dto/carbon-result.dto';
import { CreateRouteDto, RouteSegmentDto } from './dto/create-route.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { SearchRouteDto } from './dto/search-route.dto';
import {
  ItineraryCarbonDto,
  ItineraryCriterion,
  ItineraryDto,
  ItineraryScheduleDto,
  ItinerarySegmentDto,
  ItineraryWalkLegDto,
} from './dto/itinerary.dto';
import { CarbonFactorsDto } from '../carbon/dto/carbon-factors.dto';
import { cheminOptimal, type AreteGenerique, type Cout } from './dijkstra';
import { haversineDistanceM } from '../common/geo/distance.util';
import { minutesDeMarche } from '../common/geo/marche.util';
import { WalkRoutingService } from '../walk-routing/walk-routing.service';
import type { RouteGeometrieDto } from '../walk-routing/valhalla.client';
import { BikeRoutingService } from '../walk-routing/bike-routing.service';

// Une "arête" du graphe : un déplacement possible d'un arrêt vers un autre.
interface GraphEdge {
  toStopId: string;
  mode: ModeTransport;
  // Nom et exploitant de la ligne, transportés depuis TransitLine (étape
  // 4E-2). Ils ne servent PAS au calcul du chemin — Dijkstra ne pondère que
  // durationMin et distanceM — mais l'arête est le seul endroit où
  // l'information survit entre la requête et la réponse.
  lineName: string;
  operator: string;
  // Identifiant de la ligne (étape 4E-3A). Comme les deux champs
  // ci-dessus, il n'entre PAS dans le calcul : Dijkstra ne pondère que
  // durationMin et distanceM. Il est seulement transporté, pour que le
  // client puisse désigner sans ambiguïté la liaison qu'il a retenue.
  lineId: string;
  /// Identifiant de la ligne dans le flux de l'opérateur ; sert à rattacher
  /// les perturbations GTFS-RT. `null` pour une ligne saisie à la main.
  gtfsLineId: string | null;
  distanceM: number;
  durationMin: number;
  /// Tracé réel du tronçon (GeoJSON LineString), `null` si le flux n'en
  /// publie pas. Transporté, jamais interprété par le calcul de chemin.
  geometry: unknown;
}

// Le graphe : pour chaque arrêt, la liste des déplacements qui en partent.
type Graph = Map<string, GraphEdge[]>;

// Un maillon du chemin reconstruit par Dijkstra.
interface PathStep {
  fromStopId: string;
  edge: GraphEdge;
}

// Distance maximale acceptée entre le point saisi par l'usager et l'arrêt
// le plus proche (étape 4C-2).
//
// Sans cette limite, une recherche depuis Tokyo s'accrocherait à un arrêt
// parisien et proposerait un itinéraire absurde. 2 km correspond à une
// distance de marche raisonnable à l'échelle d'une métropole : au-delà,
// on considère qu'aucun arrêt ne dessert le point demandé.
const RAYON_RECHERCHE_MAX_M = 2000;

/**
 * Marge ajoutée au cadre de recherche, en degrés.
 *
 * 0,07° ≈ 8 km sous nos latitudes — bien au-delà du rayon de rattachement de
 * 2 km, et assez large pour absorber les détours réels d'un itinéraire
 * urbain.
 */
const MARGE_CADRE_DEG = 0.07;

/**
 * Nombre maximal de quais retenus comme point d'entrée ou de sortie.
 *
 * ═══ POURQUOI 6 ÉTAIT TROP PEU — UN BOGUE MESURÉ ═══
 *
 * La valeur d'origine était calibrée sur l'Île-de-France, où « les six plus
 * proches couvrent tous les modes d'un même lieu ». Sur le réseau de la CTS,
 * c'est faux, et le résultat était spectaculaire :
 *
 *     Gare Centrale → Homme de Fer (700 m)
 *     rendait 30 min, 8,5 km et 5 changements — le tram partait vers l'OUEST,
 *     atteignait le terminus de Hautepierre et revenait.
 *
 * Cause : onze quais tombent dans les 300 m de la gare de Strasbourg, et le
 * plafond de six coupait le SECOND QUAI DU TRAM A/D — celui de l'autre
 * direction, à 75 m — ainsi que le tram C, à 125 m. Le moteur n'avait donc
 * accès qu'à un seul sens de circulation et devait faire le tour.
 *
 * ⚠️ LE PLAFOND NE DOIT JAMAIS COUPER À L'INTÉRIEUR D'UNE STATION. Un réseau
 * qui publie un arrêt par ligne ET par sens — ce que font la CTS comme
 * Île-de-France Mobilités — en aligne facilement une dizaine sur un pôle
 * d'échange.
 *
 * ═══ CE QUE CE PLAFOND PROTÈGE ENCORE ═══
 *
 * Il borne l'éventail de départ du Dijkstra. Ce coût est négligeable devant
 * la taille du graphe : chaque quai n'ajoute qu'une arête à coût nul. 20
 * couvre les pôles d'échange réels des deux réseaux mesurés, tout en gardant
 * une soupape contre un flux pathologique qui déclarerait des centaines
 * d'arrêts au même endroit.
 */
const PLAFOND_QUAIS = 20;

/**
 * Rayon dans lequel plusieurs quais forment UN MÊME LIEU.
 *
 * ⚠️ BIEN PLUS PETIT que `RAYON_RECHERCHE_MAX_M`, et c'est essentiel. Le
 * rattachement multi-quai sert à ne pas se tromper de quai DANS une station,
 * pas à autoriser le moteur à démarrer n'importe où dans un rayon de deux
 * kilomètres : il ferait sinon commencer un trajet à 1,5 km de l'usager sans
 * jamais compter cette marche.
 *
 * 300 m est mesuré sur les données réelles : les cinq quais de Gare de Lyon
 * s'étalent de 84 à 183 m du point d'adresse, ceux de Gare du Nord de 183 à
 * 202 m.
 */
const RAYON_QUAIS_M = 300;

/**
 * Nombre maximal de variantes explorées pour trouver l'itinéraire le moins
 * émetteur.
 *
 * ═══ POURQUOI UNE BORNE, ET D'OÙ VIENT CE NOMBRE ═══
 *
 * `moinsEmetteur` construit ses candidats en retirant tour à tour chaque ligne
 * empruntée, puis chaque mode émetteur. Sans borne, le nombre de Dijkstras
 * suit le nombre de lignes du trajet le plus rapide — et avec le bus importé,
 * un trajet peut en enchaîner une dizaine.
 *
 * MESURÉ sur le réseau complet (35 490 arrêts, 269 899 liaisons) :
 * Gare de Lyon → Gare du Nord passait de 0,14 s à 1,1 s, les neuf variantes
 * comptant pour l'essentiel.
 *
 * ⚠️ CE N'EST PAS UNE CONSTANTE PHYSIQUE, c'est un PLAFOND DE CALCUL assumé :
 * au-delà, on cesse de chercher mieux. La conséquence est bornée et honnête —
 * l'alternative écologique reste un vrai trajet, simplement pas
 * nécessairement le meilleur possible.
 *
 * Six couvre les cas réels observés (le trajet le plus rapide dépasse
 * rarement quatre lignes) tout en divisant le pire cas par deux.
 */
const PLAFOND_VARIANTES = 6;

/**
 * Sommet fictif du Dijkstra MULTI-SOURCE. Le préfixe rend toute collision
 * avec un UUID d'arrêt impossible.
 *
 * ⚠️ IL N'Y A PLUS DE SOMMET DE DESTINATION FICTIF. Le multi-cible se traite
 * désormais par un simple test d'appartenance à l'ensemble des quais
 * d'arrivée (`estArrivee`), ce qui évite d'avoir à retirer une arête
 * fantôme en fin de chemin.
 */
const ORIGINE_VIRTUELLE = '__urbanflow_origine__';

/**
 * Sépare l'arrêt de la ligne dans l'identifiant d'état du critère
 * « moins de changements ».
 *
 * Un caractère NUL : il ne peut apparaître ni dans un UUID, ni dans aucun
 * identifiant venu de la base. Un `|` ou un `#` seraient, eux, des
 * caractères que rien n'interdit dans une donnée.
 */
const SEPARATEUR_ETAT = '\u0000';

/// Ligne courante encodée dans un état ; `''` = pas encore embarqué.
const ligneDeLEtat = (etat: string) => etat.split(SEPARATEUR_ETAT)[1] ?? '';

/**
 * Empreinte carbone manquante, avec son motif.
 *
 * ⚠️ TOUS LES CHAMPS CHIFFRÉS SONT À `null`, JAMAIS À ZÉRO. « 0 g » se lirait
 * « ce trajet ne pollue pas », alors que la vérité est « nous ne savons pas ».
 */
const indisponible = (reason: string): ItineraryCarbonDto => ({
  status: 'CARBON_UNAVAILABLE',
  co2Grams: null,
  carCo2Grams: null,
  savedVsCarGrams: null,
  ecoScore: null,
  reason,
});

/**
 * Nombre de changements de ligne d'un itinéraire.
 *
 * ⚠️ LA MARCHE NE COMPTE PAS. Métro 4 → couloir à pied → métro 4 est un
 * trajet SANS changement : on ne change pas de ligne en traversant un
 * couloir. Les segments `WALK` sont donc retirés avant de compter les
 * transitions.
 */
const compterChangements = (segments: ItinerarySegmentDto[]): number => {
  const lignes = segments
    .filter((segment) => segment.mode !== ModeTransport.WALK)
    .map((segment) => segment.lineId);

  let changements = 0;

  for (let i = 1; i < lignes.length; i++) {
    if (lignes[i] !== lignes[i - 1]) {
      changements++;
    }
  }

  return changements;
};

/**
 * Nombre de changements de ligne d'un CHEMIN, avant sa conversion en
 * itinéraire.
 *
 * ⚠️ UNE SECONDE FONCTION, ET NON UNE DUPLICATION DE RÈGLE. Elle applique
 * exactement la même — la marche ne change pas de ligne — mais sur une autre
 * représentation : `PathStep[]` sort de Dijkstra, `ItinerarySegmentDto[]` est
 * ce qu'on renvoie au client. Convertir le chemin juste pour le compter
 * coûterait la construction complète d'un itinéraire à chaque candidat
 * évalué, et il y en a jusqu'à quatorze.
 */
const compterChangementsDuChemin = (chemin: PathStep[]): number => {
  const lignes = chemin
    .filter((etape) => etape.edge.mode !== ModeTransport.WALK)
    .map((etape) => etape.edge.lineId);

  let changements = 0;

  for (let i = 1; i < lignes.length; i++) {
    if (lignes[i] !== lignes[i - 1]) {
      changements++;
    }
  }

  return changements;
};

// Le réseau exprime des durées en minutes, JavaScript des instants en
// millisecondes : la conversion est isolée pour qu'elle soit visible.
const MILLISECONDES_PAR_MINUTE = 60_000;

/**
 * Mètres parcourus par minute à vélo urbain — ~15 km/h.
 *
 * ⚠️ MÊME VALEUR QUE `itineraireAVelo` (le `/ 250` de la recherche). Un
 * trajet vélo estimé à l'enregistrement doit annoncer la même durée que celui
 * qu'on vient de voir à l'écran.
 */
const METRES_PAR_MINUTE_VELO = 250;

/// Deux décimales, comme partout ailleurs pour les grammes de CO2
/// (convention posée à l'étape 4D-1).
const arrondir = (grammes: number) => Math.round(grammes * 100) / 100;

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Injecté à l'étape 4E-3B, rendu possible par le câblage de 4E-3A.
    //
    // ⚠️ Cette dépendance ne concerne QUE create(). searchRoutes() ne doit
    // JAMAIS appeler le microservice : une panne du calcul carbone rendrait
    // sinon la recherche d'itinéraire indisponible, ce que toute l'étape
    // 4D-2 s'est employée à éviter. Un test verrouille cette propriété.
    private readonly carbonService: CarbonService,
    // ⚠️ AJOUTÉ AU SPRINT SOUTENANCE, et contrairement à `carbonService`,
    // celui-ci EST appelé par `searchRoutes()`. La règle « la recherche
    // n'appelle rien » visait un MICROSERVICE EXTERNE, dont la panne
    // rendrait la recherche indisponible. `ScheduleService` lit notre propre
    // base : il ne peut pas tomber sans que tout tombe.
    //
    // Et il est indispensable là : sans lui, le moteur propose des lignes qui
    // ne circulent pas, et annonce des durées qui excluent l'attente.
    private readonly schedule: ScheduleService,
    // ⚠️ ROUTEUR PIÉTON RÉEL. Comme `ScheduleService`, il EST appelé par
    // `searchRoutes()` — mais contrairement à lui, il interroge un service
    // EXTERNE. C'est pourquoi il ne lève jamais : il rend `null`, et la
    // marche retombe sur l'estimation à vol d'oiseau, annoncée comme telle.
    // Une panne du routeur dégrade la précision, jamais la disponibilité.
    private readonly walkRouting: WalkRoutingService,
    // Routage VÉLO — même moteur que la marche, capacité déclarée à part.
    // Comme `walkRouting`, il ne lève jamais : `null` = repli sur l'estimation.
    private readonly bikeRouting: BikeRoutingService,
  ) {}

  /**
   * Enregistre un itinéraire choisi par l'usager (étape 4E-3B).
   *
   * PRINCIPE : le client DÉSIGNE des liaisons, il ne les DÉCRIT pas.
   *
   * Jusqu'à cette étape, il fournissait lui-même `ecoScore` et
   * `carbonEstimate`. Le serveur reconstruit désormais TOUTES les valeurs
   * significatives à partir du réseau public, puis fait calculer le carbone
   * par le microservice. Le client ne décide plus que de deux choses : d'où
   * il part et quelles liaisons il a empruntées.
   *
   * CE N'EST PAS UN SECOND MOTEUR D'ITINÉRAIRE. Aucun Dijkstra, aucun plus
   * court chemin : on vérifie seulement que chaque tronçon revendiqué est une
   * arête réelle du réseau, et que ces arêtes s'enchaînent.
   *
   * userId vient TOUJOURS du JWT, jamais du corps de la requête.
   */
  async create(userId: string, dto: CreateRouteDto) {
    // ═══ TRAJET DIRECT : À PIED OU À VÉLO, D'UN BOUT À L'AUTRE ═══
    //
    // ⚠️ IL N'EMPRUNTE AUCUNE LIAISON DU RÉSEAU. Pas de `resoudreLiaisons`,
    // pas de `verifierChainage`, pas de `Segment` écrit : le client a demandé
    // « à pied » ou « à vélo », le serveur recalcule lui-même la distance et
    // la durée depuis les coordonnées. Le contrat « le client désigne, il ne
    // décrit pas » tient toujours — il n'y a simplement rien à désigner.
    if (dto.mode) {
      return this.creerTrajetDirect(userId, dto);
    }

    // UN SEUL instant pour toute l'opération : il horodate la route ET
    // chacun de ses enregistrements carbone. Laisser les @default(now())
    // de Prisma s'en charger produirait des instants distincts de quelques
    // millisecondes — de quoi ranger un trajet et son carbone dans deux
    // journées différentes à minuit, dans un futur tableau de bord.
    const requestedAt = new Date();

    // ⚠️ Un trajet MULTIMODAL sans segment n'est pas un itinéraire. (Un
    // trajet direct, lui, EXIGE la liste vide — traité juste au-dessus.)
    if (dto.segments.length === 0) {
      throw new BadRequestException(
        'Un itinéraire multimodal doit comporter au moins un segment.',
      );
    }

    const liaisons = await this.resoudreLiaisons(dto.segments);
    this.verifierChainage(liaisons);

    const totalDistanceM = liaisons.reduce(
      (somme, l) => somme + l.distanceM,
      0,
    );
    const totalDurationMin = liaisons.reduce(
      (somme, l) => somme + l.durationMin,
      0,
    );

    // APPEL RÉSEAU AVANT LA TRANSACTION, et c'est délibéré : une requête HTTP
    // à l'intérieur d'une transaction PostgreSQL tiendrait des verrous
    // ouverts pendant tout son délai (5 s au maximum ici), et entrerait en
    // concurrence avec le délai propre à la transaction Prisma.
    //
    // Le mode et la distance envoyés sont ceux du RÉSEAU, jamais ceux du
    // client : c'est ce qui rend le résultat infalsifiable.
    const carbone = await this.carbonService.calculate({
      segments: liaisons.map((l) => ({
        mode: l.line.mode,
        distanceM: l.distanceM,
      })),
    });

    // Le breakdown est apparié POSITIONNELLEMENT aux segments envoyés. Cette
    // propriété appartient au microservice ; on refuse de deviner si elle
    // n'est pas tenue, plutôt que d'associer un CO2 au mauvais segment.
    if (carbone.breakdown.length !== liaisons.length) {
      this.logger.error(
        `Breakdown carbone incohérent : ${carbone.breakdown.length} entrées ` +
          `pour ${liaisons.length} segments`,
      );
      throw new ServiceUnavailableException(
        'Service de calcul carbone indisponible',
      );
    }

    const segments = this.estimerHoraires(liaisons, requestedAt);

    let routeId: string;
    try {
      routeId = await this.prisma.$transaction(async (tx) => {
        const route = await tx.route.create({
          data: {
            originLat: dto.originLat,
            originLng: dto.originLng,
            destinationLat: dto.destinationLat,
            destinationLng: dto.destinationLng,
            requestedAt,
            totalDistanceM,
            totalDurationMin,
            // Les deux valeurs autrefois déclarées par le client.
            carbonEstimate: carbone.totalCo2Grams,
            ecoScore: carbone.ecoScore,
            userId,
          },
        });

        await tx.segment.createMany({
          data: segments.map((segment) => ({ ...segment, routeId: route.id })),
        });

        // Un CarbonRecord par SEGMENT (décision 4E) : c'est la seule
        // granularité où `mode` et `distanceM` ont un sens exact.
        await tx.carbonRecord.createMany({
          data: liaisons.map((liaison, index) => ({
            date: requestedAt,
            mode: liaison.line.mode,
            distanceM: liaison.distanceM,
            co2Grams: carbone.breakdown[index].co2Grams,
            savedVsCarGrams: this.economieDuSegment(
              liaison.distanceM,
              totalDistanceM,
              carbone,
              index,
            ),
            userId,
            routeId: route.id,
          })),
        });

        return route.id;
      });
    } catch (erreur) {
      throw this.echecEnregistrement(erreur, 'multimodal', userId);
    }

    // Relecture APRÈS commit : la transaction n'a plus rien à garantir ici.
    // orderBy explicite (leçon 4C-2) : sans lui, PostgreSQL ne promet aucun
    // ordre de lignes, et les segments pourraient revenir mélangés.
    return this.prisma.route.findUniqueOrThrow({
      where: { id: routeId },
      include: { segments: { orderBy: { departureTime: 'asc' } } },
    });
  }

  /**
   * Journalise en clair un échec d'écriture d'un trajet, puis rend
   * l'exception à relever.
   *
   * ═══ POURQUOI CE PASSAGE OBLIGÉ ═══
   *
   * Une erreur Prisma non interceptée (colonne manquante après une migration
   * oubliée, violation de clé étrangère, type enum inconnu) remonte jusqu'à
   * NestJS, qui répond « Internal server error » SANS RIEN dans les journaux
   * du serveur. L'exploitant voit un 500 opaque et ne peut rien diagnostiquer.
   *
   * Ici, le motif EXACT est écrit (`code` Prisma, `meta`, message) — jamais
   * renvoyé au client, toujours visible dans `docker logs backend`. Le client,
   * lui, reçoit un 500 générique : le détail d'une panne interne ne le regarde
   * pas.
   *
   * ⚠️ UNE `HttpException` DÉJÀ FORMÉE TRAVERSE INTACTE : un 400 (segments
   * incohérents), un 422 (mode incalculable), un 503 (microservice carbone)
   * décrivent une cause que le client PEUT comprendre. Les réécrire en 500
   * masquerait l'information utile.
   */
  private echecEnregistrement(
    erreur: unknown,
    contexte: 'multimodal' | 'direct',
    userId: string,
  ): Error {
    if (erreur instanceof HttpException) {
      return erreur;
    }

    if (erreur instanceof Prisma.PrismaClientKnownRequestError) {
      this.logger.error(
        `Échec d'enregistrement d'un trajet ${contexte} (usager ${userId}) — ` +
          `Prisma ${erreur.code} : ${erreur.message} ` +
          `${erreur.meta ? JSON.stringify(erreur.meta) : ''}`.trim(),
      );
    } else {
      this.logger.error(
        `Échec d'enregistrement d'un trajet ${contexte} (usager ${userId})`,
        erreur instanceof Error ? erreur.stack : String(erreur),
      );
    }

    return new InternalServerErrorException(
      "Le trajet n'a pas pu être enregistré.",
    );
  }

  /**
   * Enregistre un trajet DIRECT — le résultat des boutons « À pied » / « À
   * vélo » de la recherche.
   *
   * ═══ CE QUI LE DISTINGUE D'UN TRAJET MULTIMODAL ═══
   *
   *   - AUCUNE liaison réseau, donc AUCUN `Segment` écrit : `Route.mode` porte
   *     à lui seul l'information « ce trajet s'est fait à pied / à vélo » ;
   *   - la distance et la durée sont RECALCULÉES ICI, jamais reprises du
   *     client — routeur rue par rue s'il est configuré, sinon estimation à
   *     vol d'oiseau (exactement `itineraireAPied` / `itineraireAVelo`) ;
   *   - UN SEUL `CarbonRecord`, pour le trajet entier : la marche et le vélo
   *     n'émettent rien (0 g), mais l'économie face à la voiture, elle, compte
   *     — c'est le chiffre qui motive l'usager.
   *
   * ⚠️ MÊME CONTRAT D'ERREUR QUE `create()` : 422 si un mode est incalculable
   * (impossible ici, WALK/BIKE ont un facteur), 503 si le microservice
   * carbone est injoignable — et alors RIEN n'est écrit.
   */
  private async creerTrajetDirect(userId: string, dto: CreateRouteDto) {
    if (dto.segments.length > 0) {
      throw new BadRequestException(
        'Un trajet direct (à pied ou à vélo) ne comporte aucun segment.',
      );
    }

    const requestedAt = new Date();
    const mode: ModeTransport = dto.mode === 'BIKE' ? 'BIKE' : 'WALK';

    const { distanceM, durationMin } = await this.mesurerTrajetDirect(
      mode,
      dto,
    );

    // APPEL RÉSEAU AVANT LA TRANSACTION (même raison que `create()` : ne pas
    // tenir des verrous PostgreSQL pendant un aller-retour HTTP).
    const carbone = await this.carbonService.calculate({
      segments: [{ mode, distanceM }],
    });

    let routeId: string;
    try {
      routeId = await this.prisma.$transaction(async (tx) => {
        const route = await tx.route.create({
          data: {
            originLat: dto.originLat,
            originLng: dto.originLng,
            destinationLat: dto.destinationLat,
            destinationLng: dto.destinationLng,
            requestedAt,
            totalDistanceM: distanceM,
            totalDurationMin: durationMin,
            carbonEstimate: carbone.totalCo2Grams,
            ecoScore: carbone.ecoScore,
            mode,
            userId,
          },
        });

        // AUCUN `segment.createMany` : un trajet direct n'a pas de segment.

        // UN enregistrement carbone pour le trajet entier. `savedVsCarGrams`
        // vient du microservice, jamais d'un calcul local (même refus qu'en
        // 4D-1 pour le facteur d'ESCOOTER).
        await tx.carbonRecord.create({
          data: {
            date: requestedAt,
            mode,
            distanceM,
            co2Grams: carbone.totalCo2Grams,
            savedVsCarGrams: carbone.savedVsCarGrams,
            userId,
            routeId: route.id,
          },
        });

        return route.id;
      });
    } catch (erreur) {
      // ⚠️ LA CAUSE LA PLUS FRÉQUENTE ICI : la migration `route_direct_mode`
      // n'a pas été appliquée en production (`prisma migrate deploy`), donc
      // la colonne `routes.mode` n'existe pas et l'INSERT échoue. Le motif
      // exact est journalisé par `echecEnregistrement`.
      throw this.echecEnregistrement(erreur, 'direct', userId);
    }

    // Même forme de réponse que `create()` : la route relue, `segments: []`.
    return this.prisma.route.findUniqueOrThrow({
      where: { id: routeId },
      include: { segments: { orderBy: { departureTime: 'asc' } } },
    });
  }

  /**
   * Distance et durée d'un trajet direct : le routeur rue par rue s'il est
   * configuré, sinon l'estimation à vol d'oiseau.
   *
   * ⚠️ NE LÈVE JAMAIS pour une panne de routeur — même contrat que
   * `enrichirMarche` / `enrichirVelo`. Un routeur absent ou en erreur fait
   * retomber sur l'estimation, il n'empêche pas d'enregistrer.
   */
  private async mesurerTrajetDirect(
    mode: ModeTransport,
    dto: CreateRouteDto,
  ): Promise<{ distanceM: number; durationMin: number }> {
    const volDoiseauM = Math.round(
      haversineDistanceM(
        dto.originLat,
        dto.originLng,
        dto.destinationLat,
        dto.destinationLng,
      ),
    );

    const estimation =
      mode === 'BIKE'
        ? {
            distanceM: volDoiseauM,
            durationMin: Math.max(
              1,
              Math.round(volDoiseauM / METRES_PAR_MINUTE_VELO),
            ),
          }
        : {
            distanceM: volDoiseauM,
            durationMin: minutesDeMarche(volDoiseauM),
          };

    const routeur = mode === 'BIKE' ? this.bikeRouting : this.walkRouting;

    if (!routeur.estConfigure()) {
      return estimation;
    }

    const trace = await routeur.itineraire(
      { latitude: dto.originLat, longitude: dto.originLng },
      { latitude: dto.destinationLat, longitude: dto.destinationLng },
    );

    // `null` = routeur non configuré, en panne, ou sans chemin : l'estimation
    // reste une réponse honnête.
    return trace
      ? { distanceM: trace.distanceM, durationMin: trace.durationMin }
      : estimation;
  }

  /**
   * Retrouve, pour chaque segment demandé, la liaison réelle du réseau.
   *
   * UNE seule requête, quel que soit le nombre de segments : charger les
   * liaisons une par une serait le N+1 classique. Les résultats sont ensuite
   * indexés en mémoire par leur clé métier `(lineId, fromStopId, toStopId)`,
   * celle-là même que Prisma déclare unique.
   *
   * L'indexation traite naturellement le cas d'un même triplet répété par le
   * client : chaque occurrence retrouve la même liaison, et l'ordre demandé
   * est conservé.
   */
  private async resoudreLiaisons(demandes: RouteSegmentDto[]) {
    const liaisons = await this.prisma.networkLink.findMany({
      where: {
        OR: demandes.map(({ lineId, fromStopId, toStopId }) => ({
          lineId,
          fromStopId,
          toStopId,
        })),
      },
      include: { line: true },
    });

    const parCle = new Map(
      liaisons.map((liaison) => [
        this.cleLiaison(liaison.lineId, liaison.fromStopId, liaison.toStopId),
        liaison,
      ]),
    );

    return demandes.map((demande, index) => {
      const liaison = parCle.get(
        this.cleLiaison(demande.lineId, demande.fromStopId, demande.toStopId),
      );

      if (!liaison) {
        // 400 et non 404 : c'est le corps de la requête qui est invalide,
        // pas une ressource identifiée par l'URL qui manquerait.
        throw new BadRequestException(
          `Segment ${index + 1} : aucune liaison du réseau ne relie ces deux ` +
            'arrêts sur cette ligne',
        );
      }

      return liaison;
    });
  }

  private cleLiaison(lineId: string, fromStopId: string, toStopId: string) {
    return `${lineId}|${fromStopId}|${toStopId}`;
  }

  /**
   * Un itinéraire doit être CONTINU : on ne se téléporte pas entre deux
   * segments. Vérifié avant toute écriture, pour ne jamais laisser en base
   * un historique manifestement incohérent.
   */
  private verifierChainage(
    liaisons: { fromStopId: string; toStopId: string }[],
  ) {
    for (let i = 0; i < liaisons.length - 1; i++) {
      if (liaisons[i].toStopId !== liaisons[i + 1].fromStopId) {
        throw new BadRequestException(
          `Segments ${i + 1} et ${i + 2} : le trajet est interrompu, ` +
            "l'arrivée de l'un doit être le départ du suivant",
        );
      }
    }
  }

  /**
   * Fabrique les horaires de chaque segment par cumul des durées du réseau.
   *
   * ⚠️ CE SONT DES HORAIRES ESTIMÉS, ET NON DES HORAIRES GTFS RÉELS.
   *
   * `Segment` exige un départ et une arrivée (sa durée est leur différence,
   * il n'a pas de champ `durationMin`), alors que le réseau ne connaît que
   * des durées de parcours MÉDIANES (étape 4C-4-4). On les reconstruit donc
   * en chaîne à partir de l'instant d'enregistrement :
   *
   *     départ(1) = requestedAt
   *     arrivée(i) = départ(i) + durée(i)
   *     départ(i+1) = arrivée(i)
   *
   * C'est exactement la même raison qui fait rester `gtfsTripId` à NULL
   * (étape 4E-1) : aucun passage réel ne correspond à ce trajet.
   */
  private estimerHoraires(
    liaisons: {
      distanceM: number;
      durationMin: number;
      fromStopId: string;
      toStopId: string;
      line: { mode: ModeTransport; name: string; operator: string };
    }[],
    requestedAt: Date,
  ) {
    let curseur = requestedAt;

    return liaisons.map((liaison) => {
      const departureTime = curseur;
      const arrivalTime = new Date(
        departureTime.getTime() +
          liaison.durationMin * MILLISECONDES_PAR_MINUTE,
      );
      curseur = arrivalTime;

      return {
        // Tout vient du RÉSEAU, rien du client.
        mode: liaison.line.mode,
        operator: liaison.line.operator,
        line: liaison.line.name,
        distanceM: liaison.distanceM,
        fromStopId: liaison.fromStopId,
        toStopId: liaison.toStopId,
        departureTime,
        arrivalTime,
        // `gtfsTripId` n'est VOLONTAIREMENT pas mentionné : il restera NULL.
      };
    });
  }

  /**
   * Économie de CO2 d'un segment, par rapport à la voiture.
   *
   * Le microservice ne fournit `savedVsCarGrams` que pour le TOTAL. On le
   * répartit ici proportionnellement à la distance :
   *
   *     économie(i) = carCo2Grams × distance(i) / distanceTotale − co2(i)
   *
   * Ce n'est pas une approximation : les émissions d'une voiture étant
   * strictement proportionnelles à la distance, cette part EST la référence
   * voiture du segment.
   *
   * POURQUOI PAS `(218 − facteur) × km` ? Parce que 218 est un facteur
   * d'émission, et que les facteurs vivent dans le microservice. Le coder ici
   * créerait une seconde source de vérité, exactement ce que nous avons
   * refusé pour ESCOOTER (4D-1) et pour la formule d'EcoScore (4D-3-2).
   * La formule ci-dessus n'utilise QUE des valeurs renvoyées par FastAPI.
   */
  private economieDuSegment(
    distanceM: number,
    totalDistanceM: number,
    carbone: CarbonResultDto,
    index: number,
  ): number {
    // Trajet de distance nulle : aucune voiture à comparer, donc aucune
    // économie. Convention explicite, qui évite surtout la division par zéro.
    if (totalDistanceM === 0) {
      return 0;
    }

    const referenceVoiture = carbone.carCo2Grams * (distanceM / totalDistanceM);

    return arrondir(referenceVoiture - carbone.breakdown[index].co2Grams);
  }

  // Ne renvoie que les itinéraires de cet usager : le filtre "where" est la
  // garantie qu'aucune donnée d'un autre usager ne peut apparaître ici.
  /**
   * Historique paginé d'un usager (étape 4E-4A).
   *
   * POURQUOI UNE PAGINATION. Sans elle, la requête n'était bornée par rien
   * et grossissait indéfiniment avec l'usage. À noter pour la soutenance :
   * le dossier de conception ne la mentionne pas — « pagination » n'y
   * apparaît pas une seule fois. C'est une décision de conception.
   *
   * POURQUOI DEUX CLÉS DE TRI, et pas seulement `requestedAt`. Ce n'est pas
   * une question de confort : sans ORDRE TOTAL, PostgreSQL ne garantit rien
   * pour deux itinéraires enregistrés au même instant. Combiné à
   * skip/take, cela ne rend pas seulement l'ordre instable — la page 2 peut
   * RÉAFFICHER une ligne de la page 1, ou en SAUTER une. La pagination
   * deviendrait fausse.
   *
   * L'identifiant est un UUID : son ordre n'a aucun sens métier, mais il est
   * total et stable, et c'est tout ce qu'un départage demande. Même
   * raisonnement qu'à l'étape 4C-2, où Dijkstra départage ses égalités par
   * le plus petit identifiant.
   *
   * AUCUNE RELATION N'EST CHARGÉE : une liste est un RÉSUMÉ. Charger les
   * segments d'une page de 20 trajets ramènerait des dizaines de lignes que
   * cette vue n'affiche pas. Le détail est le travail de GET /api/routes/:id.
   */
  async findAllForUser(userId: string, pagination: PaginationQueryDto) {
    const { page, limit } = pagination;

    // Les deux requêtes sont indépendantes : les lancer en parallèle évite
    // d'attendre deux allers-retours successifs vers PostgreSQL.
    const [total, items] = await Promise.all([
      this.prisma.route.count({ where: { userId } }),
      this.prisma.route.findMany({
        where: { userId },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items, page, limit, total };
  }

  async findOneForUser(id: string, userId: string) {
    const route = await this.prisma.route.findUnique({ where: { id } });

    // Deux cas volontairement traités de la même façon :
    //   - l'itinéraire n'existe pas ;
    //   - il existe mais appartient à quelqu'un d'autre.
    // On renvoie 404 (et non 403) dans les deux cas pour ne pas révéler
    // l'existence d'un itinéraire qui ne nous appartient pas — même
    // principe que le login, qui ne dit jamais si un email existe.
    if (!route || route.userId !== userId) {
      throw new NotFoundException(`Itinéraire ${id} introuvable`);
    }

    return route;
  }

  /**
   * Détail complet d'un trajet enregistré (étape 4E-4B).
   *
   * POURQUOI UNE MÉTHODE SÉPARÉE, plutôt qu'enrichir findOneForUser().
   * Celle-ci sert de GARDE DE PROPRIÉTÉ à quatre appelants : ce détail,
   * remove(), et trois méthodes de SegmentsService. Y ajouter des `include`
   * ferait charger à tous des relations dont ils n'ont que faire — le
   * `remove()` chargerait les segments juste avant de les supprimer.
   *
   * Le contrôle de propriété reste donc écrit à UN SEUL endroit, et c'est
   * lui qu'on appelle en premier : la relecture enrichie n'a lieu qu'après.
   * Un usager qui demande le trajet d'un autre reçoit son 404 sans qu'aucune
   * donnée n'ait été chargée.
   */
  async findOneDetailedForUser(id: string, userId: string) {
    // 1) La règle de propriété, inchangée depuis l'étape 4A. Lève 404 si
    //    l'itinéraire n'existe pas OU appartient à quelqu'un d'autre.
    await this.findOneForUser(id, userId);

    // 2) Seulement ensuite, la relecture avec les relations.
    return this.prisma.route.findUniqueOrThrow({
      where: { id },
      include: {
        // Ordre CHRONOLOGIQUE : c'est celui dans lequel on parcourt
        // réellement le trajet. Sans orderBy explicite, PostgreSQL ne
        // promet aucun ordre de lignes (leçon 4C-2) et l'itinéraire
        // pourrait revenir mélangé — illisible.
        segments: {
          orderBy: { departureTime: 'asc' },
          // ⚠️ LES ARRÊTS VOYAGENT AVEC LE SEGMENT (Phase 4).
          //
          // Sans eux, le client ne disposait que de `fromStopId` /
          // `toStopId` — des UUID — et devait charger LA TOTALITÉ des arrêts
          // du réseau pour retrouver deux noms. C'est exactement ce que la
          // pagination de `GET /api/stops` vient d'interdire, et c'était de
          // toute façon des centaines de kilo-octets pour deux libellés.
          //
          // Un `include` sur une relation déjà jointe ne coûte aucune requête
          // supplémentaire, et les arrêts sont des données de référence
          // publiques : aucune donnée personnelle n'est exposée ici.
          include: { fromStop: true, toStop: true },
        },
        // Les enregistrements carbone n'ont AUCUN ordre naturel : ils
        // partagent tous la même `date` (étape 4E-3B). On en impose donc
        // un, arbitraire mais TOTAL : le plus gros contributeur d'abord,
        // départagé par identifiant.
        //
        // ⚠️ Cet ordre ne prétend PAS correspondre à celui des segments.
        // `CarbonRecord` n'a pas de `segmentId` : rapprocher les deux
        // tableaux position par position serait une association inventée.
        // L'usage fiable est l'agrégation par mode.
        carbonRecords: { orderBy: [{ distanceM: 'desc' }, { id: 'asc' }] },
      },
    });
  }

  async remove(id: string, userId: string) {
    // Réutilise la vérification ci-dessus : impossible de supprimer
    // l'itinéraire d'un autre usager (404 avant d'atteindre le delete).
    await this.findOneForUser(id, userId);

    await this.prisma.route.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Recherche d'itinéraire (étape 4C-1, refondue Phase 4)
  // ---------------------------------------------------------------------------

  /**
   * Cherche jusqu'à trois itinéraires RÉELLEMENT DIFFÉRENTS entre deux points.
   *
   * ═══ LES TROIS CRITÈRES ═══
   *
   *   FASTEST           ⚡ le plus rapide, tous modes confondus ;
   *   LOWEST_CO2        🌱 le moins émetteur ;
   *   FEWEST_TRANSFERS  🔁 le moins de changements de ligne.
   *
   * ⚠️ `SHORTEST` A ÉTÉ RETIRÉ DE L'AFFICHAGE, après mesure sur le réseau
   * francilien :
   *
   *     Gare de Lyon → Gare du Nord
   *       FASTEST      6 min, 1 changement,   21 g
   *       SHORTEST    64 min, 4 changements, 238 g
   *
   * « Le plus court en mètres » minimise le sol parcouru. Dans un réseau où le
   * métro plonge sous les immeubles et le bus contourne les places, cela
   * désigne des trajets de surface qui zigzaguent — soixante-quatre minutes et
   * onze fois plus d'émissions pour économiser 1,4 km de tracé.
   *
   * Le critère gardait un sens sur l'Eurométropole de Strasbourg, réseau de
   * surface où le tram file en site propre mais contourne. Il n'en a plus sur
   * un réseau souterrain dense. Il reste une valeur valide du type : des
   * itinéraires enregistrés par les usagers la portent.
   *
   * Ils répondent à trois questions qu'un voyageur se pose vraiment, et
   * peuvent parfaitement désigner le même trajet : dans ce cas un seul
   * itinéraire est renvoyé, jamais trois copies du même.
   *
   * ═══ AUCUN COEFFICIENT INVENTÉ ═══
   *
   * Les trois critères sont trois fonctions de coût LEXICOGRAPHIQUES :
   *
   *     FASTEST           [durée]
   *     FEWEST_TRANSFERS  [changements, durée]
   *
   * Aucune ne mélange deux grandeurs dans une somme pondérée, donc aucune
   * n'exige de choisir un taux de conversion — « une correspondance vaut
   * 5 minutes » — que rien ne justifierait. C'est le même refus qu'à l'étape
   * 4D-1, où aucun facteur d'émission n'a été inventé pour ESCOOTER. Voir
   * `dijkstra.ts` pour le détail.
   *
   * `LOWEST_CO2` procède autrement — par SÉLECTION parmi des itinéraires
   * réels, et non par pondération. La raison, mesurée sur le réseau réel, est
   * expliquée en détail sur `moinsEmetteur()` : elle mérite d'être lue.
   *
   * ═══ UNE PANNE DU CALCUL CARBONE NE CASSE PAS LA RECHERCHE ═══
   *
   * L'étape 4D-2 avait posé la règle sous sa forme la plus stricte : « la
   * recherche n'appelle jamais le microservice ». Ce n'est plus tenable —
   * le produit doit afficher les émissions de chaque option. La règle est
   * donc conservée dans son ESPRIT, qui est le seul qui compte : une panne du
   * service carbone ne doit jamais empêcher de trouver un itinéraire.
   *
   * Concrètement, quand le microservice est injoignable :
   *   - `facteurs()` rend `null` sans lever, donc le critère LOWEST_CO2 est
   *     simplement absent de la réponse ;
   *   - chaque itinéraire porte `carbon.status = CARBON_UNAVAILABLE` et des
   *     champs chiffrés à `null` — JAMAIS à zéro ;
   *   - les itinéraires eux-mêmes sont rendus normalement.
   *
   * Un test verrouille cette propriété.
   *
   * IMPORTANT (étape 4C-3, inchangé) : cette méthode ne lit QUE des données
   * publiques. Elle n'interroge ni Route ni Segment, qui appartiennent aux
   * usagers.
   */
  async searchRoutes(dto: SearchRouteDto): Promise<ItineraryDto[]> {
    // ═══ TRAJET DIRECT : À PIED OU À VÉLO, D'UN BOUT À L'AUTRE ═══
    //
    // ⚠️ ON NE TOUCHE PAS AU GRAPHE DES TRANSPORTS. « À pied » et « à vélo »
    // ne sont pas des critères parmi d'autres : ce sont des trajets d'une
    // seule pièce, sans arrêt, sans correspondance, sans marche d'approche.
    // Un seul itinéraire est rendu — il n'existe pas trois façons d'aller
    // quelque part à pied.
    if (dto.mode === 'WALK') {
      return this.seulementAPied(dto);
    }
    if (dto.mode === 'BIKE') {
      return this.seulementAVelo(dto);
    }

    // ⚠️ LE GRAPHE EST BORNÉ SPATIALEMENT, et ce n'est pas une optimisation
    // prématurée : c'est ce qui rend l'ajout du bus possible. Ces deux
    // requêtes chargeaient TOUT le réseau à CHAQUE recherche.
    //
    // orderBy reste INDISPENSABLE (étape 4C-2) : sans ORDER BY, PostgreSQL ne
    // garantit aucun ordre de lignes. Cet ordre se propage jusqu'à l'ordre
    // d'exploration de Dijkstra, et deux recherches identiques pourraient
    // rendre deux chemins différents (de coût pourtant égal).
    const cadre = this.cadreDeRecherche(dto);

    const [stops, links] = await Promise.all([
      this.prisma.stop.findMany({ where: cadre, orderBy: { id: 'asc' } }),
      this.prisma.networkLink.findMany({
        // Les DEUX extrémités doivent tomber dans le cadre : une liaison dont
        // l'autre bout est hors zone mènerait à un sommet absent du graphe.
        where: { fromStop: cadre, toStop: cadre },
        orderBy: { id: 'asc' },
        include: { line: true },
      }),
    ]);

    // ⚠️ AUCUN ARRÊT DANS LE CADRE NE VEUT PAS DIRE « AUCUN TRAJET ». Deux
    // points peuvent parfaitement se rejoindre à pied dans une zone que le
    // réseau ne dessert pas.
    if (stops.length === 0) {
      return this.seulementAPied(dto);
    }

    // ⚠️ TOUS LES QUAIS D'UN MÊME LIEU SONT ACCEPTABLES, pas seulement le
    // plus proche. Un pôle d'échange publie UN ARRÊT PAR QUAI : « Gare
    // Centrale » compte onze quais à Strasbourg.
    const origines = this.arretsProches(stops, dto.fromLat, dto.fromLon);
    const destinations = this.arretsProches(stops, dto.toLat, dto.toLon);

    // Aucun quai rattachable d'un côté ou de l'autre : le réseau ne dessert
    // pas ce point, mais les jambes, elles, fonctionnent toujours.
    if (origines.length === 0 || destinations.length === 0) {
      return this.seulementAPied(dto);
    }

    // ⚠️ DEUX POINTS RATTACHÉS AUX MÊMES QUAIS SE REJOIGNENT À PIED — ce qui
    // est une RÉPONSE, pas une absence de réponse. Ce cas rendait autrefois
    // une liste vide : « 15 rue Adler » → « 2 rue Mélanie », deux cents
    // mètres, et l'écran affichait « aucun itinéraire ».
    if (origines.every((o) => destinations.some((d) => d.id === o.id))) {
      return this.seulementAPied(dto);
    }

    const graph = this.buildGraph(links);
    const stopsById = new Map(stops.map((stop) => [stop.id, stop]));

    // Sommet VIRTUEL relié à coût nul à chaque quai de départ : la façon la
    // plus simple d'obtenir un Dijkstra multi-source sans toucher à
    // l'algorithme. Le multi-cible, lui, n'a besoin d'aucun sommet fictif —
    // il suffit de tester l'appartenance à l'ensemble d'arrivée.
    this.brancherOrigineVirtuelle(graph, origines);
    const idsArrivee = new Set(destinations.map((stop) => stop.id));

    // ⚠️ NE LÈVE JAMAIS. `null` = microservice indisponible.
    const facteurs = await this.carbonService.facteurs();

    // ═══ LES LIGNES QUI CIRCULENT RÉELLEMENT ═══
    //
    // ⚠️ `null` SIGNIFIE « JE NE SAIS PAS », PAS « AUCUNE ». Une installation
    // dont le flux GTFS n'a pas de `calendar.txt` doit continuer à calculer
    // des itinéraires exactement comme avant. Confondre les deux ferait
    // échouer toute recherche sur un flux pourtant valide.
    const instant = this.instantDeDepart(dto);
    const lignesActives = await this.schedule.lignesActives(instant);

    const chemins = this.cheminsCandidats(
      graph,
      idsArrivee,
      facteurs,
      lignesActives,
    );

    // ═══ LE PLUS RAPIDE, AU SENS DE L'USAGER ═══
    //
    // ⚠️ CETTE ÉTAPE RÉPARE UN RÉSULTAT ABERRANT, observé sur le réseau réel.
    //
    //     Esplanade → Neuhof, un jeudi matin
    //     « le plus rapide » : 21 min de parcours, SIX correspondances,
    //                          quatorze tronçons d'une minute…
    //                          et 28 minutes d'attente cumulée.
    //
    // Chaque durée était exacte. Le classement, lui, était faux : Dijkstra
    // minimisait le temps de PARCOURS, dans un graphe où changer de ligne ne
    // coûte rien. L'algorithme sautait donc de bus en bus pour gagner des
    // minutes qu'il repayait au triple sur le quai.
    //
    // ═══ POURQUOI PAS UNE PÉNALITÉ DE CORRESPONDANCE ═══
    //
    // La solution habituelle — « une correspondance vaut 5 minutes » — exige
    // d'inventer ce 5, que rien ne justifie et qui serait faux la moitié du
    // temps : l'attente réelle va de 0 à 30 minutes selon la ligne et l'heure.
    //
    // ═══ CE QUI EST FAIT À LA PLACE ═══
    //
    // On calcule DEUX itinéraires réels — le plus court en parcours, et le
    // moins riche en correspondances — puis on les départage sur leur HEURE
    // D'ARRIVÉE effective, attente comprise. Aucun coefficient n'est inventé :
    // on mesure, et on compare.
    //
    // C'est exactement la technique déjà employée par `moinsEmetteur()`, pour
    // la même raison : sélectionner parmi des trajets réels plutôt que
    // pondérer des grandeurs incommensurables.
    await this.plusRapideReellement(chemins, stopsById, instant, lignesActives);

    const itineraires: ItineraryDto[] = [];

    for (const [critere, chemin] of chemins) {
      // ⚠️ `SHORTEST` EST CALCULÉ MAIS NON AFFICHÉ. Il sert de candidat au
      // critère carbone — un trajet plus court émet souvent moins — sans
      // occuper une carte de résultat où il proposerait, sur un réseau
      // souterrain dense, des zigzags de surface. Voir l'en-tête de
      // `searchRoutes`.
      if (critere === 'SHORTEST') {
        continue;
      }

      const candidat = this.toItinerary(critere, chemin, stopsById, dto);

      // ⚠️ DEUX CRITÈRES PEUVENT DÉSIGNER LE MÊME TRAJET, et c'est même le
      // cas normal sur un trajet court. On garde le premier, dans l'ordre
      // FASTEST → LOWEST_CO2 → FEWEST_TRANSFERS, et l'interface affiche alors
      // DEUX cartes — jamais trois dont l'une serait un doublon maquillé.
      const deja = itineraires.some(
        (existant) => this.signature(existant) === this.signature(candidat),
      );

      if (!deja) {
        itineraires.push(candidat);
      }
    }

    // ═══ LA MARCHE, QUAND ELLE EST LA BONNE RÉPONSE ═══
    //
    // ⚠️ CE BLOC RÉPARE UN « AUCUN ITINÉRAIRE » MESURÉ SUR LE RÉSEAU RÉEL.
    // « 15 rue Adler » → « 2 rue Mélanie », deux cents mètres : le graphe ne
    // relie pas ces deux quais, et l'écran répondait « nous ne savons pas vous
    // y emmener » pour une rue à traverser.
    //
    // ═══ QUAND PRENDRE UN VÉHICULE N'A AUCUN SENS ═══
    //
    // ⚠️ MESURÉ : « 19 rue Finkmatt » → « 6 rue des Cigognes », deux cent
    // quarante mètres à vol d'oiseau. Le moteur proposait 3 min de marche +
    // 1 min de bus + 4 min de marche, soit 8 min et 991 m — pour un trajet
    // qu'on fait en quatre minutes à pied.
    //
    // ═══ LE CRITÈRE, ET POURQUOI IL N'EST PAS ARBITRAIRE ═══
    //
    // Un itinéraire est DOMINÉ par la marche quand ses propres marches
    // d'approche et de sortie cumulées atteignent déjà la distance qui sépare
    // directement les deux points. Il fait alors marcher AU MOINS AUTANT
    // qu'un trajet à pied — et demande en plus d'attendre un véhicule.
    //
    // ⚠️ AUCUN SEUIL N'EST INVENTÉ, et rien d'incomparable n'est comparé : ce
    // sont deux distances À VOL D'OISEAU mises face à face, produites par la
    // même méthode. C'est précisément ce qui manquait à la version
    // précédente, qui opposait une estimation à des durées mesurées et
    // refusait donc — à juste titre — de trancher.
    //
    // Un trajet où le véhicule fait gagner du chemin (l'écrasante majorité)
    // n'est jamais dominé : Adler → Kléber marche 325 m pour 3,4 km parcourus.
    const aPied = this.itineraireAPied(dto);
    const distanceDirecteM = aPied.totalDistanceM;

    const domineParLaMarche = (itineraire: ItineraryDto) =>
      (itineraire.walkAccess?.distanceM ?? 0) +
        (itineraire.walkEgress?.distanceM ?? 0) >=
      distanceDirecteM;

    const utiles = itineraires.filter(
      (itineraire) => !domineParLaMarche(itineraire),
    );

    if (utiles.length === 0) {
      // Aucun trajet en transport ne vaut la peine — ou le graphe n'a rien
      // trouvé du tout. Dans les deux cas, la réponse est : marchez.
      itineraires.length = 0;
      itineraires.push(aPied);
    } else if (utiles.length < itineraires.length) {
      // On retire les propositions absurdes, on garde les autres.
      itineraires.length = 0;
      itineraires.push(...utiles);
    }

    // ⚠️ AVANT LE CARBONE : le calcul des émissions se fonde sur les
    // distances, que le routeur piéton peut corriger de plusieurs dizaines de
    // pour cent.
    await this.enrichirMarche(itineraires);
    await this.enrichirCarbone(itineraires, facteurs);
    await this.enrichirHoraires(itineraires, instant, lignesActives);

    return itineraires;
  }

  /**
   * Remplace le chemin `FASTEST` par celui qui ARRIVE le plus tôt.
   *
   * ⚠️ NE FAIT RIEN SI LES HORAIRES SONT INCONNUS. Sans eux, il n'y a rien à
   * comparer, et `FASTEST` garde le sens qu'il avait : le plus court en temps
   * de parcours. Le comportement d'une installation sans calendrier est donc
   * rigoureusement inchangé.
   *
   * ⚠️ DEUX CANDIDATS SEULEMENT, ET C'EST DÉLIBÉRÉ. Chaque évaluation coûte
   * une requête d'horaire PAR MONTÉE : en explorer dix multiplierait les
   * allers-retours en base pour un gain marginal. Les deux retenus encadrent
   * le compromis — l'un minimise le parcours, l'autre les correspondances — et
   * c'est entre eux que se joue l'essentiel de l'écart.
   */
  private async plusRapideReellement(
    chemins: Map<ItineraryCriterion, PathStep[]>,
    stopsById: Map<string, Stop>,
    instant: Date,
    lignesActives: CirculationDuMoment | null,
  ): Promise<void> {
    const rapide = chemins.get('FASTEST');
    const directs = chemins.get('FEWEST_TRANSFERS');

    if (!rapide || !directs || lignesActives === null) {
      return;
    }

    // ⚠️ MÊME GARDE QUE `enrichirHoraires`, ET POUR LA MÊME RAISON. Sans
    // horaires, les deux candidats rendent `null` : on paie deux évaluations
    // complètes — chacune une requête par montée — pour ne rien pouvoir
    // départager.
    const horodate = (chemin: PathStep[]) =>
      chemin.some(
        (etape) =>
          etape.edge.mode !== ModeTransport.WALK &&
          lignesActives.horodatees.has(etape.edge.lineId),
      );

    if (!horodate(rapide) && !horodate(directs)) {
      return;
    }

    const arrivee = async (chemin: PathStep[]): Promise<number | null> => {
      const itineraire = this.toItinerary('FASTEST', chemin, stopsById);
      const horaire = await this.horairesDe(itineraire, instant);

      if (horaire.status !== 'SCHEDULE_AVAILABLE' || !horaire.arrivalAt) {
        return null;
      }

      return new Date(horaire.arrivalAt).getTime();
    };

    const [arriveeRapide, arriveeDirects] = await Promise.all([
      arrivee(rapide),
      arrivee(directs),
    ]);

    // ⚠️ UN CANDIDAT NON HORODATABLE PERD, mais ne fait pas gagner l'autre par
    // défaut. Si AUCUN des deux n'a d'horaire, on ne touche à rien : les
    // départager au hasard vaudrait moins que de garder le résultat connu.
    if (arriveeDirects === null) {
      return;
    }

    if (arriveeRapide === null || arriveeDirects < arriveeRapide) {
      chemins.set('FASTEST', directs);
    }
  }

  /**
   * L'instant auquel le voyageur souhaite partir.
   *
   * `departAt` est FACULTATIF : sans lui, c'est maintenant. C'est ce qui
   * permet de préparer un trajet du lendemain matin sans mentir sur les
   * horaires — le calendrier répondra pour CE jour-là.
   *
   * ⚠️ UNE DATE ILLISIBLE RETOMBE SUR MAINTENANT plutôt que de lever. Le DTO
   * la valide déjà ; cette garde n'existe que pour qu'un `new Date('n’importe
   * quoi')` ne produise pas un `Invalid Date` qui contaminerait silencieusement
   * tous les calculs d'attente.
   */
  private instantDeDepart(dto: SearchRouteDto): Date {
    if (!dto.departAt) {
      return new Date();
    }

    const instant = new Date(dto.departAt);

    return Number.isNaN(instant.getTime()) ? new Date() : instant;
  }

  /**
   * Complète chaque itinéraire par ses HORAIRES RÉELS.
   *
   * ═══ LE MENSONGE QUE CETTE MÉTHODE SUPPRIME ═══
   *
   * `totalDurationMin` additionnait des temps de PARCOURS. Un trajet annoncé
   * « 12 min » en demandait 25 un dimanche soir, parce que le bus passe toutes
   * les demi-heures. La durée était exacte et la promesse fausse.
   *
   * ═══ COMMENT L'ATTENTE EST CALCULÉE ═══
   *
   * On avance une HORLOGE le long de l'itinéraire :
   *
   *   1. à chaque montée dans une ligne, on cherche son prochain passage à
   *      l'arrêt ; l'écart est l'attente ;
   *   2. l'horloge avance de cette attente, puis de la durée du parcours ;
   *   3. une correspondance n'est donc pas comptée à part : c'est l'attente
   *      de la ligne suivante, mesurée après être descendu.
   *
   * ⚠️ ON NE COMPTE L'ATTENTE QU'À UNE MONTÉE. Rester dans le même véhicule
   * sur cinq arrêts consécutifs n'a aucun temps d'attente ; l'ajouter cinq
   * fois gonflerait le trajet d'une demi-heure imaginaire.
   *
   * ⚠️ SI UN SEUL PASSAGE EST INCONNU, TOUT L'ITINÉRAIRE PASSE EN
   * `SCHEDULE_UNKNOWN`. On ne compose pas une heure d'arrivée à partir de
   * segments dont certains sont horodatés et d'autres devinés : ce serait la
   * pire des réponses — précise et fausse.
   */
  private async enrichirHoraires(
    itineraires: ItineraryDto[],
    instant: Date,
    lignesActives: CirculationDuMoment | null,
  ): Promise<void> {
    // ═══ UN TRAJET À PIED N'ATTEND AUCUN VÉHICULE ═══
    //
    // ⚠️ SANS CE CAS, UN TRAJET DE TROIS MINUTES À PIED AFFICHAIT « les
    // horaires ne sont pas importés : la durée ne compte pas l'attente ».
    // C'était trompeur : il n'y a rien à attendre, et l'heure d'arrivée est
    // parfaitement connue — c'est l'heure de départ plus la durée de marche.
    //
    // Traité AVANT le repli `lignesActives === null` : l'absence de calendrier
    // ne change rien à la marche.
    const aPied = itineraires.filter(
      (itineraire) => itineraire.segments.length === 0,
    );

    for (const itineraire of aPied) {
      itineraire.schedule = {
        status: 'SCHEDULE_AVAILABLE',
        departureAt: instant.toISOString(),
        arrivalAt: new Date(
          instant.getTime() + itineraire.totalDurationMin * 60_000,
        ).toISOString(),
        // ⚠️ ZÉRO, ET NON `null` : ce n'est pas « nous ne savons pas », c'est
        // « il n'y a aucune attente ». Les deux se lisent différemment.
        totalWaitMin: 0,
        reason: null,
      };
    }

    const enTransport = itineraires.filter(
      (itineraire) => itineraire.segments.length > 0,
    );

    if (lignesActives === null) {
      for (const itineraire of enTransport) {
        itineraire.schedule = {
          status: 'SCHEDULE_UNAVAILABLE',
          departureAt: null,
          arrivalAt: null,
          totalWaitMin: null,
          reason:
            "Aucun horaire n'est importé pour ce réseau : la durée affichée " +
            "ne compte que le temps de parcours, sans l'attente.",
        };
      }

      return;
    }

    for (const itineraire of enTransport) {
      // ═══ ON NE DEMANDE PAS L'HEURE À UNE LIGNE QUI N'EN A PAS ═══
      //
      // ⚠️ CORRIGÉ APRÈS MESURE : la recherche mettait deux secondes, dont
      // l'essentiel en allers-retours vers un calendrier qui n'avait rien à
      // dire. Un itinéraire à six correspondances déclenchait jusqu'à
      // quarante-huit requêtes pour n'en tirer que des `null`.
      //
      // ⚠️ ET SURTOUT, LE STATUT ÉTAIT FAUX. `SCHEDULE_UNKNOWN` signifie « ces
      // lignes ne passent pas dans les prochaines heures » — une affirmation
      // sur le service. La phrase juste ici est « nous n'avons aucun horaire
      // pour ces lignes », qui n'affirme rien sur leur circulation.
      if (!this.itineraireHorodate(itineraire, lignesActives)) {
        itineraire.schedule = {
          status: 'SCHEDULE_UNAVAILABLE',
          departureAt: null,
          arrivalAt: null,
          totalWaitMin: null,
          reason:
            "Aucun horaire n'est importé pour les lignes de cet itinéraire : " +
            "la durée affichée ne compte que le temps de parcours, sans l'attente.",
        };
        continue;
      }

      itineraire.schedule = await this.horairesDe(itineraire, instant);
    }
  }

  /**
   * Vrai si AU MOINS UNE ligne empruntée possède des horaires en base.
   *
   * ⚠️ « AU MOINS UNE », ET NON « TOUTES ». Un itinéraire mixte — une ligne
   * horodatée, une autre non — doit tenter le calcul : il échouera alors sur la
   * seconde et rendra `SCHEDULE_UNKNOWN`, ce qui est exact. C'est seulement
   * quand AUCUNE ligne n'est connue qu'on peut affirmer d'emblée n'avoir aucun
   * horaire.
   *
   * ⚠️ LA MARCHE NE COMPTE PAS. Elle n'a pas d'horaire par nature ; l'inclure
   * ferait conclure « horodaté » sur un trajet entièrement à pied.
   */
  private itineraireHorodate(
    itineraire: ItineraryDto,
    lignesActives: CirculationDuMoment,
  ): boolean {
    return itineraire.segments.some(
      (segment) =>
        segment.mode !== ModeTransport.WALK &&
        lignesActives.horodatees.has(segment.lineId),
    );
  }

  /**
   * Fait courir l'horloge le long d'un itinéraire.
   */
  private async horairesDe(
    itineraire: ItineraryDto,
    depart: Date,
  ): Promise<ItineraryScheduleDto> {
    let horloge = depart.getTime();
    let attenteTotale = 0;
    let ligneCourante: string | null = null;

    // ⚠️ LES HEURES SONT ACCUMULÉES À PART, ET POSÉES SUR LES SEGMENTS
    // SEULEMENT SI TOUT L'ITINÉRAIRE ABOUTIT.
    //
    // La première version écrivait directement dans `segment.departureAt` au
    // fil de la boucle. Un abandon en cours de route laissait donc les
    // premiers segments horodatés et les suivants nus, sur un itinéraire
    // pourtant marqué `SCHEDULE_UNKNOWN` : des heures précises et fausses,
    // exactement ce que ce statut existe pour éviter.
    //
    // Les tests de bout en bout l'ont attrapé par un biais inattendu — deux
    // appels identiques ne rendaient plus le même corps, ces heures suivant
    // l'horloge murale.
    const horaires: { depart: string; arrivee: string; attente?: number }[] =
      [];

    for (const segment of itineraire.segments) {
      const embarque =
        segment.mode !== ModeTransport.WALK && segment.lineId !== ligneCourante;

      // L'attente PROPRE À CE SEGMENT, à ne pas confondre avec le cumul.
      let attenteSegment: number | undefined;

      if (embarque) {
        const attente = await this.schedule.attenteAvantLigne(
          [segment.fromStopId],
          segment.lineId,
          new Date(horloge),
        );

        if (attente === null) {
          return {
            status: 'SCHEDULE_UNKNOWN',
            departureAt: null,
            arrivalAt: null,
            totalWaitMin: null,
            reason:
              `Aucun passage de la ligne ${segment.lineName} n'est prévu à ` +
              `${segment.fromStopName} dans les prochaines heures.`,
          };
        }

        attenteTotale += attente;
        attenteSegment = attente;
        horloge += attente * 60_000;
      }

      const departSegment = new Date(horloge).toISOString();
      horloge += segment.durationMin * 60_000;

      horaires.push({
        depart: departSegment,
        arrivee: new Date(horloge).toISOString(),
        ...(attenteSegment === undefined ? {} : { attente: attenteSegment }),
      });

      // ⚠️ LA MARCHE NE REMET PAS À ZÉRO LA LIGNE COURANTE. Traverser un quai
      // entre deux tronçons du même tram n'est pas une descente : sans cette
      // règle, on recompterait l'attente d'un véhicule où l'on est déjà.
      if (segment.mode !== ModeTransport.WALK) {
        ligneCourante = segment.lineId;
      }
    }

    // Tout a abouti : on pose les heures.
    for (const [index, segment] of itineraire.segments.entries()) {
      segment.departureAt = horaires[index].depart;
      segment.arrivalAt = horaires[index].arrivee;

      // ⚠️ POSÉ SEULEMENT S'IL Y A EU MONTÉE. `undefined` — et non 0 — sur
      // les tronçons suivants d'une même ligne : rester assis dans le tram
      // n'est pas une attente de zéro minute, c'est l'absence d'attente.
      if (horaires[index].attente !== undefined) {
        segment.waitMin = horaires[index].attente;
      }
    }

    return {
      status: 'SCHEDULE_AVAILABLE',
      departureAt: depart.toISOString(),
      arrivalAt: new Date(horloge).toISOString(),
      totalWaitMin: attenteTotale,
      reason: null,
    };
  }

  /**
   * Les chemins retenus, par critère, dans l'ordre d'affichage.
   *
   * Une `Map` et non un objet : elle garantit l'ordre d'insertion, dont
   * dépend la déduplication ci-dessus.
   */
  private cheminsCandidats(
    graph: Graph,
    idsArrivee: ReadonlySet<string>,
    facteurs: CarbonFactorsDto | null,
    lignesActives: CirculationDuMoment | null,
  ): Map<ItineraryCriterion, PathStep[]> {
    const retenus = new Map<ItineraryCriterion, PathStep[]>();

    // ═══ LE FILTRE QUI SUPPRIME LES BUS DE NUIT À 14 HEURES ═══
    //
    // ⚠️ LA MARCHE PASSE TOUJOURS. Elle n'a pas d'horaire : la soumettre au
    // calendrier couperait le graphe en morceaux, puisque c'est elle qui
    // relie les quais entre eux.
    //
    // ⚠️ UNE LIGNE SANS AUCUN HORAIRE IMPORTÉ PASSE AUSSI, et ce n'est pas
    // une commodité : c'est la différence entre « cette ligne ne circule
    // pas » et « je ne sais rien de cette ligne ». Un flux peut décrire une
    // ligne dans `routes.txt` sans la faire figurer dans `stop_times.txt` —
    // une navette saisonnière, par exemple. La retirer du réseau amputerait
    // le graphe sans que rien ne le signale.
    const circule = (arete: GraphEdge): boolean => {
      if (lignesActives === null) {
        return true;
      }

      if (arete.mode === ModeTransport.WALK) {
        return true;
      }

      if (!lignesActives.horodatees.has(arete.lineId)) {
        return true;
      }

      return lignesActives.actives.has(arete.lineId);
    };

    const rapide = this.plusRapide(graph, idsArrivee, circule);

    // ⚠️ CALCULÉ MÊME S'IL N'EST PLUS AFFICHÉ SOUS SON NOM. `moinsDeChangements`
    // sert désormais de CANDIDAT au critère « le plus rapide » : voir
    // `plusRapideReellement()`, qui départage les deux sur l'heure d'arrivée
    // RÉELLE, attente comprise.
    const directs = this.moinsDeChangements(graph, idsArrivee, circule);

    if (rapide) {
      retenus.set('FASTEST', rapide);
    }

    const court = this.plusCourt(graph, idsArrivee, circule);

    // ⚠️ L'ORDRE D'INSERTION EST L'ORDRE D'AFFICHAGE, et il n'est pas
    // arbitraire : le carbone passe AVANT la distance parce qu'il est
    // l'identité du produit. Si les deux désignent le même trajet, c'est
    // l'étiquette « le plus écologique » qui survit à la déduplication.
    //
    // Sans facteurs d'émission, aucun classement écologique n'est possible.
    // On préfère ne rien proposer plutôt qu'un « écologique » qui n'aurait
    // été comparé à rien.
    if (facteurs) {
      const propre = this.moinsEmetteur(
        graph,
        idsArrivee,
        facteurs,
        // ⚠️ `directs` EN FAIT PARTIE, et son absence était un défaut réel :
        // le chemin retenu comme « le plus rapide » après départage sur
        // l'heure d'arrivée n'était jamais soumis au critère carbone. Le
        // résultat pouvait donc annoncer un « plus écologique » émettant
        // PLUS que le plus rapide affiché à côté.
        [rapide, court, directs].filter((c): c is PathStep[] => c !== null),
        circule,
      );

      if (propre) {
        retenus.set('LOWEST_CO2', propre);
      }
    }

    // ⚠️ CALCULÉ, MAIS FILTRÉ À LA SORTIE. `SHORTEST` sert de candidat au
    // critère carbone ci-dessus ; il n'occupe pas de carte de résultat.
    if (court) {
      retenus.set('SHORTEST', court);
    }

    // ⚠️ EN DERNIER DANS L'ORDRE D'INSERTION, donc dernier à survivre à la
    // déduplication. C'est voulu : quand « le moins de changements » désigne
    // le même trajet que « le plus rapide », c'est cette dernière étiquette
    // qui doit rester — elle est la plus utile des deux.
    if (directs) {
      retenus.set('FEWEST_TRANSFERS', directs);
    }

    return retenus;
  }

  /**
   * Le trajet de durée minimale, sur tout ou partie du réseau.
   *
   * `utilisable` permet de retirer des arêtes — un mode, une ligne — sans
   * reconstruire le graphe : c'est ainsi qu'on obtient des ALTERNATIVES
   * réellement différentes plutôt que des variantes du même trajet.
   */
  private plusRapide(
    graph: Graph,
    idsArrivee: ReadonlySet<string>,
    utilisable?: (arete: GraphEdge) => boolean,
  ): PathStep[] | null {
    return this.executer(graph, idsArrivee, utilisable, {
      coutDe: (arete) => [arete.donnee.durationMin],
      etatApres: (arete) => arete.vers,
    });
  }

  /**
   * Le trajet dont la DISTANCE PARCOURUE est la plus faible.
   *
   * ═══ POURQUOI `[distance, durée]` ET NON `[distance]` SEUL ═══
   *
   * Deux trajets de distance rigoureusement égale existent — un aller-retour
   * par deux quais opposés du même arrêt, par exemple. Sans départage, lequel
   * ressort dépend de l'ordre d'exploration, donc de l'ordre des lignes
   * rendues par PostgreSQL. La durée tranche, et rend la réponse stable.
   *
   * ⚠️ AUCUNE PONDÉRATION : c'est un coût LEXICOGRAPHIQUE. La durée n'entre
   * en jeu qu'À DISTANCE ÉGALE, jamais pour compenser un mètre de plus. Une
   * somme `distance + k × durée` exigerait d'inventer `k`, ce que ce projet
   * s'interdit depuis l'étape 4D-1.
   *
   * ⚠️ `distanceM` EST UNE DONNÉE IMPORTÉE, pas une estimation : elle vient
   * de la géométrie GTFS de la liaison, ou à défaut de la distance
   * orthodromique entre les deux arrêts. Elle n'est jamais fabriquée.
   */
  private plusCourt(
    graph: Graph,
    idsArrivee: ReadonlySet<string>,
    utilisable?: (arete: GraphEdge) => boolean,
  ): PathStep[] | null {
    return this.executer(graph, idsArrivee, utilisable, {
      coutDe: (arete) => [arete.donnee.distanceM, arete.donnee.durationMin],
      etatApres: (arete) => arete.vers,
    });
  }

  /**
   * Le trajet comportant le moins de CHANGEMENTS DE LIGNE.
   *
   * ⚠️ N'EST PLUS UN CRITÈRE AFFICHÉ, MAIS UN CANDIDAT. Depuis que les
   * horaires sont importés, son résultat est mis en concurrence avec celui de
   * `plusRapide` sur l'HEURE D'ARRIVÉE RÉELLE — voir
   * `plusRapideReellement()`. C'est ce qui empêche le moteur de proposer six
   * correspondances pour gagner des minutes de parcours qu'il repaie en
   * attente sur le quai.
   *
   * L'état inclut la ligne courante, sans quoi l'algorithme ne saurait pas
   * s'il change de ligne en poursuivant. `''` signifie « pas encore
   * embarqué » : monter dans la première ligne n'est pas un changement.
   *
   * ⚠️ UN SEGMENT DE MARCHE NE CHANGE PAS LA LIGNE COURANTE. Traverser un
   * couloir entre deux quais du métro 4 n'est pas une correspondance ; sans
   * cette règle, le même trajet en compterait deux.
   */
  private moinsDeChangements(
    graph: Graph,
    idsArrivee: ReadonlySet<string>,
    utilisable?: (arete: GraphEdge) => boolean,
  ): PathStep[] | null {
    return this.executer(graph, idsArrivee, utilisable, {
      coutDe: (arete, etat) => {
        const courante = ligneDeLEtat(etat);
        const changement =
          arete.donnee.mode !== ModeTransport.WALK &&
          courante !== '' &&
          courante !== arete.donnee.lineId;

        return [changement ? 1 : 0, arete.donnee.durationMin];
      },
      etatApres: (arete, etat) => {
        const ligne =
          arete.donnee.mode === ModeTransport.WALK
            ? ligneDeLEtat(etat)
            : arete.donnee.lineId;

        return `${arete.vers}${SEPARATEUR_ETAT}${ligne}`;
      },
    });
  }

  /**
   * Le moins émetteur PARMI DES ITINÉRAIRES RÉELS.
   *
   * ═══ POURQUOI CE N'EST PAS UN DIJKSTRA SUR LES GRAMMES ═══
   *
   * Ç'a d'abord été écrit ainsi — coût `[grammes, durée]` — puis mesuré sur
   * le réseau réel. Le résultat était inutilisable, et il faut le dire
   * précisément, parce que l'erreur est instructive :
   *
   *     Gare de Lyon → Gare du Nord
   *     le plus rapide        : RER A + RER D,      10 min, 21,43 g
   *     le « moins émetteur » : 13 segments,        47 min, 12,23 g
   *
   * Quarante-sept minutes de zigzag — métro 1, métro 5, métro 8, métro 9,
   * quatre correspondances à pied de huit minutes — pour économiser neuf
   * grammes. Personne ne ferait ce trajet.
   *
   * La cause n'est pas un bug, c'est la structure des données. Toutes nos
   * lignes ferrées portent le MÊME facteur (4 g/km) : minimiser les grammes
   * revient donc à minimiser les KILOMÈTRES PARCOURUS EN TRANSPORT, et la
   * marche, à 0 g/km, devient gratuite. L'algorithme remplace du trajet par
   * de la marche aussi longtemps qu'il le peut.
   *
   * ⚠️ L'hypothèse écrite dans la première version — « les arêtes WALK
   * viennent de transfers.txt, elles ne peuvent donc pas s'enchaîner » — ÉTAIT
   * FAUSSE, et c'est la mesure sur données réelles qui l'a montrée. Les
   * correspondances GTFS relient bel et bien des stations voisines
   * DIFFÉRENTES (Bréguet-Sabin → Chemin Vert, Filles du Calvaire →
   * Oberkampf) : elles se chaînent à travers la ville.
   *
   * ═══ CE QUI EST FAIT À LA PLACE ═══
   *
   * On CHOISIT, on ne pondère pas. On construit un jeu d'itinéraires qui sont
   * tous de vrais plus-courts-chemins EN DURÉE — donc tous praticables — puis
   * on retient celui qui émet le moins :
   *
   *   1. le plus rapide, tous modes ;
   *   2. le moins de changements ;
   *   3. le plus rapide en retirant, tour à tour, CHAQUE LIGNE empruntée par
   *      les deux précédents ;
   *   4. le plus rapide en retirant, tour à tour, chaque MODE émetteur.
   *
   * Le point 3 est la déviation du premier ordre de l'algorithme de Yen :
   * c'est la façon standard d'obtenir des itinéraires réellement différents
   * plutôt que des variantes du même. Le point 4 garantit qu'« éviter le
   * bus » reste proposable même quand le plus rapide n'en emprunte aucun.
   *
   * `LOWEST_CO2` désigne ainsi toujours un trajet qu'un voyageur ferait, et
   * l'écart affiché — « 5 min de plus, 78 g de moins » — compare deux options
   * réelles.
   */
  private moinsEmetteur(
    graph: Graph,
    idsArrivee: ReadonlySet<string>,
    facteurs: CarbonFactorsDto,
    dejaCalcules: PathStep[][],
    // ⚠️ LE FILTRE DE CIRCULATION SE COMPOSE AVEC CEUX DES VARIANTES, il ne
    // les remplace pas. Sans cela, les variantes exploraient un graphe où les
    // lignes de nuit circulaient encore, et le trajet « le moins émetteur »
    // pouvait sortir un bus N3 à 14 heures — pendant que les deux autres
    // critères, eux, le refusaient.
    circule: (arete: GraphEdge) => boolean,
  ): PathStep[] | null {
    const candidats = [...dejaCalcules];

    // (3) Retirer tour à tour chaque ligne déjà empruntée.
    const lignesEmpruntees = new Set<string>();

    for (const chemin of dejaCalcules) {
      for (const etape of chemin) {
        if (
          etape.edge.mode !== ModeTransport.WALK &&
          etape.edge.lineId !== ''
        ) {
          lignesEmpruntees.add(etape.edge.lineId);
        }
      }
    }

    // ═══ Y A-T-IL SEULEMENT QUELQUE CHOSE À ARBITRER ? ═══
    //
    // ⚠️ AJOUTÉ APRÈS MESURE. Les variantes ci-dessous coûtent onze parcours
    // de graphe supplémentaires — quatre secondes et demie sur le réseau
    // francilien. Elles cherchent un trajet moins émetteur en retirant tour à
    // tour chaque ligne, puis chaque mode.
    //
    // Cette recherche a un sens quand les trajets de base DIFFÈRENT en
    // émissions. Elle n'en a aucun quand ils émettent déjà la même chose au
    // gramme près : le réseau est alors homogène sur ce trajet — même mode,
    // même distance à peu près — et retirer une ligne ne peut produire qu'un
    // détour équivalent ou pire.
    //
    // Mesuré sur Gare de Lyon → Gare du Nord : les trois candidats émettent
    // 21 g. On payait quatre secondes et demie pour confirmer qu'il n'y avait
    // rien à gagner.
    //
    // ⚠️ LE SEUIL N'EST PAS INVENTÉ. C'est LE GRAMME, déjà retenu plus bas
    // comme unité de comparaison — la précision des facteurs de la Base
    // Carbone de l'ADEME, et l'unité affichée à l'usager. Une différence
    // qu'on n'affiche pas ne vaut pas onze parcours de graphe.
    if (this.emissionsHomogenes(dejaCalcules, facteurs)) {
      return this.moinsEmetteurParmi(dejaCalcules, facteurs);
    }

    // Ordre déterministe : deux recherches identiques doivent explorer les
    // mêmes variantes dans le même ordre (règle 4C-2). Le `slice` s'applique
    // donc à un ensemble stable, et non au hasard d'un parcours de `Set`.
    let variantes = 0;

    for (const lineId of [...lignesEmpruntees].sort()) {
      if (variantes >= PLAFOND_VARIANTES) {
        break;
      }

      variantes++;

      const variante = this.plusRapide(
        graph,
        idsArrivee,
        (arete) => circule(arete) && arete.lineId !== lineId,
      );

      if (variante) {
        candidats.push(variante);
      }
    }

    // (4) Retirer tour à tour chaque mode qui émet quelque chose. Écarter la
    // marche ou le vélo n'aurait aucun sens : ils n'émettent rien, les
    // retirer ne peut qu'augmenter les émissions.
    const modesEmetteurs = new Set<ModeTransport>();

    for (const aretes of graph.values()) {
      for (const arete of aretes) {
        const facteur = facteurs.gPerKm[arete.mode];

        if (facteur !== undefined && facteur > 0) {
          modesEmetteurs.add(arete.mode);
        }
      }
    }

    for (const mode of [...modesEmetteurs].sort()) {
      const variante = this.plusRapide(
        graph,
        idsArrivee,
        (arete) => circule(arete) && arete.mode !== mode,
      );

      if (variante) {
        candidats.push(variante);
      }
    }

    return this.moinsEmetteurParmi(candidats, facteurs);
  }

  /**
   * Vrai si tous les candidats émettent la même chose, au gramme près.
   *
   * ⚠️ « AU GRAMME PRÈS », la même unité que la comparaison finale. Employer
   * une précision plus fine ici rendrait la garde inopérante : deux trajets
   * identiques au centième de gramme sont, pour l'usager, le même trajet.
   *
   * ⚠️ UN CANDIDAT NON MESURABLE FAIT ÉCHOUER LA GARDE. `co2Estime` rend `null`
   * quand un mode n'a pas de facteur ; on ne peut alors rien conclure sur
   * l'homogénéité, et l'exploration complète reprend ses droits.
   */
  private emissionsHomogenes(
    candidats: readonly PathStep[][],
    facteurs: CarbonFactorsDto,
  ): boolean {
    if (candidats.length < 2) {
      return false;
    }

    const grammes = candidats.map((chemin) => this.co2Estime(chemin, facteurs));

    if (grammes.some((valeur) => valeur === null)) {
      return false;
    }

    const arrondis = grammes.map((valeur) => Math.round(valeur as number));

    return new Set(arrondis).size === 1;
  }

  /**
   * Le moins émetteur d'un ensemble de chemins déjà calculés.
   *
   * Extrait de `moinsEmetteur` pour être réutilisé par la garde
   * d'homogénéité : sans cela, il aurait fallu recopier le départage — et deux
   * copies d'une même règle divergent au premier changement de l'une.
   */
  private moinsEmetteurParmi(
    candidats: readonly PathStep[][],
    facteurs: CarbonFactorsDto,
  ): PathStep[] | null {
    let meilleur: {
      chemin: PathStep[];
      co2: number;
      changements: number;
      duree: number;
    } | null = null;

    for (const chemin of candidats) {
      const brut = this.co2Estime(chemin, facteurs);

      if (brut === null) {
        continue;
      }

      // ═══ COMPARÉ AU GRAMME PRÈS, ET C'EST UNE CORRECTION ═══
      //
      // ⚠️ SANS CET ARRONDI, LE CRITÈRE CARBONE DEVIENT ABSURDE. Mesuré sur
      // le réseau réel :
      //
      //     Esplanade → Neuhof
      //     « le plus rapide »      1 changement,  3 min d'attente
      //     « le plus écologique »  6 changements, 26 min d'attente
      //                             …pour 0,11 gramme de moins.
      //
      // Vingt-trois minutes de la vie de quelqu'un contre un dixième de
      // gramme. Le classement était exact et la proposition indéfendable.
      //
      // ⚠️ CE N'EST PAS UN SEUIL INVENTÉ. Le gramme est la précision des
      // données SOURCES : les facteurs de la Base Carbone de l'ADEME sont
      // publiés en g/km, et c'est aussi l'unité affichée à l'usager.
      // Départager deux trajets sur une différence qu'on n'affiche pas
      // reviendrait à trancher sur du bruit de calcul.
      //
      // À l'échelle où le carbone compte vraiment — prendre le tram plutôt
      // que la voiture — l'écart se chiffre en centaines de grammes :
      // l'arrondi ne masque rien de ce que ce critère existe pour montrer.
      const co2 = Math.round(brut);

      const duree = chemin.reduce(
        (somme, etape) => somme + etape.edge.durationMin,
        0,
      );

      const changements = compterChangementsDuChemin(chemin);

      // ═══ À ÉMISSIONS ÉGALES : D'ABORD LES CORRESPONDANCES ═══
      //
      // ⚠️ L'ORDRE DES DEUX DÉPARTAGES A ÉTÉ INVERSÉ, et ce n'est pas un
      // détail de présentation. Départager d'abord sur la DURÉE DE PARCOURS
      // faisait ressortir, pour le même bilan carbone au gramme près :
      //
      //     21 minutes de parcours, SIX correspondances, 41 min d'attente
      //   plutôt que
      //     23 minutes de parcours, UNE correspondance,   8 min d'attente
      //
      // Deux minutes de parcours gagnées, une demi-heure perdue sur le quai.
      //
      // ⚠️ CE N'EST PAS UNE PÉNALITÉ INVENTÉE. Aucun coefficient ne convertit
      // une correspondance en minutes : c'est un ORDRE LEXICOGRAPHIQUE, et il
      // ne s'applique qu'À ÉMISSIONS ÉGALES — là où, par construction, le
      // critère carbone n'a plus rien à dire et doit rendre la main au
      // confort du voyageur.
      const estMeilleur =
        meilleur === null ||
        co2 < meilleur.co2 ||
        (co2 === meilleur.co2 &&
          (changements < meilleur.changements ||
            (changements === meilleur.changements && duree < meilleur.duree)));

      if (estMeilleur) {
        meilleur = { chemin, co2, changements, duree };
      }
    }

    return meilleur?.chemin ?? null;
  }

  /**
   * Émissions d'un chemin, en grammes, d'après la table du microservice.
   *
   * ⚠️ SERT UNIQUEMENT À CLASSER DES CANDIDATS ENTRE EUX. La valeur affichée
   * à l'usager, elle, vient toujours de `POST /calculate` — voir
   * `enrichirCarbone`. Le classement ici, l'autorité là.
   *
   * Rend `null` dès qu'un mode n'a pas de facteur : un chemin dont on ne sait
   * pas mesurer une partie ne peut pas entrer dans un classement, et surtout
   * ne doit pas y entrer avec un zéro.
   */
  private co2Estime(
    chemin: PathStep[],
    facteurs: CarbonFactorsDto,
  ): number | null {
    let total = 0;

    for (const etape of chemin) {
      const facteur = facteurs.gPerKm[etape.edge.mode];

      if (facteur === undefined) {
        return null;
      }

      total += facteur * (etape.edge.distanceM / 1000);
    }

    return total;
  }

  /**
   * Exécute un Dijkstra sur le graphe et rend un chemin nettoyé du sommet
   * virtuel de départ, ou `null`.
   */
  private executer(
    graph: Graph,
    idsArrivee: ReadonlySet<string>,
    utilisable: ((arete: GraphEdge) => boolean) | undefined,
    strategie: {
      coutDe: (arete: AreteGenerique<GraphEdge>, etat: string) => Cout;
      etatApres: (arete: AreteGenerique<GraphEdge>, etat: string) => string;
    },
  ): PathStep[] | null {
    const chemin = cheminOptimal<GraphEdge>({
      aretesDepuis: (sommet) => {
        const aretes = graph.get(sommet) ?? [];

        const retenues =
          utilisable === undefined ? aretes : aretes.filter(utilisable);

        return retenues.map((arete) => ({
          vers: arete.toStopId,
          donnee: arete,
        }));
      },
      coutDe: strategie.coutDe,
      etatApres: strategie.etatApres,
      depart: ORIGINE_VIRTUELLE,
      estArrivee: (sommet) => idsArrivee.has(sommet),
    });

    if (chemin === null) {
      return null;
    }

    // Sans ce nettoyage, l'itinéraire commencerait par un segment de zéro
    // mètre sur une ligne sans nom.
    const reel = chemin
      .filter((etape) => etape.depuis !== ORIGINE_VIRTUELLE)
      .map((etape) => ({ fromStopId: etape.depuis, edge: etape.arete.donnee }));

    return reel.length > 0 ? reel : null;
  }

  /**
   * Remplace les marches ESTIMÉES par de vrais trajets piétons.
   *
   * ═══ CE QUE CETTE PASSE CORRIGE ═══
   *
   * Une marche estimée est une DROITE : sur la carte elle traverse les
   * immeubles, et sa longueur est systématiquement inférieure au chemin réel.
   * Mesuré sur le trajet de démonstration : 240 m annoncés contre 327 m par
   * les rues.
   *
   * ═══ POURQUOI UNE PASSE SÉPARÉE, ET NON DANS `toItinerary` ═══
   *
   * `toItinerary` est SYNCHRONE et appelé dans une boucle, y compris pour des
   * chemins seulement évalués puis jetés. Y placer un appel réseau ferait
   * interroger le moteur pour des itinéraires que personne ne verra.
   *
   * C'est le même patron que `enrichirCarbone` et `enrichirHoraires`.
   *
   * ⚠️ APPELÉE AVANT `enrichirCarbone`. Le calcul carbone se fonde sur les
   * distances : les corriger APRÈS lui ferait annoncer une économie assise sur
   * des mètres qui ne sont plus les bons.
   *
   * ⚠️ UN SEUL APPEL PAR COUPLE DE POINTS. Trois itinéraires partagent
   * généralement la même marche d'approche ; sans cette mémoïsation, le même
   * trajet piéton serait demandé trois fois.
   *
   * ⚠️ NE LÈVE JAMAIS. Un moteur absent, lent ou en panne laisse simplement la
   * marche en `ESTIMATE` — et l'interface continue de l'annoncer comme telle.
   */
  private async enrichirMarche(itineraires: ItineraryDto[]): Promise<void> {
    if (!this.walkRouting.estConfigure()) {
      return;
    }

    const marches = itineraires.flatMap((itineraire) =>
      [itineraire.walkAccess, itineraire.walkEgress].filter(
        (marche): marche is ItineraryWalkLegDto => marche !== null,
      ),
    );

    if (marches.length === 0) {
      return;
    }

    const cle = (marche: ItineraryWalkLegDto) =>
      `${marche.fromLat},${marche.fromLon}->${marche.toLat},${marche.toLon}`;

    const demandes = new Map<string, Promise<RouteGeometrieDto | null>>();

    for (const marche of marches) {
      if (!demandes.has(cle(marche))) {
        demandes.set(
          cle(marche),
          this.walkRouting.itineraire(
            { latitude: marche.fromLat, longitude: marche.fromLon },
            { latitude: marche.toLat, longitude: marche.toLon },
          ),
        );
      }
    }

    // Parallèles : trois marches ne doivent pas coûter trois fois le délai.
    const traces = new Map<string, RouteGeometrieDto | null>(
      await Promise.all(
        [...demandes].map(
          async ([id, promesse]) =>
            [id, await promesse] as [string, RouteGeometrieDto | null],
        ),
      ),
    );

    for (const marche of marches) {
      const trace = traces.get(cle(marche));

      if (!trace) {
        continue;
      }

      // ⚠️ TOUT EST REMPLACÉ, pas seulement le tracé. Garder la distance à vol
      // d'oiseau à côté d'une géométrie de rues afficherait « 240 m » sous un
      // trait qui en fait manifestement 327.
      marche.distanceM = trace.distanceM;
      marche.durationMin = trace.durationMin;
      marche.geometry = trace.geometry;
      marche.source = 'ROUTED';
    }

    // Les totaux dépendent des marches : ils sont donc refaits ici.
    for (const itineraire of itineraires) {
      this.recalculerTotaux(itineraire);
    }
  }

  /**
   * Recalcule durée et distance totales depuis les tronçons et les marches.
   *
   * Source unique : dès qu'une marche change de longueur, les totaux affichés
   * doivent suivre — sans quoi l'écran additionne des étapes qui ne font pas
   * la somme annoncée.
   */
  private recalculerTotaux(itineraire: ItineraryDto): void {
    const marches = [itineraire.walkAccess, itineraire.walkEgress].filter(
      (marche): marche is ItineraryWalkLegDto => marche !== null,
    );

    itineraire.totalDistanceM =
      itineraire.segments.reduce((somme, s) => somme + s.distanceM, 0) +
      marches.reduce((somme, m) => somme + m.distanceM, 0);

    itineraire.totalDurationMin =
      itineraire.segments.reduce((somme, s) => somme + s.durationMin, 0) +
      marches.reduce((somme, m) => somme + m.durationMin, 0);
  }

  /**
   * Complète chaque itinéraire par son empreinte carbone.
   *
   * ⚠️ AUCUN ÉCHEC NE REMONTE. Un itinéraire dont l'empreinte n'a pas pu être
   * calculée reste un itinéraire valide : il porte `CARBON_UNAVAILABLE` et
   * des champs à `null`. C'est ce qui garantit qu'une panne du microservice
   * ne rend pas la recherche indisponible.
   *
   * Les appels sont PARALLÈLES : trois itinéraires ne doivent pas coûter
   * trois fois le délai d'un.
   */
  private async enrichirCarbone(
    itineraires: ItineraryDto[],
    facteurs: CarbonFactorsDto | null,
  ): Promise<void> {
    if (itineraires.length === 0) {
      return;
    }

    if (facteurs === null) {
      // Inutile d'appeler `/calculate` : `facteurs()` vient déjà d'échouer,
      // et son résultat est mis en cache. Trois appels supplémentaires
      // n'auraient fait qu'ajouter trois délais d'attente à la recherche.
      for (const itineraire of itineraires) {
        itineraire.carbon = indisponible(
          'Le calcul des émissions est momentanément indisponible.',
        );
      }

      return;
    }

    await Promise.all(
      itineraires.map(async (itineraire) => {
        try {
          // ⚠️ LA MARCHE DES DEUX BOUTS EN FAIT PARTIE. Elle n'émet rien, mais
          // elle compte dans la DISTANCE — et c'est cette distance qui sert de
          // référence à « ce que la voiture aurait émis ». L'omettre
          // sous-estimait l'économie annoncée à l'usager, sur le chiffre même
          // qui justifie le produit.
          const marches = [itineraire.walkAccess, itineraire.walkEgress].filter(
            (marche): marche is ItineraryWalkLegDto => marche !== null,
          );

          const resultat = await this.carbonService.calculate({
            segments: [
              ...itineraire.segments.map((segment) => ({
                mode: segment.mode,
                distanceM: segment.distanceM,
              })),
              ...marches.map((marche) => ({
                mode: ModeTransport.WALK,
                distanceM: marche.distanceM,
              })),
            ],
          });

          itineraire.carbon = {
            status: 'CARBON_AVAILABLE',
            co2Grams: resultat.totalCo2Grams,
            carCo2Grams: resultat.carCo2Grams,
            savedVsCarGrams: resultat.savedVsCarGrams,
            ecoScore: resultat.ecoScore,
            reason: null,
          };
        } catch (error) {
          this.logger.warn(
            `Empreinte carbone indisponible pour un itinéraire ${itineraire.criterion} : ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );

          itineraire.carbon = indisponible(
            'Le calcul des émissions est momentanément indisponible.',
          );
        }
      }),
    );
  }

  /**
   * Cadre géographique dans lequel chercher (bornage spatial).
   *
   * Le rectangle contenant l'origine et la destination, élargi de
   * `MARGE_CADRE_DEG`.
   *
   * ⚠️ LA MARGE EST UN COMPROMIS ASSUMÉ, pas une vérité. Un itinéraire
   * optimal peut légitimement sortir du rectangle direct — contourner la
   * Seine, passer par une gare de correspondance excentrée. Un détour
   * au-delà de la marge ne serait pas trouvé.
   */
  private cadreDeRecherche(dto: SearchRouteDto): {
    latitude: { gte: number; lte: number };
    longitude: { gte: number; lte: number };
  } {
    return {
      latitude: {
        gte: Math.min(dto.fromLat, dto.toLat) - MARGE_CADRE_DEG,
        lte: Math.max(dto.fromLat, dto.toLat) + MARGE_CADRE_DEG,
      },
      longitude: {
        gte: Math.min(dto.fromLon, dto.toLon) - MARGE_CADRE_DEG,
        lte: Math.max(dto.fromLon, dto.toLon) + MARGE_CADRE_DEG,
      },
    };
  }

  /**
   * Tous les quais rattachables à un point, du plus proche au plus éloigné.
   *
   * Un lieu comme « Gare de Lyon » compte cinq quais distincts en base ; n'en
   * retenir qu'un obligeait le moteur à payer des correspondances qu'un
   * voyageur ne ferait jamais — il entre directement par le quai qui
   * l'arrange.
   */
  private arretsProches(
    stops: Stop[],
    latitude: number,
    longitude: number,
  ): Stop[] {
    const candidats = stops
      .map((stop) => ({
        stop,
        distance: haversineDistanceM(
          latitude,
          longitude,
          stop.latitude,
          stop.longitude,
        ),
      }))
      .filter(({ distance }) => distance <= RAYON_RECHERCHE_MAX_M)
      // Départage par identifiant à distance égale : deux recherches
      // identiques doivent rendre le même résultat (déterminisme, 4C-2).
      .sort(
        (a, b) => a.distance - b.distance || a.stop.id.localeCompare(b.stop.id),
      );

    if (candidats.length === 0) {
      return [];
    }

    // Les quais du MÊME LIEU que le plus proche. On mesure depuis ce quai-là,
    // et non depuis le point demandé : une adresse peut être excentrée par
    // rapport à la station sans que ses quais cessent d'être voisins.
    const [plusProche] = candidats;

    const memeLieu = candidats.filter(
      ({ stop }) =>
        haversineDistanceM(
          plusProche.stop.latitude,
          plusProche.stop.longitude,
          stop.latitude,
          stop.longitude,
        ) <= RAYON_QUAIS_M,
    );

    return memeLieu.slice(0, PLAFOND_QUAIS).map(({ stop }) => stop);
  }

  /**
   * Relie le sommet virtuel de départ aux quais candidats, à coût nul.
   *
   * Les arêtes portent un mode `WALK` et une durée nulle : elles ne
   * représentent AUCUN déplacement réel, seulement le fait qu'entrer par
   * l'un ou l'autre quai revient au même. `executer` les retire avant que le
   * chemin ne devienne un itinéraire.
   *
   * ⚠️ `lineId` VIDE, et c'est significatif : c'est ce qui fait que monter
   * dans la première ligne ne compte pas comme un changement.
   */
  private brancherOrigineVirtuelle(graph: Graph, origines: Stop[]): void {
    graph.set(
      ORIGINE_VIRTUELLE,
      origines.map((stop) => ({
        toStopId: stop.id,
        mode: ModeTransport.WALK,
        lineName: '',
        operator: '',
        lineId: '',
        gtfsLineId: null,
        distanceM: 0,
        durationMin: 0,
        geometry: null,
      })),
    );
  }

  // Transforme les liaisons du réseau public en graphe orienté.
  //
  // Le graphe est ORIENTÉ : une liaison va de fromStop vers toStop et ne peut
  // pas être empruntée en sens inverse. C'est fidèle à la réalité (une ligne
  // de bus a un sens) — le trajet retour existe comme une liaison distincte.
  private buildGraph(
    links: {
      fromStopId: string;
      toStopId: string;
      distanceM: number;
      durationMin: number;
      // Depuis 4C-4-1, le mode vient de la ligne qui exploite le tronçon.
      line: {
        mode: ModeTransport;
        name: string;
        operator: string;
        gtfsRouteId: string | null;
      };
      // Clé étrangère brute de la liaison (étape 4E-3A).
      lineId: string;
      // Tracé réel, ou null quand le flux ne publie pas shapes.txt.
      geometry?: unknown;
    }[],
  ): Graph {
    const graph: Graph = new Map();

    for (const link of links) {
      const edges = graph.get(link.fromStopId) ?? [];
      edges.push({
        toStopId: link.toStopId,
        mode: link.line.mode,
        lineName: link.line.name,
        operator: link.line.operator,
        lineId: link.lineId,
        // ⚠️ `?? null` ET NON LA VALEUR BRUTE. Le contrat public promet
        // `string | null` ; un `undefined` qui passerait ferait DISPARAÎTRE
        // la clé à la sérialisation JSON, et le client verrait un champ
        // absent là où il attend `null`.
        gtfsLineId: link.line.gtfsRouteId ?? null,
        distanceM: link.distanceM,
        durationMin: link.durationMin,
        geometry: link.geometry ?? null,
      });
      graph.set(link.fromStopId, edges);
    }

    return graph;
  }

  /**
   * Une marche entre un point demandé et un arrêt.
   *
   * ⚠️ TOUJOURS `ESTIMATE`. Aucun routeur piéton n'est configuré : la distance
   * est à vol d'oiseau, donc MINORÉE, et le dire fait partie de la réponse.
   * Le jour où `WALK_ROUTING_PROVIDER` existera, c'est ici que le vrai tracé
   * entrera — le contrat public, lui, n'aura pas à changer.
   */
  private marcheVers(
    depuis: { lat: number; lon: number },
    vers: { lat: number; lon: number },
    stopName: string,
  ): ItineraryWalkLegDto {
    const distanceM = Math.round(
      haversineDistanceM(depuis.lat, depuis.lon, vers.lat, vers.lon),
    );

    return {
      fromLat: depuis.lat,
      fromLon: depuis.lon,
      toLat: vers.lat,
      toLon: vers.lon,
      stopName,
      distanceM,
      durationMin: minutesDeMarche(distanceM),
      source: 'ESTIMATE',
      // Aucun tracé : il n'existe que deux points. Le client dessinera la
      // droite qui les relie EN LA MARQUANT comme une estimation.
      geometry: null,
    };
  }

  /**
   * L'itinéraire entièrement à pied, quand le réseau n'apporte rien.
   *
   * ═══ CE QU'IL REMPLACE : UNE LISTE VIDE ═══
   *
   * Le moteur rendait `[]` — donc « aucun itinéraire » — dès que l'origine et
   * la destination se rattachaient aux mêmes quais. Mesuré : « 15 rue Adler »
   * → « 2 rue Mélanie », deux cents mètres, AUCUNE proposition. L'usager
   * lisait « nous ne savons pas vous y emmener » pour une rue à traverser.
   *
   * ⚠️ ET CE N'EST PAS UNE DONNÉE INVENTÉE. La distance est mesurée entre les
   * deux points que l'usager a lui-même désignés, et elle sort marquée
   * `ESTIMATE` — l'interface annonce « Marche — estimation », jamais un
   * itinéraire de rues.
   */
  /**
   * La seule réponse possible : y aller à pied — empreinte comprise.
   *
   * ⚠️ ELLE PASSE PAR `enrichirCarbone` COMME LES AUTRES. Un trajet à pied
   * émet zéro gramme, mais ce zéro doit venir du microservice, pas d'une
   * constante écrite ici : c'est lui qui détient les facteurs, et c'est lui
   * qui calcule l'économie face à la voiture — le chiffre qui donne tout son
   * sens à « allez-y à pied ».
   */
  private async seulementAPied(dto: SearchRouteDto): Promise<ItineraryDto[]> {
    const itineraires = [this.itineraireAPied(dto)];

    // ⚠️ LE TRAJET 100 % À PIED EN A LE PLUS BESOIN : c'est le seul dont la
    // TOTALITÉ du tracé serait une droite à travers les immeubles.
    await this.enrichirMarche(itineraires);
    await this.enrichirCarbone(
      itineraires,
      await this.carbonService.facteurs(),
    );

    return itineraires;
  }

  /**
   * La seule réponse quand l'usager demande le vélo : y aller à vélo.
   *
   * ⚠️ MÊME FORME QU'UN ITINÉRAIRE DE TRANSPORT — un `ItinerarySegmentDto` de
   * mode `BIKE` — et non un `walkAccess` détourné. Le vélo N'EST PAS de la
   * marche : il a sa propre vitesse, son propre facteur d'émission (zéro), et
   * son propre tracé. Le faire passer pour une marche fausserait le calcul
   * carbone et l'affichage.
   */
  private async seulementAVelo(dto: SearchRouteDto): Promise<ItineraryDto[]> {
    const itineraires = [this.itineraireAVelo(dto)];

    await this.enrichirVelo(itineraires);
    await this.enrichirCarbone(
      itineraires,
      await this.carbonService.facteurs(),
    );

    return itineraires;
  }

  /**
   * Squelette d'un trajet vélo : un seul segment, du départ à la destination.
   *
   * Distance et durée sont d'abord ESTIMÉES (vol d'oiseau, 15 km/h), puis
   * remplacées par les valeurs du moteur dans `enrichirVelo`. Le
   * `geometrySource: 'STRAIGHT'` initial dit franchement « pas encore de
   * tracé » ; il devient `'ROUTED'` quand Valhalla a répondu.
   */
  private itineraireAVelo(dto: SearchRouteDto): ItineraryDto {
    const distanceM = Math.round(
      haversineDistanceM(dto.fromLat, dto.fromLon, dto.toLat, dto.toLon),
    );

    const segment: ItinerarySegmentDto = {
      // Identifiants synthétiques : les deux bouts sont des POINTS DEMANDÉS,
      // pas des arrêts. Ils ne sont jamais renvoyés au serveur pour un
      // enregistrement — un trajet vélo ne s'enregistre pas via des liaisons.
      fromStopId: '__velo_origine__',
      fromStopName: 'Départ',
      fromStopLat: dto.fromLat,
      fromStopLon: dto.fromLon,
      toStopId: '__velo_destination__',
      toStopName: 'Destination',
      toStopLat: dto.toLat,
      toStopLon: dto.toLon,
      mode: 'BIKE',
      lineName: '',
      operator: '',
      lineId: '__velo__',
      gtfsLineId: null,
      distanceM,
      // ~15 km/h à vélo urbain — remplacé par la durée du moteur.
      durationMin: Math.max(1, Math.round(distanceM / METRES_PAR_MINUTE_VELO)),
      geometry: null,
      geometrySource: 'STRAIGHT',
    };

    return {
      criterion: 'FASTEST',
      totalDistanceM: distanceM,
      totalDurationMin: segment.durationMin,
      numberOfTransfers: 0,
      carbon: indisponible('Empreinte non encore calculée.'),
      walkAccess: null,
      walkEgress: null,
      segments: [segment],
    };
  }

  /**
   * Remplace le segment vélo par le vrai tracé du moteur, quand il répond.
   *
   * ⚠️ MÊME CONTRAT QUE `enrichirMarche` : ne lève jamais. Si le routeur vélo
   * est absent ou en panne, le segment garde son estimation et son
   * `geometrySource: 'STRAIGHT'` — l'interface trace alors une droite EN
   * POINTILLÉS et le dit.
   */
  private async enrichirVelo(itineraires: ItineraryDto[]): Promise<void> {
    if (!this.bikeRouting.estConfigure()) {
      return;
    }

    for (const itineraire of itineraires) {
      const segment = itineraire.segments[0];

      if (!segment || segment.mode !== 'BIKE') {
        continue;
      }

      const trace = await this.bikeRouting.itineraire(
        { latitude: segment.fromStopLat, longitude: segment.fromStopLon },
        { latitude: segment.toStopLat, longitude: segment.toStopLon },
      );

      if (!trace) {
        continue;
      }

      segment.distanceM = trace.distanceM;
      segment.durationMin = trace.durationMin;
      segment.geometry = trace.geometry;
      segment.geometrySource = 'ROUTED';

      this.recalculerTotaux(itineraire);
    }
  }

  private itineraireAPied(dto: SearchRouteDto): ItineraryDto {
    const marche = this.marcheVers(
      { lat: dto.fromLat, lon: dto.fromLon },
      { lat: dto.toLat, lon: dto.toLon },
      // Aucun des deux bouts n'est un arrêt : c'est une marche de bout en bout.
      '',
    );

    return {
      criterion: 'FASTEST',
      totalDistanceM: marche.distanceM,
      totalDurationMin: marche.durationMin,
      // Marcher n'est pas changer de ligne.
      numberOfTransfers: 0,
      carbon: indisponible('Empreinte non encore calculée.'),
      walkAccess: marche,
      walkEgress: null,
      // ⚠️ VIDE, ET C'EST LE RÉSULTAT. Aucun véhicule n'est emprunté.
      segments: [],
    };
  }

  // Met en forme le chemin brut pour la réponse HTTP.
  private toItinerary(
    criterion: ItineraryCriterion,
    steps: PathStep[],
    stopsById: Map<string, Stop>,
    /**
     * Les points que l'usager a demandés, pour chiffrer la marche d'approche
     * et la marche finale.
     *
     * FACULTATIF : les chemins évalués en interne (`plusRapideReellement`) ne
     * s'en servent pas — ils ne comparent que la partie réseau, identique aux
     * deux bouts. Les inclure là fausserait la comparaison sans rien apporter.
     */
    points?: SearchRouteDto,
  ): ItineraryDto {
    const segments: ItinerarySegmentDto[] = steps.map((step) => {
      const depuis = stopsById.get(step.fromStopId);
      const vers = stopsById.get(step.edge.toStopId);

      return {
        fromStopId: step.fromStopId,
        fromStopName: depuis?.name ?? '',
        // Les coordonnées voyagent avec le segment (Phase 4) : sans elles, la
        // carte devrait redemander chaque arrêt un par un pour tracer la
        // moindre ligne.
        fromStopLat: depuis?.latitude ?? 0,
        fromStopLon: depuis?.longitude ?? 0,
        toStopId: step.edge.toStopId,
        toStopName: vers?.name ?? '',
        toStopLat: vers?.latitude ?? 0,
        toStopLon: vers?.longitude ?? 0,
        mode: step.edge.mode,
        // Transmis TELS QUELS depuis TransitLine : aucune valeur par défaut,
        // aucun repli, aucun traitement particulier selon le mode.
        lineName: step.edge.lineName,
        operator: step.edge.operator,
        lineId: step.edge.lineId,
        gtfsLineId: step.edge.gtfsLineId,
        distanceM: step.edge.distanceM,
        durationMin: step.edge.durationMin,
        geometry: step.edge.geometry ?? null,
        // L'interface ne doit pas pouvoir confondre un tracé réel avec une
        // droite tracée faute de mieux.
        geometrySource:
          step.edge.geometry === null || step.edge.geometry === undefined
            ? 'STRAIGHT'
            : 'SHAPE',
      };
    });

    // ═══ LA MARCHE DES DEUX BOUTS ═══
    //
    // ⚠️ SANS ELLE, LA DURÉE ANNONCÉE EST FAUSSE, pas approximative. Mesuré :
    // « 15 rue Adler » → « Place Kléber » s'affichait « 15 min, 3 994 m » et
    // commençait à l'arrêt Jardiniers — en taisant les 500 m à pied pour
    // l'atteindre et les 200 m de sortie. Vingt minutes de trajet réel
    // annoncées quinze, et un premier arrêt qui tombait du ciel.
    const premier = segments[0];
    const dernier = segments[segments.length - 1];

    const walkAccess =
      points && premier
        ? this.marcheVers(
            { lat: points.fromLat, lon: points.fromLon },
            { lat: premier.fromStopLat, lon: premier.fromStopLon },
            premier.fromStopName,
          )
        : null;

    const walkEgress =
      points && dernier
        ? this.marcheVers(
            { lat: dernier.toStopLat, lon: dernier.toStopLon },
            { lat: points.toLat, lon: points.toLon },
            dernier.toStopName,
          )
        : null;

    const marches = [walkAccess, walkEgress].filter(
      (marche): marche is ItineraryWalkLegDto => marche !== null,
    );

    return {
      criterion,
      totalDistanceM:
        segments.reduce((sum, s) => sum + s.distanceM, 0) +
        marches.reduce((sum, m) => sum + m.distanceM, 0),
      totalDurationMin:
        segments.reduce((sum, s) => sum + s.durationMin, 0) +
        marches.reduce((sum, m) => sum + m.durationMin, 0),
      // ⚠️ INCHANGÉ : marcher jusqu'à un quai n'est pas une correspondance.
      numberOfTransfers: compterChangements(segments),
      // Remplacé par `enrichirCarbone`. L'initialiser à « indisponible »
      // plutôt qu'à `null` garantit qu'aucun chemin de code ne peut rendre un
      // itinéraire dépourvu de champ carbone.
      carbon: indisponible('Empreinte non encore calculée.'),
      walkAccess,
      walkEgress,
      segments,
    };
  }

  // Identité d'un itinéraire : la suite des arrêts empruntés et des modes.
  // Sert uniquement à repérer deux itinéraires identiques.
  private signature(itinerary: ItineraryDto): string {
    // ⚠️ LA LIGNE FAIT PARTIE DE L'IDENTITÉ DU TRAJET. Sans elle, deux
    // itinéraires empruntant les MÊMES arrêts par DEUX LIGNES DIFFÉRENTES —
    // le cas du tram B et du tram F entre Homme de Fer et Broglie — étaient
    // tenus pour identiques, et le second disparaissait. On supprimait ainsi
    // une alternative réelle, ce qui est l'exact opposé du but.
    //
    // ⚠️ `lineId ?? ''` ET NON `lineId!` : les segments de marche n'ont pas de
    // ligne, et c'est légitime.
    return itinerary.segments
      .map((s) => `${s.fromStopId}>${s.toStopId}:${s.mode}:${s.lineId ?? ''}`)
      .join('|');
  }
}
