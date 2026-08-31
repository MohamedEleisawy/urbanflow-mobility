import { ModeTransport } from '@prisma/client';

// Forme des données rendues par GET /api/admin/stats (étape 6-5).
//
// Interfaces de SORTIE uniquement, sans class-validator : on ne valide que ce
// qui ENTRE. Même convention qu'`admin-user.dto.ts` (6-3) et
// `personal-data-export.dto.ts` (5F).
//
// ═══ CE QUE LE DOSSIER DEMANDE, MOT POUR MOT ═══
//
//   « Voir les statistiques : Accès à des TABLEAUX DE BORD ANONYMISÉS sur
//     L'UTILISATION DE L'APPLICATION, permettant d'analyser LES HABITUDES DE
//     DÉPLACEMENT dans la ville. » (§3.2.1, bloc Administration)
//
// Deux axes, et deux seulement :
//
//   utilisation de l'application  →  combien de comptes, combien de trajets
//   habitudes de déplacement      →  quels modes, sur quelles distances
//
// Chaque champ ci-dessous répond à l'un des deux. Rien n'a été ajouté parce
// qu'il était facile à calculer.
//
// ═══ RIEN QUI PERMETTE D'IDENTIFIER QUELQU'UN ═══
//
// Aucun identifiant, aucune adresse, aucune ligne par usager. Uniquement des
// COMPTES et des SOMMES. Le mot « anonymisés » du dossier n'est pas une
// précaution de style : une statistique par usager n'est pas une statistique,
// c'est un fichier.

/** Volume de comptes — axe « utilisation de l'application ». */
export interface AdminUsersStatsDto {
  /**
   * Comptes utilisables aujourd'hui : `deletedAt IS NULL`.
   *
   * Un compte désactivé n'est PAS actif : il ne peut ni se connecter, ni rien
   * faire (étape 5G). Le compter parmi les actifs surestimerait l'audience.
   */
  active: number;
  /**
   * Comptes désactivés : `deletedAt IS NOT NULL`.
   *
   * Exposé parce qu'il RENSEIGNE sur l'usage — c'est la mesure des départs —
   * et parce qu'il reste parfaitement anonyme. La liste d'administration
   * (6-3) les montre déjà nominativement : les compter ici n'ajoute aucune
   * information à ce qu'un administrateur peut déjà voir.
   */
  deleted: number;
}

/** Volume de trajets — axe « utilisation de l'application ». */
export interface AdminRoutesStatsDto {
  /**
   * Nombre de trajets ENREGISTRÉS.
   *
   * ⚠️ `COUNT(Route)`, jamais `COUNT(CarbonRecord)`. Un trajet peut porter
   * plusieurs enregistrements carbone — un par mode emprunté — et les
   * confondre gonflerait le chiffre d'un facteur variable, plus élevé pour
   * les trajets multimodaux. Ce serait un compteur faux, et faux d'une façon
   * qui flatte précisément les usages que l'application encourage.
   */
  total: number;
  /** Distance cumulée de ces trajets, en mètres. */
  totalDistanceM: number;
}

/** Empreinte carbone cumulée. */
export interface AdminCarbonStatsDto {
  /**
   * Somme de `CarbonRecord.co2Grams`.
   *
   * ⚠️ LA VALEUR EST LUE, JAMAIS RECALCULÉE. Le microservice l'a déjà
   * calculée à l'enregistrement du trajet, avec les facteurs d'émission de
   * l'époque. La recalculer ici depuis les distances et les modes produirait
   * un second chiffre, qui divergerait du premier au premier changement de
   * facteur — et personne ne saurait lequel croire.
   */
  totalCo2Grams: number;
  /** Somme de `savedVsCarGrams` : l'économie face à la voiture individuelle. */
  totalSavedVsCarGrams: number;
  /**
   * Nombre d'enregistrements carbone.
   *
   * Donné pour que le lecteur sache sur combien de mesures portent les deux
   * sommes ci-dessus. **Ce n'est pas un nombre de trajets** — voir
   * `routes.total`.
   */
  recordCount: number;
}

/**
 * Usage d'un mode de transport — axe « habitudes de déplacement ».
 *
 * ═══ POURQUOI LE SEGMENT, ET NON LE TRAJET ═══
 *
 * Un trajet est MULTIMODAL : « métro puis marche » n'a pas un mode, il en a
 * deux. « BUS = 3 trajets » n'aurait donc aucun sens vérifiable.
 *
 * Le SEGMENT est l'unité qui porte réellement un mode : une étape, un mode,
 * une distance. C'est le grain honnête pour dire comment les gens se
 * déplacent.
 *
 * Le nom des champs le dit : `segmentCount`, jamais `tripCount`.
 */
export interface AdminModeUsageDto {
  mode: ModeTransport;
  /** Nombre d'ÉTAPES empruntant ce mode — pas de trajets. */
  segmentCount: number;
  /**
   * Distance cumulée parcourue dans ce mode, en mètres.
   *
   * C'est le chiffre le plus parlant des deux : dix étapes de marche de
   * 200 m ne pèsent pas le même usage qu'une étape de métro de 12 km.
   */
  totalDistanceM: number;
}

/** Réponse complète de GET /api/admin/stats. */
export interface AdminStatsDto {
  users: AdminUsersStatsDto;
  routes: AdminRoutesStatsDto;
  carbon: AdminCarbonStatsDto;
  /**
   * Répartition par mode, du plus employé au moins employé.
   *
   * Ordre DÉTERMINISTE : `segmentCount` décroissant, puis nom du mode par
   * ordre alphabétique. `groupBy` ne garantit aucun ordre, et un tableau de
   * bord dont les lignes changent de place à chaque rafraîchissement est
   * illisible.
   *
   * ⚠️ Un mode jamais emprunté N'APPARAÎT PAS : la base ne le connaît pas.
   */
  modeUsage: AdminModeUsageDto[];
}
