// =============================================================================
// Médiane (étape 4C-4-4)
// =============================================================================
// Une même liaison A→B est parcourue des dizaines de fois par jour. Pour en
// tirer UNE durée représentative, on prend la MÉDIANE et non la moyenne.
//
// Pourquoi ? Parce qu'un flux GTFS réel contient des valeurs aberrantes :
// un service exceptionnel, une erreur de saisie, un trajet de nuit à vide.
//
//   durées observées : 9, 10, 11, 60 minutes
//   moyenne  : 22,5 min  ← une seule valeur aberrante fausse tout
//   médiane  : 10,5 min  ← à peine déplacée
//
// La médiane est robuste : il faudrait que la MOITIÉ des valeurs soient
// aberrantes pour la déplacer sérieusement.
// =============================================================================

/**
 * Médiane d'une liste de nombres.
 *
 * - nombre impair de valeurs → la valeur du milieu ;
 * - nombre pair             → la moyenne des deux valeurs centrales,
 *                             qui peut donc être décimale.
 *
 * Renvoie null pour une liste vide : il n'existe pas de médiane de rien.
 */
export function mediane(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) {
    return null;
  }

  // On trie une COPIE : la liste d'origine ne doit pas être modifiée.
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);

  return triees.length % 2 === 1
    ? triees[milieu]
    : (triees[milieu - 1] + triees[milieu]) / 2;
}
