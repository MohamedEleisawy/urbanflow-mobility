import { Injectable } from '@nestjs/common';
import { transit_realtime } from 'gtfs-realtime-bindings';

/// Version du format que nous savons interpréter.
///
/// GTFS-Realtime en est à la 2.0 depuis 2011 ; les évolutions y sont
/// additives (nouveaux champs optionnels), jamais destructives. Un flux
/// annonçant une version majeure différente ne serait donc pas simplement
/// « plus récent » : il serait incompatible.
const VERSION_SUPPORTEE = '2.0';

/**
 * Décodage d'un flux GTFS-Realtime (étape 4F-1B).
 *
 * POURQUOI DU PROTOCOL BUFFERS, ET PAS DU JSON. GTFS-Realtime est un format
 * BINAIRE défini par Google. Ce choix n'est pas gratuit : un flux d'alertes
 * est rechargé toutes les 30 à 60 secondes par tous les clients d'un réseau,
 * et le binaire divise sa taille par trois à cinq par rapport au JSON tout en
 * s'analysant plus vite. Le prix à payer est qu'on ne peut pas le lire à
 * l'œil, et qu'il faut un décodeur.
 *
 * RESPONSABILITÉ UNIQUE : octets → FeedMessage typé. Ce service ne télécharge
 * rien (c'est GtfsRtSourceService) et ne comprend rien au métier : il ne sait
 * pas ce qu'est une alerte, une sévérité ou un arrêt. Extraire les alertes,
 * traduire `cause`/`effect`/`severity` et résoudre les `informed_entity`
 * appartiennent à l'étape 4F-1C.
 *
 * Cette séparation rend le décodage testable SANS réseau, et les pannes
 * réseau testables SANS fabriquer de protobuf valide.
 */
@Injectable()
export class GtfsRtDecoderService {
  /**
   * Décode des octets en FeedMessage.
   *
   * Lève une erreur explicite si les données ne sont pas un flux
   * GTFS-Realtime lisible — tronquées, corrompues, ou tout autre contenu
   * (une page HTML d'erreur renvoyée en 200, par exemple).
   */
  decode(octets: Uint8Array): transit_realtime.FeedMessage {
    let message: transit_realtime.FeedMessage;

    try {
      message = transit_realtime.FeedMessage.decode(octets);
    } catch (error) {
      throw new Error(
        `Flux GTFS-RT illisible : ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Le décodage seul ne suffit PAS à garantir qu'on a bien affaire à un
    // flux GTFS-RT. Protocol Buffers est tolérant par conception : il ignore
    // les champs qu'il ne connaît pas. Des octets quelconques peuvent donc
    // produire un message « décodé » mais vide de sens.
    //
    // L'en-tête est le garde-fou : un vrai flux annonce toujours sa version.
    if (!message.header?.gtfsRealtimeVersion) {
      throw new Error(
        'Flux GTFS-RT invalide : en-tête absent ou sans version. Les données ' +
          'ont été décodées, mais ne décrivent pas un flux GTFS-Realtime.',
      );
    }

    const version = message.header.gtfsRealtimeVersion;

    if (!version.startsWith(VERSION_SUPPORTEE.split('.')[0])) {
      // On refuse plutôt que d'interpréter au hasard un format inconnu —
      // même principe qu'au mode ESCOOTER sans facteur d'émission (4D-1).
      throw new Error(
        `Version GTFS-RT non supportée : "${version}" ` +
          `(version ${VERSION_SUPPORTEE} attendue)`,
      );
    }

    return message;
  }
}
