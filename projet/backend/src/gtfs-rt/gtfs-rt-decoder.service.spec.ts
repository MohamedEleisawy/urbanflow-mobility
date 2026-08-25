import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transit_realtime } from 'gtfs-realtime-bindings';
import { GtfsRtDecoderService } from './gtfs-rt-decoder.service';

// Les fixtures sont des fichiers BINAIRES versionnés, produits une fois par
// test/fixtures/gtfs-rt/generer-fixtures.ts. Aucun test ne les encode
// lui-même : on relit des octets écrits sur disque, comme le fera un vrai
// flux téléchargé.
const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures', 'gtfs-rt');
const lireFixture = (nom: string): Uint8Array =>
  new Uint8Array(readFileSync(join(FIXTURES, nom)));

describe('GtfsRtDecoderService', () => {
  let service: GtfsRtDecoderService;

  beforeEach(() => {
    service = new GtfsRtDecoderService();
  });

  // ---------------------------------------------------------------------------
  // Flux valides
  // ---------------------------------------------------------------------------
  describe('flux valide', () => {
    it("décode l'en-tête d'un flux GTFS-RT", () => {
      const message = service.decode(lireFixture('flux-valide.pb'));

      expect(message.header.gtfsRealtimeVersion).toBe('2.0');
      expect(message.header.incrementality).toBe(
        transit_realtime.FeedHeader.Incrementality.FULL_DATASET,
      );
      // Les entiers 64 bits arrivent en Long, pas en number : c'est une
      // caractéristique de protobufjs dont 4F-1C devra tenir compte.
      expect(Number(message.header.timestamp)).toBe(1_764_590_400);
    });

    it("restitue l'entité et son alerte", () => {
      const message = service.decode(lireFixture('flux-valide.pb'));

      expect(message.entity).toHaveLength(1);

      const entite = message.entity[0];
      expect(entite.id).toBe('alerte-ligne-a-travaux');
      expect(entite.alert).toBeTruthy();
    });

    it("conserve intégralement le contenu de l'alerte", () => {
      const message = service.decode(lireFixture('flux-valide.pb'));
      const alerte = message.entity[0].alert!;

      // Le décodeur ne traduit rien : il rend les valeurs GTFS-RT brutes.
      // Leur interprétation métier appartient à 4F-1C.
      expect(alerte.cause).toBe(transit_realtime.Alert.Cause.MAINTENANCE);
      expect(alerte.effect).toBe(transit_realtime.Alert.Effect.REDUCED_SERVICE);
      expect(alerte.informedEntity![0].routeId).toBe('ROUTE_A');
      expect(alerte.informedEntity![0].stopId).toBe('STOP_1');
      expect(alerte.headerText!.translation![0].text).toBe(
        'Travaux sur la ligne A',
      );
      expect(Number(alerte.activePeriod![0].start)).toBe(1_764_586_800);
      expect(Number(alerte.activePeriod![0].end)).toBe(1_764_597_600);
    });

    it('décode une alerte sans date de fin', () => {
      // Le cas qui a motivé la migration 4F-1A : GTFS-RT rend `end`
      // facultatif. Le décodage doit l'accepter sans inventer de date.
      const message = service.decode(lireFixture('flux-sans-fin.pb'));
      const periode = message.entity[0].alert!.activePeriod![0];

      expect(Number(periode.start)).toBe(1_764_586_800);
      // protobufjs représente un champ absent par sa valeur par défaut : 0,
      // et non par une date lointaine inventée.
      expect(Number(periode.end)).toBe(0);
    });

    it('accepte un flux valide sans aucune perturbation', () => {
      // « Aucune alerte » est la réponse normale d'un réseau qui fonctionne :
      // ce n'est pas une erreur, et cela ne doit pas lever.
      const message = service.decode(lireFixture('flux-sans-entite.pb'));

      expect(message.header.gtfsRealtimeVersion).toBe('2.0');
      expect(message.entity).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Flux refusés
  // ---------------------------------------------------------------------------
  describe('flux illisible', () => {
    it('refuse un flux tronqué', () => {
      // Connexion coupée en cours de téléchargement : les premiers octets
      // sont authentiques, la fin manque.
      expect(() => service.decode(lireFixture('flux-tronque.pb'))).toThrow(
        /Flux GTFS-RT illisible/,
      );
    });

    it('refuse une page HTML renvoyée en 200', () => {
      // Cas très courant en production : un portail d'erreur ou une page de
      // maintenance servie avec un code 200. Le téléchargement réussit, le
      // contenu n'est pas un flux.
      const html = new Uint8Array(
        Buffer.from('<html><body>404 Not Found</body></html>'),
      );

      expect(() => service.decode(html)).toThrow(/Flux GTFS-RT illisible/);
    });

    it('refuse des octets quelconques', () => {
      const aleatoire = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

      expect(() => service.decode(aleatoire)).toThrow(/Flux GTFS-RT illisible/);
    });

    it('refuse un contenu vide', () => {
      expect(() => service.decode(new Uint8Array(0))).toThrow(
        /Flux GTFS-RT illisible/,
      );
    });
  });

  describe('flux décodable mais non conforme', () => {
    it('refuse un en-tête sans version', () => {
      // Protocol Buffers accepte un en-tête vide : c'est au décodeur de
      // vérifier qu'on a bien affaire à un flux GTFS-Realtime.
      expect(() =>
        service.decode(lireFixture('entete-sans-version.pb')),
      ).toThrow(/en-tête absent ou sans version/);
    });

    it('refuse une version majeure inconnue', () => {
      // On préfère refuser qu'interpréter au hasard un format qu'on ne
      // connaît pas — même principe que le mode ESCOOTER sans facteur
      // d'émission (4D-1).
      expect(() => service.decode(lireFixture('version-inconnue.pb'))).toThrow(
        /Version GTFS-RT non supportée : "3\.0"/,
      );
    });

    it("nomme la version reçue dans le message d'erreur", () => {
      // Un message qui dit seulement « version non supportée » oblige à
      // rouvrir le code pour savoir ce qui a été reçu.
      expect(() => service.decode(lireFixture('version-inconnue.pb'))).toThrow(
        /2\.0 attendue/,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Frontière de responsabilité
  // ---------------------------------------------------------------------------
  it('ne fait AUCUN accès réseau', () => {
    // Le décodeur reçoit des octets, un point c'est tout. Ce test verrouille
    // la séparation avec GtfsRtSourceService : si quelqu'un ajoutait un
    // téléchargement ici, il tomberait.
    const espion = jest.spyOn(global, 'fetch');

    service.decode(lireFixture('flux-valide.pb'));

    expect(espion).not.toHaveBeenCalled();
    espion.mockRestore();
  });
});
