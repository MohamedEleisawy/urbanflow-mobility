import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ModeTransport } from '@prisma/client';
import { CalculateCarbonDto } from './dto/calculate-carbon.dto';
import { CarbonFactorsDto } from './dto/carbon-factors.dto';
import {
  CarbonBreakdownItemDto,
  CarbonResultDto,
} from './dto/carbon-result.dto';

/**
 * Forme EXACTE de la réponse du microservice FastAPI (snake_case).
 *
 * Ce type ne sort jamais du service : il décrit un contrat INTERNE, entre
 * NestJS et FastAPI. Le contrat PUBLIC, lui, est `CarbonResultDto`.
 */
interface ReponseCalculFastApi {
  total_distance_m: number;
  total_co2_g: number;
  car_co2_g: number;
  saved_g: number;
  eco_score: number;
  breakdown: {
    mode: ModeTransport;
    distance_m: number;
    co2_g: number;
  }[];
}

/**
 * Forme EXACTE de la réponse de `GET /factors` (snake_case).
 *
 * Interne au service, comme `ReponseCalculFastApi` : le contrat public est
 * `CarbonFactorsDto`.
 */
interface ReponseFacteursFastApi {
  factors: Record<string, number>;
  car_factor_g_per_km: number;
}

/// Valeur de repli, identique à celle du `.env.example` de la racine.
const URL_PAR_DEFAUT = 'http://localhost:8000';

/**
 * Durée de vie du cache des facteurs d'émission.
 *
 * ⚠️ COURTE ET BORNÉE, jamais infinie. Les facteurs ne changent qu'au
 * déploiement du microservice ; une minute suffit donc largement à absorber
 * la rafale d'appels d'une session de recherche, tout en garantissant qu'un
 * facteur corrigé sera pris en compte sans redémarrer le backend.
 *
 * Un cache sans expiration figerait une valeur ADEME périmée pour la durée de
 * vie du processus — soit, en production, indéfiniment.
 */
const DUREE_CACHE_FACTEURS_MS = 60_000;

/// Message PUBLIC unique : il ne révèle ni l'adresse interne du
/// microservice, ni la nature exacte de la panne.
const MESSAGE_INDISPONIBLE = 'Service de calcul carbone indisponible';

/**
 * Proxy vers le microservice de calcul carbone (étape 4D-2).
 *
 * Ce service ne calcule RIEN lui-même et n'écrit RIEN en base. Il fait
 * quatre choses, et uniquement celles-là :
 *
 *   1. traduire la requête publique (camelCase) vers FastAPI (snake_case) ;
 *   2. appeler FastAPI, avec un délai maximal ;
 *   3. vérifier la réponse et traduire les pannes en statuts HTTP ;
 *   4. traduire la réponse FastAPI vers le contrat public.
 *
 * POURQUOI UN PROXY, ET NON UN APPEL DIRECT DEPUIS LE FRONTEND ?
 * Parce que le microservice ne doit pas être exposé publiquement : il n'a ni
 * authentification, ni limitation de débit, ni CORS. Le frontend ne connaît
 * qu'une seule origine, le backend NestJS, qui reste le point d'entrée
 * unique où poser plus tard ces contrôles.
 */
@Injectable()
export class CarbonService {
  private readonly logger = new Logger(CarbonService.name);

  /**
   * Un calcul arithmétique qui dépasse plusieurs secondes est anormal : à ce
   * stade, le microservice est bien plus probablement injoignable que lent.
   * Sans ce délai, une requête pendante bloquerait un client indéfiniment.
   */
  private readonly DELAI_MS = 5_000;

  private readonly baseUrl: string;

  /**
   * Dernière lecture de `GET /factors`, valable jusqu'à `expireA`.
   *
   * `valeur: null` mémorise un ÉCHEC — voir `facteurs()`.
   */
  private cacheFacteurs: {
    valeur: CarbonFactorsDto | null;
    expireA: number;
  } | null = null;

  constructor() {
    const configuree = process.env.CARBON_SERVICE_URL;

    if (!configuree) {
      // Avertissement et non erreur fatale : contrairement à JWT_SECRET
      // (voir auth.module.ts), une adresse manquante n'est pas un trou de
      // sécurité. Faire échouer le démarrage priverait toute l'API — la
      // recherche d'itinéraire, l'authentification, les usagers — à cause
      // d'un seul endpoint public et facultatif.
      this.logger.warn(
        `CARBON_SERVICE_URL absente : repli sur ${URL_PAR_DEFAUT}. ` +
          'Définissez-la (voir projet/backend/.env.example) en production.',
      );
    }

    // Un « / » final donnerait « http://hote:8000//calculate ».
    this.baseUrl = (configuree ?? URL_PAR_DEFAUT).replace(/\/+$/, '');
  }

  async calculate(dto: CalculateCarbonDto): Promise<CarbonResultDto> {
    const reponse = await this.envoyer(dto);

    // 422 : FastAPI a compris la requête mais refuse de la calculer. Le seul
    // cas possible aujourd'hui est le mode ESCOOTER, reconnu par l'enum
    // Prisma mais dépourvu de facteur d'émission. Ce n'est PAS une panne :
    // le refus est légitime et son motif doit remonter jusqu'au client.
    if (reponse.status === 422) {
      throw new UnprocessableEntityException(await this.motifDuRefus(reponse));
    }

    // Tout autre statut anormal (500, 404 sur une mauvaise URL...) traduit un
    // problème dont l'usager n'est pas responsable et ne peut rien faire.
    if (!reponse.ok) {
      this.logger.error(
        `Microservice carbone : réponse inattendue HTTP ${reponse.status}`,
      );
      throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    }

    return this.versContratPublic(await this.lireCorps(reponse));
  }

  // ---------------------------------------------------------------------------
  // Facteurs d'émission (Phase 4)
  // ---------------------------------------------------------------------------

  /**
   * Table des facteurs d'émission, telle que publiée par le microservice.
   *
   * ═══ NE LÈVE JAMAIS, ET C'EST LE POINT ESSENTIEL ═══
   *
   * `calculate()` lève un 503 quand le microservice est en panne : c'est
   * correct, car l'usager a explicitement demandé un calcul carbone.
   *
   * Ici, non. Cette méthode sert la RECHERCHE D'ITINÉRAIRES, et l'étape 4D-2
   * a posé une règle que rien ne doit défaire : « une panne du calcul carbone
   * ne doit pas rendre la recherche d'itinéraire indisponible ». Une panne
   * rend donc `null`, l'appelant retire l'alternative écologique de sa
   * réponse et le dit à l'usager. Il ne se rabat JAMAIS sur des facteurs de
   * secours écrits en dur : ce serait à la fois une seconde source de vérité
   * et un chiffre inventé.
   *
   * Le résultat est mis en cache pour `DUREE_CACHE_FACTEURS_MS` : une
   * recherche d'itinéraire évalue plusieurs candidats, et aucun ne mérite son
   * propre aller-retour HTTP.
   */
  async facteurs(): Promise<CarbonFactorsDto | null> {
    const maintenant = Date.now();

    if (this.cacheFacteurs && maintenant < this.cacheFacteurs.expireA) {
      return this.cacheFacteurs.valeur;
    }

    const valeur = await this.lireFacteurs();

    // ⚠️ L'ÉCHEC EST MIS EN CACHE LUI AUSSI (`null` est une valeur, pas une
    // absence). Sans cela, un microservice éteint serait re-sollicité à
    // chaque candidat de chaque recherche, chacun payant le délai complet de
    // 5 secondes : la panne du service carbone deviendrait une panne de la
    // recherche, précisément ce que cette méthode existe pour éviter.
    this.cacheFacteurs = {
      valeur,
      expireA: maintenant + DUREE_CACHE_FACTEURS_MS,
    };

    return valeur;
  }

  private async lireFacteurs(): Promise<CarbonFactorsDto | null> {
    const url = `${this.baseUrl}/factors`;

    try {
      const reponse = await fetch(url, {
        signal: AbortSignal.timeout(this.DELAI_MS),
      });

      if (!reponse.ok) {
        this.logger.warn(
          `Facteurs d'émission indisponibles : HTTP ${reponse.status}`,
        );
        return null;
      }

      const corps: unknown = await reponse.json();

      if (!this.estReponseFacteurs(corps)) {
        this.logger.warn(
          "Facteurs d'émission : réponse de forme inattendue, ignorée",
        );
        return null;
      }

      return this.versFacteursPublics(corps);
    } catch (error) {
      this.logger.warn(
        `Facteurs d'émission injoignables (${url}) : ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private estReponseFacteurs(corps: unknown): corps is ReponseFacteursFastApi {
    if (typeof corps !== 'object' || corps === null) {
      return false;
    }

    const champs = corps as Record<string, unknown>;

    if (typeof champs.car_factor_g_per_km !== 'number') {
      return false;
    }

    const table = champs.factors;

    if (typeof table !== 'object' || table === null || Array.isArray(table)) {
      return false;
    }

    // Une valeur non numérique dans la table invaliderait un classement par
    // émissions sans jamais lever d'erreur : on refuse la table entière.
    return Object.values(table as Record<string, unknown>).every(
      (facteur) => typeof facteur === 'number' && Number.isFinite(facteur),
    );
  }

  /**
   * Traduit la table FastAPI vers l'enum Prisma.
   *
   * ⚠️ LES MODES INCONNUS DE NOTRE ENUM SONT ÉCARTÉS EN SILENCE, et c'est
   * volontaire : le jour où le microservice publierait un `FERRY`, notre
   * `ModeTransport` ne le connaîtrait pas, et le laisser entrer produirait
   * une clé qui ne correspond à aucun mode du réseau. Aucune information
   * n'est perdue — aucun de nos itinéraires ne peut emprunter ce mode.
   */
  private versFacteursPublics(
    reponse: ReponseFacteursFastApi,
  ): CarbonFactorsDto {
    const modesConnus = new Set<string>(Object.values(ModeTransport));
    const gPerKm: Partial<Record<ModeTransport, number>> = {};

    for (const [mode, facteur] of Object.entries(reponse.factors)) {
      if (modesConnus.has(mode)) {
        gPerKm[mode as ModeTransport] = facteur;
      }
    }

    return { gPerKm, carGPerKm: reponse.car_factor_g_per_km };
  }

  // ---------------------------------------------------------------------------
  // Appel réseau
  // ---------------------------------------------------------------------------
  private async envoyer(dto: CalculateCarbonDto): Promise<Response> {
    const url = `${this.baseUrl}/calculate`;

    try {
      // fetch est natif depuis Node 18 : aucune dépendance HTTP nécessaire,
      // comme pour le téléchargement GTFS (voir GtfsSourceService).
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: dto.segments.map((segment) => ({
            mode: segment.mode,
            distance_m: segment.distanceM,
          })),
        }),
        signal: AbortSignal.timeout(this.DELAI_MS),
      });
    } catch (error) {
      // Connexion refusée, DNS introuvable, coupure réseau ou dépassement du
      // délai : quatre causes différentes, une seule conséquence pour
      // l'usager. Le motif exact est journalisé, jamais renvoyé.
      this.logger.error(
        `Microservice carbone injoignable (${url}) : ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    }
  }

  // ---------------------------------------------------------------------------
  // Lecture de la réponse
  // ---------------------------------------------------------------------------
  private async lireCorps(reponse: Response): Promise<ReponseCalculFastApi> {
    let corps: unknown;

    try {
      corps = await reponse.json();
    } catch {
      this.logger.error(
        'Microservice carbone : réponse illisible (JSON invalide)',
      );
      throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    }

    // Un 200 ne garantit pas la forme du corps. Sans cette vérification, un
    // champ manquant deviendrait `undefined` dans la réponse publique, et
    // l'usager lirait une empreinte carbone vide au lieu d'une erreur.
    if (!this.estReponseAttendue(corps)) {
      this.logger.error(
        `Microservice carbone : réponse de forme inattendue — ${JSON.stringify(corps)}`,
      );
      throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    }

    return corps;
  }

  private estReponseAttendue(corps: unknown): corps is ReponseCalculFastApi {
    if (typeof corps !== 'object' || corps === null) {
      return false;
    }

    const champs = corps as Record<string, unknown>;

    return (
      typeof champs.total_distance_m === 'number' &&
      typeof champs.total_co2_g === 'number' &&
      typeof champs.car_co2_g === 'number' &&
      typeof champs.saved_g === 'number' &&
      // Ajouté à l'étape 4D-3-2. Sans cette ligne, un microservice trop
      // ancien renverrait un 200 sans score, et l'API publique répondrait
      // `"ecoScore": undefined` — donc, une fois sérialisée, un champ
      // silencieusement ABSENT. Mieux vaut un 503 franc.
      typeof champs.eco_score === 'number' &&
      Array.isArray(champs.breakdown)
    );
  }

  /**
   * Extrait le motif d'un refus FastAPI pour le transmettre au client.
   *
   * FastAPI répond `{"detail": [{"loc": [...], "msg": "..."}]}` pour une
   * erreur de validation, et `{"detail": "..."}` pour un refus simple. Les
   * deux formes sont traitées ; toute autre donne un message générique,
   * plutôt que de transformer un refus légitime en erreur 500.
   */
  private async motifDuRefus(reponse: Response): Promise<string> {
    try {
      const corps: unknown = await reponse.json();
      const detail = (corps as { detail?: unknown }).detail;

      if (typeof detail === 'string' && detail.length > 0) {
        return detail;
      }

      if (Array.isArray(detail)) {
        const messages = detail
          .map((erreur) => (erreur as { msg?: unknown }).msg)
          .filter((message): message is string => typeof message === 'string')
          // Pydantic préfixe ses messages par « Value error, » : du bruit
          // technique qui n'apprend rien à l'usager.
          .map((message) => message.replace(/^Value error, /, ''));

        if (messages.length > 0) {
          return messages.join(' ; ');
        }
      }
    } catch {
      // Corps illisible : on garde le 422, mais sans détail.
    }

    return 'Calcul carbone refusé par le service de calcul';
  }

  // ---------------------------------------------------------------------------
  // Traduction snake_case → camelCase
  // ---------------------------------------------------------------------------
  /**
   * LE SEUL endroit où les noms de champs FastAPI sont connus.
   *
   * Si le microservice renommait un champ demain, ce serait la seule méthode
   * à corriger — ni le contrôleur, ni les DTOs, ni les tests E2E.
   */
  private versContratPublic(reponse: ReponseCalculFastApi): CarbonResultDto {
    return {
      totalDistanceM: reponse.total_distance_m,
      totalCo2Grams: reponse.total_co2_g,
      carCo2Grams: reponse.car_co2_g,
      savedVsCarGrams: reponse.saved_g,
      // Le score est TRANSMIS, jamais recalculé : le refaire ici créerait une
      // seconde implémentation de la même formule, qui divergerait le jour où
      // l'une des deux changerait. Le microservice détient les facteurs, donc
      // il détient le score.
      ecoScore: reponse.eco_score,
      breakdown: reponse.breakdown.map((detail): CarbonBreakdownItemDto => ({
        mode: detail.mode,
        distanceM: detail.distance_m,
        co2Grams: detail.co2_g,
      })),
    };
  }
}
