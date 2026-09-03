import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { territoryConfig } from '../config/territory.config';
import {
  JourDeService,
  joursDeServiceCandidats,
  SECONDES_PAR_JOUR,
} from './service-day.util';

// =============================================================================
// Calendrier de service et prochains passages (sprint soutenance)
// =============================================================================
// ═══ CE QUE CE SERVICE RÉPOND ═══
//
//   « Quelles lignes circulent MAINTENANT ? »       → lignesActives()
//   « Quand passe le prochain véhicule ICI ? »      → prochainsPassages()
//
// ═══ CE QU'IL NE RÉPOND PAS, ET LE DIT ═══
//
// Ce sont des horaires THÉORIQUES, ceux que l'opérateur publie. Un retard, une
// suppression, un véhicule bloqué n'y figurent pas : cela demanderait un flux
// temps réel, que la CTS ne publie qu'en SIRI-Lite sous jeton. `GET
// /api/capabilities` dit si ce flux est branché, et l'interface étiquette les
// horaires en conséquence. On n'affiche jamais un horaire théorique comme s'il
// était observé.
// =============================================================================

/// Horizon au-delà duquel on cesse de chercher un passage, en secondes.
///
/// ⚠️ CE N'EST PAS UN CONFORT D'AFFICHAGE, C'EST UNE BORNE DE REQUÊTE. Sans
/// elle, un arrêt dont la ligne ne circule plus de la journée ferait balayer
/// tous ses passages restants pour n'en trouver aucun.
///
/// Trois heures : au-delà, « le prochain passage » n'a plus de sens pratique —
/// personne n'attend trois heures un tram. Un arrêt sans passage dans cette
/// fenêtre est annoncé comme tel, jamais complété par le premier passage du
/// lendemain présenté comme imminent.
export const HORIZON_PASSAGES_SEC = 3 * 3600;

/**
 * Ce que le calendrier sait des lignes, à un instant donné.
 *
 * ═══ POURQUOI DEUX ENSEMBLES, ET NON UN SEUL ═══
 *
 * La première version ne rendait que `actives`, et le moteur écartait toute
 * ligne absente. Les tests de bout en bout l'ont mise en défaut aussitôt :
 * ils créent des lignes de démonstration SANS horaire, qui disparaissaient
 * donc du réseau.
 *
 * Ce n'était pas un artefact de test. Un flux réel peut parfaitement décrire
 * une ligne dans `routes.txt` sans la faire figurer dans `stop_times.txt` —
 * une ligne saisonnière, une navette exceptionnelle. Les faire disparaître
 * silencieusement aurait amputé le réseau sans que rien ne le signale.
 *
 * D'où la distinction :
 *
 *   `horodatees`  les lignes dont on connaît AU MOINS UN passage : ce sont
 *                 les seules sur lesquelles le calendrier a quelque chose à
 *                 dire ;
 *   `actives`     parmi elles, celles qui circulent à l'instant demandé.
 *
 * Une ligne hors de `horodatees` est un « je ne sais pas », et un « je ne
 * sais pas » ne doit jamais valoir « non ».
 */
export interface CirculationDuMoment {
  horodatees: ReadonlySet<string>;
  actives: ReadonlySet<string>;
}

export interface Passage {
  lineId: string;
  lineName: string;
  mode: string;

  /// Destination affichée en girouette, quand le flux la publie.
  headsign: string | null;

  /**
   * Instant du départ.
   *
   * ⚠️ UN INSTANT ABSOLU, et non « 08:42 ». C'est au client d'afficher
   * l'heure dans le fuseau qui l'intéresse ; lui transmettre une chaîne déjà
   * formatée l'empêcherait de calculer « dans 6 min ».
   */
  departureAt: Date;

  /// Minutes d'attente à partir de l'instant demandé, arrondies vers le bas.
  waitMin: number;
}

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Les identifiants des services actifs un jour donné.
   *
   * ═══ LES TROIS RÈGLES DE GTFS, DANS L'ORDRE ═══
   *
   *   1. le service est régulier ce jour-là (jour de semaine coché ET date
   *      dans la période de validité) ;
   *   2. SAUF si une exception le retire (`exception_type: 2`) ;
   *   3. OU BIEN une exception l'ajoute (`exception_type: 1`), même hors
   *      période et même un jour non coché.
   *
   * ⚠️ L'ORDRE COMPTE, et c'est là que les implémentations naïves se
   * trompent. Un ajout l'emporte sur l'absence de règle régulière — c'est
   * ainsi qu'un réseau fait circuler un service « dimanche » un 14 juillet
   * tombant un mardi.
   */
  private async servicesActifs(jour: JourDeService): Promise<Set<string>> {
    const colonnes = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ] as const;

    const [reguliers, exceptions] = await Promise.all([
      this.prisma.transitService.findMany({
        where: {
          [colonnes[jour.jourSemaine]]: true,
          startDate: { lte: jour.date },
          endDate: { gte: jour.date },
        },
        select: { id: true },
      }),
      this.prisma.transitServiceException.findMany({
        where: { date: jour.date },
        select: { serviceId: true, added: true },
      }),
    ]);

    const actifs = new Set(reguliers.map((s) => s.id));

    for (const exception of exceptions) {
      if (exception.added) {
        actifs.add(exception.serviceId);
      } else {
        actifs.delete(exception.serviceId);
      }
    }

    return actifs;
  }

  /**
   * Les lignes qui circulent RÉELLEMENT à l'instant donné.
   *
   * ═══ LE BOGUE QUE CETTE MÉTHODE SUPPRIME ═══
   *
   * Le moteur d'itinéraires empruntait n'importe quelle ligne présente dans le
   * graphe, sans savoir si elle circulait. Un usager cherchant un trajet à
   * 14 h se voyait proposer les bus de nuit N2 et N3, qui ne roulent qu'entre
   * 00 h 30 et 05 h 00. L'itinéraire était irréprochable et impraticable.
   *
   * ⚠️ NE RÉPOND QUE SUR LES LIGNES HORODATÉES. Voir `CirculationDuMoment` :
   * une ligne sans aucun passage en base est un « je ne sais pas », et le
   * moteur doit continuer à l'emprunter.
   *
   * ⚠️ RENVOIE `null`, ET NON UN ENSEMBLE VIDE, QUAND AUCUN CALENDRIER N'EST
   * IMPORTÉ. La distinction est capitale : « aucune ligne ne circule » ferait
   * échouer toute recherche, alors que « je ne sais pas » doit laisser le
   * moteur travailler comme avant. Un flux GTFS sans `calendar.txt` reste un
   * flux valide.
   */
  async lignesActives(instant: Date): Promise<CirculationDuMoment | null> {
    const total = await this.prisma.transitService.count();

    if (total === 0) {
      return null;
    }

    // Une seule requête `distinct` : quelques dizaines de lignes, jamais les
    // centaines de milliers de passages.
    const horodateesBrutes = await this.prisma.stopDeparture.findMany({
      select: { lineId: true },
      distinct: ['lineId'],
    });

    const horodatees = new Set(horodateesBrutes.map((l) => l.lineId));

    const { timezone } = territoryConfig();
    const lignes = new Set<string>();

    for (const jour of joursDeServiceCandidats(instant, timezone)) {
      const services = await this.servicesActifs(jour);

      if (services.size === 0) {
        continue;
      }

      // `distinct` plutôt qu'un `groupBy` : on ne veut que la liste des
      // lignes, sans compter les passages — qui se chiffrent en centaines de
      // milliers.
      const actives = await this.prisma.stopDeparture.findMany({
        where: {
          serviceId: { in: [...services] },
          departureSec: {
            gte: jour.secondes,
            lte: jour.secondes + HORIZON_PASSAGES_SEC,
          },
        },
        select: { lineId: true },
        distinct: ['lineId'],
      });

      for (const ligne of actives) {
        lignes.add(ligne.lineId);
      }
    }

    return { horodatees, actives: lignes };
  }

  /**
   * Les prochains passages à un arrêt, tous modes et toutes lignes.
   *
   * @param lineIds restreint à ces lignes, si fourni. C'est ce qui permet de
   *   répondre « votre tram D part à 08:42 » plutôt que de lister les onze
   *   lignes de l'arrêt.
   *
   * ⚠️ RENVOIE UNE LISTE VIDE PLUTÔT QUE D'ÉLARGIR L'HORIZON. Un arrêt sans
   * passage dans les trois heures est un arrêt sans passage : afficher le
   * premier tram de demain matin comme « prochain passage » serait exact et
   * trompeur.
   */
  async prochainsPassages(
    stopIds: readonly string[],
    instant: Date,
    limite: number,
    lineIds?: readonly string[],
  ): Promise<Passage[]> {
    if (stopIds.length === 0) {
      return [];
    }

    const { timezone } = territoryConfig();
    const passages: Passage[] = [];

    for (const jour of joursDeServiceCandidats(instant, timezone)) {
      const services = await this.servicesActifs(jour);

      if (services.size === 0) {
        continue;
      }

      const lignes = await this.prisma.stopDeparture.findMany({
        where: {
          stopId: { in: [...stopIds] },
          serviceId: { in: [...services] },
          departureSec: {
            gte: jour.secondes,
            lte: jour.secondes + HORIZON_PASSAGES_SEC,
          },
          ...(lineIds ? { lineId: { in: [...lineIds] } } : {}),
        },
        orderBy: { departureSec: 'asc' },
        take: limite,
        include: { line: { select: { name: true, mode: true } } },
      });

      for (const passage of lignes) {
        const attenteSec = passage.departureSec - jour.secondes;

        passages.push({
          lineId: passage.lineId,
          lineName: passage.line.name,
          mode: passage.line.mode,
          headsign: passage.headsign,
          departureAt: new Date(instant.getTime() + attenteSec * 1000),
          // ⚠️ ARRONDI VERS LE BAS. « Dans 6 min » pour un passage à 6 min 50
          // laisse à l'usager le temps de courir ; « dans 7 min » le fait
          // rater le tram. L'erreur n'est pas symétrique.
          waitMin: Math.floor(attenteSec / 60),
        });
      }
    }

    // ⚠️ RETRI GLOBAL INDISPENSABLE. Les deux jours de service ont été
    // interrogés séparément : concaténés, un passage de la veille à 24 h 10
    // pourrait précéder un passage du jour à 00 h 05.
    passages.sort((a, b) => a.departureAt.getTime() - b.departureAt.getTime());

    return passages.slice(0, limite);
  }

  /**
   * L'attente, en minutes, avant de pouvoir monter dans une ligne donnée.
   *
   * C'est ce qui manquait à la durée annoncée par le moteur d'itinéraires :
   * `totalDurationMin` additionnait des temps de PARCOURS, sans jamais compter
   * le temps passé sur le quai.
   *
   * ⚠️ RENVOIE `null` — ET NON ZÉRO — QUAND L'ATTENTE EST INCONNUE. Zéro
   * signifierait « le véhicule est là », ce qui est le mensonge le plus
   * coûteux possible sur cet écran. `null` fait afficher « attente inconnue ».
   */
  async attenteAvantLigne(
    stopIds: readonly string[],
    lineId: string,
    instant: Date,
  ): Promise<number | null> {
    const passages = await this.prochainsPassages(stopIds, instant, 1, [
      lineId,
    ]);

    return passages[0]?.waitMin ?? null;
  }

  /**
   * Vrai si cette installation connaît des horaires.
   *
   * L'interface s'en sert pour choisir entre afficher un prochain passage et
   * dire honnêtement qu'elle n'en connaît aucun — jamais pour masquer la
   * question.
   */
  async horairesDisponibles(): Promise<boolean> {
    const total = await this.prisma.stopDeparture.count({ take: 1 });

    return total > 0;
  }
}

/// Réexporté pour les tests et les appelants : la durée d'un jour de service
/// est une constante du domaine, pas un détail de ce fichier.
export { SECONDES_PAR_JOUR };
