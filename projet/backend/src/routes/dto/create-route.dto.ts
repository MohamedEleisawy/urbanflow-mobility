import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsLatitude,
  IsLongitude,
  IsUUID,
  ValidateNested,
} from 'class-validator';

// Corps attendu par POST /api/routes.
//
// CE QUI A CHANGÉ À L'ÉTAPE 4E-3B, ET POURQUOI
// --------------------------------------------
// Jusqu'ici, le client fournissait lui-même `ecoScore` et `carbonEstimate`,
// documentés comme provisoires depuis l'étape 4A. C'était une FAILLE
// D'INTÉGRITÉ : n'importe qui pouvait enregistrer un trajet en voiture en
// déclarant `ecoScore: 100`, et le futur tableau de bord CO2 aurait reposé
// sur des chiffres inventés par le client.
//
// Ces deux champs ont donc disparu du contrat — et pas seulement du code qui
// les lisait. Le `ValidationPipe` global (whitelist + forbidNonWhitelisted,
// voir main.ts) rejette désormais la requête en 400 si le client les envoie
// quand même : ce n'est plus un oubli poli, c'est un refus explicite.
//
// `totalDistanceM` et `totalDurationMin` disparaissent pour la même raison :
// laisser le client les déclarer aurait rouvert la même faille sous une autre
// forme. Le serveur les calcule en sommant les liaisons du réseau.
//
// Il ne reste donc au client que ce qu'il est LÉGITIME à décider : d'où il
// part, où il va, et quelles liaisons il a retenues.

// Une liaison du réseau public retenue par l'usager.
//
// Le client ne décrit PAS le segment : il le DÉSIGNE. Le serveur ira lire le
// mode, la distance, la durée, la ligne et l'exploitant dans `NetworkLink`.
export class RouteSegmentDto {
  // Ce triplet est exactement la clé unique de NetworkLink :
  //   @@unique([lineId, fromStopId, toStopId])
  //
  // `lineId` est indispensable (étape 4E-3A) : deux lignes peuvent relier les
  // mêmes arrêts, et rien ne leur interdit de porter le même nom d'affichage.
  @IsUUID()
  lineId!: string;

  @IsUUID()
  fromStopId!: string;

  @IsUUID()
  toStopId!: string;
}

export class CreateRouteDto {
  @IsLatitude()
  originLat!: number;

  @IsLongitude()
  originLng!: number;

  @IsLatitude()
  destinationLat!: number;

  @IsLongitude()
  destinationLng!: number;

  // @ValidateNested({ each: true }) et @Type sont indispensables ENSEMBLE :
  // sans @Type, class-transformer laisserait des objets bruts dans le tableau
  // et @ValidateNested n'aurait aucune classe contre laquelle les valider —
  // les segments passeraient donc SANS être vérifiés (même piège qu'en 4D-2).
  //
  // @ArrayNotEmpty : un itinéraire sans segment n'est pas un itinéraire.
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RouteSegmentDto)
  segments!: RouteSegmentDto[];
}
