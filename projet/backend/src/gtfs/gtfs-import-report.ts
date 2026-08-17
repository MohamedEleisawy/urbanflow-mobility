// =============================================================================
// Rapport d'import GTFS (étape 4C-4-2)
// =============================================================================
// Un flux GTFS réel contient toujours des imperfections. La règle du projet
// est de ne JAMAIS écarter une ligne en silence : chaque ligne rencontrée
// est comptée, et si elle n'est pas retenue, on sait pourquoi.
// =============================================================================

import { describeRouteType } from './route-type.mapping';

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

  /// Nombre d'entités réellement ÉCRITES en base (étape 4C-4-3).
  ///
  /// À ne pas confondre avec `files.*.valid`, qui compte les lignes
  /// correctement LUES. Une ligne peut être parfaitement valide et ne pas
  /// être importée : c'est le cas d'une ligne de train, dont le route_type
  /// n'a pas d'équivalent dans notre enum.
  readonly imported: Record<'stops' | 'transitLines' | 'networkLinks', number> =
    {
      stops: 0,
      transitLines: 0,
      networkLinks: 0,
    };

  /// Paires d'arrêts consécutifs rencontrées lors de la construction du
  /// réseau (étape 4C-4-4). Une paire est un candidat de liaison ; plusieurs
  /// paires identiques se regroupent ensuite en UNE seule NetworkLink.
  readonly pairs: { total: number; valid: number; invalidDuration: number } = {
    total: 0,
    valid: 0,
    invalidDuration: 0,
  };

  /// Anomalies de structure du flux, sans gravité mais à signaler.
  readonly anomalies: { unsortedStopTimes: number } = {
    unsortedStopTimes: 0,
  };

  /// route_type non traduits, comptés PAR TYPE.
  ///
  /// On ne se contente pas d'un total : savoir qu'un flux contient
  /// 40 lignes de train et 2 de ferry est bien plus utile pour décider si
  /// l'enum ModeTransport doit un jour être étendu.
  readonly unsupportedRouteTypes: Record<number, number> = {};

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

  /// Une entité a été écrite (créée ou mise à jour) en base.
  countImported(entity: 'stops' | 'transitLines' | 'networkLinks'): void {
    this.imported[entity] += 1;
  }

  /// Une paire d'arrêts consécutifs exploitable.
  countValidPair(): void {
    this.pairs.total += 1;
    this.pairs.valid += 1;
  }

  /// Une paire dont les horaires ne permettent pas de calculer une durée
  /// (arrivée antérieure au départ, par exemple).
  countInvalidPair(): void {
    this.pairs.total += 1;
    this.pairs.invalidDuration += 1;
  }

  /// stop_times.txt n'était pas groupé par trajet : un trajet déjà traité
  /// réapparaît plus loin dans le fichier.
  countUnsortedStopTimes(): void {
    this.anomalies.unsortedStopTimes += 1;
  }

  /// Une ligne valide n'a pas pu être importée faute de mode équivalent.
  countUnsupportedRouteType(routeType: number): void {
    this.unsupportedRouteTypes[routeType] =
      (this.unsupportedRouteTypes[routeType] ?? 0) + 1;
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

    if (this.pairs.total > 0) {
      lignes.push(
        `  Paires d'arrêts consécutifs : ${this.pairs.total} ` +
          `(${this.pairs.valid} exploitables, ` +
          `${this.pairs.invalidDuration} à durée invalide)`,
      );
    }

    if (this.anomalies.unsortedStopTimes > 0) {
      lignes.push(
        `  Anomalie : stop_times.txt non groupé par trajet ` +
          `(${this.anomalies.unsortedStopTimes} reprises)`,
      );
    }

    if (
      this.imported.stops > 0 ||
      this.imported.transitLines > 0 ||
      this.imported.networkLinks > 0
    ) {
      lignes.push('  Écrits en base :');
      lignes.push(`    arrêts   : ${this.imported.stops}`);
      lignes.push(`    lignes   : ${this.imported.transitLines}`);
      lignes.push(`    liaisons : ${this.imported.networkLinks}`);
    }

    const nonSupportes = Object.entries(this.unsupportedRouteTypes);
    if (nonSupportes.length > 0) {
      lignes.push('  Lignes non importées (mode sans équivalent) :');
      for (const [type, nombre] of nonSupportes) {
        lignes.push(
          `    route_type ${describeRouteType(Number(type))} : ${nombre}`,
        );
      }
    }

    return lignes;
  }
}
