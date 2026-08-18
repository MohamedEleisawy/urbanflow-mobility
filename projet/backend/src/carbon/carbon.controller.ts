import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CarbonService } from './carbon.service';
import { CalculateCarbonDto } from './dto/calculate-carbon.dto';

// PUBLIC : aucun @UseGuards ici, volontairement.
//
// L'étape 4D est un CALCUL SANS ÉTAT : il ne lit ni n'écrit aucune donnée
// personnelle, et son résultat ne dépend que du corps de la requête. Exiger
// un compte pour savoir combien émet un trajet en bus n'aurait aucun sens.
//
// C'est l'étape 4E qui introduira le suivi personnel (CarbonRecord,
// CarbonBudget) — et celui-là sera bien authentifié, puisqu'il rattachera
// des trajets à un usager.
@Controller('carbone')
export class CarbonController {
  constructor(private readonly carbonService: CarbonService) {}

  @Post()
  // 200 et non 201 : cette requête ne crée rien, elle calcule. Même
  // raisonnement que POST /api/routes/search.
  @HttpCode(HttpStatus.OK)
  calculate(@Body() dto: CalculateCarbonDto) {
    return this.carbonService.calculate(dto);
  }
}
