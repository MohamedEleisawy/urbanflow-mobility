import { AlertSeverity, ModeTransport } from '@prisma/client';
import { transit_realtime } from 'gtfs-realtime-bindings';
import {
  GtfsRtImportReport,
  GtfsRtRejectReason,
} from './gtfs-rt-import-report';

// =============================================================================
// FeedEntity GTFS-Realtime → Alert (étape 4F-1C)
// =============================================================================
// Toutes les décisions métier de l'étape sont ICI, et ce fichier ne touche
// JAMAIS la base : il reçoit ce dont il a besoin (`GtfsRtModeLookup`) et rend
// soit des données prêtes à écrire, soit rien — auquel cas le rapport dit
// pourquoi.
//
// Cette pureté n'est pas un principe abstrait : elle permet de tester les
// quatorze cas de mapping sans PostgreSQL, en une milliseconde chacun.
// =============================================================================

/**
 * Ce que la base sait des lignes et des arrêts nommés par le flux.
 *
 * Construit par GtfsRtImportService à partir des données importées en 4C-4,
 * et restreint aux seuls identifiants que le flux mentionne réellement.
 */
export interface GtfsRtModeLookup {
  /// gtfsRouteId → mode de la ligne.
  readonly modeParLigne: ReadonlyMap<string, ModeTransport>;
  /// gtfsStopId → modes des lignes qui desservent cet arrêt.
  readonly modesParArret: ReadonlyMap<string, ReadonlySet<ModeTransport>>;
}

/// Données prêtes pour un `upsert` sur Alert. Volontairement dépourvues d'`id`
/// interne : celui-ci est un UUID généré par PostgreSQL, jamais transporté.
export interface AlertImportData {
  gtfsAlertId: string;
  stopIds: string[];
  lineIds: string[];
  affectedMode: ModeTransport;
  severity: AlertSeverity;
  cause: string;
  effect: string;
  startTime: Date;
  endTime: Date | null;
  headerText: string | null;
  descriptionText: string | null;
}

/**
 * Correspondance des sévérités.
 *
 * UNKNOWN_SEVERITY n'y figure PAS, et c'est la décision principale de cette
 * étape. Voir `mapSeverity` ci-dessous.
 */
const SEVERITES: Partial<
  Record<transit_realtime.Alert.SeverityLevel, AlertSeverity>
> = {
  [transit_realtime.Alert.SeverityLevel.INFO]: AlertSeverity.INFO,
  [transit_realtime.Alert.SeverityLevel.WARNING]: AlertSeverity.WARNING,
  [transit_realtime.Alert.SeverityLevel.SEVERE]: AlertSeverity.SEVERE,
};

/// Langue préférée pour les textes destinés aux voyageurs.
///
/// Le projet s'adresse à des usagers francophones : ses messages d'erreur,
/// ses commentaires et son interface sont en français. Afficher « Line A
/// works » à côté de « Travaux sur la ligne B » serait incohérent dès que le
/// flux propose les deux.
const LANGUE_PREFEREE = 'fr';

/**
 * Traduit une entité de flux en données d'alerte, ou explique son rejet.
 *
 * Renvoie `null` quand l'entité n'est pas importable ; le motif est alors
 * inscrit dans le rapport. L'appelant n'a jamais à deviner ce qui s'est passé.
 */
export function mapAlertEntity(
  entite: transit_realtime.IFeedEntity,
  lookup: GtfsRtModeLookup,
  report: GtfsRtImportReport,
): AlertImportData | null {
  const rejeter = (motif: GtfsRtRejectReason): null => {
    report.countRejected(motif);
    return null;
  };

  // ---------------------------------------------------------------------------
  // 1. Est-ce seulement une alerte ?
  // ---------------------------------------------------------------------------
  // Un flux GTFS-RT peut mélanger alertes, mises à jour de trajets et
  // positions de véhicules. Les deux derniers ne nous concernent pas ici —
  // ce n'est pas une anomalie, mais cela se compte quand même.
  if (!entite.alert) {
    return rejeter('notAnAlert');
  }

  report.countAlert();

  // Un flux INCREMENTAL peut annoncer la disparition d'une alerte. Nous ne
  // traitons que des flux complets (voir 4F-1B) : supprimer une ligne sur la
  // foi d'un drapeau que nous ne savons pas encore interpréter serait
  // hasardeux. On le compte, on ne le fait pas.
  if (entite.isDeleted) {
    return rejeter('deletedEntity');
  }

  // ---------------------------------------------------------------------------
  // 2. L'identifiant : la clé de l'idempotence
  // ---------------------------------------------------------------------------
  // Sans lui, impossible de savoir si cette alerte est celle importée hier.
  // Chaque import créerait un doublon.
  const gtfsAlertId = entite.id?.trim();
  if (!gtfsAlertId) {
    return rejeter('missingEntityId');
  }

  const alerte = entite.alert;

  // ---------------------------------------------------------------------------
  // 3. La période d'activité
  // ---------------------------------------------------------------------------
  const periodes = alerte.activePeriod ?? [];

  if (periodes.length === 0) {
    // La spécification dit qu'une alerte sans période est active tant qu'elle
    // figure au flux. Notre modèle exige un startTime : le seul candidat
    // serait l'horodatage du flux, qui ne dit pas quand la perturbation a
    // commencé mais quand nous l'avons lue. Deux choses différentes.
    return rejeter('missingActivePeriod');
  }

  if (periodes.length > 1) {
    // Trois issues possibles, une seule honnête — voir carnet 4F-1C §2.
    // Fusionner 8h-10h et 18h-20h en 8h-20h annoncerait une perturbation à
    // midi qui n'existe pas. Ne garder que la première perdrait les autres en
    // silence. On refuse, et le compteur rend le besoin mesurable.
    return rejeter('multipleActivePeriods');
  }

  const periode = periodes[0];

  if (estAbsent(periode.start)) {
    return rejeter('missingPeriodStart');
  }

  const startTime = versDate(periode.start);

  // 4F-1A a rendu endTime nullable exactement pour ce cas : aucune fin
  // annoncée donne NULL, jamais une date inventée.
  const endTime = estAbsent(periode.end) ? null : versDate(periode.end);

  // ---------------------------------------------------------------------------
  // 4. La sévérité
  // ---------------------------------------------------------------------------
  const severity = mapSeverity(alerte.severityLevel);
  if (severity === null) {
    // UNKNOWN_SEVERITY. La traduire en INFO reviendrait à afficher « pour
    // information » là où l'opérateur a dit « je ne sais pas » : une panne
    // majeure pourrait ainsi être présentée comme anodine.
    //
    // Même refus que le trolleybus de 4C-4-3, qu'on n'a pas traduit en BUS.
    return rejeter('unknownSeverity');
  }

  // ---------------------------------------------------------------------------
  // 5. Les entités concernées
  // ---------------------------------------------------------------------------
  const cible = extraireCibles(alerte.informedEntity ?? [], report);

  if (cible.stopIds.length === 0 && cible.lineIds.length === 0) {
    return rejeter('noRepresentableEntity');
  }

  if (cible.ecartees > 0) {
    // L'alerte part en base, mais amputée : elle annonce moins que ce que
    // l'opérateur a publié. Jamais plus.
    report.countPartiallyRepresented();
  }

  // ---------------------------------------------------------------------------
  // 6. Le mode affecté
  // ---------------------------------------------------------------------------
  const modes = deduireModes(cible, lookup);

  if (modes.size === 0) {
    return rejeter('undeterminableMode');
  }

  if (modes.size > 1) {
    // Une alerte portant sur un bus ET un tramway ne peut pas s'écrire dans
    // un champ unique. Choisir « le premier » serait arbitraire.
    return rejeter('ambiguousMode');
  }

  const [affectedMode] = modes;

  return {
    gtfsAlertId,
    stopIds: cible.stopIds,
    lineIds: cible.lineIds,
    affectedMode,
    severity,
    // cause et effect restent TEXTUELS, avec le nom exact de l'énumération
    // GTFS-RT. Aucune perte : le vocabulaire du flux est conservé tel quel,
    // et créer deux enums Prisma n'apporterait rien à cette étape.
    cause: nomEnum(transit_realtime.Alert.Cause, alerte.cause, 'UNKNOWN_CAUSE'),
    effect: nomEnum(
      transit_realtime.Alert.Effect,
      alerte.effect,
      'UNKNOWN_EFFECT',
    ),
    startTime,
    endTime,
    // Le texte rédigé par l'opérateur — la seule partie de l'alerte qu'un
    // voyageur peut lire (étape 4F-2A).
    headerText: choisirTraduction(alerte.headerText),
    descriptionText: choisirTraduction(alerte.descriptionText),
  };
}

/**
 * Choisit UNE traduction dans un TranslatedString GTFS-RT.
 *
 * GTFS-Realtime ne transporte pas une chaîne mais une LISTE de traductions,
 * chacune avec sa langue :
 *
 *     header_text {
 *       translation { text: "Travaux ligne A", language: "fr" }
 *       translation { text: "Works on line A", language: "en" }
 *     }
 *
 * Notre modèle n'a qu'une colonne. Il faut donc choisir, et la règle est :
 *
 *   1. la traduction française, si elle existe ;
 *   2. sinon la PREMIÈRE traduction disponible ;
 *   3. sinon NULL.
 *
 * POURQUOI LA PREMIÈRE ET NON UNE AUTRE. Un texte dans une langue qu'on n'a
 * pas demandée reste une information vraie, écrite par l'opérateur : la
 * cacher priverait le voyageur d'un avertissement réel. L'ordre du flux est
 * par ailleurs le seul critère non arbitraire dont on dispose — les
 * opérateurs y placent généralement leur langue principale en tête.
 *
 * CE QU'ON NE FAIT JAMAIS : fabriquer un texte à partir de `cause` et
 * `effect`. « MAINTENANCE » + « REDUCED_SERVICE » donnerait bien une phrase,
 * mais ce serait NOTRE phrase présentée comme celle de l'opérateur. NULL dit
 * la vérité — « aucun texte n'a été publié » — comme `endTime` en 4F-1A.
 */
function choisirTraduction(
  texte: transit_realtime.ITranslatedString | null | undefined,
): string | null {
  const traductions = texte?.translation ?? [];

  // protobufjs rend "" — et non undefined — pour une chaîne non transmise :
  // une traduction sans texte utile ne doit pas être retenue.
  const utilisables = traductions.filter((t) => t.text?.trim());

  if (utilisables.length === 0) {
    return null;
  }

  // `language` est facultatif : un flux monolingue l'omet souvent, et
  // protobufjs le rend alors "". Comparer en minuscules évite qu'un "FR"
  // passe à côté.
  const francaise = utilisables.find(
    (t) => t.language?.trim().toLowerCase() === LANGUE_PREFEREE,
  );

  return (francaise ?? utilisables[0]).text.trim();
}

/// INFO, WARNING, SEVERE se traduisent ; UNKNOWN_SEVERITY donne null.
function mapSeverity(
  niveau: transit_realtime.Alert.SeverityLevel | null | undefined,
): AlertSeverity | null {
  if (niveau === null || niveau === undefined) {
    // Champ absent : protobufjs applique la valeur par défaut de la
    // spécification, UNKNOWN_SEVERITY. Le traitement est donc le même.
    return null;
  }

  return SEVERITES[niveau] ?? null;
}

interface Cibles {
  stopIds: string[];
  lineIds: string[];
  /// Nombre d'`informed_entity` non représentables.
  ecartees: number;
}

/**
 * Répartit les `informed_entity` entre arrêts, lignes, et écartées.
 *
 * RÈGLE DE PRUDENCE : un sélecteur qui désigne un TRAJET ou un EXPLOITANT est
 * écarté même s'il porte aussi un `route_id` ou un `stop_id`. La raison tient
 * en une phrase : « la ligne A à l'arrêt 1, pour le trajet de 8h12 » n'est pas
 * « la ligne A à l'arrêt 1 ». Retenir la partie représentable élargirait
 * l'alerte à toute la journée.
 *
 * Mieux vaut annoncer moins que la vérité que davantage : un usager qui ne
 * voit pas une perturbation cherche l'information ailleurs ; un usager à qui
 * l'on annonce une perturbation inexistante renonce à un trajet possible.
 */
function extraireCibles(
  selecteurs: transit_realtime.IEntitySelector[],
  report: GtfsRtImportReport,
): Cibles {
  // Set : un même arrêt peut être nommé par plusieurs sélecteurs, et Alert
  // n'a pas à contenir deux fois le même identifiant.
  const stopIds = new Set<string>();
  const lineIds = new Set<string>();
  let ecartees = 0;

  for (const selecteur of selecteurs) {
    if (selecteur.trip) {
      report.countDiscardedSelector('tripSelector');
      ecartees += 1;
      continue;
    }

    // protobufjs rend "" — et non undefined — pour une chaîne non transmise.
    if (selecteur.agencyId) {
      report.countDiscardedSelector('agencySelector');
      ecartees += 1;
      continue;
    }

    const stopId = selecteur.stopId?.trim();
    const routeId = selecteur.routeId?.trim();

    if (!stopId && !routeId) {
      // Sélecteur vide, ou ne portant que route_type / direction_id, que nous
      // ne savons pas exprimer.
      report.countDiscardedSelector('emptySelector');
      ecartees += 1;
      continue;
    }

    if (stopId) {
      stopIds.add(stopId);
    }
    if (routeId) {
      lineIds.add(routeId);
    }
  }

  return {
    stopIds: [...stopIds],
    lineIds: [...lineIds],
    ecartees,
  };
}

/**
 * Déduit le ou les modes concernés à partir de la base.
 *
 * LES LIGNES PRIMENT SUR LES ARRÊTS, et ce n'est pas un détail. Une alerte
 * sur la ligne A qui mentionne l'arrêt Châtelet concerne la ligne A — même si
 * Châtelet est aussi desservi par trois tramways. Consulter les arrêts dans
 * ce cas rendrait ambiguë une alerte qui ne l'est pas.
 *
 * Les arrêts ne sont donc consultés que lorsque AUCUNE ligne n'est nommée :
 * c'est alors la seule information disponible.
 */
function deduireModes(
  cible: Cibles,
  lookup: GtfsRtModeLookup,
): Set<ModeTransport> {
  const modes = new Set<ModeTransport>();

  if (cible.lineIds.length > 0) {
    for (const lineId of cible.lineIds) {
      const mode = lookup.modeParLigne.get(lineId);
      if (mode) {
        modes.add(mode);
      }
    }
    return modes;
  }

  for (const stopId of cible.stopIds) {
    for (const mode of lookup.modesParArret.get(stopId) ?? []) {
      modes.add(mode);
    }
  }

  return modes;
}

/**
 * Nom exact d'une valeur d'énumération GTFS-RT.
 *
 * On stocke le NOM ("REDUCED_SERVICE") et non le numéro : un numéro seul
 * serait illisible en base et dépendrait de la version du fichier .proto.
 */
function nomEnum(
  enumeration: Record<number, string>,
  valeur: number | null | undefined,
  defaut: string,
): string {
  if (valeur === null || valeur === undefined) {
    return defaut;
  }

  return enumeration[valeur] ?? defaut;
}

/**
 * Un horodatage GTFS-RT est-il absent ?
 *
 * PIÈGE COÛTEUX, découvert par le test e2e de cette étape. Sur un message
 * DÉCODÉ, protobufjs ne laisse pas les champs non transmis à `undefined` : il
 * les sert depuis le prototype avec la valeur par défaut de la spécification,
 * soit 0 pour un entier. `hasOwnProperty` renvoie bien `false`, mais une
 * simple lecture renvoie 0 — et `new Date(0)` donne le 1ᵉʳ janvier 1970.
 *
 * Ne tester que `undefined` marchait sur des objets construits à la main dans
 * un test unitaire, et écrivait 1970 en base sur un vrai flux.
 *
 * Traiter 0 comme absent n'est PAS un contournement : dans Protocol Buffers,
 * la valeur par défaut d'un champ non transmis EST 0. Les deux disent
 * exactement la même chose — « ce champ n'a pas été fourni ». Et aucune
 * perturbation réelle ne commence ni ne s'achève à l'époque Unix.
 */
function estAbsent(horodatage: number | Long | null | undefined): boolean {
  return (
    horodatage === null || horodatage === undefined || Number(horodatage) === 0
  );
}

/**
 * Horodatage GTFS-RT → Date.
 *
 * DEUX PIÈGES SUPERPOSÉS, relevés en 4F-1B :
 *   1. protobufjs rend les entiers 64 bits en `Long`, pas en `number` ;
 *   2. GTFS-RT compte en SECONDES Unix, JavaScript en millisecondes.
 */
function versDate(horodatage: number | Long | null | undefined): Date {
  return new Date(Number(horodatage) * 1000);
}
