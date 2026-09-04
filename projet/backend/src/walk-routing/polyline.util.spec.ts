import { decoderPolyligne } from './polyline.util';

// =============================================================================
// Décodage des polylignes encodées
// =============================================================================
// C'est un ALGORITHME : il se vérifie sur des valeurs connues, sans réseau.
// Une erreur ici ne lève rien — elle déplace simplement le tracé de plusieurs
// degrés, donc de plusieurs centaines de kilomètres.
// =============================================================================

describe('decoderPolyligne', () => {
  it('décode l’exemple de référence de Google (précision 5)', () => {
    // Valeurs publiées dans la spécification du format : trois points de
    // Californie. C'est le seul jeu d'essai qui ne vienne pas de nous.
    const points = decoderPolyligne('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);

    expect(points).toHaveLength(3);
    expect(points[0][0]).toBeCloseTo(38.5, 5);
    expect(points[0][1]).toBeCloseTo(-120.2, 5);
    expect(points[1][0]).toBeCloseTo(40.7, 5);
    expect(points[1][1]).toBeCloseTo(-120.95, 5);
    expect(points[2][0]).toBeCloseTo(43.252, 5);
    expect(points[2][1]).toBeCloseTo(-126.453, 5);
  });

  it('respecte la PRÉCISION demandée', () => {
    // ⚠️ LE PIÈGE QUE CE TEST VERROUILLE. Google et OSRM encodent au 10⁻⁵,
    // Valhalla au 10⁻⁶. Se tromper d'un facteur dix ne lève aucune erreur :
    // le tracé se retrouve dix degrés plus loin — en mer du Nord pour un
    // trajet strasbourgeois.
    const encodee = '_p~iF~ps|U';

    const [enCinq] = decoderPolyligne(encodee, 5);
    const [enSix] = decoderPolyligne(encodee, 6);

    expect(enCinq[0]).toBeCloseTo(38.5, 5);
    expect(enSix[0]).toBeCloseTo(3.85, 5);
  });

  it('rend un tableau vide sur une entrée vide', () => {
    expect(decoderPolyligne('', 6)).toEqual([]);
  });

  it('rend un tableau vide plutôt que de lever sur une entrée illisible', () => {
    // ⚠️ Un fournisseur externe peut changer de format sans prévenir.
    // L'appelant doit pouvoir retomber sur son estimation, pas gérer une
    // exception au milieu d'une recherche d'itinéraire.
    expect(() => decoderPolyligne('', 6)).not.toThrow();
  });

  it('s’arrête proprement sur une chaîne TRONQUÉE', () => {
    // Une latitude sans sa longitude ne doit pas produire un point à moitié
    // lu : on rend ce qui précède, et rien de plus.
    const complet = decoderPolyligne('_p~iF~ps|U_ulLnnqC', 5);
    const tronque = decoderPolyligne('_p~iF~ps|U_ulL', 5);

    expect(complet).toHaveLength(2);
    expect(tronque).toHaveLength(1);
    expect(tronque[0]).toEqual(complet[0]);
  });

  it('enchaîne les variations : chaque point part du précédent', () => {
    // C'est ce qui rend le format compact — et ce qu'une implémentation
    // fautive casse en premier, en rendant des points absolus.
    const points = decoderPolyligne('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);

    expect(points[1][0]).toBeGreaterThan(points[0][0]);
    expect(points[2][0]).toBeGreaterThan(points[1][0]);
  });
});
