import { AlertSeverity, ModeTransport } from '@prisma/client';

// Formes des données RENVOYÉES par GET /api/alerts (étape 4F-2B).
//
// De simples interfaces de sortie, comme weekly-tracking.dto.ts (4E-5A) : on
// ne valide que ce qui ENTRE dans l'application, pas ce qui en sort. Aucun
// class-validator ici.

/** Une ligne concernée par une perturbation. */
export interface AlertLineDto {
  /** Identifiant GTFS de la ligne (`route_id`), tel que publié par l'opérateur. */
  id: string;

  /**
   * Nom affiché de la ligne — « 38 », « A »…
   *
   * NULL quand la ligne est absente de notre référentiel. Cela arrive
   * réellement : un flux temps réel peut citer une ligne créée après notre
   * dernier import GTFS statique. On conserve alors l'identifiant plutôt que
   * d'écarter l'alerte — mieux vaut « perturbation sur ROUTE_A » que le
   * silence.
   */
  name: string | null;
}

/** Une perturbation en cours, telle que la lit un voyageur. */
export interface AlertDto {
  /**
   * Identifiant de l'alerte dans le flux de l'opérateur (`gtfsAlertId`).
   *
   * CE N'EST PAS notre UUID interne, et c'est délibéré : celui-ci n'a aucun
   * sens hors de notre base, et exposer deux identifiants pour la même chose
   * invite à utiliser le mauvais. `gtfsAlertId` est unique, stable d'un
   * import à l'autre (c'est la clé de l'idempotence, 4F-1C), et c'est celui
   * qu'un futur acquittement utiliserait.
   */
  id: string;

  /**
   * Titre et description rédigés PAR L'OPÉRATEUR (étape 4F-2A).
   *
   * NULL quand le flux n'en publie pas. Aucun texte n'est jamais fabriqué à
   * partir de `cause` et `effect` : ce serait notre phrase présentée comme
   * celle de l'opérateur.
   */
  headerText: string | null;
  descriptionText: string | null;

  /** Arrêts concernés, par leur identifiant GTFS (`stop_id`). */
  stopIds: string[];

  /** Lignes concernées, avec leur nom quand nous le connaissons. */
  lines: AlertLineDto[];

  /** Mode de transport touché, déduit du référentiel à l'import (4F-1C). */
  mode: ModeTransport;

  /** INFO, WARNING ou SEVERE — jamais « inconnu » : 4F-1C rejette ce cas. */
  severity: AlertSeverity;

  /** Vocabulaire GTFS-RT conservé tel quel : "MAINTENANCE", "STRIKE"… */
  cause: string;
  effect: string;

  /** Début de la perturbation, en ISO 8601 UTC. */
  startTime: Date;

  /**
   * Fin annoncée, ou NULL si l'opérateur n'en a pas donné.
   *
   * Une alerte sans fin reste active tant qu'elle a commencé (4F-1A) :
   * aucune échéance n'est inventée pour combler ce vide.
   */
  endTime: Date | null;
}

/** Réponse de GET /api/alerts. */
export interface AlertsResponseDto {
  /** Les perturbations en cours, de la plus grave à la plus anodine. */
  items: AlertDto[];

  /**
   * Plafond appliqué par le serveur.
   *
   * L'endpoint n'est pas paginé — les alertes actives forment un ensemble
   * global et naturellement borné, qui se vide à mesure que les
   * perturbations se terminent. Mais une requête non bornée reste une
   * requête non bornée : le plafond existe pour qu'un opérateur défaillant
   * publiant des milliers d'alertes ne puisse pas faire tomber l'API.
   */
  limit: number;

  /**
   * Vrai si le plafond a été atteint et que des alertes ont été omises.
   *
   * TOUJOURS PRÉSENT, même à false. Sans lui, le client ne peut pas
   * distinguer « voici toutes les perturbations » de « en voici 200 sur
   * 3 000 » — exactement le silence que le projet s'interdit depuis
   * GtfsImportReport. Même rôle que `weeksRequested` en 4E-5A.
   */
  truncated: boolean;
}
