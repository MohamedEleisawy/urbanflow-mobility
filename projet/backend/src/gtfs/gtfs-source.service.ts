import { createWriteStream } from 'node:fs';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Injectable, Logger } from '@nestjs/common';
import yauzl from 'yauzl';

/// Les quatre fichiers dont le pipeline a besoin. Tout le reste d'un flux
/// GTFS (agency, calendar, shapes, fares...) est ignoré : voir le carnet.
export const FICHIERS_GTFS_REQUIS = [
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
] as const;

/**
 * Un flux GTFS prêt à être lu : un dossier contenant les quatre fichiers.
 *
 * `cleanup` supprime les éventuels fichiers temporaires. Il doit TOUJOURS
 * être appelé, y compris en cas d'erreur — d'où l'usage d'un `finally` chez
 * l'appelant.
 */
export interface GtfsSourceResolue {
  folder: string;
  cleanup: () => Promise<void>;
}

/**
 * Obtention des fichiers GTFS, quelle que soit leur provenance
 * (étape 4C-4-5).
 *
 * Trois sources sont acceptées :
 *   - un dossier local déjà décompressé ;
 *   - une archive .zip locale ;
 *   - une archive .zip distante en http(s).
 *
 * DÉCISION D'ARCHITECTURE. Une archive ZIP est toujours EXTRAITE vers un
 * dossier temporaire, puis le pipeline existant (lecture, validation,
 * import) est réutilisé tel quel sur ce dossier.
 *
 * Pourquoi ne pas brancher directement le flux du ZIP sur csv-parse ?
 * Parce que l'index d'une archive ZIP se trouve à sa FIN, et qu'une lecture
 * séquentielle restitue donc les entrées dans l'ordre de l'archive — en
 * pratique l'ordre alphabétique : routes, stops, stop_times, trips. Or notre
 * lecteur exige stops → routes → trips → stop_times, car la validation des
 * références croisées a besoin des identifiants déjà connus. Un flux ne
 * pouvant pas revenir en arrière, il faudrait soit relire l'archive quatre
 * fois, soit garder stop_times entier en mémoire — ce dernier fichier
 * pesant couramment plusieurs centaines de Mo.
 *
 * L'extraction sur disque évite les deux écueils : la mémoire reste bornée
 * de bout en bout (yauzl lit l'archive par positionnement dans le fichier,
 * chaque entrée est recopiée en flux), et AUCUNE ligne du pipeline métier
 * n'a eu à changer. Le coût est de l'espace disque temporaire, libéré
 * immédiatement après l'import.
 */
@Injectable()
export class GtfsSourceService {
  private readonly logger = new Logger(GtfsSourceService.name);

  /// Au-delà, on considère que le serveur ne répondra pas.
  private readonly DELAI_TELECHARGEMENT_MS = 30_000;

  async resolve(source: string): Promise<GtfsSourceResolue> {
    if (this.estUrl(source)) {
      return this.depuisUrl(source);
    }

    if (source.toLowerCase().endsWith('.zip')) {
      return this.depuisZip(source);
    }

    return this.depuisDossier(source);
  }

  /**
   * Détecte TOUT schéma d'URL (`quelquechose://`), et pas seulement http(s).
   *
   * C'est important : une adresse comme `ftp://serveur/reseau.zip` se
   * termine par « .zip ». Si on ne reconnaissait ici que http et https,
   * elle serait prise pour un chemin de fichier local et traitée comme une
   * archive — avec un message d'erreur trompeur. En reconnaissant le
   * schéma, on l'oriente vers le contrôle de protocole, qui la refuse
   * explicitement.
   */
  private estUrl(source: string): boolean {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(source);
  }

  // ---------------------------------------------------------------------------
  // Source 1 — dossier local
  // ---------------------------------------------------------------------------
  private async depuisDossier(dossier: string): Promise<GtfsSourceResolue> {
    try {
      const infos = await stat(dossier);
      if (!infos.isDirectory()) {
        throw new Error(`"${dossier}" n'est pas un dossier`);
      }
    } catch {
      throw new Error(`Dossier GTFS introuvable : "${dossier}"`);
    }

    // On valide AVANT de commencer l'import : mieux vaut un message clair
    // tout de suite qu'une erreur obscure du parseur au milieu du travail.
    await this.validerFichiersRequis(dossier);

    // Rien à nettoyer : le dossier appartient à l'utilisateur.
    return { folder: dossier, cleanup: () => Promise.resolve() };
  }

  // ---------------------------------------------------------------------------
  // Source 2 — archive ZIP locale
  // ---------------------------------------------------------------------------
  private async depuisZip(cheminZip: string): Promise<GtfsSourceResolue> {
    try {
      await access(cheminZip);
    } catch {
      throw new Error(`Archive GTFS introuvable : "${cheminZip}"`);
    }

    const dossier = await this.creerDossierTemporaire();

    try {
      await this.extraire(cheminZip, dossier);
      await this.validerFichiersRequis(dossier);
    } catch (error) {
      // On ne laisse jamais un dossier temporaire derrière soi.
      await this.supprimer(dossier);
      throw error;
    }

    return { folder: dossier, cleanup: () => this.supprimer(dossier) };
  }

  // ---------------------------------------------------------------------------
  // Source 3 — archive ZIP distante
  // ---------------------------------------------------------------------------
  private async depuisUrl(url: string): Promise<GtfsSourceResolue> {
    // Seuls http et https sont acceptés : on refuse notamment file://, qui
    // permettrait de faire lire n'importe quel fichier de la machine.
    const adresse = new URL(url);
    if (adresse.protocol !== 'http:' && adresse.protocol !== 'https:') {
      throw new Error(
        `Protocole non autorisé : "${adresse.protocol}" (http ou https attendu)`,
      );
    }

    const dossier = await this.creerDossierTemporaire();
    const cheminZip = join(dossier, 'flux.zip');

    try {
      await this.telecharger(url, cheminZip);
      // À partir d'ici, le traitement est EXACTEMENT celui d'un ZIP local :
      // aucune logique n'est dupliquée.
      await this.extraire(cheminZip, dossier);
      await this.validerFichiersRequis(dossier);
    } catch (error) {
      await this.supprimer(dossier);
      throw error;
    }

    return { folder: dossier, cleanup: () => this.supprimer(dossier) };
  }

  private async telecharger(url: string, destination: string): Promise<void> {
    let reponse: Response;

    try {
      // fetch est natif depuis Node 18 : aucune dépendance HTTP nécessaire.
      reponse = await fetch(url, {
        signal: AbortSignal.timeout(this.DELAI_TELECHARGEMENT_MS),
      });
    } catch (error) {
      throw new Error(
        `Téléchargement impossible depuis "${url}" : ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!reponse.ok) {
      throw new Error(
        `Téléchargement refusé par le serveur : HTTP ${reponse.status} (${url})`,
      );
    }

    if (!reponse.body) {
      throw new Error(`Réponse vide reçue depuis "${url}"`);
    }

    // Le corps est recopié EN FLUX vers le disque : à aucun moment
    // l'archive entière ne se retrouve en mémoire.
    await pipeline(
      Readable.fromWeb(reponse.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(destination),
    );

    const infos = await stat(destination);
    if (infos.size === 0) {
      throw new Error(`Archive vide téléchargée depuis "${url}"`);
    }

    this.logger.log(`Archive téléchargée (${infos.size} octets) depuis ${url}`);
  }

  // ---------------------------------------------------------------------------
  // Extraction
  // ---------------------------------------------------------------------------
  /**
   * Extrait les quatre fichiers utiles de l'archive vers `destination`.
   *
   * Les entrées sont comparées sur leur NOM DE BASE : une archive peut
   * ranger ses fichiers à la racine ou dans un sous-dossier
   * (`reseau/stops.txt`), les deux fonctionnent.
   *
   * Tout le reste de l'archive est ignoré sans être décompressé.
   */
  private extraire(cheminZip: string, destination: string): Promise<void> {
    const requis = new Set<string>(FICHIERS_GTFS_REQUIS);

    return new Promise((resolve, reject) => {
      // lazyEntries : on avance entrée par entrée, sans tout parcourir d'un
      // coup. autoClose ferme le descripteur à la fin.
      yauzl.open(cheminZip, { lazyEntries: true }, (erreur, archive) => {
        if (erreur || !archive) {
          reject(
            new Error(
              `Archive GTFS illisible : "${cheminZip}" ` +
                `(${erreur?.message ?? 'format non reconnu'})`,
            ),
          );
          return;
        }

        archive.on('error', (e: Error) =>
          reject(new Error(`Archive GTFS illisible : ${e.message}`)),
        );
        archive.on('end', () => resolve());

        archive.readEntry();

        archive.on('entry', (entree: yauzl.Entry) => {
          const nom = basename(entree.fileName);

          // Dossier, ou fichier qui ne nous intéresse pas : on passe.
          if (entree.fileName.endsWith('/') || !requis.has(nom)) {
            archive.readEntry();
            return;
          }

          archive.openReadStream(entree, (erreurFlux, flux) => {
            if (erreurFlux || !flux) {
              reject(
                new Error(
                  `Extraction impossible de "${nom}" : ` +
                    `${erreurFlux?.message ?? 'flux indisponible'}`,
                ),
              );
              return;
            }

            // Chaque fichier est recopié EN FLUX : même un stop_times.txt
            // de plusieurs centaines de Mo ne passe jamais par la mémoire.
            pipeline(flux, createWriteStream(join(destination, nom)))
              .then(() => archive.readEntry())
              .catch(reject);
          });
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------
  private async validerFichiersRequis(dossier: string): Promise<void> {
    const manquants: string[] = [];

    for (const fichier of FICHIERS_GTFS_REQUIS) {
      try {
        await access(join(dossier, fichier));
      } catch {
        manquants.push(fichier);
      }
    }

    if (manquants.length > 0) {
      throw new Error(
        `Flux GTFS incomplet : fichier(s) manquant(s) — ${manquants.join(', ')}`,
      );
    }
  }

  private creerDossierTemporaire(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'urbanflow-gtfs-'));
  }

  private supprimer(dossier: string): Promise<void> {
    return rm(dossier, { recursive: true, force: true });
  }
}
