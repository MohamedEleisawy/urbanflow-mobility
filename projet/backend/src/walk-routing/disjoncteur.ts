import { Logger } from '@nestjs/common';

// =============================================================================
// Disjoncteur pour un service extérieur
// =============================================================================
// ═══ POURQUOI, ET PAS SEULEMENT UN REPLI ═══
//
// Le repli existait déjà : un moteur injoignable rend `null`, et l'appelant
// retombe sur son estimation. Correct, mais COÛTEUX — chaque recherche
// d'itinéraire attend quand même le délai complet du `fetch` avant d'échouer.
// Un fournisseur indisponible ajoute donc plusieurs secondes à CHAQUE
// recherche, indéfiniment.
//
// Passé un seuil d'échecs, ce disjoncteur fait cesser les appels : la réponse
// redevient instantanée, dégradée mais franche. Après une pause, un appel est
// retenté — le service a pu revenir.
//
// ⚠️ RÉUTILISÉ PAR DEUX SERVICES (piéton, vélo), CHACUN AVEC SON INSTANCE. Un
// Valhalla qui échoue sur le profil vélo peut très bien répondre sur le
// piéton : mélanger les deux compteurs couperait un profil qui marche.
// =============================================================================

/**
 * Échecs consécutifs avant d'ouvrir le disjoncteur.
 *
 * TROIS, et non un : un échec isolé arrive — un paquet perdu, une seconde de
 * latence. Couper dès le premier priverait le produit pour un incident sans
 * lendemain.
 */
const ECHECS_AVANT_OUVERTURE = 3;

/** Durée pendant laquelle on cesse d'interroger un moteur déclaré en panne. */
const DUREE_OUVERTURE_MS = 60_000;

export class Disjoncteur {
  private echecsConsecutifs = 0;
  private ouvertJusqua = 0;

  constructor(
    private readonly logger: Logger,
    private readonly nom: string,
  ) {}

  /**
   * Le disjoncteur est-il ouvert — autrement dit : renonce-t-on à appeler ?
   *
   * ⚠️ OBSERVABLE DE L'EXTÉRIEUR À DESSEIN. Un disjoncteur qu'on ne peut pas
   * interroger est un disjoncteur qu'on ne peut pas diagnostiquer.
   */
  ouvert(maintenant = Date.now()): boolean {
    return maintenant < this.ouvertJusqua;
  }

  /// Un appel a abouti : le moteur répond, on repart de zéro.
  succes(): void {
    if (this.echecsConsecutifs > 0 || this.ouvertJusqua !== 0) {
      this.logger.log(`${this.nom} de nouveau disponible.`);
    }

    this.echecsConsecutifs = 0;
    this.ouvertJusqua = 0;
  }

  /**
   * Un appel a échoué : au troisième d'affilée, on cesse d'insister.
   *
   * Rend `null` pour se laisser écrire `return disjoncteur.echec();`.
   */
  echec(): null {
    this.echecsConsecutifs += 1;

    if (this.echecsConsecutifs >= ECHECS_AVANT_OUVERTURE) {
      this.ouvertJusqua = Date.now() + DUREE_OUVERTURE_MS;
      this.logger.warn(
        `${this.nom} déclaré indisponible après ${this.echecsConsecutifs} échecs. ` +
          `Aucun appel pendant ${DUREE_OUVERTURE_MS / 1000} s.`,
      );
    }

    return null;
  }
}
