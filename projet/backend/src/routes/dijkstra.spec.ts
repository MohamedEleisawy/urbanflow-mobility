import {
  additionnerCouts,
  cheminOptimal,
  comparerCouts,
  type AreteGenerique,
} from './dijkstra';

// =============================================================================
// Le module est PUR : ces tests n'ont besoin d'aucune base, d'aucun mock
// Prisma et d'aucun module NestJS. Les graphes sont écrits à la main, ce qui
// rend chaque résultat attendu vérifiable de tête.
// =============================================================================

/** Ce que transportent nos arêtes de test : une ligne et une durée. */
interface Donnee {
  ligne: string;
  minutes: number;
}

type Graphe = Record<string, AreteGenerique<Donnee>[]>;

const arete = (vers: string, ligne: string, minutes: number) => ({
  vers,
  donnee: { ligne, minutes },
});

/** Le plus rapide : coût scalaire, état = simple sommet. */
function plusRapide(graphe: Graphe, depart: string, arrivee: string) {
  return cheminOptimal<Donnee>({
    aretesDepuis: (sommet) => graphe[sommet] ?? [],
    coutDe: (a) => [a.donnee.minutes],
    etatApres: (a) => a.vers,
    depart,
    estArrivee: (sommet) => sommet === arrivee,
  });
}

/**
 * Le moins de changements, puis le plus rapide.
 *
 * L'état encode la ligne empruntée — `sommet|ligne` — car c'est la seule
 * information dont `coutDe` a besoin pour savoir s'il y a changement.
 * `''` signifie « pas encore embarqué » : monter dans la première ligne
 * n'est pas un changement.
 */
const ligneDeLEtat = (etat: string) => etat.split('|')[1] ?? '';

function moinsDeChangements(graphe: Graphe, depart: string, arrivee: string) {
  return cheminOptimal<Donnee>({
    aretesDepuis: (sommet) => graphe[sommet.split('|')[0]] ?? [],
    coutDe: (a, etat) => {
      const courante = ligneDeLEtat(etat);
      return [
        courante !== '' && courante !== a.donnee.ligne ? 1 : 0,
        a.donnee.minutes,
      ];
    },
    etatApres: (a) => `${a.vers}|${a.donnee.ligne}`,
    depart: `${depart}|`,
    estArrivee: (sommet) => sommet === arrivee,
  });
}

const lignes = (chemin: ReturnType<typeof plusRapide>) =>
  chemin?.map((etape) => etape.arete.donnee.ligne);

const parcours = (chemin: ReturnType<typeof plusRapide>) =>
  chemin?.map((etape) => etape.arete.vers);

describe('comparerCouts', () => {
  it('compare la première composante en priorité', () => {
    expect(comparerCouts([1, 999], [2, 0])).toBeLessThan(0);
  });

  it('départage sur la composante suivante quand la première est à égalité', () => {
    expect(comparerCouts([1, 10], [1, 20])).toBeLessThan(0);
  });

  it('rend zéro pour deux coûts identiques', () => {
    expect(comparerCouts([3, 4], [3, 4])).toBe(0);
  });

  it('traite une composante absente comme un zéro', () => {
    expect(comparerCouts([1], [1, 0])).toBe(0);
    expect(comparerCouts([1], [1, 5])).toBeLessThan(0);
  });
});

describe('additionnerCouts', () => {
  it('additionne composante par composante', () => {
    expect(additionnerCouts([1, 10], [1, 5])).toEqual([2, 15]);
  });

  it("s'aligne sur le plus long des deux vecteurs", () => {
    expect(additionnerCouts([], [1, 2])).toEqual([1, 2]);
  });
});

describe('cheminOptimal — plus rapide', () => {
  it('trouve le chemin de durée minimale', () => {
    // A --5--> B --5--> D        (10 min, via B)
    // A --------2------> C --3--> D  (5 min, via C)
    const graphe: Graphe = {
      A: [arete('B', 'L1', 5), arete('C', 'L2', 2)],
      B: [arete('D', 'L1', 5)],
      C: [arete('D', 'L2', 3)],
    };

    expect(parcours(plusRapide(graphe, 'A', 'D'))).toEqual(['C', 'D']);
  });

  it("rend null quand l'arrivée est inatteignable", () => {
    const graphe: Graphe = { A: [arete('B', 'L1', 5)] };

    expect(plusRapide(graphe, 'A', 'Z')).toBeNull();
  });

  it("rend un chemin vide quand le départ est déjà l'arrivée", () => {
    expect(plusRapide({}, 'A', 'A')).toEqual([]);
  });

  it('ne suit pas une arête en sens inverse (graphe orienté)', () => {
    const graphe: Graphe = { A: [arete('B', 'L1', 1)] };

    expect(plusRapide(graphe, 'B', 'A')).toBeNull();
  });
});

describe('cheminOptimal — moins de changements', () => {
  it('préfère un trajet direct plus long à un trajet rapide avec correspondance', () => {
    // Direct  : A --L1(30)--> D                         0 changement, 30 min
    // Rapide  : A --L2(5)--> B --L3(5)--> D             1 changement, 10 min
    const graphe: Graphe = {
      A: [arete('D', 'L1', 30), arete('B', 'L2', 5)],
      B: [arete('D', 'L3', 5)],
    };

    expect(lignes(moinsDeChangements(graphe, 'A', 'D'))).toEqual(['L1']);
    // Le critère « plus rapide » du même graphe choisit bien l'autre.
    expect(lignes(plusRapide(graphe, 'A', 'D'))).toEqual(['L2', 'L3']);
  });

  it('ne compte pas de changement quand on reste sur la même ligne', () => {
    // A --L1--> B --L1--> C : deux arêtes, zéro changement.
    const graphe: Graphe = {
      A: [arete('B', 'L1', 4)],
      B: [arete('C', 'L1', 4)],
    };

    expect(lignes(moinsDeChangements(graphe, 'A', 'C'))).toEqual(['L1', 'L1']);
  });

  it('à nombre de changements égal, retient le plus rapide', () => {
    // Deux trajets à un changement : 20 min et 12 min.
    const graphe: Graphe = {
      A: [arete('B', 'L1', 10), arete('C', 'L1', 6)],
      B: [arete('D', 'L2', 10)],
      C: [arete('D', 'L3', 6)],
    };

    expect(parcours(moinsDeChangements(graphe, 'A', 'D'))).toEqual(['C', 'D']);
  });

  it("accepte un changement quand aucun trajet direct n'existe", () => {
    const graphe: Graphe = {
      A: [arete('B', 'L1', 3)],
      B: [arete('C', 'L2', 3)],
    };

    expect(lignes(moinsDeChangements(graphe, 'A', 'C'))).toEqual(['L1', 'L2']);
  });
});

describe('cheminOptimal — déterminisme', () => {
  it('rend exactement le même chemin sur deux exécutions identiques', () => {
    const graphe: Graphe = {
      A: [arete('B', 'L1', 5), arete('C', 'L2', 5)],
      B: [arete('D', 'L1', 5)],
      C: [arete('D', 'L2', 5)],
    };

    const premier = parcours(plusRapide(graphe, 'A', 'D'));
    const second = parcours(plusRapide(graphe, 'A', 'D'));

    expect(premier).toEqual(second);
  });
});

describe('cheminOptimal — robustesse du tas', () => {
  it('traite un graphe en chaîne assez long pour exercer le tas binaire', () => {
    // Chaîne de 500 sommets : le balayage linéaire précédent y faisait
    // 250 000 comparaisons, le tas en fait quelques milliers.
    const graphe: Graphe = {};

    for (let i = 0; i < 500; i++) {
      graphe[`S${i}`] = [arete(`S${i + 1}`, 'L1', 1)];
    }

    const chemin = plusRapide(graphe, 'S0', 'S500');

    expect(chemin).toHaveLength(500);
  });

  it('retient la meilleure des arêtes parallèles entre deux sommets', () => {
    const graphe: Graphe = {
      A: [arete('B', 'L1', 9), arete('B', 'L2', 2), arete('B', 'L3', 7)],
    };

    expect(lignes(plusRapide(graphe, 'A', 'B'))).toEqual(['L2']);
  });
});
