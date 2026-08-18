import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ModeTransport } from '@prisma/client';
import { CalculateCarbonDto } from './dto/calculate-carbon.dto';
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
  breakdown: {
    mode: ModeTransport;
    distance_m: number;
    co2_g: number;
  }[];
}

/// Valeur de repli, identique à celle du `.env.example` de la racine.
const URL_PAR_DEFAUT = 'http://localhost:8000';

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
      breakdown: reponse.breakdown.map((detail): CarbonBreakdownItemDto => ({
        mode: detail.mode,
        distanceM: detail.distance_m,
        co2Grams: detail.co2_g,
      })),
    };
  }
}
