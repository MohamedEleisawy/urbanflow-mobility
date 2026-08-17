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
