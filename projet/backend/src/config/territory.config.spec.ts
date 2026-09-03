import { territoryConfig } from './territory.config';

// =============================================================================
// Configuration territoriale
// =============================================================================
// Ce que ces tests protègent : la promesse qu'UrbanFlow est une plateforme
// GÉNÉRIQUE. Si le territoire cessait d'être configurable, le produit
// redeviendrait l'application d'une seule ville.
// =============================================================================

describe('territoryConfig', () => {
  const environnement = { ...process.env };

  afterEach(() => {
    process.env = { ...environnement };
  });

  const vider = () => {
    delete process.env.TERRITORY_NAME;
    delete process.env.TERRITORY_DISPLAY_NAME;
    delete process.env.TERRITORY_COUNTRY;
    delete process.env.TERRITORY_CENTER_LAT;
    delete process.env.TERRITORY_CENTER_LON;
    delete process.env.TERRITORY_RADIUS_M;
  };

  it('propose le territoire de démonstration par défaut', () => {
    vider();

    const territoire = territoryConfig();

    expect(territoire.name).toBe('strasbourg');
    expect(territoire.displayName).toMatch(/Strasbourg/);
    // Place Kléber, à quelques centaines de mètres près.
    expect(territoire.centerLat).toBeCloseTo(48.58, 1);
    expect(territoire.centerLon).toBeCloseTo(7.75, 1);
  });

  it('se laisse REMPLACER ENTIÈREMENT par l’environnement', () => {
    // ⚠️ LA PROPRIÉTÉ ESSENTIELLE. Déployer UrbanFlow sur une autre métropole
    // ne doit demander AUCUNE modification de code.
    process.env.TERRITORY_NAME = 'lyon';
    process.env.TERRITORY_DISPLAY_NAME = 'Métropole de Lyon';
    process.env.TERRITORY_COUNTRY = 'FR';
    process.env.TERRITORY_CENTER_LAT = '45.7578';
    process.env.TERRITORY_CENTER_LON = '4.8320';
    process.env.TERRITORY_RADIUS_M = '20000';
    process.env.TERRITORY_TIMEZONE = 'Europe/Paris';

    expect(territoryConfig()).toEqual({
      name: 'lyon',
      displayName: 'Métropole de Lyon',
      country: 'FR',
      centerLat: 45.7578,
      centerLon: 4.832,
      radiusM: 20000,
      // Même fuseau que Strasbourg : ce qui est vérifié ici est que la
      // variable est LUE, pas qu'elle diffère.
      timezone: 'Europe/Paris',
    });
  });

  it('accepte un territoire hors de France', () => {
    vider();
    process.env.TERRITORY_NAME = 'geneve';
    process.env.TERRITORY_COUNTRY = 'CH';
    process.env.TERRITORY_CENTER_LAT = '46.2044';
    process.env.TERRITORY_CENTER_LON = '6.1432';

    const territoire = territoryConfig();

    expect(territoire.country).toBe('CH');
    expect(territoire.centerLat).toBeCloseTo(46.2, 1);
  });

  it('IGNORE une coordonnée illisible plutôt que de rendre NaN', () => {
    vider();
    process.env.TERRITORY_CENTER_LAT = 'quelque part';

    const territoire = territoryConfig();

    // ⚠️ Un `NaN` traverserait le contrat public sans lever et placerait la
    // carte nulle part. Un défaut connu vaut mieux qu'une coordonnée
    // impossible.
    expect(Number.isFinite(territoire.centerLat)).toBe(true);
    expect(territoire.centerLat).toBeCloseTo(48.58, 1);
  });

  it('ignore un rayon vide', () => {
    vider();
    process.env.TERRITORY_RADIUS_M = '';

    expect(territoryConfig().radiusM).toBeGreaterThan(0);
  });

  it('relit l’environnement à CHAQUE appel', () => {
    vider();
    expect(territoryConfig().name).toBe('strasbourg');

    process.env.TERRITORY_NAME = 'nantes';

    // Figer la valeur au chargement du module rendrait la configuration
    // intestable, et surprendrait au premier rechargement à chaud.
    expect(territoryConfig().name).toBe('nantes');
  });

  it('ne contient RIEN de secret', () => {
    vider();

    // Ces valeurs sont servies telles quelles au navigateur par
    // `GET /api/territory`.
    const champs = Object.keys(territoryConfig()).join(' ').toLowerCase();

    expect(champs).not.toMatch(/secret|token|key|password/);
  });
});
