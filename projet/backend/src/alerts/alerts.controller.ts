import { Controller, Get } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AlertsResponseDto } from './dto/alert.dto';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  /**
   * Les perturbations en cours du réseau (UC02, étape 4F-2B).
   *
   * PUBLIC : aucun @UseGuards, aucun @CurrentUser. Le diagramme de cas
   * d'utilisation place « UC02 Voir les perturbations » dans le bloc
   * « Mobilité (Libre accès) », au même titre que la consultation des arrêts
   * et la recherche d'itinéraire. Un visiteur non connecté doit pouvoir
   * savoir que sa ligne est coupée — exiger un compte pour cela serait
   * absurde, et ces données ne sont personnelles à personne.
   *
   * AUCUN PARAMÈTRE, donc aucun DTO d'entrée. La liste est globale et petite ;
   * un filtre par mode ou par ligne reproduirait côté serveur un
   * `Array.filter` de trois lignes, au prix d'un DTO validé et de ses tests.
   *
   * Un paramètre inattendu — `?foo=1` — n'est pas rejeté : le
   * `forbidNonWhitelisted` global ne s'applique qu'aux DTO déclarés, et il
   * n'y en a pas ici. Le paramètre est simplement ignoré, ce qui est le
   * comportement HTTP habituel. Un test le constate plutôt que de le
   * supposer.
   *
   * TOUJOURS 200, jamais 404 : un réseau sans perturbation renvoie une liste
   * vide. « Tout fonctionne » est une réponse, pas une erreur — le même
   * raisonnement qu'un flux GTFS-RT sans entité en 4F-1B.
   */
  @Get()
  findActive(): Promise<AlertsResponseDto> {
    // Aucun argument : le service se date lui-même. Les tests, eux, lui
    // passent un instant fixe.
    return this.alertsService.findActive();
  }
}
