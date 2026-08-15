import { haversineDistanceM } from './distance.util';

describe('haversineDistanceM', () => {
  it('renvoie 0 entre un point et lui-même', () => {
    expect(haversineDistanceM(48.8566, 2.3522, 48.8566, 2.3522)).toBe(0);
  });

  it('calcule une distance connue (Gare du Nord → Châtelet ≈ 2,6 km)', () => {
    const distance = haversineDistanceM(48.8809, 2.3553, 48.8583, 2.347);

    // Distance réelle à vol d'oiseau ≈ 2,6 km : on tolère 200 m d'écart.
    expect(distance).toBeGreaterThan(2400);
    expect(distance).toBeLessThan(2800);
  });

  it('est symétrique (A→B = B→A)', () => {
    const aVersB = haversineDistanceM(48.8809, 2.3553, 48.8583, 2.347);
    const bVersA = haversineDistanceM(48.8583, 2.347, 48.8809, 2.3553);

    expect(aVersB).toBeCloseTo(bVersA, 6);
  });

  it('tient compte de la courbure : 1° de longitude est plus court en haut', () => {
    // Un degré de longitude à l'équateur ≈ 111 km, mais à 60° de latitude
    // il ne fait plus que ≈ 55 km. Une simple soustraction de coordonnées
    // ne verrait aucune différence : c'est pourquoi on utilise Haversine.
    const aEquateur = haversineDistanceM(0, 0, 0, 1);
    const aSoixanteDegres = haversineDistanceM(60, 0, 60, 1);

    expect(aEquateur).toBeGreaterThan(aSoixanteDegres * 1.8);
  });
});
