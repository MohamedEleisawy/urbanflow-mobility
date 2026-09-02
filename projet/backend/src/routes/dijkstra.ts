// =============================================================================
// Dijkstra générique à coût LEXICOGRAPHIQUE (Phase 4)
// =============================================================================
// Ce module est PUR : aucune dépendance à Prisma, à NestJS ni au domaine
// transport. Il ne connaît que des sommets identifiés par une chaîne et des
// arêtes portant un coût. C'est ce qui le rend testable sans base de données.
//
// ═══ POURQUOI UN COÛT LEXICOGRAPHIQUE, ET NON UN SCALAIRE ═══
//
// Le critère « le moins de changements » ne peut pas s'écrire comme un simple
// poids. La formulation naïve — `durée + PÉNALITÉ × changement` — oblige à
// choisir une pénalité (5 minutes ? 10 ?) que RIEN dans le dossier de
// conception ne justifie. C'est exactement le raisonnement qui a fait refuser
// d'inventer un facteur d'émission pour ESCOOTER : on n'écrit pas un nombre
// qu'on ne saurait pas défendre devant un jury.
//
// L'ordre lexicographique répond à la question sans coefficient :
//
//     coût = [nombre de changements, durée en minutes]
//
// se lit « le moins de changements possible ; à égalité, le plus rapide ».
// C'est une définition EXACTE du critère, pas une approximation pondérée.
//
// Dijkstra reste valide sur ces vecteurs : l'ordre lexicographique est un
// ordre total, et l'addition composante par composante d'un vecteur à termes
// positifs ne peut que faire croître le coût — les deux seules propriétés
// dont l'algorithme a besoin.
// =============================================================================

/**
 * Coût d'un chemin : un vecteur comparé composante par composante.
 *
 * ⚠️ TOUTES LES COMPOSANTES DOIVENT ÊTRE POSITIVES OU NULLES. Une composante
 * négative casserait l'hypothèse de Dijkstra (un sommet « réglé » pourrait
 * encore être amélioré) et rendrait le résultat silencieusement faux.
 */
export type Cout = readonly number[];

/**
 * Compare deux coûts dans l'ordre lexicographique.
 *
 * Renvoie un nombre négatif si `a` est meilleur, positif si `b` l'est, zéro
 * s'ils sont équivalents.
 */
export function comparerCouts(a: Cout, b: Cout): number {
  const longueur = Math.max(a.length, b.length);

  for (let i = 0; i < longueur; i++) {
    // Une composante absente vaut 0 : deux coûts de longueurs différentes
    // restent comparables plutôt que de produire un NaN.
    const difference = (a[i] ?? 0) - (b[i] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

/** Somme composante par composante de deux coûts. */
export function additionnerCouts(a: Cout, b: Cout): Cout {
  const longueur = Math.max(a.length, b.length);
  const somme: number[] = new Array<number>(longueur);

  for (let i = 0; i < longueur; i++) {
    somme[i] = (a[i] ?? 0) + (b[i] ?? 0);
  }

  return somme;
}

/**
 * Tas binaire minimal, ordonné par `comparerCouts`.
 *
 * ═══ POURQUOI IL REMPLACE LE BALAYAGE LINÉAIRE ═══
 *
 * L'implémentation précédente cherchait le sommet de coût minimal en
 * parcourant TOUTE la table des coûts à chaque itération — un Dijkstra en
 * O(V²). C'était tenable tant que les sommets étaient les seuls arrêts
 * (1 934 en base, quelques centaines dans le cadre de recherche).
 *
 * Ce n'est plus le cas : le critère « moins de changements » exige de
 * distinguer « être à Châtelet en étant descendu du RER A » de « y être en
 * étant descendu du métro 1 ». Les sommets deviennent des couples
 * (arrêt, ligne), et leur nombre suit celui des LIAISONS, pas des arrêts.
 * O(V²) sur des milliers de sommets, multiplié par le nombre de candidats
 * évalués à chaque recherche, ne passait plus.
 *
 * ⚠️ AUCUNE OPÉRATION `decrease-key`. Améliorer le coût d'un sommet déjà
 * empilé demanderait de retrouver sa position dans le tas. On ré-empile donc
 * le sommet avec son nouveau coût, et l'entrée périmée est ignorée au
 * dépilage (elle désigne un sommet déjà réglé). C'est l'idiome « lazy
 * deletion » : le tas peut contenir jusqu'à E entrées au lieu de V, ce qui ne
 * change pas la complexité O(E log E) et supprime toute structure auxiliaire.
 */
class TasMinimal {
  private readonly elements: { cle: Cout; valeur: string }[] = [];

  /**
   * Ordre TOTAL : le coût d'abord, puis l'identifiant d'état.
   *
   * ⚠️ LE SECOND CRITÈRE N'EST PAS COSMÉTIQUE. Sans lui, deux états de coût
   * égal sortiraient du tas dans l'ordre où sa réorganisation interne les a
   * laissés — donc, en remontant la chaîne, dans l'ordre où PostgreSQL a
   * rendu ses lignes. Deux recherches identiques pourraient alors rendre deux
   * chemins différents. C'est la règle de déterminisme posée à l'étape 4C-2.
   */
  private static comparer(
    a: { cle: Cout; valeur: string },
    b: { cle: Cout; valeur: string },
  ): number {
    const parCout = comparerCouts(a.cle, b.cle);

    if (parCout !== 0) {
      return parCout;
    }

    return a.valeur < b.valeur ? -1 : a.valeur > b.valeur ? 1 : 0;
  }

  get taille(): number {
    return this.elements.length;
  }

  inserer(cle: Cout, valeur: string): void {
    this.elements.push({ cle, valeur });
    this.remonter(this.elements.length - 1);
  }

  extraireMinimum(): { cle: Cout; valeur: string } | undefined {
    if (this.elements.length === 0) {
      return undefined;
    }

    const minimum = this.elements[0];
    const dernier = this.elements.pop();

    if (this.elements.length > 0 && dernier !== undefined) {
      this.elements[0] = dernier;
      this.descendre(0);
    }

    return minimum;
  }

  private remonter(depart: number): void {
    let index = depart;

    while (index > 0) {
      const parent = (index - 1) >> 1;

      if (
        TasMinimal.comparer(this.elements[index], this.elements[parent]) >= 0
      ) {
        return;
      }

      this.echanger(index, parent);
      index = parent;
    }
  }

  private descendre(depart: number): void {
    let index = depart;

    for (;;) {
      const gauche = index * 2 + 1;
      const droite = gauche + 1;
      let plusPetit = index;

      if (
        gauche < this.elements.length &&
        TasMinimal.comparer(this.elements[gauche], this.elements[plusPetit]) < 0
      ) {
        plusPetit = gauche;
      }

      if (
        droite < this.elements.length &&
        TasMinimal.comparer(this.elements[droite], this.elements[plusPetit]) < 0
      ) {
        plusPetit = droite;
      }

      if (plusPetit === index) {
        return;
      }

      this.echanger(index, plusPetit);
      index = plusPetit;
    }
  }

  private echanger(a: number, b: number): void {
    const tampon = this.elements[a];
    this.elements[a] = this.elements[b];
    this.elements[b] = tampon;
  }
}

/**
 * Une arête du graphe, du point de vue de l'algorithme.
 *
 * `A` est le type des données métier transportées : le module ne les lit
 * jamais, il se contente de les restituer dans le chemin trouvé.
 */
export interface AreteGenerique<A> {
  /// Sommet atteint par cette arête.
  vers: string;
  /// Charge utile rendue telle quelle dans le chemin.
  donnee: A;
}

/** Une étape du chemin reconstruit. */
export interface EtapeChemin<A> {
  depuis: string;
  arete: AreteGenerique<A>;
}

export interface OptionsDijkstra<A> {
  /// Pour un sommet, les arêtes qui en partent.
  aretesDepuis: (sommet: string) => Iterable<AreteGenerique<A>>;

  /**
   * Coût d'emprunter `arete` depuis l'état `etatCourant`.
   *
   * ⚠️ C'EST L'ÉTAT QUI EST PASSÉ, ET NON L'ARÊTE PRÉCÉDENTE. La différence
   * compte : « combien de changements ai-je faits ? » ne se lit pas sur la
   * dernière arête empruntée. Un trajet métro → marche → métro sur la MÊME
   * ligne ne comporte aucun changement, alors que l'arête précédente est
   * une marche. L'appelant encode donc dans l'état ce qu'il doit mémoriser
   * — ici la dernière ligne réellement empruntée — et le relit ici.
   *
   * ⚠️ DOIT RENDRE UN VECTEUR À COMPOSANTES POSITIVES OU NULLES, et de
   * longueur constante d'un appel à l'autre.
   */
  coutDe: (arete: AreteGenerique<A>, etatCourant: string) => Cout;

  /**
   * Identité de l'ÉTAT atteint après avoir emprunté `arete` depuis
   * `etatCourant`. Deux chemins de même état sont interchangeables pour la
   * suite du parcours.
   *
   * Rendre simplement `arete.vers` donne un Dijkstra classique. Y adjoindre
   * la ligne courante distingue « à Châtelet, sur le RER A » de « à Châtelet,
   * sur le métro 1 » — ce qu'exige le comptage des changements.
   *
   * ⚠️ PLUS L'ÉTAT PORTE D'INFORMATION, PLUS LE GRAPHE EXPLORÉ EST GRAND.
   * N'y mettre que ce dont `coutDe` a besoin.
   */
  etatApres: (arete: AreteGenerique<A>, etatCourant: string) => string;

  /// Sommet de départ.
  depart: string;

  /// Vrai quand le sommet atteint est une arrivée acceptable.
  estArrivee: (sommet: string) => boolean;
}

/**
 * Plus court chemin au sens de `coutDe`, ou `null` si l'arrivée est
 * inatteignable.
 *
 * ⚠️ DÉTERMINISME. À coût strictement égal, l'état déjà connu est conservé :
 * le premier chemin trouvé gagne, et l'ordre d'exploration est lui-même
 * déterminé par l'ordre des arêtes fourni par l'appelant. C'est à ce dernier
 * de trier ses arêtes (par identifiant) pour que deux recherches identiques
 * rendent le même chemin — la règle posée à l'étape 4C-2.
 */
export function cheminOptimal<A>(
  options: OptionsDijkstra<A>,
): EtapeChemin<A>[] | null {
  const { aretesDepuis, coutDe, etatApres, depart, estArrivee } = options;

  // État initial : on est au départ, sans être arrivé par aucune arête.
  const etatInitial = depart;

  const meilleurCout = new Map<string, Cout>([[etatInitial, []]]);
  const venantDe = new Map<
    string,
    { etatPrecedent: string; etape: EtapeChemin<A> }
  >();
  const sommetDeLEtat = new Map<string, string>([[etatInitial, depart]]);
  const regles = new Set<string>();

  const tas = new TasMinimal();
  tas.inserer([], etatInitial);

  let etatArrivee: string | null = null;

  while (tas.taille > 0) {
    const extrait = tas.extraireMinimum();

    if (extrait === undefined) {
      break;
    }

    const etat = extrait.valeur;

    // Entrée périmée laissée par la « lazy deletion » : cet état a déjà été
    // réglé à un coût meilleur ou égal.
    if (regles.has(etat)) {
      continue;
    }

    regles.add(etat);

    const coutCourant = meilleurCout.get(etat);

    if (coutCourant === undefined) {
      continue;
    }

    const sommet = sommetDeLEtat.get(etat) ?? etat;

    if (estArrivee(sommet)) {
      etatArrivee = etat;
      break;
    }

    for (const arete of aretesDepuis(sommet)) {
      const etatSuivant = etatApres(arete, etat);

      if (regles.has(etatSuivant)) {
        continue;
      }

      const candidat = additionnerCouts(coutCourant, coutDe(arete, etat));

      const connu = meilleurCout.get(etatSuivant);

      if (connu !== undefined) {
        const ecart = comparerCouts(candidat, connu);

        if (ecart > 0) {
          continue;
        }

        // ⚠️ COÛT STRICTEMENT ÉGAL : deux chemins différents mènent au même
        // état pour le même prix. Sans règle explicite, le gagnant serait
        // « celui exploré en premier », donc l'ordre des liaisons rendues par
        // PostgreSQL. On retient le prédécesseur d'identifiant le plus petit
        // — arbitraire, mais TOTAL et stable (règle de l'étape 4C-2).
        if (ecart === 0) {
          const precedentConnu = venantDe.get(etatSuivant)?.etatPrecedent;

          if (precedentConnu !== undefined && precedentConnu <= etat) {
            continue;
          }
        }
      }

      meilleurCout.set(etatSuivant, candidat);
      venantDe.set(etatSuivant, {
        etatPrecedent: etat,
        etape: { depuis: sommet, arete },
      });
      sommetDeLEtat.set(etatSuivant, arete.vers);
      tas.inserer(candidat, etatSuivant);
    }
  }

  if (etatArrivee === null) {
    return null;
  }

  // Reconstruction, de l'arrivée vers le départ.
  const etapes: EtapeChemin<A>[] = [];
  let curseur = etatArrivee;

  while (curseur !== etatInitial) {
    const precedent = venantDe.get(curseur);

    if (precedent === undefined) {
      return null;
    }

    etapes.unshift(precedent.etape);
    curseur = precedent.etatPrecedent;
  }

  return etapes;
}
