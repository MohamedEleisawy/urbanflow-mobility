import {
  bornesSemaineIso,
  debutFenetreSemaines,
  lundiDeLaSemaineIso,
  semaineIso,
} from './iso-week.util';

// Tests de la fonction PURE : aucune base, aucune horloge, uniquement des
// dates absolues dont le résultat est vérifiable dans n'importe quel
// calendrier ISO. C'est ce qui rend ces cas limites testables sans effort.
const utc = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

describe('semaineIso', () => {
  it('numérote une semaine ordinaire', () => {
    expect(semaineIso(utc('2026-08-24'))).toEqual({ year: 2026, week: 35 });
  });

  // ---------------------------------------------------------------------------
  // Lundi → dimanche : la frontière de semaine
  // ---------------------------------------------------------------------------
  it('place le lundi et le dimanche suivant dans la MÊME semaine', () => {
    // 24 août 2026 = lundi, 30 août = dimanche. En convention américaine
    // (semaine commençant le dimanche), ils seraient séparés.
    expect(semaineIso(utc('2026-08-24'))).toEqual(
      semaineIso(utc('2026-08-30')),
    );
  });

  it('bascule de semaine au lundi suivant, pas avant', () => {
    expect(semaineIso(utc('2026-08-30'))).toEqual({ year: 2026, week: 35 });
    expect(semaineIso(utc('2026-08-31'))).toEqual({ year: 2026, week: 36 });
  });

  // ---------------------------------------------------------------------------
  // Le piège : l'année de la semaine n'est pas celle de la date
  // ---------------------------------------------------------------------------
  it('rattache le 1er janvier 2027 à la semaine 53 de 2026', () => {
    // Vendredi 1er janvier 2027 : le jeudi de sa semaine est le 31 décembre
    // 2026. Lire `getUTCFullYear()` sur la date donnerait 2027 — et
    // couperait une semaine en deux.
    expect(semaineIso(utc('2027-01-01'))).toEqual({ year: 2026, week: 53 });
  });

  it('rattache le 30 décembre 2024 à la semaine 1 de 2025', () => {
    // Le cas symétrique : une date de décembre appartenant à l'année ISO
    // SUIVANTE.
    expect(semaineIso(utc('2024-12-30'))).toEqual({ year: 2025, week: 1 });
  });

  it('rattache le 1er janvier 2021 à la semaine 53 de 2020', () => {
    expect(semaineIso(utc('2021-01-01'))).toEqual({ year: 2020, week: 53 });
  });

  it('garde une semaine à cheval sur deux années dans UNE seule clé', () => {
    // Du lundi 28 décembre 2026 au dimanche 3 janvier 2027 : sept jours,
    // deux années civiles, une seule semaine ISO.
    const semaine = { year: 2026, week: 53 };
    expect(semaineIso(utc('2026-12-28'))).toEqual(semaine);
    expect(semaineIso(utc('2026-12-31'))).toEqual(semaine);
    expect(semaineIso(utc('2027-01-01'))).toEqual(semaine);
    expect(semaineIso(utc('2027-01-03'))).toEqual(semaine);
    // ...et le lundi suivant ouvre bien la semaine 1 de 2027.
    expect(semaineIso(utc('2027-01-04'))).toEqual({ year: 2027, week: 1 });
  });

  // ---------------------------------------------------------------------------
  // Semaine 1 et années à 53 semaines
  // ---------------------------------------------------------------------------
  it('donne la semaine 1 à une année dont le 1er janvier est un jeudi', () => {
    // La règle ISO : la semaine 1 est celle qui contient le premier jeudi.
    expect(semaineIso(utc('2026-01-01'))).toEqual({ year: 2026, week: 1 });
  });

  it('reconnaît les années à 53 semaines', () => {
    // 2026 et 2020 en comptent 53 : toutes les années n'ont pas 52 semaines.
    expect(semaineIso(utc('2026-12-31')).week).toBe(53);
    expect(semaineIso(utc('2020-12-31')).week).toBe(53);
  });

  it('traite une année bissextile sans décalage', () => {
    // 29 février 2028 : le jour supplémentaire ne doit pas décaler la
    // numérotation.
    expect(semaineIso(utc('2028-02-29'))).toEqual({ year: 2028, week: 9 });
  });

  // ---------------------------------------------------------------------------
  // UTC explicite
  // ---------------------------------------------------------------------------
  it('découpe en UTC, sans dépendre de l’heure de la journée', () => {
    // Même jour, trois heures différentes : une seule semaine. Sans calcul
    // en UTC, un dimanche 23 h basculerait selon le fuseau du serveur.
    const dimanche = '2026-08-30';
    const debut = semaineIso(new Date(`${dimanche}T00:00:00.000Z`));
    const fin = semaineIso(new Date(`${dimanche}T23:59:59.999Z`));

    expect(debut).toEqual({ year: 2026, week: 35 });
    expect(fin).toEqual(debut);
  });

  it('bascule exactement à minuit UTC, pas avant', () => {
    // Dernière milliseconde du dimanche, puis première du lundi.
    expect(semaineIso(new Date('2026-08-30T23:59:59.999Z')).week).toBe(35);
    expect(semaineIso(new Date('2026-08-31T00:00:00.000Z')).week).toBe(36);
  });
});

describe('lundiDeLaSemaineIso', () => {
  it('renvoie le lundi à minuit UTC', () => {
    expect(lundiDeLaSemaineIso(utc('2026-08-27')).toISOString()).toBe(
      '2026-08-24T00:00:00.000Z',
    );
  });

  it('renvoie le jour même quand la date EST un lundi', () => {
    expect(lundiDeLaSemaineIso(utc('2026-08-24')).toISOString()).toBe(
      '2026-08-24T00:00:00.000Z',
    );
  });

  it('remonte au lundi précédent depuis un dimanche', () => {
    // Le piège inverse : un dimanche appartient à la semaine qui COMMENCE
    // six jours plus tôt, pas à celle qui débute le lendemain.
    expect(lundiDeLaSemaineIso(utc('2026-08-30')).toISOString()).toBe(
      '2026-08-24T00:00:00.000Z',
    );
  });

  it('franchit correctement une fin d’année', () => {
    expect(lundiDeLaSemaineIso(utc('2027-01-01')).toISOString()).toBe(
      '2026-12-28T00:00:00.000Z',
    );
  });
});

describe('debutFenetreSemaines', () => {
  it('renvoie le lundi courant pour une fenêtre d’une semaine', () => {
    // Semaine courante INCLUSE : une fenêtre de 1 s'arrête au lundi du jour.
    expect(debutFenetreSemaines(utc('2026-08-27'), 1).toISOString()).toBe(
      '2026-08-24T00:00:00.000Z',
    );
  });

  it('recule de N − 1 semaines, semaine courante incluse', () => {
    // 12 semaines depuis la semaine du 24 août : on remonte de 11 semaines.
    expect(debutFenetreSemaines(utc('2026-08-27'), 12).toISOString()).toBe(
      '2026-06-08T00:00:00.000Z',
    );
  });

  it('franchit une fin d’année sans erreur de calendrier', () => {
    expect(debutFenetreSemaines(utc('2027-01-06'), 3).toISOString()).toBe(
      '2026-12-21T00:00:00.000Z',
    );
  });

  it('couvre exactement N semaines complètes', () => {
    // Le début de fenêtre doit lui-même appartenir à la N-ième semaine
    // avant la courante — sinon on ramènerait une semaine de trop ou de
    // moins.
    const reference = utc('2026-08-27');
    const debut = debutFenetreSemaines(reference, 4);

    expect(semaineIso(debut)).toEqual({ year: 2026, week: 32 });
    expect(semaineIso(reference)).toEqual({ year: 2026, week: 35 });
  });
});

describe('bornesSemaineIso', () => {
  it('renvoie le lundi et le lundi suivant', () => {
    const { debut, fin } = bornesSemaineIso(2026, 35);

    expect(debut.toISOString()).toBe('2026-08-24T00:00:00.000Z');
    // Borne de FIN EXCLUE : le lundi de la semaine suivante.
    expect(fin.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('couvre exactement sept jours', () => {
    const { debut, fin } = bornesSemaineIso(2026, 12);

    expect(fin.getTime() - debut.getTime()).toBe(7 * 86_400_000);
  });

  it('fait commencer la semaine 1 dans l’année civile PRÉCÉDENTE', () => {
    // Conséquence de la règle ISO, et le piège de cette fonction : le lundi
    // de la semaine 1 de 2026 tombe le 29 décembre 2025.
    expect(bornesSemaineIso(2026, 1).debut.toISOString()).toBe(
      '2025-12-29T00:00:00.000Z',
    );
    expect(bornesSemaineIso(2025, 1).debut.toISOString()).toBe(
      '2024-12-30T00:00:00.000Z',
    );
  });

  it('gère la semaine 53 des années qui en comptent 53', () => {
    expect(bornesSemaineIso(2026, 53).debut.toISOString()).toBe(
      '2026-12-28T00:00:00.000Z',
    );
    // Sa borne de fin ouvre la semaine 1 de 2027.
    expect(bornesSemaineIso(2026, 53).fin.toISOString()).toBe(
      bornesSemaineIso(2027, 1).debut.toISOString(),
    );
  });

  it('est exactement l’inverse de semaineIso', () => {
    // Aller-retour : (year, week) → lundi → (year, week). Les cas limites
    // sont ceux où l'année civile et l'année ISO divergent.
    const cas = [
      { year: 2026, week: 35 },
      { year: 2026, week: 1 },
      { year: 2026, week: 53 },
      { year: 2027, week: 1 },
      { year: 2025, week: 1 },
      { year: 2020, week: 53 },
      { year: 2021, week: 1 },
    ];

    for (const attendu of cas) {
      const { debut } = bornesSemaineIso(attendu.year, attendu.week);
      expect(semaineIso(debut)).toEqual(attendu);
    }
  });

  it('enchaîne les semaines sans trou ni recouvrement', () => {
    // La fin d'une semaine EST le début de la suivante : aucun
    // enregistrement ne peut tomber entre les deux, ni compter deux fois.
    for (let week = 1; week < 53; week++) {
      expect(bornesSemaineIso(2026, week).fin.toISOString()).toBe(
        bornesSemaineIso(2026, week + 1).debut.toISOString(),
      );
    }
  });
});
