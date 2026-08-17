import { mediane } from './median.util';

describe('mediane', () => {
  it('renvoie la valeur centrale pour un nombre impair de valeurs', () => {
    expect(mediane([8, 10, 12])).toBe(10);
    expect(mediane([5])).toBe(5);
  });

  it('renvoie la moyenne des deux valeurs centrales pour un nombre pair', () => {
    expect(mediane([9, 10, 11, 60])).toBe(10.5);
    expect(mediane([10, 20])).toBe(15);
  });

  it("n'est pas sensible à l'ordre des valeurs", () => {
    expect(mediane([12, 8, 10])).toBe(10);
    expect(mediane([60, 9, 11, 10])).toBe(10.5);
  });

  it('résiste à une valeur aberrante, contrairement à la moyenne', () => {
    const valeurs = [9, 10, 11, 60];
    const moyenne = valeurs.reduce((a, b) => a + b, 0) / valeurs.length;

    // C'est tout l'argument du choix : la moyenne est tirée à 22,5 par le
    // 60, alors que la médiane reste à 10,5.
    expect(moyenne).toBe(22.5);
    expect(mediane(valeurs)).toBe(10.5);
  });

  it('ne modifie pas la liste reçue', () => {
    const valeurs = [12, 8, 10];
    mediane(valeurs);

    expect(valeurs).toEqual([12, 8, 10]);
  });

  it('renvoie null pour une liste vide', () => {
    expect(mediane([])).toBeNull();
  });
});
