// =============================================================================
// Rapport d'import GTFS-Realtime (étape 4F-1C)
// =============================================================================
// Même principe qu'à l'étape 4C-4-2 : un flux réel contient toujours des cas
// que notre modèle ne sait pas représenter. La règle du projet est de ne
// JAMAIS écarter une alerte en silence — chaque entité rencontrée est
// comptée, et si elle n'est pas importée, on sait exactement pourquoi.
//
// La différence avec GtfsImportReport tient à la nature du flux : le GTFS
// statique décrit un réseau, ses défauts sont des erreurs de saisie. Ici, le
// flux est parfaitement valide — ce sont NOS limites de modélisation qui
// écartent des alertes. Les motifs ci-dessous ne disent donc pas « le flux
// est mauvais » mais « voici ce que notre modèle ne sait pas dire ».
// =============================================================================

/// Motifs pour lesquels une entité n'est PAS importée du tout.
export type GtfsRtRejectReason =
  /// L'entité ne porte pas d'alerte (trip_update, vehicle_position…).
  | 'notAnAlert'
  /// Entité marquée supprimée dans un flux incrémental.
  | 'deletedEntity'
  /// Sans identifiant, aucune idempotence possible.
  | 'missingEntityId'
  /// Aucune période d'activité : startTime serait indéterminable.
  | 'missingActivePeriod'
  /// Plusieurs périodes : le modèle n'en tient qu'une (voir carnet 4F-1C).
  | 'multipleActivePeriods'
  /// Période présente mais sans `start`.
  | 'missingPeriodStart'
  /// UNKNOWN_SEVERITY : l'opérateur dit ne pas savoir.
  | 'unknownSeverity'
  /// Aucune entité concernée représentable en stopIds/lineIds.
  | 'noRepresentableEntity'
  /// Plusieurs modes distincts, le modèle n'en tient qu'un.
  | 'ambiguousMode'
  /// Aucun mode déductible : lignes et arrêts inconnus de notre base.
  | 'undeterminableMode';

/// Motifs pour lesquels une `informed_entity` est écartée SANS rejeter
/// l'alerte elle-même. L'alerte est alors importée, mais avec une portée
/// PLUS ÉTROITE que celle annoncée — jamais plus large.
export type GtfsRtSelectorReason =
  /// Ciblage d'un trajet précis : `trip_id` n'a pas d'équivalent dans Alert.
  | 'tripSelector'
  /// Ciblage d'un exploitant entier : `agency_id` non plus.
  | 'agencySelector'
  /// Sélecteur sans aucun identifiant exploitable.
  | 'emptySelector';

/**
 * Bilan d'un import d'alertes GTFS-Realtime.
 *
 * DÉTERMINISTE, comme GtfsImportReport : aucune date, aucun identifiant
 * aléatoire. Deux imports du même flux produisent un rapport strictement
 * identique — c'est ce qui le rend comparable dans un test.
 *
 * Invariant garanti :
 *
 *     entities.total === entities.created + entities.updated + entities.rejected
 *
 * Autrement dit : toute entité lue a exactement un sort, et il est connu.
 */
export class GtfsRtImportReport {
  readonly entities = {
    /// Entités lues dans le flux, tous types confondus.
    total: 0,
    /// Parmi elles, celles qui portaient effectivement une alerte.
    alerts: 0,
    /// Alertes créées en base.
    created: 0,
    /// Alertes existantes mises à jour (même gtfsAlertId).
    updated: 0,
    /// Entités non importées, tous motifs confondus.
    rejected: 0,
  };

  readonly rejections: Record<GtfsRtRejectReason, number> = {
    notAnAlert: 0,
    deletedEntity: 0,
    missingEntityId: 0,
    missingActivePeriod: 0,
    multipleActivePeriods: 0,
    missingPeriodStart: 0,
    unknownSeverity: 0,
    noRepresentableEntity: 0,
    ambiguousMode: 0,
    undeterminableMode: 0,
  };

  readonly discardedSelectors: Record<GtfsRtSelectorReason, number> = {
    tripSelector: 0,
    agencySelector: 0,
    emptySelector: 0,
  };

  /// Alertes importées dont AU MOINS UNE entité concernée a été écartée.
  ///
  /// Compteur distinct des précédents, et pour une raison qui compte : ces
  /// alertes sont bien en base, mais elles annoncent une perturbation sur un
  /// périmètre plus étroit que celui publié par l'opérateur. C'est le seul
  /// endroit où cette perte devient visible.
  partiallyRepresented = 0;

  /// Une entité a été rencontrée dans le flux.
  countEntity(): void {
    this.entities.total += 1;
  }

  /// L'entité portait bien une alerte.
  countAlert(): void {
    this.entities.alerts += 1;
  }

  /// L'alerte n'existait pas en base : elle a été créée.
  countCreated(): void {
    this.entities.created += 1;
  }

  /// Une alerte de même gtfsAlertId existait : elle a été mise à jour.
  countUpdated(): void {
    this.entities.updated += 1;
  }

  /// L'entité n'est pas importée, pour le motif indiqué.
  countRejected(reason: GtfsRtRejectReason): void {
    this.entities.rejected += 1;
    this.rejections[reason] += 1;
  }

  /// Une `informed_entity` a été écartée sans rejeter l'alerte.
  countDiscardedSelector(reason: GtfsRtSelectorReason): void {
    this.discardedSelectors[reason] += 1;
  }

  /// L'alerte est importée, mais amputée d'au moins une entité concernée.
  countPartiallyRepresented(): void {
    this.partiallyRepresented += 1;
  }

  /// Vérifie l'invariant. Garde-fou : si cette méthode renvoie false, c'est
  /// qu'un chemin de code oublie de statuer sur une entité.
  isConsistent(): boolean {
    const { total, created, updated, rejected } = this.entities;
    return total === created + updated + rejected;
  }

  /// Résumé lisible, journalisé en fin d'import.
  toLines(): string[] {
    const { total, alerts, created, updated, rejected } = this.entities;

    const lignes = [
      "Bilan d'import GTFS-RT :",
      `  ${total} entités lues, dont ${alerts} alertes`,
      `  ${created} créées, ${updated} mises à jour, ${rejected} non importées`,
    ];

    const motifs = Object.entries(this.rejections).filter(([, n]) => n > 0);
    if (motifs.length > 0) {
      lignes.push('  Motifs de non-import :');
      for (const [motif, nombre] of motifs) {
        lignes.push(`    ${motif} : ${nombre}`);
      }
    }

    const ecartes = Object.entries(this.discardedSelectors).filter(
      ([, n]) => n > 0,
    );
    if (ecartes.length > 0) {
      lignes.push(
        '  Entités concernées écartées (alerte importée quand même) :',
      );
      for (const [motif, nombre] of ecartes) {
        lignes.push(`    ${motif} : ${nombre}`);
      }
    }

    if (this.partiallyRepresented > 0) {
      lignes.push(
        `  ${this.partiallyRepresented} alertes importées avec une portée ` +
          `plus étroite que celle annoncée`,
      );
    }

    return lignes;
  }
}
