// =============================================================================
// Conversion des horaires GTFS (étape 4C-4-2)
// =============================================================================
// GTFS exprime les horaires en "HH:MM:SS", mais avec une particularité qui
// interdit d'utiliser Date :
//
//   L'HEURE PEUT DÉPASSER 24.
//
// Un métro qui part à 0h10 le lendemain, sur le service de la veille, est
// noté 25:10:00. C'est voulu : cela permet de rattacher ce passage à la
// bonne journée d'exploitation, et non au lendemain calendaire.
//
// `new Date("25:10:00")` est invalide, et forcer ces horaires dans une Date
// obligerait à choisir une date de référence dont nous n'avons pas besoin.
// On convertit donc simplement en SECONDES DEPUIS MINUIT :
//
//   01:10:00 →  4 200
//   25:10:00 → 90 600
//
// Cette représentation suffit à calculer une durée (une soustraction), ce
// qui sera exactement le besoin de l'étape 4C-4-4.
// =============================================================================

// Heures sur 1 à 3 chiffres (GTFS tolère "1:10:00"), minutes et secondes
// obligatoirement entre 00 et 59.
const HORAIRE_GTFS = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;

/**
 * Convertit un horaire GTFS en secondes depuis minuit.
 * Renvoie null si la chaîne n'est pas un horaire exploitable — au lecteur
 * de compter la ligne comme ignorée.
 */
export function parseGtfsTime(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const resultat = HORAIRE_GTFS.exec(value.trim());

  if (!resultat) {
    return null;
  }

  const heures = Number(resultat[1]);
  const minutes = Number(resultat[2]);
  const secondes = Number(resultat[3]);

  return heures * 3600 + minutes * 60 + secondes;
}

// =============================================================================
// Dates de calendrier GTFS (sprint soutenance)
// =============================================================================
// GTFS écrit ses dates au format `YYYYMMDD` : « 20260903 ». Trois pièges, tous
// rencontrés :
//
//   1. `new Date("20260903")` est INVALIDE dans Node — la chaîne n'est pas un
//      format ISO reconnu. Il faut découper soi-même.
//
//   2. `new Date(2026, 8, 3)` construit un instant dans le fuseau du SERVEUR.
//      Sur un serveur à l'ouest de Greenwich, minuit local devient la veille
//      en UTC, et une colonne `date` stocke alors le 2 septembre. Une date de
//      calendrier n'a pas de fuseau : on la fabrique en UTC.
//
//   3. `Date.UTC(2026, 8, 31)` avec un mois à 30 jours donne le 1er octobre
//      SANS LEVER D'ERREUR. JavaScript reporte silencieusement. On vérifie
//      donc que la date reconstruite correspond bien à ce qui était écrit.
// =============================================================================

const DATE_GTFS = /^(\d{4})(\d{2})(\d{2})$/;

/**
 * Convertit une date GTFS `YYYYMMDD` en `Date` à midi UTC.
 *
 * ⚠️ MIDI ET NON MINUIT. À minuit UTC, un serveur affichant la date en heure
 * locale négative recule d'un jour. Midi laisse douze heures de marge de part
 * et d'autre — davantage que n'importe quel décalage horaire terrestre.
 *
 * Renvoie `null` si la chaîne n'est pas une date exploitable : au lecteur de
 * compter la ligne comme ignorée plutôt que de deviner.
 */
export function parseGtfsDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const resultat = DATE_GTFS.exec(value.trim());

  if (!resultat) {
    return null;
  }

  const annee = Number(resultat[1]);
  const mois = Number(resultat[2]);
  const jour = Number(resultat[3]);

  const date = new Date(Date.UTC(annee, mois - 1, jour, 12, 0, 0));

  // ⚠️ LE CONTRÔLE DE REPORT. `Date.UTC(2026, 1, 31)` rend le 3 mars sans
  // broncher : sans cette vérification, un « 20260231 » deviendrait une date
  // valide et fausse.
  if (
    date.getUTCFullYear() !== annee ||
    date.getUTCMonth() !== mois - 1 ||
    date.getUTCDate() !== jour
  ) {
    return null;
  }

  return date;
}
