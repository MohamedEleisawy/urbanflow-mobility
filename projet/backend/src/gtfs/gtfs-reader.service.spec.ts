import { join } from 'node:path';
import { GtfsReaderService } from './gtfs-reader.service';
import { GtfsImportReport } from './gtfs-import-report';

// Ces tests n'utilisent NI base de données NI réseau : ils lisent un petit
// jeu de fichiers GTFS local, volontairement truffé de cas limites.
const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures', 'gtfs');
const fichier = (nom: string) => join(FIXTURES, nom);

// Vide un générateur asynchrone dans un tableau (les fixtures sont petites).
async function collecter<T>(source: AsyncGenerator<T>): Promise<T[]> {
  const resultat: T[] = [];
  for await (const element of source) {
    resultat.push(element);
  }
  return resultat;
}

describe('GtfsReaderService', () => {
  let service: GtfsReaderService;
  let report: GtfsImportReport;

  beforeEach(() => {
    service = new GtfsReaderService();
    report = new GtfsImportReport();
  });

  // ---------------------------------------------------------------------------
  // stops.txt
  // ---------------------------------------------------------------------------
  describe('readStops', () => {
    it('lit les arrêts valides et écarte les autres', async () => {
      const arrets = await collecter(
        service.readStops(fichier('stops.txt'), report),
      );

      expect(arrets.map((a) => a.stopId)).toEqual(['S1', 'S2', 'S3', 'S4']);
      expect(report.files.stops).toEqual({
        total: 8,
        valid: 4,
        ignored: 3,
        filtered: 1,
      });
    });

    it('gère un nom entre guillemets contenant une virgule', async () => {
      // Sans un vrai parseur CSV, "Châtelet, salle d'échanges" serait coupé
      // en deux et décalerait toutes les colonnes suivantes.
      const arrets = await collecter(
        service.readStops(fichier('stops.txt'), report),
      );
      const chatelet = arrets.find((a) => a.stopId === 'S2');

      expect(chatelet?.stopName).toBe("Châtelet, salle d'échanges");
      // Preuve que les colonnes ne sont pas décalées : les coordonnées
      // restent exploitables.
      expect(chatelet?.latitude).toBe(48.8583);
      expect(chatelet?.longitude).toBe(2.347);
    });

    it('traduit wheelchair_boarding en booléen', async () => {
      const arrets = await collecter(
        service.readStops(fichier('stops.txt'), report),
      );

      // 1 → accessible
      expect(arrets.find((a) => a.stopId === 'S1')?.pmrAccessible).toBe(true);
      // 2 → non accessible
      expect(arrets.find((a) => a.stopId === 'S2')?.pmrAccessible).toBe(false);
      // 0 → inconnu, représenté par false (approximation documentée)
      expect(arrets.find((a) => a.stopId === 'S3')?.pmrAccessible).toBe(false);
      // absent → inconnu, également false
      expect(arrets.find((a) => a.stopId === 'S4')?.pmrAccessible).toBe(false);
    });

    it('compte un champ obligatoire manquant', async () => {
      await collecter(service.readStops(fichier('stops.txt'), report));

      // BAD1 n'a pas de stop_name.
      expect(report.errors.missingRequiredField).toBe(1);
    });

    it('compte une latitude non numérique et une longitude hors bornes', async () => {
      await collecter(service.readStops(fichier('stops.txt'), report));

      // BAD2 (latitude illisible) et BAD3 (longitude = 500).
      expect(report.errors.invalidCoordinates).toBe(2);
    });

    it('écarte un location_type non supporté SANS le compter comme une erreur', async () => {
      await collecter(service.readStops(fichier('stops.txt'), report));

      // STATION1 a location_type=1 : c'est une station, pas un arrêt
      // desservi. La donnée est correcte, simplement hors de notre modèle.
      expect(report.filtered.unsupportedLocationType).toBe(1);
      expect(report.files.stops.filtered).toBe(1);
      // Elle ne doit surtout pas grossir le compteur d'erreurs.
      expect(report.files.stops.ignored).toBe(3);
    });

    it("une ligne invalide n'empêche pas la lecture des suivantes", async () => {
      const arrets = await collecter(
        service.readStops(fichier('stops.txt'), report),
      );

      // BAD1/BAD2/BAD3 sont en fin de fichier, mais S1..S4 les précèdent et
      // STATION1 s'intercale : la lecture est allée jusqu'au bout.
      expect(arrets).toHaveLength(4);
      expect(report.files.stops.total).toBe(8);
    });
  });

  // ---------------------------------------------------------------------------
  // routes.txt
  // ---------------------------------------------------------------------------
  describe('readRoutes', () => {
    it('lit les lignes et conserve route_type BRUT', async () => {
      const lignes = await collecter(
        service.readRoutes(fichier('routes.txt'), report),
      );

      expect(lignes.map((l) => l.routeId)).toEqual(['R1', 'R2', 'R3', 'R4']);
      // R3 est de type 2 (train) : non supporté par notre enum, mais on ne
      // filtre RIEN ici — la traduction appartient à l'étape 4C-4-3.
      expect(lignes.find((l) => l.routeId === 'R3')?.routeType).toBe(2);
      expect(report.files.routes).toEqual({
        total: 6,
        valid: 4,
        ignored: 2,
        filtered: 0,
      });
    });

    it("n'invente aucun nom quand route_short_name est absent", async () => {
      const lignes = await collecter(
        service.readRoutes(fichier('routes.txt'), report),
      );
      const sansNomCourt = lignes.find((l) => l.routeId === 'R4');

      expect(sansNomCourt?.shortName).toBe('');
      expect(sansNomCourt?.longName).toBe('Ligne sans nom court');
    });

    it('compte un route_type manquant ou illisible', async () => {
      await collecter(service.readRoutes(fichier('routes.txt'), report));

      expect(report.errors.missingRequiredField).toBe(1); // BADR1
      expect(report.errors.invalidNumber).toBe(1); // BADR2
    });
  });

  // ---------------------------------------------------------------------------
  // trips.txt
  // ---------------------------------------------------------------------------
  describe('readTrips', () => {
    const LIGNES_CONNUES = new Set(['R1', 'R2', 'R3', 'R4']);

    it('lit les trajets et permet la correspondance trip_id → route_id', async () => {
      const trajets = await collecter(
        service.readTrips(fichier('trips.txt'), report, LIGNES_CONNUES),
      );

      expect(trajets.map((t) => t.tripId)).toEqual(['T1', 'T2', 'T3', 'T4']);
      expect(trajets.find((t) => t.tripId === 'T4')?.routeId).toBe('R2');
      expect(report.files.trips).toEqual({
        total: 6,
        valid: 4,
        ignored: 2,
        filtered: 0,
      });
    });

    it('compte une référence vers une ligne inexistante', async () => {
      await collecter(
        service.readTrips(fichier('trips.txt'), report, LIGNES_CONNUES),
      );

      expect(report.errors.unknownRoute).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // stop_times.txt
  // ---------------------------------------------------------------------------
  describe('readStopTimes', () => {
    const ARRETS_CONNUS = new Set(['S1', 'S2', 'S3', 'S4']);
    const TRAJETS_CONNUS = new Set(['T1', 'T2', 'T3', 'T4']);

    const lire = () =>
      collecter(
        service.readStopTimes(
          fichier('stop_times.txt'),
          report,
          ARRETS_CONNUS,
          TRAJETS_CONNUS,
        ),
      );

    it('lit les passages valides', async () => {
      const passages = await lire();

      expect(report.files.stopTimes).toEqual({
        total: 14,
        valid: 9,
        ignored: 5,
        filtered: 0,
      });
      expect(passages).toHaveLength(9);
    });

    it('convertit les horaires en secondes depuis minuit', async () => {
      const passages = await lire();
      const premier = passages[0];

      expect(premier.arrivalTimeSec).toBe(28800); // 08:00:00
      expect(passages[1].departureTimeSec).toBe(8 * 3600 + 3 * 60 + 30);
    });

    it('accepte un horaire supérieur à 24h', async () => {
      const passages = await lire();
      const nuit = passages.filter((p) => p.tripId === 'T3');

      expect(nuit[0].arrivalTimeSec).toBe(90600); // 25:10:00
      expect(nuit[0].departureTimeSec).toBe(90630); // 25:10:30
    });

    it('compte un horaire syntaxiquement invalide', async () => {
      await lire();

      // Une heure illisible, et une ligne aux horaires vides.
      expect(report.errors.invalidTime).toBe(2);
    });

    it('compte un stop_id inexistant', async () => {
      await lire();

      expect(report.errors.unknownStop).toBe(1);
    });

    it('compte un trip_id inexistant', async () => {
      await lire();

      expect(report.errors.unknownTrip).toBe(1);
    });

    it('compte un stop_sequence non entier', async () => {
      await lire();

      expect(report.errors.invalidNumber).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Cohérence du rapport et lecture en flux
  // ---------------------------------------------------------------------------
  describe('rapport et streaming', () => {
    it('respecte total = valid + ignored + filtered sur les quatre fichiers', async () => {
      await collecter(service.readStops(fichier('stops.txt'), report));
      await collecter(service.readRoutes(fichier('routes.txt'), report));
      await collecter(
        service.readTrips(
          fichier('trips.txt'),
          report,
          new Set(['R1', 'R2', 'R3', 'R4']),
        ),
      );
      await collecter(
        service.readStopTimes(
          fichier('stop_times.txt'),
          report,
          new Set(['S1', 'S2', 'S3', 'S4']),
          new Set(['T1', 'T2', 'T3', 'T4']),
        ),
      );

      expect(report.isConsistent()).toBe(true);
    });

    it('produit un résumé lisible mentionnant les motifs', async () => {
      await collecter(service.readStops(fichier('stops.txt'), report));

      const resume = report.toLines().join('\n');

      expect(resume).toContain('stops');
      expect(resume).toContain('invalidCoordinates');
      expect(resume).toContain('unsupportedLocationType');
    });

    it('lit RÉELLEMENT en flux : consommer une seule ligne ne lit pas tout le fichier', async () => {
      const flux = service.readStops(fichier('stops.txt'), report);

      // On ne demande qu'un seul arrêt, puis on s'arrête.
      const premier = await flux.next();
      await flux.return(undefined);

      expect(premier.value?.stopId).toBe('S1');
      // Le fichier contient 8 lignes. Si le service les avait toutes
      // chargées d'un coup (readFile puis parse complet), le compteur
      // vaudrait 8. Il vaut 1 : la lecture est bien paresseuse.
      expect(report.files.stops.total).toBe(1);
    });

    it('échoue proprement quand le fichier est absent', async () => {
      // Erreur de FICHIER (et non de ligne) : celle-ci doit interrompre.
      await expect(
        collecter(service.readStops(fichier('fichier-inexistant.txt'), report)),
      ).rejects.toThrow(/Lecture impossible du fichier GTFS/);
    });
  });
});
