import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GtfsRtModule } from '../src/gtfs-rt/gtfs-rt.module';
import { GtfsRtSourceService } from '../src/gtfs-rt/gtfs-rt-source.service';
import { GtfsRtDecoderService } from '../src/gtfs-rt/gtfs-rt-decoder.service';

/**
 * Chaîne complète GTFS-Realtime (étape 4F-1B).
 *
 * CE QUE LES TESTS UNITAIRES NE PROUVENT PAS. Ils remplacent fetch : ils
 * vérifient donc la logique du service, pas qu'un vrai transfert HTTP
 * produise des octets décodables. Ici, un VRAI serveur HTTP local sert un
 * VRAI fichier binaire, et les deux services sont résolus par l'injection de
 * dépendances de NestJS.
 *
 * AUCUNE BASE DE DONNÉES, AUCUNE ÉCRITURE. Ce fichier ne crée aucune
 * application HTTP Nest et n'appelle jamais Prisma.
 *
 * Il affirmait aussi, en 4F-1B, que GtfsRtModule ne dépendait de rien.
 * Ce n'est plus vrai depuis 4F-1C : le module y a gagné GtfsRtImportService,
 * qui écrit en base et importe donc PrismaModule. Ce que ce test continue de
 * prouver est plus précis, et suffit : la source et le décodeur, eux, ne
 * touchent toujours pas à la base — `.compile()` n'ouvre aucune connexion,
 * et les deux services s'utilisent ici sans qu'aucune ne soit nécessaire.
 *
 * AUCUN ACCÈS À INTERNET : le serveur écoute sur la boucle locale, sur un
 * port attribué par le système (port 0), afin de ne jamais entrer en conflit
 * avec un autre test.
 */
const FIXTURES = join(__dirname, 'fixtures', 'gtfs-rt');
const lireFixture = (nom: string): Buffer => readFileSync(join(FIXTURES, nom));

describe('GTFS-RT : URL → octets → FeedMessage (e2e)', () => {
  let moduleRef: TestingModule;
  let source: GtfsRtSourceService;
  let decoder: GtfsRtDecoderService;
  let serveur: Server;
  let base: string;

  /// Ce que le serveur local renverra à la prochaine requête.
  let reponse: { statut: number; corps: Buffer; typeMime: string };

  beforeAll(async () => {
    Logger.overrideLogger(false);

    // L'assemblage par NestJS fait partie de ce qu'on vérifie : si
    // GtfsRtModule oubliait un provider, ce test ne démarrerait pas.
    moduleRef = await Test.createTestingModule({
      imports: [GtfsRtModule],
    }).compile();

    source = moduleRef.get(GtfsRtSourceService);
    decoder = moduleRef.get(GtfsRtDecoderService);

    serveur = createServer((_requete, res) => {
      res.writeHead(reponse.statut, { 'Content-Type': reponse.typeMime });
      res.end(reponse.corps);
    });

    await new Promise<void>((resolve) =>
      serveur.listen(0, '127.0.0.1', resolve),
    );

    const { port } = serveur.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      serveur.close((erreur) => (erreur ? reject(erreur) : resolve())),
    );
    await moduleRef.close();
  });

  beforeEach(() => {
    reponse = {
      statut: 200,
      corps: lireFixture('flux-valide.pb'),
      typeMime: 'application/x-protobuf',
    };
  });

  it('télécharge puis décode un flux servi en HTTP', async () => {
    const octets = await source.fetchFeed(`${base}/alertes.pb`);
    const message = decoder.decode(octets);

    expect(message.header.gtfsRealtimeVersion).toBe('2.0');
    expect(message.entity).toHaveLength(1);
    expect(message.entity[0].id).toBe('alerte-ligne-a-travaux');
    expect(message.entity[0].alert!.informedEntity![0].routeId).toBe('ROUTE_A');
  });

  it('traverse le transfert HTTP sans altérer un seul octet', async () => {
    const octets = await source.fetchFeed(`${base}/alertes.pb`);

    // Le binaire est fragile : un encodage appliqué par mégarde en cours de
    // route le rendrait indécodable. On compare au fichier d'origine.
    expect(Buffer.from(octets)).toEqual(lireFixture('flux-valide.pb'));
  });

  it('décode un flux réellement vide de perturbations', async () => {
    reponse.corps = lireFixture('flux-sans-entite.pb');

    const message = decoder.decode(
      await source.fetchFeed(`${base}/alertes.pb`),
    );

    // 13 octets, aucune entité : un réseau sans incident, pas une panne.
    expect(message.entity).toEqual([]);
  });

  it('signale une réponse HTTP en erreur sans jamais décoder', async () => {
    reponse = {
      statut: 503,
      corps: Buffer.from('Service Unavailable'),
      typeMime: 'text/plain',
    };

    await expect(source.fetchFeed(`${base}/alertes.pb`)).rejects.toThrow(
      /HTTP 503/,
    );
  });

  it("distingue une page d'erreur servie en 200 d'un vrai flux", async () => {
    // Le piège classique en production : le portail de l'opérateur répond
    // 200 avec du HTML. Le téléchargement réussit, le décodage doit refuser.
    reponse = {
      statut: 200,
      corps: Buffer.from('<html><body>Maintenance</body></html>'),
      typeMime: 'text/html',
    };

    const octets = await source.fetchFeed(`${base}/alertes.pb`);

    expect(() => decoder.decode(octets)).toThrow(/Flux GTFS-RT illisible/);
  });

  it('refuse un flux tronqué par une coupure de connexion', async () => {
    reponse.corps = lireFixture('flux-tronque.pb');

    const octets = await source.fetchFeed(`${base}/alertes.pb`);

    expect(() => decoder.decode(octets)).toThrow(/Flux GTFS-RT illisible/);
  });

  it('ne joint jamais une adresse hors http(s), même locale', async () => {
    await expect(
      source.fetchFeed(join(FIXTURES, 'flux-valide.pb')),
    ).rejects.toThrow(/URL de flux GTFS-RT invalide|Protocole non autorisé/);
  });
});
