import { parseGtfsTime } from './gtfs-time.util';

describe('parseGtfsTime', () => {
  it('convertit un horaire normal en secondes depuis minuit', () => {
    expect(parseGtfsTime('01:10:00')).toBe(4200);
    expect(parseGtfsTime('00:00:00')).toBe(0);
    expect(parseGtfsTime('08:03:30')).toBe(8 * 3600 + 3 * 60 + 30);
  });

  it('accepte les heures supérieures à 24h (services de nuit GTFS)', () => {
    // 25:10:00 = 1h10 le lendemain, rattaché à la journée d'exploitation
    // de la veille. C'est précisément ce que Date ne sait pas représenter.
    expect(parseGtfsTime('25:10:00')).toBe(90600);
    expect(parseGtfsTime('26:00:00')).toBe(93600);
  });

  it('accepte une heure écrite sur un seul chiffre', () => {
    expect(parseGtfsTime('1:10:00')).toBe(4200);
  });

  it('ignore les espaces autour de la valeur', () => {
    expect(parseGtfsTime('  08:00:00  ')).toBe(28800);
  });

  it('renvoie null pour un horaire invalide', () => {
    expect(parseGtfsTime('pas-une-heure')).toBeNull();
    expect(parseGtfsTime('08:00')).toBeNull();
    expect(parseGtfsTime('08:60:00')).toBeNull();
    expect(parseGtfsTime('08:00:60')).toBeNull();
    expect(parseGtfsTime('')).toBeNull();
    expect(parseGtfsTime(undefined)).toBeNull();
  });
});
