import { Injectable } from '@nestjs/common';
import { AlertSeverity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AlertDto, AlertLineDto, AlertsResponseDto } from './dto/alert.dto';

/// Nombre maximal d'alertes rendues par un appel.
///
/// L'endpoint n'est PAS paginé, et c'est justifié : contrairement à
/// l'historique d'un usager (4E-4A), qui croît sans fin, les alertes actives
/// forment un ensemble global et auto-limité — chaque perturbation qui se
/// termine en sort. Un réseau réel en publie quelques dizaines.
///
/// Le plafond n'en reste pas moins nécessaire. PaginationQueryDto le dit déjà
/// pour l'historique : sans borne, un flux défaillant publiant des milliers
/// d'alertes rétablirait la requête non bornée que l'on cherche à éviter.
export const ALERTS_LIMIT = 200;

/**
 * Priorité d'affichage des sévérités.
 *
 * POURQUOI CETTE TABLE EXISTE, alors que PostgreSQL sait déjà trier un enum.
 * Il le trie selon son ORDRE DE DÉCLARATION dans `schema.prisma`. Cela
 * fonctionne aujourd'hui — `INFO, WARNING, SEVERE` — mais fait dépendre une
 * règle métier d'un détail d'écriture : réordonner l'enum inverserait
 * silencieusement la priorité affichée aux voyageurs.
 *
 * La priorité est donc écrite ICI, explicitement, et c'est elle qui ordonne
 * la réponse. Un test vérifie par ailleurs que cette table reste cohérente
 * avec l'ordre déclaré — voir plus bas pourquoi les deux doivent s'accorder.
 */
const PRIORITE: Record<AlertSeverity, number> = {
  [AlertSeverity.SEVERE]: 0,
  [AlertSeverity.WARNING]: 1,
  [AlertSeverity.INFO]: 2,
};

/// Colonnes lues. Explicite, et pas seulement par économie : c'est ce qui
/// garantit que l'UUID interne ne PEUT PAS fuiter dans la réponse.
const COLONNES = {
  gtfsAlertId: true,
  headerText: true,
  descriptionText: true,
  stopIds: true,
  lineIds: true,
  affectedMode: true,
  severity: true,
  cause: true,
  effect: true,
  startTime: true,
  endTime: true,
} as const;

/**
 * Lecture publique des perturbations (étape 4F-2B, UC02).
 *
 * SÉPARÉ DE GtfsRtModule, et ce n'est pas cosmétique : importer un flux
 * protobuf et servir une liste à un voyageur sont deux métiers. Ce service ne
 * connaît ni GTFS-RT, ni le protobuf, ni l'import — il lit une table.
 *
 * AUCUNE SUPPRESSION. 4F-1D a décidé qu'une alerte absente du flux n'est pas
 * supprimée : « absente du flux actuel » n'est pas « terminée ». La
 * pertinence se juge donc ICI, à la lecture, sur les dates stockées. La table
 * garde l'historique ; l'API ne montre que le présent.
 */
@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Les perturbations en cours, de la plus grave à la plus anodine.
   *
   * @param now instant de référence. Vaut l'heure courante en production ;
   *            les tests le fixent pour éprouver les bornes à la milliseconde
   *            près. C'est le procédé de 4F-1C appliqué à la dépendance la
   *            plus sournoise qui soit — celle qui change à chaque exécution.
   *            Aucun service d'horloge global, aucun `useFakeTimers` : on
   *            passe la valeur, comme on passe déjà les modes au mapper.
   */
  async findActive(now: Date = new Date()): Promise<AlertsResponseDto> {
    const alertes = await this.prisma.alert.findMany({
      where: {
        // Début INCLUSIF : une perturbation qui commence à l'instant est en
        // cours.
        startTime: { lte: now },
        // Fin EXCLUSIVE, et sans fin annoncée = toujours active.
        //
        // L'intervalle est donc [startTime, endTime[ — la convention déjà
        // retenue pour les semaines ISO en 4E-5B, qui évite d'avoir à choisir
        // une « dernière milliseconde ». À t = endTime, la perturbation est
        // terminée : c'est la lecture naturelle de « travaux jusqu'à 14h ».
        OR: [{ endTime: null }, { endTime: { gt: now } }],
      },
      select: COLONNES,
      // Cet ordre-ci sert à CHOISIR les bonnes lignes quand il y en a trop :
      // sans `severity` ici, 200 alertes mineures récentes pourraient évincer
      // une coupure totale annoncée ce matin. L'ordre définitif, lui, est
      // rétabli en mémoire par PRIORITE.
      orderBy: [
        { severity: 'desc' },
        { startTime: 'desc' },
        { gtfsAlertId: 'asc' },
      ],
      // Un de plus que le plafond : il suffit à savoir s'il en existait
      // d'autres, sans une seconde requête de comptage.
      take: ALERTS_LIMIT + 1,
    });

    const truncated = alertes.length > ALERTS_LIMIT;
    const retenues = truncated ? alertes.slice(0, ALERTS_LIMIT) : alertes;

    const nomsDeLigne = await this.chargerNomsDeLigne(retenues);

    return {
      items: retenues
        .map((alerte) => this.versDto(alerte, nomsDeLigne))
        .sort(this.parPriorite),
      limit: ALERTS_LIMIT,
      truncated,
    };
  }

  /**
   * Ordre définitif de la réponse.
   *
   * 1. la gravité, selon PRIORITE — ce qui bloque le réseau d'abord ;
   * 2. à gravité égale, la perturbation la plus récente ;
   * 3. à défaut, l'identifiant, qui départage.
   *
   * POURQUOI TRIER PAR GRAVITÉ D'ABORD, alors que GET /api/routes trie par
   * date. Un historique est chronologique par nature : l'usager y cherche
   * « mon trajet d'hier ». Une liste de perturbations est une liste de
   * TRIAGE : le voyageur doit voir en premier ce qui bloque son trajet, pas
   * ce qui vient d'être publié.
   *
   * POURQUOI LE TROISIÈME CRITÈRE N'EST PAS DÉCORATIF. Sans lui, deux
   * alertes de même gravité et de même heure sortiraient dans un ordre laissé
   * à PostgreSQL, donc instable — et le test de déterminisme échouerait par
   * intermittence, ce qui est bien pire qu'un test qui échoue toujours.
   */
  private readonly parPriorite = (a: AlertDto, b: AlertDto): number =>
    PRIORITE[a.severity] - PRIORITE[b.severity] ||
    b.startTime.getTime() - a.startTime.getTime() ||
    a.id.localeCompare(b.id);

  /**
   * Résout les noms des lignes citées, EN UNE SEULE REQUÊTE.
   *
   * Le flux GTFS-RT ne transporte que des identifiants : `ROUTE_A`. Or 4E-2 a
   * déjà établi qu'un usager doit lire « Bus 38 », pas un code interne.
   *
   * POURQUOI UN PRÉ-CHARGEMENT ET NON UN `include`. Il n'existe aucune
   * relation entre Alert et TransitLine : `lineIds` est un tableau de texte,
   * conformément au diagramme de classes (4C-4-1). Prisma ne peut donc pas
   * joindre. Résoudre ligne par ligne ferait une requête par alerte — le N+1
   * classique, et cent alertes citant la même ligne la chargeraient cent
   * fois. On collecte donc tous les identifiants, on interroge une fois, et
   * on distribue.
   */
  private async chargerNomsDeLigne(
    alertes: { lineIds: string[] }[],
  ): Promise<Map<string, string>> {
    // Set : une même ligne citée par dix alertes n'est demandée qu'une fois.
    const identifiants = new Set(alertes.flatMap((a) => a.lineIds));

    if (identifiants.size === 0) {
      // Aucune ligne citée : inutile d'aller déranger la base.
      return new Map();
    }

    const lignes = await this.prisma.transitLine.findMany({
      where: { gtfsRouteId: { in: [...identifiants] } },
      select: { gtfsRouteId: true, name: true },
    });

    return new Map(
      lignes
        .filter((ligne) => ligne.gtfsRouteId !== null)
        .map((ligne) => [ligne.gtfsRouteId!, ligne.name]),
    );
  }

  private versDto(
    alerte: {
      gtfsAlertId: string;
      headerText: string | null;
      descriptionText: string | null;
      stopIds: string[];
      lineIds: string[];
      affectedMode: AlertDto['mode'];
      severity: AlertSeverity;
      cause: string;
      effect: string;
      startTime: Date;
      endTime: Date | null;
    },
    nomsDeLigne: Map<string, string>,
  ): AlertDto {
    const lines: AlertLineDto[] = alerte.lineIds.map((id) => ({
      id,
      // Une ligne inconnue du référentiel garde son identifiant et perd son
      // nom. Écarter l'alerte pour autant priverait le voyageur d'une
      // perturbation réelle : un flux temps réel peut citer une ligne créée
      // après notre dernier import statique.
      name: nomsDeLigne.get(id) ?? null,
    }));

    return {
      // L'identifiant du flux, jamais notre UUID interne.
      id: alerte.gtfsAlertId,
      headerText: alerte.headerText,
      descriptionText: alerte.descriptionText,
      stopIds: alerte.stopIds,
      lines,
      mode: alerte.affectedMode,
      severity: alerte.severity,
      cause: alerte.cause,
      effect: alerte.effect,
      startTime: alerte.startTime,
      endTime: alerte.endTime,
    };
  }
}
