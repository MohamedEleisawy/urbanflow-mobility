import {
  choisirShape,
  decouperTrace,
  distanceM,
  indicePlusProche,
  versGeoJson,
  type PointTrace,
} from './shape-geometry';

// Géométrie des liaisons (Phase 1B).
//
// Fonctions pures : aucune base, aucun réseau. Les coordonnées employées sont
// celles d'arrêts parisiens réels, pour que les distances attendues soient
// vérifiables sur une carte plutôt qu'inventées.
describe('shape-geometry', () => {
  /// Un fragment de tracé nord → sud, du type de ceux de `shapes.txt`.
  const TRACE: PointTrace[] = [
    { latitude: 48.8809, longitude: 2.3553 }, // Gare du Nord
    { latitude: 48.8766, longitude: 2.359 }, // Gare de l'Est
    { latitude: 48.8675, longitude: 2.3636 }, // République
    { latitude: 48.8583, longitude: 2.347 }, // Châtelet
    { latitude: 48.8532, longitude: 2.3693 }, // Bastille
  ];

  describe('distanceM', () => {
    it('mesure une distance plausible entre deux arrêts réels', () => {
      // Gare du Nord → Gare de l'Est : environ 550 m à vol d'oiseau.
      const d = distanceM(TRACE[0], TRACE[1]);

      expect(d).toBeGreaterThan(450);
      expect(d).toBeLessThan(650);
    });

    it('rend zéro pour un point et lui-même', () => {
      expect(distanceM(TRACE[0], TRACE[0])).toBe(0);
    });

    it('est symétrique', () => {
      expect(distanceM(TRACE[0], TRACE[3])).toBeCloseTo(
        distanceM(TRACE[3], TRACE[0]),
        6,
      );
    });
  });

  describe('indicePlusProche', () => {
    it('retrouve le point exact', () => {
      const { indice, distanceM: d } = indicePlusProche(TRACE, TRACE[2]);

      expect(indice).toBe(2);
      expect(d).toBe(0);
    });

    it("retrouve le point le plus proche d'une position intermédiaire", () => {
      const { indice } = indicePlusProche(TRACE, {
        latitude: 48.8677,
        longitude: 2.3634,
      });

      expect(indice).toBe(2);
    });

    it('NE REMONTE JAMAIS en amont de `depuis`', () => {
      // Le point cherché est celui d'indice 0 — mais la recherche démarre à 2.
      const { indice } = indicePlusProche(TRACE, TRACE[0], 2);

      // C'est ce qui règle les lignes qui repassent près d'un même endroit :
      // sans cette borne, l'arrivée pourrait se projeter AVANT le départ et
      // la découpe rendrait un tracé à l'envers.
      expect(indice).toBeGreaterThanOrEqual(2);
    });
  });

  describe('decouperTrace', () => {
    it('extrait la portion comprise entre deux arrêts', () => {
      const portion = decouperTrace(TRACE, TRACE[1], TRACE[3]);

      expect(portion).toEqual([TRACE[1], TRACE[2], TRACE[3]]);
    });

    it('inclut les DEUX extrémités', () => {
      const portion = decouperTrace(TRACE, TRACE[0], TRACE[1]);

      // Une portion qui exclurait ses bornes laisserait un trou visible à
      // chaque arrêt sur la carte.
      expect(portion).toHaveLength(2);
      expect(portion?.[0]).toEqual(TRACE[0]);
      expect(portion?.[1]).toEqual(TRACE[1]);
    });

    it('accepte des positions APPROCHÉES des arrêts', () => {
      // Le flux ne fournit pas `shape_dist_traveled` : l'arrêt ne tombe
      // jamais exactement sur un point du tracé. Mesuré sur le réseau réel,
      // l'écart médian est de 12,5 m.
      const portion = decouperTrace(
        TRACE,
        { latitude: 48.8767, longitude: 2.3591 },
        { latitude: 48.8584, longitude: 2.3471 },
      );

      expect(portion).toEqual([TRACE[1], TRACE[2], TRACE[3]]);
    });

    it('rend `null` si l’arrivée précède le départ', () => {
      // Incohérence réelle entre `stop_times.txt` et `shapes.txt`. Fabriquer
      // une ligne malgré tout reviendrait à inventer un parcours.
      expect(decouperTrace(TRACE, TRACE[3], TRACE[1])).toBeNull();
    });

    it('rend `null` si les deux arrêts tombent sur le même point', () => {
      expect(decouperTrace(TRACE, TRACE[2], TRACE[2])).toBeNull();
    });

    it('rend `null` pour un tracé trop court', () => {
      expect(decouperTrace([TRACE[0]], TRACE[0], TRACE[1])).toBeNull();
      expect(decouperTrace([], TRACE[0], TRACE[1])).toBeNull();
    });
  });

  describe('versGeoJson', () => {
    it('produit un LineString', () => {
      const geo = versGeoJson([TRACE[0], TRACE[1]]);

      expect(geo?.type).toBe('LineString');
      expect(geo?.coordinates).toHaveLength(2);
    });

    it('⚠️ ORDONNE [longitude, latitude], PAS l’inverse', () => {
      const geo = versGeoJson([TRACE[0], TRACE[1]]);

      // LA VÉRIFICATION LA PLUS IMPORTANTE DE CE FICHIER.
      //
      // GeoJSON (RFC 7946) impose longitude d'abord — l'inverse de Leaflet et
      // de l'usage courant. Une inversion ne lève AUCUNE erreur : elle place
      // simplement Paris (48,88 N / 2,35 E) au large de la Somalie
      // (2,35 N / 48,88 E). Seul un test peut l'attraper.
      expect(geo?.coordinates[0]).toEqual([2.3553, 48.8809]);
      expect(geo?.coordinates[0]![0]).toBeLessThan(10); // longitude parisienne
      expect(geo?.coordinates[0]![1]).toBeGreaterThan(40); // latitude parisienne
    });

    it('conserve l’ordre des points', () => {
      const geo = versGeoJson(TRACE);

      expect(geo?.coordinates).toHaveLength(5);
      expect(geo?.coordinates[4]).toEqual([2.3693, 48.8532]);
    });

    it('rend `null` en dessous de deux points', () => {
      // Un LineString d'un seul point n'est pas un GeoJSON valide : le
      // stocker produirait une géométrie que rien ne saurait dessiner.
      expect(versGeoJson([TRACE[0]])).toBeNull();
      expect(versGeoJson([])).toBeNull();
    });
  });

  describe('choisirShape', () => {
    it('retient le tracé le PLUS FRÉQUENT', () => {
      const choix = choisirShape(
        new Map([
          ['shp_A', 3],
          ['shp_B', 41],
          ['shp_C', 12],
        ]),
      );

      // Le parcours réellement emprunté par le plus grand nombre de trajets.
      expect(choix).toBe('shp_B');
    });

    it('départage les égalités par ordre alphabétique', () => {
      const choix = choisirShape(
        new Map([
          ['shp_Z', 7],
          ['shp_A', 7],
        ]),
      );

      // DÉTERMINISME : deux imports du même flux doivent rendre exactement le
      // même résultat, quel que soit l'ordre de parcours du fichier.
      expect(choix).toBe('shp_A');
    });

    it('est déterministe quel que soit l’ordre d’insertion', () => {
      const a = choisirShape(
        new Map([
          ['x', 5],
          ['y', 5],
          ['z', 5],
        ]),
      );
      const b = choisirShape(
        new Map([
          ['z', 5],
          ['y', 5],
          ['x', 5],
        ]),
      );

      expect(a).toBe(b);
      expect(a).toBe('x');
    });

    it('rend `null` sans aucun tracé', () => {
      expect(choisirShape(new Map())).toBeNull();
    });

    it('accepte un tracé unique', () => {
      expect(choisirShape(new Map([['shp_seul', 1]]))).toBe('shp_seul');
    });
  });
});
