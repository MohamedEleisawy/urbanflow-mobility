import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { debutFenetreSemaines, semaineIso } from '../common/date/iso-week.util';
import { WeeklyTrackingQueryDto } from './dto/weekly-tracking-query.dto';
import { CarbonTrackingDto, WeeklyCarbonDto } from './dto/weekly-tracking.dto';

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
