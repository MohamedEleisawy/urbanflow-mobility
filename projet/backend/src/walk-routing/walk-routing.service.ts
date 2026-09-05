import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { capabilitiesConfig } from '../config/capabilities.config';
import { Disjoncteur } from './disjoncteur';
import {
  itineraireValhalla,
  type PointGeo,
  type RouteGeometrieDto,
} from './valhalla.client';

// Ré-exports pour ne pas casser les imports existants.
export type { PointGeo } from './valhalla.client';
export type { RouteGeometrieDto as WalkRouteDto } from './valhalla.client';

// =============================================================================
// Routage PIÉTON réel
// =============================================================================
// ═══ LE MENSONGE QUE CE SERVICE SUPPRIME ═══
//
// La marche était tracée par une DROITE entre deux points. Sur une carte,
// cette droite traverse les immeubles, les jardins et les voies ferrées — et
// sa longueur est systématiquement inférieure au chemin réel. Mesuré : 240 m à
// vol d'oiseau contre 327 m par les rues, soit 36 % d'écart.
//
// ═══ CE QUI EST CACHÉ DERRIÈRE CETTE FRONTIÈRE ═══
//
// Le frontend ne connaît QUE `walkAccess` / `walkEgress` et leur `source`. Il
// ignore quel moteur les a produits et n'appelle jamais un fournisseur
// extérieur lui-même : changer de moteur ne touche pas une ligne d'interface.
//
// ═══ CE SERVICE NE LÈVE JAMAIS ═══
//
// ⚠️ `null` EST UNE RÉPONSE NORMALE : moteur non configuré, en panne, ou sans
// chemin. L'appelant retombe sur l'estimation à vol d'oiseau, marquée
// `ESTIMATE` — et l'interface le DIT. Une recherche d'itinéraire ne doit
// jamais échouer parce qu'un routeur piéton est en panne.
// =============================================================================

@Injectable()
export class WalkRoutingService implements OnModuleInit {
  private readonly logger = new Logger(WalkRoutingService.name);
  private readonly disjoncteur = new Disjoncteur(this.logger, 'Routeur piéton');

  /** Dit au démarrage si le routage piéton rue par rue est actif (voir
   * `BikeRoutingService.onModuleInit` pour le raisonnement). */
  onModuleInit(): void {
    const capacite = capabilitiesConfig().walkRouting;
    if (capacite.status === 'CONFIGURED') {
      this.logger.log(`Routage piéton ACTIF (${capacite.provider}).`);
    } else {
      this.logger.warn(
        'Routage piéton NON CONFIGURÉ : les portions à pied seront des ' +
          'estimations à vol d’oiseau. Renseignez WALK_ROUTING_PROVIDER et ' +
          'WALK_ROUTING_BASE_URL.',
      );
    }
  }

  /** Voir `Disjoncteur.ouvert`. Public pour être diagnosticable. */
  disjoncteurOuvert(maintenant = Date.now()): boolean {
    return this.disjoncteur.ouvert(maintenant);
  }

  /**
   * Le moteur est-il configuré ?
   *
   * Lu à CHAQUE APPEL et non figé au démarrage : `GET /api/capabilities` doit
   * refléter un changement d'environnement sans redémarrage, et les tests
   * doivent pouvoir basculer d'un cas à l'autre.
   */
  estConfigure(): boolean {
    return capabilitiesConfig().walkRouting.status === 'CONFIGURED';
  }

  /**
   * Calcule un vrai trajet à pied entre deux points.
   *
   * @returns le trajet rue par rue, ou `null` si aucun moteur n'est configuré
   *   ou s'il n'a rien pu rendre. JAMAIS d'exception.
   */
  async itineraire(
    depuis: PointGeo,
    vers: PointGeo,
  ): Promise<RouteGeometrieDto | null> {
    const base = process.env.WALK_ROUTING_BASE_URL?.trim();

    if (!this.estConfigure() || !base) {
      return null;
    }

    // ⚠️ AUCUN APPEL RÉSEAU QUAND LE MOTEUR EST DÉCLARÉ EN PANNE. Rendre la
    // main immédiatement plutôt que d'attendre quatre secondes pour un échec
    // prévisible.
    if (this.disjoncteur.ouvert()) {
      return null;
    }

    // ⚠️ DEUX POINTS CONFONDUS N'ONT PAS D'ITINÉRAIRE. Le moteur répondrait
    // par une erreur ; on s'épargne l'aller-retour.
    if (
      depuis.latitude === vers.latitude &&
      depuis.longitude === vers.longitude
    ) {
      return null;
    }

    const resultat = await itineraireValhalla(
      this.logger,
      base,
      'pedestrian',
      depuis,
      vers,
    );

    if ('erreur' in resultat) {
      return this.disjoncteur.echec();
    }

    // ⚠️ UNE ABSENCE DE CHEMIN N'EST PAS UNE PANNE : on ne la compte pas
    // contre le disjoncteur, mais elle n'est pas non plus un succès à
    // célébrer. On rend `null`, l'appelant estimera.
    if (resultat.route === null) {
      return null;
    }

    this.disjoncteur.succes();
    return resultat.route;
  }
}
