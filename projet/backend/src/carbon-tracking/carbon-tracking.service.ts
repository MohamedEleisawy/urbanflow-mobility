import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  bornesSemaineIso,
  debutFenetreSemaines,
  semaineIso,
} from '../common/date/iso-week.util';
import { WeeklyTrackingQueryDto } from './dto/weekly-tracking-query.dto';
import { CarbonTrackingDto, WeeklyCarbonDto } from './dto/weekly-tracking.dto';
import { WeekQueryDto } from './dto/week-query.dto';
import { WeeklyBudgetDto } from './dto/weekly-budget.dto';

/// Deux décimales, comme partout ailleurs pour les grammes de CO2
/// (convention posée à l'étape 4D-1).
///
/// L'arrondi n'intervient qu'à la SORTIE : additionner des flottants déjà
/// arrondis ferait dériver les totaux à mesure qu'ils s'accumulent.
const arrondir = (grammes: number) => Math.round(grammes * 100) / 100;

/** Accumulateur interne, le temps de regrouper les enregistrements. */
interface Cumul {
  year: number;
  week: number;
  co2Grams: number;
  savedVsCarGrams: number;
  /** Un Set : c'est lui qui rend le comptage de trajets DISTINCT. */
  routeIds: Set<string>;
}

/**
 * Suivi carbone personnel, semaine par semaine (étape 4E-5A).
 *
 * LECTURE SEULE, et source unique : `CarbonRecord`. Aucune écriture, aucun
 * `CarbonBudget` — le plafond hebdomadaire viendra à une étape ultérieure.
 *
 * POURQUOI UN MODULE À PART DE CarbonModule. Celui-ci n'importe ni Prisma
 * ni Auth : c'est la démonstration, écrite dans ses commentaires depuis
 * l'étape 4D, qu'un calcul carbone ne touche pas la base et ne connaît pas
 * l'usager. Y greffer une lecture authentifiée détruirait cette propriété.
 */
@Injectable()
export class CarbonTrackingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bilan des `weeks` dernières semaines ISO d'un usager.
   *
   * POURQUOI L'AGRÉGATION SE FAIT EN MÉMOIRE, et non par `groupBy` Prisma :
   * `tripCount` exige un `COUNT(DISTINCT routeId)`, que l'API `groupBy` de
   * Prisma ne sait pas exprimer — son `_count` ne compte que des lignes ou
   * des champs non nuls, jamais des valeurs distinctes. Y parvenir
   * demanderait du SQL brut, qui n'existe nulle part ailleurs en production
   * dans ce projet.
   *
   * Le coût reste borné : la requête est filtrée par usager ET par fenêtre,
   * et ne rapatrie que quatre colonnes sur huit.
   */
  async findWeeklyForUser(
    userId: string,
    query: WeeklyTrackingQueryDto,
  ): Promise<CarbonTrackingDto> {
    const { weeks } = query;
    const debut = debutFenetreSemaines(new Date(), weeks);

    const enregistrements = await this.prisma.carbonRecord.findMany({
      // Le filtre est fait EN BASE. Tout ramener puis filtrer en mémoire
      // ferait transiter les données des autres usagers par le serveur.
      where: { userId, date: { gte: debut } },
      // On ne charge que ce que l'agrégation consomme.
      select: {
        date: true,
        co2Grams: true,
        savedVsCarGrams: true,
        routeId: true,
      },
    });

    return {
      weeks: this.regrouperParSemaine(enregistrements),
      weeksRequested: weeks,
    };
  }

  /**
   * Budget d'une semaine et son état de consommation (étape 4E-5B).
   *
   * DEUX SOURCES, ET PAS DE TROISIÈME :
   *
   *   UserPreferences.co2BudgetWeekly  →  le plafond que l'usager se fixe
   *   CarbonRecord                     →  ce qu'il a réellement émis
   *
   * `CarbonBudget` existe dans le schéma mais n'est VOLONTAIREMENT pas
   * utilisé ici. Y recopier la consommation créerait une seconde vérité à
   * synchroniser avec `CarbonRecord` : à la moindre suppression de trajet,
   * les deux divergeraient sans que rien ne le signale. Une valeur calculée
   * ne se stocke que lorsqu'on a besoin d'en figer l'historique — ce n'est
   * pas le cas d'un état courant.
   *
   * Sans semaine demandée, on répond pour la semaine EN COURS.
   */
  async findBudgetForUser(
    userId: string,
    query: WeekQueryDto,
  ): Promise<WeeklyBudgetDto> {
    const { year, week } =
      query.year !== undefined && query.week !== undefined
        ? { year: query.year, week: query.week }
        : semaineIso(new Date());

    // Bornes [lundi, lundi suivant[ — la fin est EXCLUE, ce qui évite d'avoir
    // à choisir une « dernière milliseconde » du dimanche.
    const { debut, fin } = bornesSemaineIso(year, week);

    // Deux requêtes indépendantes, donc lancées en parallèle.
    const [preferences, enregistrements] = await Promise.all([
      // `userId` est @unique sur UserPreferences : findUnique convient.
      this.prisma.userPreferences.findUnique({
        where: { userId },
        select: { co2BudgetWeekly: true },
      }),
      this.prisma.carbonRecord.findMany({
        // Filtre EN BASE, jamais en mémoire.
        where: { userId, date: { gte: debut, lt: fin } },
        select: { co2Grams: true, routeId: true },
      }),
    ]);

    const consumedGrams = arrondir(
      enregistrements.reduce((somme, e) => somme + e.co2Grams, 0),
    );
    // Un trajet en trois segments compte pour UN : le Set s'en charge.
    const tripCount = new Set(enregistrements.map((e) => e.routeId)).size;

    // `?? null` et non `?.` seul : l'absence de préférences doit produire un
    // null explicite, pas un undefined que JSON.stringify effacerait.
    const weeklyBudgetGrams = preferences?.co2BudgetWeekly ?? null;

    if (weeklyBudgetGrams === null) {
      // Aucun plafond fixé : on ne juge pas, on n'invente pas de valeur par
      // défaut. La consommation, elle, reste une information valable.
      return {
        year,
        week,
        weeklyBudgetGrams: null,
        consumedGrams,
        remainingGrams: null,
        exceeded: null,
        tripCount,
      };
    }

    return {
      year,
      week,
      weeklyBudgetGrams,
      consumedGrams,
      // Borné à 0 : on ne « doit » pas du carbone, on a simplement dépassé.
      // Une valeur négative n'aurait aucun sens pour l'usager — même
      // raisonnement que `savedVsCarGrams` à l'étape 4D-1.
      remainingGrams: arrondir(Math.max(weeklyBudgetGrams - consumedGrams, 0)),
      // STRICTEMENT supérieur : consommer exactement son budget, c'est le
      // respecter, pas le dépasser.
      exceeded: consumedGrams > weeklyBudgetGrams,
      tripCount,
    };
  }

  private regrouperParSemaine(
    enregistrements: {
      date: Date;
      co2Grams: number;
      savedVsCarGrams: number;
      routeId: string;
    }[],
  ): WeeklyCarbonDto[] {
    const cumuls = new Map<string, Cumul>();

    for (const enregistrement of enregistrements) {
      const { year, week } = semaineIso(enregistrement.date);
      const cle = `${year}-${week}`;

      const cumul = cumuls.get(cle) ?? {
        year,
        week,
        co2Grams: 0,
        savedVsCarGrams: 0,
        routeIds: new Set<string>(),
      };

      cumul.co2Grams += enregistrement.co2Grams;
      cumul.savedVsCarGrams += enregistrement.savedVsCarGrams;
      // Un trajet en trois segments compte pour UN : le Set s'en charge.
      cumul.routeIds.add(enregistrement.routeId);

      cumuls.set(cle, cumul);
    }

    return (
      [...cumuls.values()]
        .map((cumul) => ({
          year: cumul.year,
          week: cumul.week,
          co2Grams: arrondir(cumul.co2Grams),
          savedVsCarGrams: arrondir(cumul.savedVsCarGrams),
          tripCount: cumul.routeIds.size,
        }))
        // La plus récente en premier, comme l'historique (étape 4E-4A).
        // Trier sur l'année PUIS la semaine : sans la seconde clé, deux
        // semaines de la même année seraient dans un ordre arbitraire.
        .sort((a, b) => b.year - a.year || b.week - a.week)
    );
  }
}
