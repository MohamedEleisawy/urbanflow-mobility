// =============================================================================
// Rapport d'import GTFS (étape 4C-4-2)
// =============================================================================
// Un flux GTFS réel contient toujours des imperfections. La règle du projet
// est de ne JAMAIS écarter une ligne en silence : chaque ligne rencontrée
// est comptée, et si elle n'est pas retenue, on sait pourquoi.
// =============================================================================

/// Les quatre fichiers que nous lisons.
export type GtfsFileName = 'stops' | 'routes' | 'trips' | 'stopTimes';

/// Motifs pour lesquels une ligne est INVALIDE (donnée inexploitable).
export type GtfsIgnoreReason =
  | 'missingRequiredField'
  | 'invalidCoordinates'
  | 'invalidNumber'
  | 'invalidTime'
  | 'unknownStop'
  | 'unknownTrip'
  | 'unknownRoute';

/// Motifs pour lesquels une ligne est CORRECTE mais volontairement écartée.
/// À distinguer des précédents : il n'y a rien à corriger dans le flux.
export type GtfsFilterReason = 'unsupportedLocationType';

interface CompteursFichier {
  total: number;
  valid: number;
  /// Lignes invalides (données inexploitables).
  ignored: number;
  /// Lignes valides mais écartées volontairement.
  filtered: number;
}

function compteursVides(): CompteursFichier {
  return { total: 0, valid: 0, ignored: 0, filtered: 0 };
}

/**
 * Bilan d'une lecture de flux GTFS.
 *
 * L'objet est volontairement DÉTERMINISTE : aucune date, aucun identifiant
 * aléatoire. Deux lectures du même flux produisent un rapport strictement
 * identique, ce qui le rend directement comparable dans les tests.
 *
 * Invariant garanti pour chaque fichier :
 *
 *     total === valid + ignored + filtered
 *
 * (`filtered` a été ajouté à l'énoncé initial pour distinguer « le flux
 * contient une erreur » de « nous avons choisi de ne pas traiter ce cas » :
 * ces deux situations n'appellent pas la même réaction.)
 */
export class GtfsImportReport {
  readonly files: Record<GtfsFileName, CompteursFichier> = {
    stops: compteursVides(),
    routes: compteursVides(),
    trips: compteursVides(),
    stopTimes: compteursVides(),
  };

  readonly errors: Record<GtfsIgnoreReason, number> = {
    missingRequiredField: 0,
    invalidCoordinates: 0,
    invalidNumber: 0,
    invalidTime: 0,
    unknownStop: 0,
    unknownTrip: 0,
    unknownRoute: 0,
  };

  readonly filtered: Record<GtfsFilterReason, number> = {
    unsupportedLocationType: 0,
  };

  /// Une ligne a été rencontrée dans le fichier.
  countRow(file: GtfsFileName): void {
    this.files[file].total += 1;
  }

  /// La ligne est exploitable.
  countValid(file: GtfsFileName): void {
    this.files[file].valid += 1;
  }

  /// La ligne est inexploitable, pour le motif indiqué.
  countIgnored(file: GtfsFileName, reason: GtfsIgnoreReason): void {
    this.files[file].ignored += 1;
    this.errors[reason] += 1;
  }

  /// La ligne est correcte mais volontairement non retenue.
  countFiltered(file: GtfsFileName, reason: GtfsFilterReason): void {
    this.files[file].filtered += 1;
    this.filtered[reason] += 1;
  }

  /// Vérifie l'invariant sur les quatre fichiers. Sert de garde-fou : si
  /// cette méthode renvoie false, c'est qu'un chemin de code oublie de
  /// compter une ligne.
  isConsistent(): boolean {
    return Object.values(this.files).every(
      (compteurs) =>
        compteurs.total ===
        compteurs.valid + compteurs.ignored + compteurs.filtered,
    );
  }

  /// Résumé lisible, destiné à être affiché en fin d'import.
  toLines(): string[] {
    const lignes = ['Bilan de lecture GTFS :'];

    for (const [nom, c] of Object.entries(this.files)) {
      lignes.push(
        `  ${nom.padEnd(10)} ${c.total} lues, ${c.valid} valides, ` +
          `${c.ignored} invalides, ${c.filtered} écartées`,
      );
    }

    const erreurs = Object.entries(this.errors).filter(([, n]) => n > 0);
    if (erreurs.length > 0) {
      lignes.push("  Motifs d'invalidité :");
      for (const [motif, nombre] of erreurs) {
        lignes.push(`    ${motif} : ${nombre}`);
      }
    }

    const ecartees = Object.entries(this.filtered).filter(([, n]) => n > 0);
    if (ecartees.length > 0) {
      lignes.push("  Motifs d'écartement volontaire :");
      for (const [motif, nombre] of ecartees) {
        lignes.push(`    ${motif} : ${nombre}`);
      }
    }

    return lignes;
  }
}
