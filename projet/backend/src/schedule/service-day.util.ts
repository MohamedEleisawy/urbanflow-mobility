// =============================================================================
// Le JOUR DE SERVICE, et pourquoi ce n'est pas la date d'aujourd'hui
// =============================================================================
// Un réseau de transport ne compte pas les jours comme un calendrier.
//
//   Il est 00 h 40, la nuit de samedi à dimanche. Le bus N3 passe. Sur quel
//   service circule-t-il ? Pas celui du dimanche : celui du SAMEDI. GTFS
//   l'écrit « 24:40:00 » — vingt-quatre heures quarante après le samedi
//   00 h 00.
//
// Un usager qui consulte les horaires à 00 h 40 doit donc voir les passages
// rattachés à la veille. Chercher dans le service du jour calendaire ne
// rendrait rien, et l'écran annoncerait « aucun passage » sur un arrêt où le
// bus arrive dans trois minutes.
//
// ═══ CE QUE CE MODULE FAIT ═══
//
// Il traduit un INSTANT (un `Date`, sans ambiguïté) en deux jours de service
// candidats, exprimés dans le fuseau du RÉSEAU :
//
//   - le jour calendaire lui-même, à partir de son heure locale ;
//   - la veille, dont les passages « après minuit » n'ont pas encore eu lieu.
//
// ═══ POURQUOI LE FUSEAU DU RÉSEAU, ET NON CELUI DU SERVEUR ═══
//
// Un horaire GTFS est en heure locale du réseau. Sur un serveur hébergé en
// UTC — le cas normal en conteneur — `date.getHours()` rend 06 h quand il est
// 08 h à Strasbourg : l'application annoncerait des passages déjà partis.
//
// D'où `Intl.DateTimeFormat` avec le fuseau du territoire, qui gère aussi le
// changement d'heure sans qu'on ait à y penser.
// =============================================================================

/// Secondes dans une journée. Nommée parce qu'elle apparaît dans des calculs
/// où « 86400 » ne se lit pas.
export const SECONDES_PAR_JOUR = 86_400;

export interface JourDeService {
  /**
   * La date du jour de service, à midi UTC.
   *
   * ⚠️ MIDI, comme les dates de `calendar.txt`. Les deux se comparent
   * directement, sans qu'un décalage de fuseau puisse en faire basculer une.
   */
  date: Date;

  /**
   * Position du curseur dans ce jour de service, en secondes depuis son
   * minuit local.
   *
   * ⚠️ PEUT DÉPASSER 86 400 pour le jour de la veille : à 00 h 40, on est à
   * 88 800 secondes du samedi. C'est exactement l'échelle de `departureSec`,
   * qui accepte « 24:40:00 ».
   */
  secondes: number;

  /// 0 = lundi … 6 = dimanche. L'ordre des colonnes de `calendar.txt`.
  jourSemaine: number;
}

/**
 * Décompose un instant dans le fuseau donné.
 *
 * `formatToParts` plutôt qu'un décalage calculé à la main : lui seul gère
 * correctement les changements d'heure, où un jour dure 23 ou 25 heures.
 */
function partiesLocales(instant: Date, fuseau: string) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parties: Record<string, string> = {};

  for (const partie of format.formatToParts(instant)) {
    parties[partie.type] = partie.value;
  }

  return {
    annee: Number(parties.year),
    mois: Number(parties.month),
    jour: Number(parties.day),
    // ⚠️ `hour` PEUT VALOIR « 24 » à minuit pile selon la locale et le moteur
    // (`en-CA` en heures 24 rend « 24 » pour 00 h dans certaines versions de
    // Node). Un modulo le ramène à 0 ; sans lui, minuit compterait 86 400
    // secondes et basculerait dans le jour suivant.
    heure: Number(parties.hour) % 24,
    minute: Number(parties.minute),
    seconde: Number(parties.second),
  };
}

/**
 * Le jour de service correspondant à un instant, dans le fuseau du réseau.
 */
export function jourDeService(instant: Date, fuseau: string): JourDeService {
  const p = partiesLocales(instant, fuseau);
  const date = new Date(Date.UTC(p.annee, p.mois - 1, p.jour, 12, 0, 0));

  // `getUTCDay()` rend 0 pour dimanche : on décale pour que lundi vaille 0,
  // l'ordre des colonnes de `calendar.txt`.
  const jourSemaine = (date.getUTCDay() + 6) % 7;

  return {
    date,
    secondes: p.heure * 3600 + p.minute * 60 + p.seconde,
    jourSemaine,
  };
}

/**
 * Les DEUX jours de service dans lesquels un passage peut encore avoir lieu.
 *
 * Le premier est le jour courant ; le second est la veille, dont les passages
 * « après minuit » (`departureSec >= 86 400`) sont encore à venir.
 *
 * ⚠️ LA VEILLE EST TOUJOURS INCLUSE, y compris à 15 h. Elle ne rapporte alors
 * rien — aucun service ne publie de passage à 39 heures — mais l'exclure
 * demanderait un seuil arbitraire (« avant 5 h du matin ») que rien ne
 * justifie : certains réseaux vont jusqu'à 27 h, d'autres jusqu'à 30 h.
 * Laisser la donnée trancher coûte une requête de plus et ne peut pas se
 * tromper.
 */
export function joursDeServiceCandidats(
  instant: Date,
  fuseau: string,
): JourDeService[] {
  const courant = jourDeService(instant, fuseau);

  const dateVeille = new Date(courant.date);
  dateVeille.setUTCDate(dateVeille.getUTCDate() - 1);

  return [
    courant,
    {
      date: dateVeille,
      secondes: courant.secondes + SECONDES_PAR_JOUR,
      jourSemaine: (courant.jourSemaine + 6) % 7,
    },
  ];
}
