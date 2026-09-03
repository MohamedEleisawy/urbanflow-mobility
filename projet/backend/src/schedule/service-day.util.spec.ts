import {
  jourDeService,
  joursDeServiceCandidats,
  SECONDES_PAR_JOUR,
} from './service-day.util';

// =============================================================================
// Ce que ces tests protègent
// =============================================================================
// Deux bogues, tous deux invisibles en développement et systématiques en
// production :
//
//   1. LE FUSEAU. Un serveur en UTC calcule « 06 h » quand il est 08 h à
//      Strasbourg, et annonce comme prochains des passages déjà partis. Ce
//      décalage ne se voit jamais sur un poste de développement réglé sur
//      l'heure de Paris.
//
//   2. LE JOUR DE SERVICE. À 00 h 40, les passages en cours appartiennent au
//      service de la VEILLE. Chercher dans celui du jour ne rend rien, et
//      l'écran affiche « aucun passage » sur un arrêt où le bus arrive.
//
// ⚠️ LES INSTANTS SONT ÉCRITS EN UTC (`Z`), jamais en heure locale. Un test
// écrit « 08:00 » sans fuseau passerait sur une machine française et
// échouerait en intégration continue.
// =============================================================================

const PARIS = 'Europe/Paris';

describe('jourDeService', () => {
  it('lit l’heure DANS LE FUSEAU DU RÉSEAU, pas dans celui du serveur', () => {
    // 3 septembre 2026, 06:00 UTC = 08:00 à Strasbourg (heure d'été).
    const jour = jourDeService(new Date('2026-09-03T06:00:00Z'), PARIS);

    expect(jour.secondes).toBe(8 * 3600);
    expect(jour.date.toISOString().slice(0, 10)).toBe('2026-09-03');
  });

  it('suit le CHANGEMENT D’HEURE sans qu’on ait à le prévoir', () => {
    // 3 janvier 2026 : heure d'hiver, décalage +1 et non +2.
    const jour = jourDeService(new Date('2026-01-03T07:00:00Z'), PARIS);

    expect(jour.secondes).toBe(8 * 3600);
  });

  it('numérote les jours comme les colonnes de calendar.txt (0 = lundi)', () => {
    // 3 septembre 2026 est un JEUDI.
    expect(
      jourDeService(new Date('2026-09-03T10:00:00Z'), PARIS).jourSemaine,
    ).toBe(3);

    // 6 septembre 2026 est un DIMANCHE : la colonne la plus à droite.
    expect(
      jourDeService(new Date('2026-09-06T10:00:00Z'), PARIS).jourSemaine,
    ).toBe(6);
  });

  it('place la date à MIDI UTC, hors d’atteinte de tout décalage', () => {
    // ⚠️ À minuit UTC, un serveur affichant la date en heure locale négative
    // reculerait d'un jour, et la comparaison avec `calendar.startDate`
    // basculerait. Midi laisse douze heures de marge des deux côtés.
    const jour = jourDeService(new Date('2026-09-03T23:30:00Z'), PARIS);

    expect(jour.date.getUTCHours()).toBe(12);
  });

  it('rend 0 seconde à MINUIT PILE, jamais 86 400', () => {
    // Le piège : certaines versions de Node formatent minuit « 24 » en
    // horloge 24 h. Sans modulo, minuit compterait une journée entière et
    // basculerait dans le jour suivant.
    const jour = jourDeService(new Date('2026-09-02T22:00:00Z'), PARIS);

    expect(jour.secondes).toBe(0);
    expect(jour.date.toISOString().slice(0, 10)).toBe('2026-09-03');
  });
});

describe('joursDeServiceCandidats', () => {
  it('propose le jour courant ET la veille', () => {
    const jours = joursDeServiceCandidats(
      new Date('2026-09-03T12:00:00Z'),
      PARIS,
    );

    expect(jours).toHaveLength(2);
    expect(jours[0].date.toISOString().slice(0, 10)).toBe('2026-09-03');
    expect(jours[1].date.toISOString().slice(0, 10)).toBe('2026-09-02');
  });

  it('DÉCALE LE CURSEUR D’UNE JOURNÉE sur le jour de la veille', () => {
    // C'est TOUT le mécanisme. À 00 h 40 le vendredi, on est à 40 minutes du
    // vendredi — mais à 24 h 40 du jeudi, l'échelle exacte dans laquelle GTFS
    // écrit ses passages de nuit.
    const jours = joursDeServiceCandidats(
      new Date('2026-09-03T22:40:00Z'),
      PARIS,
    );

    expect(jours[0].secondes).toBe(40 * 60);
    expect(jours[1].secondes).toBe(40 * 60 + SECONDES_PAR_JOUR);
  });

  it('recule aussi le JOUR DE SEMAINE de la veille', () => {
    // 3 septembre 2026 est un jeudi (3) ; sa veille est un mercredi (2).
    // Sans ce décalage, on chercherait les passages de nuit du jeudi dans le
    // calendrier du jeudi — et l'on raterait le service du mercredi soir.
    const jours = joursDeServiceCandidats(
      new Date('2026-09-03T12:00:00Z'),
      PARIS,
    );

    expect(jours[0].jourSemaine).toBe(3);
    expect(jours[1].jourSemaine).toBe(2);
  });

  it('fait reculer LUNDI vers DIMANCHE, et non vers −1', () => {
    // 7 septembre 2026 est un lundi (0). `(0 + 6) % 7` doit rendre 6.
    const jours = joursDeServiceCandidats(
      new Date('2026-09-07T12:00:00Z'),
      PARIS,
    );

    expect(jours[0].jourSemaine).toBe(0);
    expect(jours[1].jourSemaine).toBe(6);
  });

  it('recule correctement au CHANGEMENT DE MOIS', () => {
    const jours = joursDeServiceCandidats(
      new Date('2026-09-01T12:00:00Z'),
      PARIS,
    );

    expect(jours[1].date.toISOString().slice(0, 10)).toBe('2026-08-31');
  });
});
