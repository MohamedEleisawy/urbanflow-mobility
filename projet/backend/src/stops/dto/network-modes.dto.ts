import { ModeTransport } from '@prisma/client';

/**
 * Les modes de transport RÉELLEMENT presents dans le reseau importe.
 *
 * ⚠️ POURQUOI CE CONTRAT EXISTE.
 *
 * L'enum `ModeTransport` compte huit valeurs — WALK, BUS, TRAM, METRO, TRAIN,
 * BIKE, ESCOOTER, CAR. Aucune ne dit si le reseau CHARGE en contient. Sur
 * l'Eurometropole de Strasbourg, le flux de la CTS n'apporte que TRAM et BUS :
 * afficher un filtre « Metro » ou « Trottinette » proposerait a l'usager de
 * filtrer sur un mode qui ne rendra jamais rien.
 *
 * L'interface doit donc demander ce qui existe, plutot que de supposer.
 */
export interface NetworkModeDto {
  mode: ModeTransport;

  /// Nombre de LIGNES de ce mode. Zero signifie « absent du reseau ».
  lineCount: number;
}

export interface NetworkModesResponseDto {
  modes: NetworkModeDto[];
}
