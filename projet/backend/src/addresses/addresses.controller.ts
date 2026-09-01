import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
// "import type" est requis : JwtPayload est une interface (elle n'existe pas
// à l'exécution) et apparaît dans la signature de méthodes décorées.
import type { JwtPayload } from '../auth/jwt-payload.type';
import { AddressDto } from './dto/address.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

// Adresses favorites de l'usager authentifié (bloc 7).
//
// ═══ LE GUARD EST SUR LA CLASSE ═══
//
// Les quatre routes manipulent des DONNÉES PERSONNELLES : aucune ne peut être
// publique, ni aujourd'hui ni demain. Poser `JwtAuthGuard` au niveau de la
// classe le rend impossible à oublier sur une route ajoutée plus tard —
// même raisonnement qu'`AdminController` (6-3) et `SegmentsController`.
//
// ═══ UN MODULE À PART, PLUTÔT QUE QUATRE ROUTES DANS `UsersController` ═══
//
// Le chemin `users/me/addresses` en fait une ressource IMBRIQUÉE, exactement
// comme `routes/:routeId/segments` (4E). Le précédent existe, il est suivi.
// `UsersController` porte déjà cinq routes ; lui en ajouter quatre en ferait
// le fourre-tout du projet.
//
// ⚠️ AUCUNE ROUTE N'ACCEPTE D'IDENTIFIANT D'USAGER. Le chemin dit `me`, et
// l'identité vient de `@CurrentUser().sub`. Il n'y a donc rien à vérifier
// pour empêcher A d'agir sur B : la forme même des routes l'interdit. Seul
// l'identifiant de l'ADRESSE circule, et son appartenance est contrôlée par
// `findOneForUser` côté service.
@Controller('users/me/addresses')
@UseGuards(JwtAuthGuard)
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  /**
   * Liste les adresses du compte.
   *
   *   GET /api/users/me/addresses
   *
   * Rend un tableau, éventuellement VIDE — jamais 404. « Aucune adresse
   * enregistrée » n'est pas une erreur : c'est l'état normal d'un compte
   * neuf, et le frontend l'affiche comme tel.
   *
   * Zéro à deux éléments, par construction : la contrainte d'unicité
   * `(userId, type)` sur deux types possibles borne la liste.
   *
   * Réponses : 200, ou 401 sans jeton valide — y compris pour un compte
   * supprimé, que `JwtAuthGuard` refuse depuis 5G.
   */
  @Get()
  findAll(@CurrentUser() usager: JwtPayload): Promise<AddressDto[]> {
    return this.addressesService.findAllForUser(usager.sub);
  }

  /**
   * Enregistre une adresse.
   *
   *   POST /api/users/me/addresses
   *
   * Réponses : 201, 400 (validation, champ inconnu, coordonnées hors
   * bornes), 401, 409 (une adresse de ce type existe déjà).
   */
  @Post()
  create(
    @CurrentUser() usager: JwtPayload,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressDto> {
    return this.addressesService.create(usager.sub, dto);
  }

  /**
   * Modifie une adresse.
   *
   *   PATCH /api/users/me/addresses/:id
   *
   * `PATCH` et non `PUT` : le corps décrit ce qui CHANGE, pas la ressource
   * entière. Même convention que `PATCH /users/me/preferences` (5E) — et
   * c'est le verbe que la politique CORS a dû apprendre en 7-1.
   *
   * `ParseUUIDPipe` refuse en 400 un identifiant mal formé, avant toute
   * requête : inutile d'interroger la base pour un texte qui ne peut être
   * aucun identifiant.
   *
   * Réponses : 200, 400, 401, 404 (inexistante OU appartenant à autrui —
   * volontairement indiscernables), 409.
   */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() usager: JwtPayload,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressDto> {
    return this.addressesService.update(id, usager.sub, dto);
  }

  /**
   * Supprime une adresse.
   *
   *   DELETE /api/users/me/addresses/:id
   *
   * `204 No Content`, comme `DELETE /users/me` (5G), `DELETE /routes/:id`
   * (5A-9) et `DELETE /admin/users/:id` (6-4). Quatre suppressions qui
   * répondraient différemment obligeraient le frontend à s'en souvenir.
   *
   * ⚠️ PAS D'IDEMPOTENCE ICI, à la différence de la suppression de compte :
   * supprimer deux fois rend 404 la seconde fois. La nuance est justifiée —
   * là-bas, distinguer « inexistant » de « déjà supprimé » aurait renseigné
   * un attaquant sur l'existence d'un compte ; ici, l'appelant ne peut de
   * toute façon atteindre que ses propres adresses, et savoir que le
   * raccourci n'existe plus lui est utile.
   *
   * Réponses : 204, 400 (identifiant mal formé), 401, 404.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() usager: JwtPayload,
  ): Promise<void> {
    await this.addressesService.remove(id, usager.sub);
  }
}
