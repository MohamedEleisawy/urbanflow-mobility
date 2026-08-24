// Formes des données RENVOYÉES par GET /api/suivi-carbone.
// Ce sont de simples interfaces de sortie (pas de class-validator : on ne
// valide que ce qui ENTRE dans l'application, pas ce qui en sort).

/** Bilan carbone d'une semaine ISO pour un usager. */
export interface WeeklyCarbonDto {
  /** Année ISO — celle du jeudi de la semaine (voir iso-week.util.ts). */
  year: number;
  /** Numéro de semaine ISO, de 1 à 52 ou 53. */
  week: number;

  /** Grammes de CO2 émis sur la semaine. */
  co2Grams: number;
  /** Grammes évités par rapport à la voiture individuelle. */
  savedVsCarGrams: number;

  /**
   * Nombre de TRAJETS de la semaine — pas d'enregistrements carbone.
   *
   * La distinction est essentielle : il existe un `CarbonRecord` par
   * SEGMENT (décision 4E). Un trajet en trois segments produit trois
   * lignes ; les compter donnerait trois trajets au lieu d'un. Ce champ
   * compte donc des `routeId` DISTINCTS.
   */
  tripCount: number;
}

export interface CarbonTrackingDto {
  /** Semaines contenant au moins un trajet, de la plus récente à la plus ancienne. */
  weeks: WeeklyCarbonDto[];

  /**
   * Fenêtre effectivement appliquée.
   *
   * Une réponse bornée doit dire QUELLE borne l'a été : sans cela, le
   * client ne peut pas distinguer « voici tout votre historique » de
   * « voici les 12 dernières semaines ». Même rôle que `page` et `limit`
   * dans l'historique paginé (étape 4E-4A).
   */
  weeksRequested: number;
}
