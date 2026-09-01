import {
  FavoriteAddressType,
  LanguageEnum,
  ModeTransport,
  RoleEnum,
  ThemeEnum,
} from '@prisma/client';

// Forme du fichier rendu par GET /api/users/me/export (étape 5F).
//
// Interfaces de SORTIE uniquement, sans class-validator : on ne valide que ce
// qui ENTRE dans l'application. Même convention qu'`alert.dto.ts` (4F-2B) et
// `weekly-tracking.dto.ts` (4E-5A).
//
// ═══ CE QUI N'APPARAÎT NULLE PART, ET POURQUOI ═══
//
//   `passwordHash`  — un condensat de mot de passe n'est pas une donnée que
//                     l'usager doit récupérer : la lui remettre ne lui apprend
//                     rien et lui fait porter un secret à protéger.
//   les jetons      — un JWT est autoportant et n'est jamais stocké en base :
//                     il n'y a rien à exporter.
//   `Alert`, `Stop`, `TransitLine`, `NetworkLink` — DONNÉES DE RÉFÉRENCE
//                     GLOBALES. Elles sont identiques pour tout le monde et ne
//                     disent rien de l'usager. Les inclure gonflerait le
//                     fichier du réseau entier sans apporter une seule
//                     information personnelle.
//   `userId` des sous-objets — toujours égal à `user.id`, déjà présent en tête
//                     du fichier. La structure porte l'appartenance.

/** Le compte lui-même. */
export interface ExportedUserDto {
  id: string;
  email: string;
  role: RoleEnum;
  createdAt: Date;
  /**
   * Date de suppression logique, ou `null`.
   *
   * EXPORTÉE, bien qu'aucune fonctionnalité ne la remplisse encore : c'est un
   * fait que la base détient sur le compte, et le RGPD porte sur ce qui est
   * DÉTENU, pas sur ce qui est utilisé.
   */
  deletedAt: Date | null;
}

/** Les préférences, ou `null` si l'usager n'en a jamais enregistré. */
export interface ExportedPreferencesDto {
  preferredModes: ModeTransport[];
  pmrMode: boolean;
  co2BudgetWeekly: number;
  notificationsEnabled: boolean;
  language: LanguageEnum;
  theme: ThemeEnum;
}

/** Une étape d'un trajet enregistré. */
export interface ExportedSegmentDto {
  id: string;
  mode: ModeTransport;
  operator: string;
  line: string;
  departureTime: Date;
  arrivalTime: Date;
  distanceM: number;
  gtfsTripId: string | null;
  /**
   * Identifiants d'arrêts, tels qu'ils sont STOCKÉS.
   *
   * Les NOMS ne sont pas résolus : ils vivent dans `Stop`, une table de
   * référence globale. Les joindre reviendrait à recopier des données qui
   * n'appartiennent pas à l'usager pour rendre le fichier plus joli.
   */
  fromStopId: string;
  toStopId: string;
}

/** Un trajet enregistré, avec ses étapes. */
export interface ExportedRouteDto {
  id: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  requestedAt: Date;
  totalDurationMin: number;
  totalDistanceM: number;
  ecoScore: number;
  carbonEstimate: number;
  /**
   * Étapes IMBRIQUÉES plutôt que listées à plat.
   *
   * Un segment n'a aucun sens hors de son trajet. Les mettre à plat
   * obligerait l'usager à faire lui-même la jointure par `routeId` pour
   * relire ses propres déplacements.
   */
  segments: ExportedSegmentDto[];
}

/** Une empreinte carbone enregistrée. */
export interface ExportedCarbonRecordDto {
  id: string;
  date: Date;
  co2Grams: number;
  mode: ModeTransport;
  distanceM: number;
  savedVsCarGrams: number;
  /**
   * TOP-NIVEAU et non imbriqué dans le trajet, malgré le lien.
   *
   * Un `CarbonRecord` est un fait de l'usager — c'est lui qui alimente le
   * suivi hebdomadaire — et non un détail de trajet. `routeId` est conservé
   * pour que le rattachement reste lisible.
   */
  routeId: string;
}

/** Un budget carbone hebdomadaire. */
export interface ExportedCarbonBudgetDto {
  id: string;
  year: number;
  week: number;
  weeklyBudgetGrams: number;
  consumedWeeklyGrams: number;
}

/**
 * Adresse favorite exportée (bloc 7).
 *
 * UNE ADRESSE EST UNE DONNEE PERSONNELLE — au sens plein : elle désigne le
 * domicile d'une personne. Elle DOIT donc figurer dans l'export RGPD, au même
 * titre que les trajets.
 *
 * `userId` en est absent : le fichier entier appartient à un seul compte, dont
 * l'identifiant figure déjà dans `user.id`. Le répéter sur chaque ligne
 * n'apprendrait rien.
 */
export interface ExportedAddressDto {
  id: string;
  type: FavoriteAddressType;
  address: string;
  latitude: number;
  longitude: number;
  createdAt: Date;
}

/**
 * Le fichier complet.
 *
 * ⚠️ `version` EN TÊTE, ET CE N'EST PAS DÉCORATIF. Un export est un fichier
 * que l'usager conserve, parfois des années. Le jour où la structure changera,
 * ce numéro sera le seul moyen de savoir comment relire un fichier ancien.
 * L'ajouter après coup serait impossible : les fichiers déjà téléchargés ne
 * l'auraient pas.
 *
 * ⚠️ VERSION 2 depuis le bloc 7 : le champ `addresses` s'est ajouté. Un
 * fichier portant `version: 1` n'en contient pas — ce n'est pas une donnée
 * manquante, c'est un export antérieur à la fonctionnalité. C'est
 * exactement le cas que ce numéro existait pour distinguer.
 */
export interface PersonalDataExportDto {
  version: number;
  /** Instant de génération, en ISO 8601 UTC (sérialisation JSON de `Date`). */
  exportedAt: Date;
  user: ExportedUserDto;
  preferences: ExportedPreferencesDto | null;
  /** Adresses favorites — ajoutées en VERSION 2 (bloc 7). */
  addresses: ExportedAddressDto[];
  routes: ExportedRouteDto[];
  carbonRecords: ExportedCarbonRecordDto[];
  carbonBudgets: ExportedCarbonBudgetDto[];
}
