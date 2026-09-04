// =============================================================================
// Dictionnaire d'interface (Phase 5)
// =============================================================================
// ═══ POURQUOI PAS DE BIBLIOTHÈQUE D'INTERNATIONALISATION ═══
//
// `next-intl`, `react-i18next` et consorts apportent le chargement paresseux
// des catalogues, la pluralisation par langue, le formatage de dates et les
// namespaces. Nous n'avons besoin d'aucun des quatre :
//
//   - trois langues, quelques centaines de clés : le catalogue entier pèse
//     moins qu'un logo, le charger paresseusement coûterait plus que le
//     gagner ;
//   - la pluralisation de nos trois langues se règle par un ternaire — aucune
//     ne connaît le duel ni les six formes du russe ;
//   - les dates et les distances passent déjà par `Intl`, natif ;
//   - un seul écran n'a jamais besoin d'un namespace.
//
// Le projet interdit d'ailleurs explicitement les dépendances superflues. Ce
// module fait donc le travail en une centaine de lignes, sans build spécial
// et sans surface d'API à apprendre.
//
// ═══ CE QUI N'EST PAS TRADUIT, ET POURQUOI ═══
//
// Les NOMS PROPRES venus des données : « Gare du Nord », « RER D », « Lobau -
// Hôtel de Ville ». Ils viennent du flux de l'opérateur et n'ont pas de
// traduction — « North Station » ne figure sur aucun panneau, et personne ne
// le demanderait à un guichet.
// =============================================================================

/**
 * Les trois langues de l'interface.
 *
 * ⚠️ IDENTIQUES AUX VALEURS DE `LanguageEnum` côté backend. Les préférences
 * stockent l'une de ces trois valeurs ; en inventer une quatrième ici
 * produirait un 400 à l'enregistrement.
 */
export const LANGUES = ["FR", "EN", "ES"] as const;

export type Langue = (typeof LANGUES)[number];

/// Langue employée quand rien n'est choisi ni stocké.
export const LANGUE_PAR_DEFAUT: Langue = "FR";

/**
 * Étiquette BCP 47 de chaque langue.
 *
 * Sert à `Intl` (dates, nombres) et à la synthèse vocale — une phrase
 * espagnole lue par une voix française est inintelligible.
 */
export const ETIQUETTES_BCP47: Record<Langue, string> = {
  FR: "fr-FR",
  EN: "en-US",
  ES: "es-ES",
};

/// Nom de chaque langue DANS CETTE LANGUE — c'est ainsi qu'on les choisit.
export const NOMS_LANGUES: Record<Langue, string> = {
  FR: "Français",
  EN: "English",
  ES: "Español",
};

/**
 * Les textes de l'interface.
 *
 * ⚠️ LE FRANÇAIS EST LA RÉFÉRENCE. Son type dicte les clés attendues des deux
 * autres : `Record<Langue, typeof FR>` fait échouer la compilation dès qu'une
 * traduction manque ou qu'une clé est inventée. C'est ce qui remplace, à lui
 * seul, l'outillage d'une bibliothèque d'i18n.
 */
const FR = {
  // --- Navigation générale -------------------------------------------------
  appNom: "UrbanFlow",
  retourRecherche: "← Retour à la recherche",
  retourTrajet: "← Retour au trajet",

  // --- Recherche -----------------------------------------------------------
  rechercheTitre: "Rechercher un itinéraire",
  rechercheIntro:
    "Choisissez un point de départ et une destination pour comparer le trajet le plus rapide, le plus direct et le moins émetteur.",
  depart: "Départ",
  arrivee: "Arrivée",
  departPlaceholder: "D'où partez-vous ?",
  arriveePlaceholder: "Où allez-vous ?",
  maPosition: "Ma position",
  domicile: "Domicile",
  travail: "Travail",
  rechercher: "Rechercher",
  rechercheEnCours: "Recherche en cours…",
  // ⚠️ DISTINCT du libellé du bouton : les deux apparaissent EN MÊME TEMPS
  // pendant une recherche, et les confondre rendrait l'écran illisible — et
  // les requêtes de test ambiguës.
  rechercheIndicateur: "Recherche d'itinéraires…",
  memePoint: "Le départ et l'arrivée doivent être différents.",

  // --- Résultats -----------------------------------------------------------

  // --- Navigation et cadre général (sprint soutenance) ---------------------

  // --- Page d'accueil (sprint soutenance) ----------------------------------
  accueilBaseline: "La mobilité urbaine, sans zone d’ombre",
  accueilSlogan1: "Bougez mieux.",
  accueilSlogan2: "Émettez moins.",
  accueilCtaPrincipal: "Rechercher un itinéraire",
  accueilCtaAccroche: "Votre prochain trajet commence ici.",
  accueilTitre: "Bougez dans {territoire} en sachant ce que ça coûte",
  accueilIntro:
    "Comparez vos itinéraires en tram, en bus et à pied, et voyez l’empreinte carbone de chacun avant de partir.",
  accueilCta: "Chercher un itinéraire",
  accueilCtaSecondaire: "Voir les perturbations",

  accueilAtoutCarboneTitre: "Le carbone, chiffré",
  accueilAtoutCarboneTexte:
    "Chaque itinéraire affiche ses émissions et ce qu’il économise face à la voiture, sur les facteurs de la Base Carbone de l’ADEME.",
  accueilAtoutReseauTitre: "Le réseau réel",
  accueilAtoutReseauTexte:
    "Arrêts, lignes, horaires et calendrier de service viennent du flux ouvert de l’opérateur — jamais d’une estimation.",
  accueilAtoutGuidageTitre: "Le guidage au pas",
  accueilAtoutGuidageTexte:
    "Suivi GPS, étape en cours mise en avant et guidage vocal. La position ne quitte jamais votre appareil.",

  accueilHonneteteTitre: "Ce que nous ne savons pas, nous le disons",
  accueilHonneteteTexte:
    "Une source absente est annoncée comme absente. Aucun horaire n’est inventé, aucune perturbation fabriquée, aucun trajet rempli pour faire nombre.",

  // --- Mot de passe oublié (war room) --------------------------------------
  mdpOublieLien: "Mot de passe oublié ?",
  mdpOublieTitre: "Mot de passe oublié",
  mdpOublieIntro:
    "Saisissez l’adresse de votre compte. Nous préparerons un lien de réinitialisation.",
  mdpOublieChamp: "Adresse électronique",
  mdpOublieEnvoyer: "Préparer un lien",
  mdpOublieEnCours: "Préparation…",
  mdpOublieRetour: "Retour à la connexion",
  mdpOublieConfidentialite:
    "Nous répondons la même chose que l’adresse soit inscrite ou non : cela évite qu’on puisse deviner qui a un compte ici.",

  mdpResetTitre: "Nouveau mot de passe",
  mdpResetIntro: "Choisissez un mot de passe d’au moins 8 caractères.",
  mdpResetChamp: "Nouveau mot de passe",
  mdpResetConfirmation: "Confirmer le mot de passe",
  mdpResetValider: "Changer mon mot de passe",
  mdpResetEnCours: "Modification…",
  mdpResetDiscordance: "Les deux mots de passe ne correspondent pas.",
  mdpResetTropCourt: "Le mot de passe doit contenir au moins 8 caractères.",
  mdpResetSansJeton:
    "Ce lien est incomplet. Demandez une nouvelle réinitialisation.",
  mdpResetSucces: "Mot de passe modifié. Vous pouvez vous connecter.",
  mdpAllerConnexion: "Aller à la connexion",

  // --- Autour de moi (war room) --------------------------------------------
  autourTitre: "Autour de moi",
  autourIntro:
    "Les arrêts les plus proches de votre position, avec les lignes qui les desservent.",
  // --- Marche d'approche et de sortie ---
  // ⚠️ « estimation » n'est pas une précaution de style : la distance est à
  // vol d'oiseau, donc MINORÉE. Le trajet réel est toujours plus long.
  tracePietonReel: "Tracé piéton",
  tracePietonReelDetail:
    "Les portions à pied suivent les rues, d’après les données OpenStreetMap.",
  tracePietonEstime: "Tracé piéton estimé",
  tracePietonEstimeDetail:
    "Le trait en pointillés relie les deux points en ligne droite : aucun routeur piéton n’est configuré, ce n’est pas le chemin exact des rues.",
  marcheVersDestination: "Marchez jusqu’à votre destination.",
  marcheVers: "Marche jusqu’à",
  marcheDepuis: "Marche depuis",
  marcheJusquAArrivee: "Marche jusqu’à votre destination",
  marcheEstimation: "estimation à vol d’oiseau",
  marcheEstimationDetail:
    "Aucun routeur piéton n’est configuré : cette distance est mesurée à vol d’oiseau, le chemin réel est plus long.",
  itineraireToutAPied: "Ce trajet se fait entièrement à pied.",
  autourActiver: "Utiliser ma position",
  autourRecherche: "Recherche des arrêts proches…",
  autourAucun: "Aucun arrêt de transport dans les environs.",
  autourAucunDetail:
    "Élargissez la zone ou vérifiez que le réseau de ce territoire est bien chargé.",
  autourDistanceVolDOiseau:
    "Distances et temps de marche estimés à vol d’oiseau : aucun routeur piéton n’est configuré, le trajet réel est plus long.",
  autourHorairesTheoriques:
    "Prochains passages selon les horaires théoriques de l’opérateur. Retards et suppressions ne sont pas connus.",
  autourHorairesInconnus:
    "Les horaires de ces lignes ne sont pas importés : nous ne pouvons pas annoncer de prochain passage.",
  autourDans: "dans",
  autourMinutes: "min",
  autourPartirDIci: "Partir d’ici",
  autourAllerIci: "Aller ici",
  autourPmr: "Accessible PMR",

  navAccueil: "Accueil",
  navRecherche: "Recherche",
  navPerturbations: "Perturbations",
  navImpact: "Impact carbone",
  navMonEspace: "Mon espace",
  navAdministration: "Administration",
  navConnexion: "Connexion",
  navDeconnexion: "Se déconnecter",
  navOuvrirMenu: "Ouvrir le menu",
  navFermerMenu: "Fermer le menu",
  navPrincipale: "Navigation principale",

  themeLabel: "Thème",
  themeSystem: "Système",
  themeLight: "Clair",
  themeDark: "Sombre",
  themeCompteAvertissement:
    "Ce réglage vaut pour ce navigateur. Pour le conserver sur tous vos appareils, enregistrez-le dans vos préférences.",
  langueLabel: "Langue",

  // --- Pied de page et pages légales ---------------------------------------
  piedConfidentialite: "Confidentialité",
  piedMentionsLegales: "Mentions légales",
  piedAccessibilite: "Accessibilité",
  piedMesDonnees: "Mes données",
  piedSecondaire: "Liens légaux",
  demoAvertissement:
    "Installation de démonstration : les coordonnées de l’exploitant ne sont pas configurées.",

  arriveePrevue: "Arrivée prévue",
  attenteTotale: "dont {n} min d’attente",
  attenteSansAttente: "sans attente",
  prochainPassage: "Prochain passage",
  horaireIndisponible:
    "Aucun horaire n’est connu pour ces lignes dans les prochaines heures : la durée affichée ne compte que le temps de parcours.",
  horaireNonImporte:
    "Les horaires ne sont pas importés pour ce réseau : la durée affichée ne compte que le temps de parcours, sans l’attente.",
  horairesTheoriques:
    "Horaires théoriques publiés par l’opérateur. Retards et suppressions ne sont pas connus.",

  critereFastest: "Le plus rapide",
  critereShortest: "Le plus court",
  critereFewestTransfers: "Le moins de changements",
  critereLowestCo2: "Le plus écologique",
  explicationFastest: "Le trajet le plus court en temps, tous modes confondus.",
  explicationShortest:
    "Le trajet qui parcourt le moins de distance. Souvent plus lent : le tram file en site propre mais contourne.",
  explicationFewestTransfers:
    "Le moins de correspondances — la marche n'en est pas une.",
  explicationLowestCo2:
    "Le trajet le moins émetteur parmi ceux réellement praticables.",
  badgeClimat: "🌱 Meilleur pour le climat",
  sansChangement: "sans changement",
  aucunItineraire: "Aucun itinéraire trouvé",
  aucunItineraireDetail:
    "Le réseau ne propose pas de trajet entre ces deux points. Essayez deux arrêts plus proches l'un de l'autre, ou desservis par une même ligne.",
  voirLeTrajet: "Voir le trajet",
  filtresModes: "Modes de transport",
  filtresAutresModes: "Autres modes, non disponibles ici",
  motifAbsentDuReseau: "Ce mode n’existe pas sur le réseau de ce territoire.",
  motifRoutageAbsent:
    "Le routage détaillé n’est pas configuré sur cette installation : nous ne saurions pas tracer un trajet rue par rue.",
  marcheToujoursIncluse:
    "La marche fait partie de tout itinéraire — rejoindre l’arrêt, en sortir — et ne peut donc pas être écartée.",
  modeIndisponible: "Mode non disponible sur ce réseau",
  filtresAide:
    "Ces filtres masquent les itinéraires déjà trouvés ; ils ne relancent pas la recherche.",
  aucunItineraireApresFiltre:
    "Aucun itinéraire ne correspond à ces modes. Réactivez-en un pour revoir les propositions.",
  horsAttente: "Durée hors temps d'attente aux correspondances.",

  // --- Carbone -------------------------------------------------------------
  co2Emis: "CO₂ émis",
  co2Economise: "Économisé vs voiture",
  ecoScore: "Éco-score",
  carboneIndisponible: "Empreinte carbone indisponible.",
  indisponible: "Indisponible",

  // --- Itinéraire ----------------------------------------------------------
  duree: "Durée",
  distance: "Distance",
  changements: "Changements",
  aucun: "Aucun",
  derouleTrajet: "Le déroulé du trajet",
  etapeEnCours: "Étape en cours",
  commencerTrajet: "Commencer le trajet",
  perturbationsTrajet: "Perturbations sur votre trajet",

  // --- Navigation guidée ---------------------------------------------------
  pretAPartir: "Prêt à partir.",
  arreterSuivi: "Arrêter le suivi",
  guidageVocal: "Guidage vocal",
  guidageVocalActif: "Guidage vocal activé",
  recentrer: "Recentrer sur moi",
  suiviCarteActif: "Suivi de la carte activé",
  recherchePosition: "Recherche de votre position…",
  localisationIndisponible: "Localisation indisponible.",
  vousEtesArrive: "Vous êtes arrivé 🌱",
  dureePrevue: "Durée prévue",
  recalcul: "Recalcul de l'itinéraire…",
  instructionMarcher: (distance: string, arret: string) =>
    `Marchez ${distance} jusqu'à ${arret}`,
  instructionPrendre: (mode: string, ligne: string, arret: string) =>
    `Prenez le ${mode} ${ligne}, descendez à ${arret}`,

  // --- Vélos en libre-service (GBFS) ---------------------------------------
  stationsVelib: "Vélos en libre-service",
  velibChargement: "Chargement des stations…",
  velibAucune: "Aucune station de vélos dans cette zone.",
  velibIndisponible: "Données des vélos en libre-service indisponibles.",
  velibMecaniques: "🚲 Mécaniques",
  velibElectriques: "⚡ Électriques",
  velibPlaces: "🅿 Places libres",

  // --- Carte ---------------------------------------------------------------
  carte: "Carte",
  carteAucunArret: "Aucun arrêt à afficher sur la carte.",

  // --- Préférences ---------------------------------------------------------
  langue: "Langue",
  langueAide: "L'interface change immédiatement, sans rechargement.",
};

// ⚠️ PAS DE `as const` SUR `FR`. Il figerait chaque valeur en TYPE LITTÉRAL
// (« Départ » et non `string`), et les traductions anglaise et espagnole
// deviendraient impossibles à écrire : TypeScript exigerait le mot français.
//
// Ce qu'on veut vérifier, ce sont les CLÉS — qu'aucune ne manque et qu'aucune
// ne soit inventée. `Record<Langue, typeof FR>` s'en charge sans figer les
// valeurs.

const EN: typeof FR = {
  appNom: "UrbanFlow",
  retourRecherche: "← Back to search",
  retourTrajet: "← Back to the route",

  rechercheTitre: "Find a route",
  rechercheIntro:
    "Pick a starting point and a destination to compare the fastest, the most direct and the lowest-emission route.",
  depart: "From",
  arrivee: "To",
  departPlaceholder: "Where are you starting from?",
  arriveePlaceholder: "Where are you going?",
  maPosition: "My location",
  domicile: "Home",
  travail: "Work",
  rechercher: "Search",
  rechercheEnCours: "Searching…",
  rechercheIndicateur: "Looking for routes…",
  memePoint: "Start and destination must be different.",


  // --- Navigation and chrome (soutenance sprint) ---------------------------

  // --- Home page (soutenance sprint) ---------------------------------------
  accueilBaseline: "Urban mobility, with nothing hidden",
  accueilSlogan1: "Move better.",
  accueilSlogan2: "Emit less.",
  accueilCtaPrincipal: "Find a route",
  accueilCtaAccroche: "Your next journey starts here.",
  accueilTitre: "Move around {territoire} knowing what it costs",
  accueilIntro:
    "Compare tram, bus and walking routes, and see the carbon footprint of each one before you leave.",
  accueilCta: "Find a route",
  accueilCtaSecondaire: "Check disruptions",

  accueilAtoutCarboneTitre: "Carbon, measured",
  accueilAtoutCarboneTexte:
    "Every route shows its emissions and what it saves against driving, using ADEME Base Carbone factors.",
  accueilAtoutReseauTitre: "The real network",
  accueilAtoutReseauTexte:
    "Stops, lines, timetables and service calendar come from the operator’s open feed — never from an estimate.",
  accueilAtoutGuidageTitre: "Step-by-step guidance",
  accueilAtoutGuidageTexte:
    "GPS tracking, the current step highlighted, and voice guidance. Your position never leaves your device.",

  accueilHonneteteTitre: "What we don’t know, we say",
  accueilHonneteteTexte:
    "A missing source is announced as missing. No timetable is invented, no disruption fabricated, no route padded to fill a card.",

  // --- Forgotten password (war room) ---------------------------------------
  mdpOublieLien: "Forgot your password?",
  mdpOublieTitre: "Forgotten password",
  mdpOublieIntro:
    "Enter your account address. We will prepare a reset link.",
  mdpOublieChamp: "Email address",
  mdpOublieEnvoyer: "Prepare a link",
  mdpOublieEnCours: "Preparing…",
  mdpOublieRetour: "Back to sign in",
  mdpOublieConfidentialite:
    "We answer the same whether the address is registered or not: this prevents anyone from working out who has an account here.",

  mdpResetTitre: "New password",
  mdpResetIntro: "Choose a password of at least 8 characters.",
  mdpResetChamp: "New password",
  mdpResetConfirmation: "Confirm password",
  mdpResetValider: "Change my password",
  mdpResetEnCours: "Changing…",
  mdpResetDiscordance: "The two passwords do not match.",
  mdpResetTropCourt: "The password must be at least 8 characters long.",
  mdpResetSansJeton: "This link is incomplete. Request a new reset.",
  mdpResetSucces: "Password changed. You can now sign in.",
  mdpAllerConnexion: "Go to sign in",

  // --- Around me (war room) ------------------------------------------------
  autourTitre: "Around me",
  autourIntro:
    "The stops closest to your position, with the lines that serve them.",
  tracePietonReel: "Walking route",
  tracePietonReelDetail:
    "Walking sections follow the streets, based on OpenStreetMap data.",
  tracePietonEstime: "Estimated walking route",
  tracePietonEstimeDetail:
    "The dashed line joins the two points in a straight line: no pedestrian router is configured, this is not the exact street path.",
  marcheVersDestination: "Walk to your destination.",
  marcheVers: "Walk to",
  marcheDepuis: "Walk from",
  marcheJusquAArrivee: "Walk to your destination",
  marcheEstimation: "straight-line estimate",
  marcheEstimationDetail:
    "No pedestrian router is configured: this distance is measured as the crow flies, the real path is longer.",
  itineraireToutAPied: "This trip is entirely on foot.",
  autourActiver: "Use my location",
  autourRecherche: "Looking for nearby stops…",
  autourAucun: "No transport stop nearby.",
  autourAucunDetail:
    "Widen the area, or check that this territory's network is loaded.",
  autourDistanceVolDOiseau:
    "Distances and walking times estimated as the crow flies: no pedestrian router is configured, the real route is longer.",
  autourHorairesTheoriques:
    "Next departures from the operator's scheduled times. Delays and cancellations are not known.",
  autourHorairesInconnus:
    "Timetables for these lines are not imported: we cannot announce a next departure.",
  autourDans: "in",
  autourMinutes: "min",
  autourPartirDIci: "Depart from here",
  autourAllerIci: "Go here",
  autourPmr: "Step-free access",

  navAccueil: "Home",
  navRecherche: "Search",
  navPerturbations: "Disruptions",
  navImpact: "Carbon impact",
  navMonEspace: "My account",
  navAdministration: "Administration",
  navConnexion: "Sign in",
  navDeconnexion: "Sign out",
  navOuvrirMenu: "Open menu",
  navFermerMenu: "Close menu",
  navPrincipale: "Main navigation",

  themeLabel: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  themeCompteAvertissement:
    "This setting applies to this browser. To keep it across devices, save it in your preferences.",
  langueLabel: "Language",

  // --- Footer and legal pages ----------------------------------------------
  piedConfidentialite: "Privacy",
  piedMentionsLegales: "Legal notice",
  piedAccessibilite: "Accessibility",
  piedMesDonnees: "My data",
  piedSecondaire: "Legal links",
  demoAvertissement:
    "Demonstration deployment: the operator’s details are not configured.",

  arriveePrevue: "Arriving at",
  attenteTotale: "including {n} min waiting",
  attenteSansAttente: "no waiting",
  prochainPassage: "Next departure",
  horaireIndisponible:
    "No timetable is known for these lines in the next few hours: the duration shown covers travel time only.",
  horaireNonImporte:
    "Timetables are not imported for this network: the duration shown covers travel time only, without waiting.",
  horairesTheoriques:
    "Scheduled times published by the operator. Delays and cancellations are not known.",

  critereFastest: "Fastest",
  critereShortest: "Shortest",
  critereFewestTransfers: "Fewest changes",
  critereLowestCo2: "Greenest",
  explicationFastest: "The shortest route in time, across all modes.",
  explicationShortest:
    "The route covering the least ground. Often slower: the tram runs on its own tracks but goes around.",
  explicationFewestTransfers: "The fewest changes — walking is not one.",
  explicationLowestCo2:
    "The lowest-emission route among those that are actually practicable.",
  badgeClimat: "🌱 Best for the climate",
  sansChangement: "no changes",
  aucunItineraire: "No route found",
  aucunItineraireDetail:
    "The network offers no route between these two points. Try two stops closer together, or served by the same line.",
  voirLeTrajet: "View the route",
  filtresModes: "Transport modes",
  filtresAutresModes: "Other modes, unavailable here",
  motifAbsentDuReseau: "This mode does not exist on this territory’s network.",
  motifRoutageAbsent:
    "Detailed routing is not configured on this deployment: we could not trace a street-by-street route.",
  marcheToujoursIncluse:
    "Walking is part of every route — reaching the stop, leaving it — and therefore cannot be excluded.",
  modeIndisponible: "Mode not available on this network",
  filtresAide:
    "These filters hide routes already found; they do not run a new search.",
  aucunItineraireApresFiltre:
    "No route matches these modes. Re-enable one to see the suggestions again.",
  horsAttente: "Duration excludes waiting time at changes.",

  co2Emis: "CO₂ emitted",
  co2Economise: "Saved vs car",
  ecoScore: "Eco-score",
  carboneIndisponible: "Carbon footprint unavailable.",
  indisponible: "Unavailable",

  duree: "Duration",
  distance: "Distance",
  changements: "Changes",
  aucun: "None",
  derouleTrajet: "Step by step",
  etapeEnCours: "Current step",
  commencerTrajet: "Start the journey",
  perturbationsTrajet: "Disruptions on your route",

  pretAPartir: "Ready to go.",
  arreterSuivi: "Stop tracking",
  guidageVocal: "Voice guidance",
  guidageVocalActif: "Voice guidance on",
  recentrer: "Recentre on me",
  suiviCarteActif: "Map following on",
  recherchePosition: "Looking for your location…",
  localisationIndisponible: "Location unavailable.",
  vousEtesArrive: "You have arrived 🌱",
  dureePrevue: "Planned duration",
  recalcul: "Recalculating the route…",
  instructionMarcher: (distance, arret) => `Walk ${distance} to ${arret}`,
  instructionPrendre: (mode, ligne, arret) =>
    `Take ${mode} ${ligne}, get off at ${arret}`,

  stationsVelib: "Shared bikes",
  velibChargement: "Loading stations…",
  velibAucune: "No bike station in this area.",
  velibIndisponible: "Shared bike data unavailable.",
  velibMecaniques: "🚲 Mechanical",
  velibElectriques: "⚡ Electric",
  velibPlaces: "🅿 Free docks",

  carte: "Map",
  carteAucunArret: "No stop to show on the map.",

  langue: "Language",
  langueAide: "The interface changes immediately, without reloading.",
};

const ES: typeof FR = {
  appNom: "UrbanFlow",
  retourRecherche: "← Volver a la búsqueda",
  retourTrajet: "← Volver al trayecto",

  rechercheTitre: "Buscar un itinerario",
  rechercheIntro:
    "Elige un punto de partida y un destino para comparar el trayecto más rápido, el más directo y el menos contaminante.",
  depart: "Origen",
  arrivee: "Destino",
  departPlaceholder: "¿Desde dónde sales?",
  arriveePlaceholder: "¿A dónde vas?",
  maPosition: "Mi ubicación",
  domicile: "Casa",
  travail: "Trabajo",
  rechercher: "Buscar",
  rechercheEnCours: "Buscando…",
  rechercheIndicateur: "Buscando itinerarios…",
  memePoint: "El origen y el destino deben ser diferentes.",


  // --- Navegación y marco (sprint de defensa) ------------------------------

  // --- Página de inicio (sprint de defensa) --------------------------------
  accueilBaseline: "La movilidad urbana, sin zonas de sombra",
  accueilSlogan1: "Muévase mejor.",
  accueilSlogan2: "Emita menos.",
  accueilCtaPrincipal: "Buscar un itinerario",
  accueilCtaAccroche: "Su próximo trayecto empieza aquí.",
  accueilTitre: "Muévase por {territoire} sabiendo lo que cuesta",
  accueilIntro:
    "Compare sus itinerarios en tranvía, autobús y a pie, y vea la huella de carbono de cada uno antes de salir.",
  accueilCta: "Buscar un itinerario",
  accueilCtaSecondaire: "Ver las incidencias",

  accueilAtoutCarboneTitre: "El carbono, en cifras",
  accueilAtoutCarboneTexte:
    "Cada itinerario muestra sus emisiones y lo que ahorra frente al coche, según los factores de la Base Carbone de ADEME.",
  accueilAtoutReseauTitre: "La red real",
  accueilAtoutReseauTexte:
    "Paradas, líneas, horarios y calendario de servicio proceden del flujo abierto del operador, nunca de una estimación.",
  accueilAtoutGuidageTitre: "Guiado paso a paso",
  accueilAtoutGuidageTexte:
    "Seguimiento GPS, etapa actual destacada y guiado por voz. Su posición nunca sale de su dispositivo.",

  accueilHonneteteTitre: "Lo que no sabemos, lo decimos",
  accueilHonneteteTexte:
    "Una fuente ausente se anuncia como ausente. Ningún horario se inventa, ninguna incidencia se fabrica, ningún trayecto se rellena para hacer número.",

  // --- Contraseña olvidada (war room) --------------------------------------
  mdpOublieLien: "¿Olvidó su contraseña?",
  mdpOublieTitre: "Contraseña olvidada",
  mdpOublieIntro:
    "Introduzca la dirección de su cuenta. Prepararemos un enlace de restablecimiento.",
  mdpOublieChamp: "Dirección de correo electrónico",
  mdpOublieEnvoyer: "Preparar un enlace",
  mdpOublieEnCours: "Preparando…",
  mdpOublieRetour: "Volver al inicio de sesión",
  mdpOublieConfidentialite:
    "Respondemos lo mismo tanto si la dirección está registrada como si no: así nadie puede averiguar quién tiene una cuenta aquí.",

  mdpResetTitre: "Nueva contraseña",
  mdpResetIntro: "Elija una contraseña de al menos 8 caracteres.",
  mdpResetChamp: "Nueva contraseña",
  mdpResetConfirmation: "Confirmar contraseña",
  mdpResetValider: "Cambiar mi contraseña",
  mdpResetEnCours: "Cambiando…",
  mdpResetDiscordance: "Las dos contraseñas no coinciden.",
  mdpResetTropCourt: "La contraseña debe tener al menos 8 caracteres.",
  mdpResetSansJeton: "Este enlace está incompleto. Solicite un nuevo restablecimiento.",
  mdpResetSucces: "Contraseña cambiada. Ya puede iniciar sesión.",
  mdpAllerConnexion: "Ir al inicio de sesión",

  // --- A mi alrededor (war room) -------------------------------------------
  autourTitre: "A mi alrededor",
  autourIntro:
    "Las paradas más cercanas a su posición, con las líneas que las sirven.",
  tracePietonReel: "Ruta a pie",
  tracePietonReelDetail:
    "Los tramos a pie siguen las calles, según los datos de OpenStreetMap.",
  tracePietonEstime: "Ruta a pie estimada",
  tracePietonEstimeDetail:
    "La línea discontinua une los dos puntos en línea recta: no hay ningún enrutador peatonal configurado, no es el trazado exacto de las calles.",
  marcheVersDestination: "Camina hasta tu destino.",
  marcheVers: "Caminar hasta",
  marcheDepuis: "Caminar desde",
  marcheJusquAArrivee: "Caminar hasta su destino",
  marcheEstimation: "estimación en línea recta",
  marcheEstimationDetail:
    "No hay ningún enrutador peatonal configurado: esta distancia se mide en línea recta, el camino real es más largo.",
  itineraireToutAPied: "Este trayecto se realiza completamente a pie.",
  autourActiver: "Usar mi ubicación",
  autourRecherche: "Buscando paradas cercanas…",
  autourAucun: "Ninguna parada de transporte en los alrededores.",
  autourAucunDetail:
    "Amplíe la zona o compruebe que la red de este territorio está cargada.",
  autourDistanceVolDOiseau:
    "Distancias y tiempos de marcha estimados en línea recta: no hay enrutador peatonal configurado, el trayecto real es más largo.",
  autourHorairesTheoriques:
    "Próximos pasos según los horarios teóricos del operador. No se conocen retrasos ni supresiones.",
  autourHorairesInconnus:
    "Los horarios de estas líneas no están importados: no podemos anunciar un próximo paso.",
  autourDans: "en",
  autourMinutes: "min",
  autourPartirDIci: "Salir de aquí",
  autourAllerIci: "Ir aquí",
  autourPmr: "Accesible PMR",

  navAccueil: "Inicio",
  navRecherche: "Búsqueda",
  navPerturbations: "Incidencias",
  navImpact: "Impacto de carbono",
  navMonEspace: "Mi cuenta",
  navAdministration: "Administración",
  navConnexion: "Iniciar sesión",
  navDeconnexion: "Cerrar sesión",
  navOuvrirMenu: "Abrir el menú",
  navFermerMenu: "Cerrar el menú",
  navPrincipale: "Navegación principal",

  themeLabel: "Tema",
  themeSystem: "Sistema",
  themeLight: "Claro",
  themeDark: "Oscuro",
  themeCompteAvertissement:
    "Este ajuste se aplica a este navegador. Para conservarlo en todos sus dispositivos, guárdelo en sus preferencias.",
  langueLabel: "Idioma",

  // --- Pie de página y páginas legales -------------------------------------
  piedConfidentialite: "Privacidad",
  piedMentionsLegales: "Aviso legal",
  piedAccessibilite: "Accesibilidad",
  piedMesDonnees: "Mis datos",
  piedSecondaire: "Enlaces legales",
  demoAvertissement:
    "Instalación de demostración: los datos del operador no están configurados.",

  arriveePrevue: "Llegada prevista",
  attenteTotale: "incluidos {n} min de espera",
  attenteSansAttente: "sin espera",
  prochainPassage: "Próximo paso",
  horaireIndisponible:
    "No se conoce ningún horario para estas líneas en las próximas horas: la duración mostrada solo cuenta el tiempo de trayecto.",
  horaireNonImporte:
    "Los horarios no están importados para esta red: la duración mostrada solo cuenta el tiempo de trayecto, sin la espera.",
  horairesTheoriques:
    "Horarios teóricos publicados por el operador. No se conocen retrasos ni supresiones.",

  critereFastest: "El más rápido",
  critereShortest: "El más corto",
  critereFewestTransfers: "Menos transbordos",
  critereLowestCo2: "El más ecológico",
  explicationFastest: "El trayecto más corto en tiempo, con todos los modos.",
  explicationShortest:
    "El trayecto que recorre menos distancia. A menudo más lento: el tranvía circula en vía propia pero da un rodeo.",
  explicationFewestTransfers:
    "El menor número de transbordos — caminar no cuenta como uno.",
  explicationLowestCo2:
    "El trayecto menos contaminante entre los realmente practicables.",
  badgeClimat: "🌱 Mejor para el clima",
  sansChangement: "sin transbordos",
  aucunItineraire: "Ningún itinerario encontrado",
  aucunItineraireDetail:
    "La red no ofrece ningún trayecto entre estos dos puntos. Prueba con dos paradas más cercanas, o servidas por la misma línea.",
  voirLeTrajet: "Ver el trayecto",
  filtresModes: "Modos de transporte",
  filtresAutresModes: "Otros modos, no disponibles aquí",
  motifAbsentDuReseau: "Este modo no existe en la red de este territorio.",
  motifRoutageAbsent:
    "El enrutamiento detallado no está configurado en esta instalación: no sabríamos trazar un trayecto calle por calle.",
  marcheToujoursIncluse:
    "Caminar forma parte de todo itinerario —llegar a la parada, salir de ella— y por tanto no puede excluirse.",
  modeIndisponible: "Modo no disponible en esta red",
  filtresAide:
    "Estos filtros ocultan itinerarios ya encontrados; no lanzan una nueva búsqueda.",
  aucunItineraireApresFiltre:
    "Ningún itinerario coincide con estos modos. Reactiva uno para ver las propuestas.",
  horsAttente: "Duración sin el tiempo de espera en los transbordos.",

  co2Emis: "CO₂ emitido",
  co2Economise: "Ahorrado frente al coche",
  ecoScore: "Eco-puntuación",
  carboneIndisponible: "Huella de carbono no disponible.",
  indisponible: "No disponible",

  duree: "Duración",
  distance: "Distancia",
  changements: "Transbordos",
  aucun: "Ninguno",
  derouleTrajet: "Paso a paso",
  etapeEnCours: "Etapa actual",
  commencerTrajet: "Empezar el trayecto",
  perturbationsTrajet: "Incidencias en tu trayecto",

  pretAPartir: "Listo para salir.",
  arreterSuivi: "Detener el seguimiento",
  guidageVocal: "Guía por voz",
  guidageVocalActif: "Guía por voz activada",
  recentrer: "Centrar en mí",
  suiviCarteActif: "Seguimiento del mapa activado",
  recherchePosition: "Buscando tu ubicación…",
  localisationIndisponible: "Ubicación no disponible.",
  vousEtesArrive: "Has llegado 🌱",
  dureePrevue: "Duración prevista",
  recalcul: "Recalculando el itinerario…",
  instructionMarcher: (distance, arret) => `Camina ${distance} hasta ${arret}`,
  instructionPrendre: (mode, ligne, arret) =>
    `Toma el ${mode} ${ligne}, bájate en ${arret}`,

  stationsVelib: "Bicicletas compartidas",
  velibChargement: "Cargando las estaciones…",
  velibAucune: "Ninguna estación de bicicletas en esta zona.",
  velibIndisponible: "Datos de bicicletas compartidas no disponibles.",
  velibMecaniques: "🚲 Mecánicas",
  velibElectriques: "⚡ Eléctricas",
  velibPlaces: "🅿 Plazas libres",

  carte: "Mapa",
  carteAucunArret: "Ninguna parada que mostrar en el mapa.",

  langue: "Idioma",
  langueAide: "La interfaz cambia inmediatamente, sin recargar.",
};

/** Le catalogue complet. */
export const TEXTES: Record<Langue, typeof FR> = { FR, EN, ES };

/** Type des textes — utile pour typer un composant qui les reçoit. */
export type Textes = typeof FR;

/**
 * Reconnaît une langue, ou rend `null`.
 *
 * ⚠️ TOUTE VALEUR EXTÉRIEURE PASSE PAR ICI. La langue vient des préférences
 * de l'usager — donc d'une API — ou du stockage du navigateur, où elle a pu
 * être écrite par une version antérieure. La caster ferait chercher un
 * catalogue inexistant, et l'interface s'afficherait vide.
 */
export function langueValide(valeur: unknown): Langue | null {
  return typeof valeur === "string" && (LANGUES as readonly string[]).includes(valeur)
    ? (valeur as Langue)
    : null;
}
