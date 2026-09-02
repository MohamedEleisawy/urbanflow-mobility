import { Controller, Get, Query } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';
import { GeocodingQueryDto } from './dto/geocoding-query.dto';
import { GeocodingResponseDto } from './dto/geocoding-result.dto';

// Recherche d'adresses (Phase 3A).
//
// ⚠️ AUCUN GUARD, et c'est délibéré. Le dossier place « Rechercher un
// itinéraire » en libre accès (§3.2.1, bloc Mobilité) : exiger un compte pour
// saisir une adresse fermerait au visiteur la porte d'entrée de
// l'application. C'est la même décision que pour `GET /api/stops` et
// `POST /api/routes/search`.
//
// Rien n'est écrit, rien n'est lu en base : il n'y a aucune donnée à protéger
// ici, seulement un relais vers un service public.
@Controller('geocoding')
export class GeocodingController {
  constructor(private readonly geocodingService: GeocodingService) {}

  /**
   * Cherche des lieux correspondant à une saisie libre.
   *
   *   GET /api/geocoding/search?q=Tour+Eiffel
   *
   * Réponses :
   *   200  `{ items: [...], attribution }` — la liste peut être VIDE, et une
   *        liste vide n'est pas une erreur : « aucun résultat » est une
   *        réponse légitime que l'interface doit savoir afficher.
   *   400  `q` absent, trop court (< 3) ou trop long (> 120)
   *   503  fournisseur injoignable, en erreur, ou réponse illisible
   *
   * ⚠️ 503 et « liste vide » sont volontairement DISTINCTS : le premier
   * invite à réessayer, le second à reformuler. Les confondre laisserait
   * l'usager corriger une saisie correcte pendant une panne.
   */
  @Get('search')
  search(@Query() query: GeocodingQueryDto): Promise<GeocodingResponseDto> {
    return this.geocodingService.search(query);
  }
}
