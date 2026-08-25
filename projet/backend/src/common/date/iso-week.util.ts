/**
 * Découpage du temps en semaines ISO 8601 (étape 4E-5A).
 *
 * POURQUOI CETTE NORME. Le dossier de conception décrit un suivi carbone
 * « hebdomadaire » sans jamais préciser où commence une semaine. C'est donc
 * une DÉCISION DE CONCEPTION, au même titre que la formule de l'EcoScore
 * (étape 4D-3-1), et elle doit être présentée comme telle.
 *
 * ISO 8601 s'impose pour deux raisons : c'est la norme européenne (semaine
 * du LUNDI au DIMANCHE), et le modèle Prisma `CarbonBudget` porte déjà un
 * couple `(year, week)` qui n'a de sens qu'avec une convention de ce type.
 *
 * LA RÈGLE, en une phrase :
 *
 *     la semaine 1 est celle qui contient le PREMIER JEUDI de l'année.
 *
 * D'où une conséquence contre-intuitive mais essentielle : l'année d'une
 * semaine n'est PAS toujours celle de la date. Le 1er janvier 2027 (un
 * vendredi) appartient à la semaine 53 de 2026 ; le 30 décembre 2024 (un
 * lundi) appartient à la semaine 1 de 2025. C'est pourquoi l'année est
 * toujours lue sur le JEUDI de la semaine, jamais sur la date elle-même.
 *
 * TOUT EST CALCULÉ EN UTC, explicitement. Sans cela, le découpage
 * dépendrait du fuseau du serveur : un trajet du dimanche 23 h à Paris
 * basculerait dans la semaine suivante ou non selon la machine qui exécute
 * le code. Un suivi hebdomadaire ne peut pas dépendre de cela.
 */

const MILLISECONDES_PAR_JOUR = 86_400_000;
const JOURS_PAR_SEMAINE = 7;

/** Une semaine ISO, telle que `CarbonBudget` la représente déjà. */
export interface IsoWeek {
  /** Année ISO — celle du jeudi de la semaine, pas forcément celle de la date. */
  year: number;
  /** Numéro de semaine ISO, de 1 à 52 ou 53 selon les années. */
  week: number;
}

/**
 * Jour de la semaine au sens ISO : lundi = 1 … dimanche = 7.
 *
 * `getUTCDay()` place le dimanche à 0 : le convertir en 7 est ce qui fait du
 * lundi le début de semaine, et non le dimanche comme en usage américain.
 */
function jourIso(date: Date): number {
  const jour = date.getUTCDay();
  return jour === 0 ? JOURS_PAR_SEMAINE : jour;
}

/** Minuit UTC du jour donné : on ignore l'heure, seule la date compte. */
function minuitUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Année et numéro de semaine ISO d'une date.
 *
 * Fonction PURE : aucune horloge, aucun fuseau local, aucun effet de bord.
 * Elle se teste donc sur des dates absolues, dont les résultats sont
 * vérifiables dans n'importe quel calendrier.
 */
export function semaineIso(date: Date): IsoWeek {
  // Le jeudi de la même semaine porte l'année ISO. On s'y déplace.
  const jeudi = minuitUtc(date);
  jeudi.setUTCDate(jeudi.getUTCDate() + 4 - jourIso(date));

  const year = jeudi.getUTCFullYear();
  const premierJanvier = Date.UTC(year, 0, 1);

  // Nombre de semaines entières écoulées depuis le 1er janvier, plus une.
  const week =
    Math.floor(
      (jeudi.getTime() - premierJanvier) /
        MILLISECONDES_PAR_JOUR /
        JOURS_PAR_SEMAINE,
    ) + 1;

  return { year, week };
}

/**
 * Minuit UTC du lundi ouvrant la semaine ISO d'une date.
 *
 * Sert à borner une fenêtre de suivi : « les N dernières semaines »
 * commence au lundi de la semaine courante, reculé de N − 1 semaines.
 */
export function lundiDeLaSemaineIso(date: Date): Date {
  const lundi = minuitUtc(date);
  lundi.setUTCDate(lundi.getUTCDate() - (jourIso(date) - 1));
  return lundi;
}

/**
 * Début de la fenêtre couvrant les `semaines` dernières semaines, semaine
 * courante INCLUSE.
 *
 * `semaines = 1` renvoie donc le lundi de la semaine en cours.
 */
export function debutFenetreSemaines(reference: Date, semaines: number): Date {
  const debut = lundiDeLaSemaineIso(reference);
  debut.setUTCDate(debut.getUTCDate() - (semaines - 1) * JOURS_PAR_SEMAINE);
  return debut;
}

/**
 * Bornes d'une semaine ISO désignée par son couple `(year, week)`
 * — l'opération INVERSE de `semaineIso()` (étape 4E-5B).
 *
 * `debut` est inclus, `fin` est EXCLUE : c'est le lundi de la semaine
 * suivante. Une borne de fin inclusive obligerait à choisir une « dernière
 * milliseconde », qui laisserait passer ou perdrait les enregistrements
 * situés pile à la frontière selon la précision du stockage.
 *
 * Le point d'appui du calcul : **le 4 janvier appartient TOUJOURS à la
 * semaine 1**. C'est une conséquence directe de la règle ISO (la semaine 1
 * contient le premier jeudi) et cela évite d'énumérer les cas : le lundi de
 * la semaine 1 se déduit du 4 janvier, les autres s'en comptent.
 *
 * Conséquence à connaître : le lundi d'une semaine 1 tombe souvent dans
 * l'année civile PRÉCÉDENTE — la semaine 1 de 2026 commence le
 * 29 décembre 2025.
 */
export function bornesSemaineIso(
  year: number,
  week: number,
): { debut: Date; fin: Date } {
  const lundiSemaine1 = lundiDeLaSemaineIso(new Date(Date.UTC(year, 0, 4)));

  const debut = new Date(
    lundiSemaine1.getTime() +
      (week - 1) * JOURS_PAR_SEMAINE * MILLISECONDES_PAR_JOUR,
  );
  const fin = new Date(
    debut.getTime() + JOURS_PAR_SEMAINE * MILLISECONDES_PAR_JOUR,
  );

  return { debut, fin };
}
