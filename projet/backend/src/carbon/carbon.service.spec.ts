import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { ModeTransport } from '@prisma/client';
import { CarbonService } from './carbon.service';
import { CalculateCarbonDto } from './dto/calculate-carbon.dto';

// Les avertissements et erreurs journalisés par le service sont volontaires :
// on les fait taire pour garder la sortie des tests lisible.
beforeAll(() => {
  Logger.overrideLogger(false);
});

// AUCUN test ne démarre le microservice FastAPI ni ne touche au réseau :
// fetch, global depuis Node 18, est remplacé dans chaque cas.
const URL_TEST = 'http://microservice-carbone:8000';

// Réponse type du microservice, telle que mesurée à l'étape 4D-1 pour
// 600 m à pied puis 3200 m en bus. eco_score est venu s'y ajouter en 4D-3-1
// (466,8 / 828,4 = 0,5635...).
const REPONSE_FASTAPI = {
  total_distance_m: 3800,
  total_co2_g: 361.6,
  car_co2_g: 828.4,
  saved_g: 466.8,
  eco_score: 56.3,
  breakdown: [
    { mode: 'WALK', distance_m: 600, co2_g: 0.0 },
    { mode: 'BUS', distance_m: 3200, co2_g: 361.6 },
  ],
};

// On construit une vraie Response (globale depuis Node 18) plutôt qu'un
// objet factice : le service utilise .ok, .status et .json(), et un faux
// approximatif pourrait masquer une erreur d'usage de l'API fetch.
const reponse = (corps: unknown, status = 200): Response =>
  new Response(JSON.stringify(corps), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const mockerFetch = (implementation: () => Promise<Response>) =>
  jest.spyOn(global, 'fetch').mockImplementation(implementation);

// Corps d'entrée valide, au format PUBLIC (camelCase).
const dtoValide = (): CalculateCarbonDto => ({
  segments: [
    { mode: ModeTransport.WALK, distanceM: 600 },
    { mode: ModeTransport.BUS, distanceM: 3200 },
  ],
});

describe('CarbonService', () => {
  let service: CarbonService;
  const environnementInitial = process.env.CARBON_SERVICE_URL;

  beforeEach(() => {
    process.env.CARBON_SERVICE_URL = URL_TEST;
    service = new CarbonService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.CARBON_SERVICE_URL = environnementInitial;
  });

  // ---------------------------------------------------------------------------
  // Appel du microservice
  // ---------------------------------------------------------------------------
  describe('appel du microservice', () => {
    it('appelle FastAPI une seule fois, en POST et en JSON', async () => {
      const appel = mockerFetch(() =>
        Promise.resolve(reponse(REPONSE_FASTAPI)),
      );

      await service.calculate(dtoValide());

      expect(appel).toHaveBeenCalledTimes(1);
      const options = appel.mock.calls[0][1];
      expect(options?.method).toBe('POST');
      expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('appelle exactement CARBON_SERVICE_URL + /calculate', async () => {
      const appel = mockerFetch(() =>
        Promise.resolve(reponse(REPONSE_FASTAPI)),
      );

      await service.calculate(dtoValide());

      expect(appel.mock.calls[0][0]).toBe(`${URL_TEST}/calculate`);
    });

    it("supprime le « / » final de l'adresse configurée", async () => {
      // Sans cette normalisation, l'URL contiendrait « //calculate » — que
      // certains serveurs traitent comme une route différente.
      process.env.CARBON_SERVICE_URL = `${URL_TEST}/`;
      const appel = mockerFetch(() =>
        Promise.resolve(reponse(REPONSE_FASTAPI)),
      );

      await new CarbonService().calculate(dtoValide());

      expect(appel.mock.calls[0][0]).toBe(`${URL_TEST}/calculate`);
    });

    it('se replie sur localhost:8000 si la variable est absente', async () => {
      delete process.env.CARBON_SERVICE_URL;
      const appel = mockerFetch(() =>
        Promise.resolve(reponse(REPONSE_FASTAPI)),
      );

      await new CarbonService().calculate(dtoValide());

      expect(appel.mock.calls[0][0]).toBe('http://localhost:8000/calculate');
    });

    it('traduit le corps en snake_case pour FastAPI', async () => {
      const appel = mockerFetch(() =>
        Promise.resolve(reponse(REPONSE_FASTAPI)),
      );

      await service.calculate(dtoValide());

      const corps: unknown = JSON.parse(appel.mock.calls[0][1]?.body as string);
      // distanceM (public) devient distance_m (FastAPI). L'ordre des
      // segments est conservé : il détermine le breakdown renvoyé.
      expect(corps).toEqual({
        segments: [
          { mode: 'WALK', distance_m: 600 },
          { mode: 'BUS', distance_m: 3200 },
        ],
      });
    });

    it("n'envoie AUCUN champ camelCase au microservice", async () => {
      const appel = mockerFetch(() =>
        Promise.resolve(reponse(REPONSE_FASTAPI)),
      );

      await service.calculate(dtoValide());

      expect(appel.mock.calls[0][1]?.body as string).not.toContain('distanceM');
    });

    it('impose un délai maximal à la requête', async () => {
      const appel = mockerFetch(() =>
        Promise.resolve(reponse(REPONSE_FASTAPI)),
      );

      await service.calculate(dtoValide());

      // Sans signal, une requête pendante bloquerait le client indéfiniment.
      expect(appel.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ---------------------------------------------------------------------------
  // Traduction de la réponse
  // ---------------------------------------------------------------------------
  describe('traduction snake_case → camelCase', () => {
    it('renvoie le contrat public attendu', async () => {
      mockerFetch(() => Promise.resolve(reponse(REPONSE_FASTAPI)));

      const resultat = await service.calculate(dtoValide());

      expect(resultat).toEqual({
        totalDistanceM: 3800,
        totalCo2Grams: 361.6,
        carCo2Grams: 828.4,
        savedVsCarGrams: 466.8,
        ecoScore: 56.3,
        breakdown: [
          { mode: 'WALK', distanceM: 600, co2Grams: 0 },
          { mode: 'BUS', distanceM: 3200, co2Grams: 361.6 },
        ],
      });
    });

    it('ne laisse fuiter aucun nom de champ snake_case', async () => {
      mockerFetch(() => Promise.resolve(reponse(REPONSE_FASTAPI)));

      const resultat = await service.calculate(dtoValide());

      // Le contrat public ne doit rien laisser deviner du contrat interne.
      expect(JSON.stringify(resultat)).not.toMatch(/_g|_m\b|total_|saved_/);
    });

    it('conserve les décimales sans les altérer', async () => {
      // Le proxy ne doit ni arrondir, ni tronquer : l'arrondi appartient à
      // FastAPI (étape 4D-1), qui est le seul à savoir ce qu'il calcule.
      mockerFetch(() =>
        Promise.resolve(
          reponse({
            ...REPONSE_FASTAPI,
            total_co2_g: 112.89,
            saved_g: 466.79,
          }),
        ),
      );

      const resultat = await service.calculate(dtoValide());

      expect(resultat.totalCo2Grams).toBe(112.89);
      expect(resultat.savedVsCarGrams).toBe(466.79);
    });

    it('traduit eco_score en ecoScore sans toucher à la valeur', async () => {
      mockerFetch(() => Promise.resolve(reponse(REPONSE_FASTAPI)));

      const resultat = await service.calculate(dtoValide());

      expect(resultat.ecoScore).toBe(56.3);
    });

    it.each<[string, number]>([
      ['un trajet sans émission', 100.0],
      ['un trajet en voiture', 0.0],
      ['un trajet en tram', 98.2],
      ['une distance nulle', 100.0],
    ])('conserve le score de %s : %p', async (_cas, score) => {
      // Le proxy ne doit ni arrondir, ni borner, ni réinterpréter : les
      // bornes 0 et 100 comme la décimale appartiennent au microservice.
      mockerFetch(() =>
        Promise.resolve(reponse({ ...REPONSE_FASTAPI, eco_score: score })),
      );

      const resultat = await service.calculate(dtoValide());

      expect(resultat.ecoScore).toBe(score);
    });

    it('envoie snake_case à FastAPI et renvoie camelCase au client', async () => {
      const appel = mockerFetch(() =>
        Promise.resolve(reponse(REPONSE_FASTAPI)),
      );

      const resultat = await service.calculate(dtoValide());

      // Les deux conventions coexistent, de part et d'autre du proxy.
      expect(JSON.stringify(resultat)).toContain('ecoScore');
      expect(JSON.stringify(resultat)).not.toContain('eco_score');
      expect(appel.mock.calls[0][1]?.body as string).not.toContain('ecoScore');
    });

    it('conserve un breakdown vide tel quel', async () => {
      mockerFetch(() =>
        Promise.resolve(reponse({ ...REPONSE_FASTAPI, breakdown: [] })),
      );

      const resultat = await service.calculate(dtoValide());

      expect(resultat.breakdown).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Erreurs
  // ---------------------------------------------------------------------------
  describe('gestion des erreurs', () => {
    it('traduit un 422 FastAPI en 422, en conservant le motif', async () => {
      // Cas réel : le mode ESCOOTER est reconnu par l'enum Prisma mais n'a
      // aucun facteur d'émission dans le microservice.
      mockerFetch(() =>
        Promise.resolve(
          reponse(
            {
              detail: [
                {
                  type: 'value_error',
                  loc: ['body', 'segments', 0, 'mode'],
                  msg: "Value error, Mode 'ESCOOTER' non supporte : aucun facteur d'emission valide dans le dossier de conception.",
                },
              ],
            },
            422,
          ),
        ),
      );

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('retire le préfixe technique « Value error, » de Pydantic', async () => {
      mockerFetch(() =>
        Promise.resolve(
          reponse(
            { detail: [{ msg: "Value error, Mode 'ESCOOTER' non supporte" }] },
            422,
          ),
        ),
      );

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        /^Mode 'ESCOOTER' non supporte$/,
      );
    });

    it('accepte aussi un detail FastAPI sous forme de chaîne', async () => {
      mockerFetch(() =>
        Promise.resolve(reponse({ detail: 'Requête refusée' }, 422)),
      );

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        /Requête refusée/,
      );
    });

    it('reste en 422 même si le corps du refus est illisible', async () => {
      // Un corps non-JSON ne doit pas transformer un refus légitime en 500.
      mockerFetch(() =>
        Promise.resolve(new Response('pas du json', { status: 422 })),
      );

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('traduit un 500 FastAPI en 503', async () => {
      mockerFetch(() => Promise.resolve(reponse({ detail: 'boom' }, 500)));

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('traduit une panne réseau en 503', async () => {
      mockerFetch(() => Promise.reject(new TypeError('fetch failed')));

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('traduit un dépassement de délai en 503', async () => {
      // Forme exacte de l'erreur levée par AbortSignal.timeout().
      const expiration = new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      );
      mockerFetch(() => Promise.reject(expiration));

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('traduit un 200 de forme inattendue en 503', async () => {
      // Un champ manquant deviendrait `undefined` dans la réponse publique :
      // l'usager lirait une empreinte vide au lieu d'une erreur.
      mockerFetch(() => Promise.resolve(reponse({ total_co2_g: 12 })));

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('traduit un 200 sans eco_score en 503', async () => {
      // Cas concret : un microservice resté en version 4D-2. Sans le
      // contrôle de forme, la réponse publique porterait `ecoScore:
      // undefined`, que JSON.stringify fait purement DISPARAÎTRE — le client
      // recevrait donc un contrat amputé, sans la moindre erreur.
      const { eco_score: _ignore, ...sansScore } = REPONSE_FASTAPI;
      mockerFetch(() => Promise.resolve(reponse(sansScore)));

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('traduit un eco_score du mauvais type en 503', async () => {
      mockerFetch(() =>
        Promise.resolve(reponse({ ...REPONSE_FASTAPI, eco_score: '56.3' })),
      );

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('traduit un eco_score nul en 503', async () => {
      // `null` passerait un simple test de présence, mais n'est pas un
      // nombre : le contrôle porte bien sur le TYPE.
      mockerFetch(() =>
        Promise.resolve(reponse({ ...REPONSE_FASTAPI, eco_score: null })),
      );

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('traduit un 200 au corps illisible en 503', async () => {
      mockerFetch(() =>
        Promise.resolve(new Response('<html>erreur</html>', { status: 200 })),
      );

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("n'expose jamais l'adresse interne du microservice", async () => {
      mockerFetch(() =>
        Promise.reject(new TypeError(`connect ECONNREFUSED ${URL_TEST}`)),
      );

      await expect(service.calculate(dtoValide())).rejects.toThrow(
        /^Service de calcul carbone indisponible$/,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Validation du DTO
// ---------------------------------------------------------------------------
// Ces cas ne passent PAS par le service : ils vérifient que le ValidationPipe
// global rejette la requête AVANT que le contrôleur — donc FastAPI — ne soit
// atteint. On reproduit exactement la configuration de main.ts.
describe('CalculateCarbonDto (ValidationPipe)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const valider = (corps: unknown) =>
    pipe.transform(corps, { type: 'body', metatype: CalculateCarbonDto });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepte un corps valide', async () => {
    await expect(
      valider({ segments: [{ mode: 'BUS', distanceM: 3200 }] }),
    ).resolves.toEqual({
      segments: [{ mode: 'BUS', distanceM: 3200 }],
    });
  });

  it('refuse un tableau de segments vide', async () => {
    // Calculer l'empreinte de rien n'a pas de sens.
    await expect(valider({ segments: [] })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuse un corps sans segments', async () => {
    await expect(valider({})).rejects.toThrow(BadRequestException);
  });

  it('refuse une distance négative', async () => {
    await expect(
      valider({ segments: [{ mode: 'BUS', distanceM: -100 }] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuse une distance décimale', async () => {
    await expect(
      valider({ segments: [{ mode: 'BUS', distanceM: 100.5 }] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuse une distance envoyée sous forme de chaîne', async () => {
    await expect(
      valider({ segments: [{ mode: 'BUS', distanceM: '3200' }] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuse un mode inexistant', async () => {
    await expect(
      valider({ segments: [{ mode: 'FUSEE', distanceM: 1000 }] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuse un champ non déclaré (forbidNonWhitelisted)', async () => {
    await expect(
      valider({
        segments: [{ mode: 'BUS', distanceM: 100, couleur: 'rouge' }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepte ESCOOTER : le refus appartient à FastAPI, pas au DTO', async () => {
    // ESCOOTER est un mode LÉGITIME du domaine (il est dans l'enum Prisma).
    // C'est le microservice qui refusera de le calculer, faute de facteur —
    // d'où un 422 et non un 400. Dupliquer ici la liste des modes calculables
    // créerait deux vérités à maintenir.
    await expect(
      valider({ segments: [{ mode: 'ESCOOTER', distanceM: 1000 }] }),
    ).resolves.toBeDefined();
  });

  it("n'appelle JAMAIS FastAPI quand le DTO est invalide", async () => {
    const appel = jest.spyOn(global, 'fetch');

    await expect(valider({ segments: [] })).rejects.toThrow(
      BadRequestException,
    );

    // La preuve que la validation précède l'appel réseau : une requête
    // invalide ne doit rien coûter au microservice.
    expect(appel).not.toHaveBeenCalled();
  });
});
