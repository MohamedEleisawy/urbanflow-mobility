import { FavoriteAddressType } from '@prisma/client';

/**
 * Adresse favorite telle qu'elle est RENDUE (bloc 7).
 *
 * Interface de sortie sans class-validator : on ne valide que ce qui ENTRE.
 * Même convention qu'`admin-user.dto.ts` (6-3) et
 * `personal-data-export.dto.ts` (5F).
 *
 * ⚠️ PAS DE `userId`. La route est `/me` : l'appelant connaît déjà à qui
 * appartiennent ces adresses, puisqu'elles sont les siennes. Le renvoyer
 * n'apprendrait rien et ferait circuler un identifiant de plus — c'est la
 * même minimisation qu'ailleurs dans le projet.
 */
export interface AddressDto {
  id: string;
  type: FavoriteAddressType;
  address: string;
  latitude: number;
  longitude: number;
  createdAt: Date;
}
