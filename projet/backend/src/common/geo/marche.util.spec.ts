import { METRES_PAR_MINUTE, minutesDeMarche } from './marche.util';

// =============================================================================
// Marche à pied — estimation
// =============================================================================
// La marche est le LIANT de la multimodalité : elle relie une adresse à un
// quai, et parfois une adresse à une autre. Ces règles décident donc de ce que
// l'usager lit avant et après chaque trajet.
// =============================================================================

describe('minutesDeMarche', () => {
  it('applique la vitesse de marche retenue', () => {
    // 750 m à 75 m/min : dix minutes, sans arrondi à discuter.
    expect(minutesDeMarche(10 * METRES_PAR_MINUTE)).toBe(10);
  });

  it('arrondit à la minute la plus proche', () => {
    // 300 m → 4 min ; 340 m → 4,53 min → 5.
    expect(minutesDeMarche(300)).toBe(4);
    expect(minutesDeMarche(340)).toBe(5);
  });

  it('ne descend JAMAIS sous une minute', () => {
    // ⚠️ « 0 min de marche » se lit « vous y êtes », ce qui est faux à
    // cinquante mètres d'un quai — et ferait disparaître l'étape de
    // l'affichage alors qu'il faut traverser une place.
    expect(minutesDeMarche(1)).toBe(1);
    expect(minutesDeMarche(30)).toBe(1);
    expect(minutesDeMarche(0)).toBe(1);
  });

  it('rend une minute plutôt qu’un NaN sur une entrée aberrante', () => {
    // Une distance négative ou non finie ne peut pas venir d'une mesure ;
    // laisser passer un `NaN` le ferait traverser jusqu'au total affiché.
    expect(minutesDeMarche(-100)).toBe(1);
    expect(minutesDeMarche(Number.NaN)).toBe(1);
    expect(minutesDeMarche(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('reste croissante : marcher plus loin ne prend jamais moins de temps', () => {
    let precedent = 0;

    for (let distanceM = 0; distanceM <= 5_000; distanceM += 97) {
      const minutes = minutesDeMarche(distanceM);
      expect(minutes).toBeGreaterThanOrEqual(precedent);
      precedent = minutes;
    }
  });
});
