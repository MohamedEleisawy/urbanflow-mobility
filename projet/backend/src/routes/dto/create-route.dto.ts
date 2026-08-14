import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  Max,
  Min,
} from 'class-validator';

// Corps attendu par POST /api/routes.
//
// À cette étape, l'application n'effectue pas encore de vrai calcul
// d'itinéraire (hors périmètre) : le client fournit donc lui-même les
// valeurs déjà calculées. L'endpoint sert à ENREGISTRER un itinéraire dans
// l'historique de l'usager, pas à le calculer. Quand le moteur de calcul
// sera développé, ces quatre valeurs seront produites par le serveur.
//
// Remarque : userId n'apparaît PAS ici, et c'est volontaire. Il est déduit
// du JWT (voir RoutesController) ; accepter un userId envoyé par le client
// permettrait à n'importe qui d'écrire dans l'historique d'un autre usager.
export class CreateRouteDto {
  @IsLatitude()
  originLat!: number;

  @IsLongitude()
  originLng!: number;

  @IsLatitude()
  destinationLat!: number;

  @IsLongitude()
  destinationLng!: number;

  // Une durée et une distance sont des entiers positifs.
  @IsInt()
  @Min(0)
  totalDurationMin!: number;

  @IsInt()
  @Min(0)
  totalDistanceM!: number;

  // EcoScore : 0 = voiture individuelle, 100 = mobilité douce
  // (échelle définie dans le diagramme de classes).
  @IsNumber()
  @Min(0)
  @Max(100)
  ecoScore!: number;

  // Émissions estimées en grammes de CO2 : jamais négatif.
  @IsNumber()
  @Min(0)
  carbonEstimate!: number;
}
