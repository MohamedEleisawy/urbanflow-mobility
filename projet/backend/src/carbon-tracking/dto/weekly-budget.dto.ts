// Forme des données RENVOYÉES par GET /api/suivi-carbone/budget.
// Interface de sortie (pas de class-validator : on ne valide que ce qui
// ENTRE dans l'application, pas ce qui en sort).

export interface WeeklyBudgetDto {
  /** Année ISO — celle du jeudi de la semaine (voir iso-week.util.ts). */
  year: number;
  /** Numéro de semaine ISO, de 1 à 52 ou 53. */
  week: number;

  /**
   * Plafond que l'usager s'est fixé, en grammes de CO2.
   *
   * NULL quand il n'a jamais défini de préférences : la relation
   * `User → UserPreferences` est optionnelle. On ne suppose alors AUCUNE
   * valeur par défaut — inventer un plafond reviendrait à juger un usager
   * sur un objectif qu'il n'a pas choisi.
   */
  weeklyBudgetGrams: number | null;

  /** Consommation réelle de la semaine, somme des CarbonRecord. */
  consumedGrams: number;

  /**
   * Ce qu'il reste avant le plafond, jamais négatif.
   *
   * NULL exactement quand `weeklyBudgetGrams` l'est : sans plafond, il n'y
   * a rien à décompter.
   */
  remainingGrams: number | null;

  /**
   * Le plafond est-il dépassé ?
   *
   * NULL exactement quand `weeklyBudgetGrams` l'est. `false` signifierait
   * « non dépassé », ce qui serait une affirmation fausse : sans plafond,
   * la question n'a pas de réponse.
   *
   * ⚠️ Ces trois champs sont INDISSOCIABLES : soit tous renseignés, soit
   * tous nuls. `consumedGrams` et `tripCount`, eux, sont toujours des
   * nombres — la consommation existe indépendamment de tout objectif.
   */
  exceeded: boolean | null;

  /**
   * Nombre de TRAJETS de la semaine — pas d'enregistrements carbone.
   *
   * Il existe un `CarbonRecord` par SEGMENT (décision 4E) : un trajet en
   * trois segments produit trois lignes. Ce champ compte des `routeId`
   * DISTINCTS.
   */
  tripCount: number;
}
