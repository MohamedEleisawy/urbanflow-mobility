import { Injectable, Logger } from '@nestjs/common';
import { capabilitiesConfig } from '../config/capabilities.config';
import { Disjoncteur } from './disjoncteur';
import {
  itineraireValhalla,
  type PointGeo,
  type RouteGeometrieDto,
} from './valhalla.client';

// =============================================================================
// Routage VÉLO réel
// =============================================================================
// ═══ POURQUOI UN SERVICE À PART DE `WalkRoutingService` ═══
//
// Le moteur est le même (Valhalla) et l'adresse peut être la même, mais ce
// sont DEUX CAPACITÉS DISTINCTES aux yeux du produit :
//
//   - `GET /api/capabilities` publie `walkRouting` et `bikeRouting`
//     séparément. Un déploiement peut configurer l'un sans l'autre ;
//   - le disjoncteur est propre à ce profil : un Valhalla qui échoue sur
//     `bicycle` répond peut-être encore sur `pedestrian`. Un compteur commun
//     couperait un profil qui marche.
//
// ⚠️ AUCUN REPLI CACHÉ SUR `WALK_ROUTING_BASE_URL`. Si `BIKE_ROUTING_*` n'est
// pas configuré, le routage vélo est simplement absent — et l'itinéraire vélo
// retombe sur une estimation à vol d'oiseau, annoncée comme telle. Emprunter
// silencieusement l'adresse du routeur piéton reviendrait à activer une
// capacité que l'exploitant n'a pas déclarée.
//
// ═══ CE SERVICE NE LÈVE JAMAIS ═══ (même contrat que le piéton)
// =============================================================================

@Injectable()
export class BikeRoutingService {
  private readonly logger = new Logger(BikeRoutingService.name);
  private readonly disjoncteur = new Disjoncteur(this.logger, 'Routeur vélo');

  disjoncteurOuvert(maintenant = Date.now()): boolean {
    return this.disjoncteur.ouvert(maintenant);
  }

  estConfigure(): boolean {
    return capabilitiesConfig().bikeRouting.status === 'CONFIGURED';
  }

  /**
   * Calcule un vrai trajet à vélo entre deux points.
   *
   * @returns le trajet rue par rue, ou `null` si aucun moteur n'est configuré
   *   ou s'il n'a rien pu rendre. JAMAIS d'exception.
   */
  async itineraire(
    depuis: PointGeo,
    vers: PointGeo,
  ): Promise<RouteGeometrieDto | null> {
    const base = process.env.BIKE_ROUTING_BASE_URL?.trim();

    if (!this.estConfigure() || !base) {
      return null;
    }

    if (this.disjoncteur.ouvert()) {
      return null;
    }

    if (
      depuis.latitude === vers.latitude &&
      depuis.longitude === vers.longitude
    ) {
      return null;
    }

    const resultat = await itineraireValhalla(
      this.logger,
      base,
      'bicycle',
      depuis,
      vers,
    );

    if ('erreur' in resultat) {
      return this.disjoncteur.echec();
    }

    if (resultat.route === null) {
      return null;
    }

    this.disjoncteur.succes();
    return resultat.route;
  }
}
