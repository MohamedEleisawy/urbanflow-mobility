import { Injectable, Logger } from '@nestjs/common';

/// Délai maximal accordé au serveur de l'opérateur.
///
/// Bien plus court que les 30 s de GtfsSourceService (étape 4C-4-5), et pour
/// une raison de fond : là-bas on télécharge une archive statique de plusieurs
/// centaines de mégaoctets, ici un flux temps réel de quelques centaines de
/// kilooctets, rafraîchi toutes les 30 à 60 secondes.
///
/// Un flux temps réel lent est un flux périmé : attendre 30 s pour obtenir
/// l'état du réseau d'il y a une demi-minute n'aurait aucun intérêt.
const DELAI_MS = 10_000;

/// Taille maximale acceptée pour un flux.
///
/// PROTECTION NOUVELLE, propre à cette étape. L'import statique n'en avait pas
/// besoin : il recopie l'archive EN FLUX vers le disque, la mémoire reste donc
/// bornée quelle que soit la taille. Ici, au contraire, le flux est chargé
/// ENTIÈREMENT EN MÉMOIRE — le décodage Protocol Buffers exige le message
/// complet, il n'est pas incrémental.
///
/// Sans plafond, une URL mal configurée ou un serveur hostile pourrait faire
/// gonfler la mémoire du processus sans limite. 25 Mo laissent une marge
/// confortable : les flux d'alertes des grands réseaux pèsent couramment
/// moins d'un mégaoctet.
const TAILLE_MAX_OCTETS = 25 * 1024 * 1024;

/**
 * Récupération d'un flux GTFS-Realtime distant (étape 4F-1B).
 *
 * RESPONSABILITÉ UNIQUE : rapporter des octets. Ce service ne sait pas ce
 * qu'est un FeedMessage, ne décode rien et n'écrit nulle part. Le décodage
 * appartient à GtfsRtDecoderService, et l'interprétation métier à l'étape
 * 4F-1C.
 *
 * Cette séparation n'est pas cosmétique : elle permet de tester les pannes
 * réseau sans fabriquer de protobuf valide, et de tester le décodage sans
 * réseau du tout.
 *
 * Les règles de sécurité reprennent celles de GtfsSourceService (4C-4-5) :
 * http(s) uniquement, délai maximal, réponse vérifiée. La limite de taille,
 * elle, est spécifique — voir TAILLE_MAX_OCTETS.
 */
@Injectable()
export class GtfsRtSourceService {
  private readonly logger = new Logger(GtfsRtSourceService.name);

  /**
   * Télécharge un flux et renvoie ses octets bruts.
   *
   * Lève une erreur explicite dans tous les cas d'échec : URL malformée,
   * protocole refusé, serveur injoignable, délai dépassé, réponse en erreur,
   * corps vide ou trop volumineux.
   */
  async fetchFeed(url: string): Promise<Uint8Array> {
    const adresse = this.validerUrl(url);
    const reponse = await this.telecharger(adresse);

    if (!reponse.ok) {
      throw new Error(
        `Flux GTFS-RT refusé par le serveur : HTTP ${reponse.status} (${url})`,
      );
    }

    this.verifierTailleAnnoncee(reponse, url);

    const octets = new Uint8Array(await reponse.arrayBuffer());

    // Un serveur peut mentir sur Content-Length, ou ne pas l'envoyer du
    // tout : on revérifie sur les octets réellement reçus.
    if (octets.byteLength > TAILLE_MAX_OCTETS) {
      throw new Error(
        `Flux GTFS-RT trop volumineux : ${octets.byteLength} octets reçus ` +
          `(maximum ${TAILLE_MAX_OCTETS})`,
      );
    }

    if (octets.byteLength === 0) {
      // Un FeedMessage vide serait décodable, mais un corps de longueur nulle
      // signale une erreur côté serveur, pas un réseau sans perturbation.
      throw new Error(`Flux GTFS-RT vide reçu depuis "${url}"`);
    }

    this.logger.log(`Flux GTFS-RT reçu (${octets.byteLength} octets) : ${url}`);

    return octets;
  }

  /**
   * N'accepte que http(s).
   *
   * Reprend la protection de GtfsSourceService : sans elle, une adresse
   * `file:///etc/passwd` ferait lire un fichier local, et `ftp://` ou
   * d'autres schémas ouvriraient autant de portes.
   */
  private validerUrl(url: string): URL {
    let adresse: URL;

    try {
      adresse = new URL(url);
    } catch {
      throw new Error(`URL de flux GTFS-RT invalide : "${url}"`);
    }

    if (adresse.protocol !== 'http:' && adresse.protocol !== 'https:') {
      throw new Error(
        `Protocole non autorisé : "${adresse.protocol}" (http ou https attendu)`,
      );
    }

    return adresse;
  }

  private async telecharger(adresse: URL): Promise<Response> {
    try {
      // fetch est natif depuis Node 18 : aucune dépendance HTTP nécessaire,
      // comme pour le téléchargement GTFS statique.
      //
      // AbortSignal.timeout : sans lui, une requête pendante immobiliserait
      // l'appelant indéfiniment.
      return await fetch(adresse, {
        signal: AbortSignal.timeout(DELAI_MS),
      });
    } catch (error) {
      // Connexion refusée, DNS introuvable, coupure réseau ou dépassement du
      // délai : quatre causes, une seule conséquence pour l'appelant.
      throw new Error(
        `Flux GTFS-RT injoignable (${adresse.href}) : ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Refuse un flux annoncé trop gros AVANT de le charger en mémoire.
   *
   * L'en-tête peut être absent ou mensonger : ce contrôle ne remplace pas la
   * vérification sur les octets reçus, il évite seulement de télécharger
   * inutilement ce qu'on sait déjà devoir rejeter.
   */
  private verifierTailleAnnoncee(reponse: Response, url: string): void {
    const annoncee = Number(reponse.headers.get('content-length'));

    if (Number.isFinite(annoncee) && annoncee > TAILLE_MAX_OCTETS) {
      throw new Error(
        `Flux GTFS-RT trop volumineux : ${annoncee} octets annoncés ` +
          `(maximum ${TAILLE_MAX_OCTETS}) — ${url}`,
      );
    }
  }
}
