// =============================================================================
// Position de l'usager (bloc 5D-1)
// =============================================================================
// Le sujet exige un « planificateur d'itinéraires multimodal avec
// géolocalisation en temps réel » (F2). Jusqu'ici, le départ ne pouvait être
// qu'un arrêt choisi dans une liste.
//
// ═══ POURQUOI AUCUN CONTRAT BACKEND N'EST NÉCESSAIRE ═══
//
// `POST /api/routes/search` attend des COORDONNÉES BRUTES
// (`fromLat`/`fromLon`), pas des identifiants d'arrêt, et cherche lui-même
// l'arrêt le plus proche dans un rayon de 2 km. Une position GPS s'y branche
// donc directement : c'est exactement la forme que le contrat attend déjà.
//
// Rien n'est inventé, rien n'est contourné.
//
// ═══ CE QUE CE MODULE NE FAIT PAS ═══
//
// Il ne SUIT pas la position (`watchPosition`) : une position est demandée
// quand l'usager la demande, et jamais autrement. Suivre en continu
// consommerait la batterie et le GPS pour un formulaire qu'on remplit une
// fois — l'inverse de l'éco-conception attendue (C5) — et collecterait une
// donnée de géolocalisation sans nécessité, ce que le RGPD proscrit (C8).
// =============================================================================

/** Une position, dans la forme exacte qu'attend `rechercherItineraires`. */
export interface Coordonnees {
  latitude: number;
  longitude: number;
}

/**
 * Pourquoi la position n'a pas pu être obtenue.
 *
 * Ces cas ne se valent PAS du point de vue de l'usager : un refus de
 * permission se répare dans les réglages du navigateur, un délai dépassé se
 * réessaie. Les confondre sous un « erreur de géolocalisation » laisserait
 * l'usager sans rien à faire.
 */
export type RaisonEchec = "non-supportee" | "permission-refusee" | "indisponible" | "delai-depasse";

export class ErreurGeolocalisation extends Error {
  constructor(
    readonly raison: RaisonEchec,
    message: string,
  ) {
    super(message);
    this.name = "ErreurGeolocalisation";
  }
}

/// Messages destinés à l'usager, un par cause, avec la marche à suivre.
const MESSAGES: Record<RaisonEchec, string> = {
  "non-supportee":
    "Votre navigateur ne permet pas la géolocalisation. Choisissez un arrêt de départ.",
  "permission-refusee":
    "Vous avez refusé l'accès à votre position. Autorisez-la dans les réglages de votre navigateur, ou choisissez un arrêt de départ.",
  indisponible:
    "Votre position n'a pas pu être déterminée. Vérifiez que la localisation est activée sur votre appareil.",
  "delai-depasse":
    "La localisation a pris trop de temps. Réessayez, ou choisissez un arrêt de départ.",
};

export function messageGeolocalisation(raison: RaisonEchec): string {
  return MESSAGES[raison];
}

/**
 * Demande UNE position à l'appareil.
 *
 * ⚠️ `navigator.geolocation` N'EXISTE PAS PARTOUT : il est absent du rendu
 * serveur, et les navigateurs le retirent sur une origine non sécurisée
 * (http hors localhost). Le tester avant de l'appeler évite un
 * `TypeError` qui casserait la page entière plutôt que la seule
 * fonctionnalité.
 *
 * @param options délai et fraîcheur. Les valeurs par défaut privilégient une
 *                réponse rapide sur une précision maximale : pour trouver
 *                l'arrêt le plus proche dans un rayon de 2 km, quelques
 *                dizaines de mètres d'écart ne changent rien, alors qu'un GPS
 *                sollicité à pleine précision vide la batterie.
 */
export function positionActuelle(options: PositionOptions = {}): Promise<Coordonnees> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(new ErreurGeolocalisation("non-supportee", MESSAGES["non-supportee"]));
  }

  return new Promise((resoudre, rejeter) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resoudre({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (echec) => rejeter(new ErreurGeolocalisation(raisonDe(echec), MESSAGES[raisonDe(echec)])),
      {
        // `false` : la position approchée du réseau suffit et coûte
        // infiniment moins cher que le GPS (objectif Green IT, C5).
        enableHighAccuracy: false,
        timeout: 10_000,
        // Une position de moins de cinq minutes est réutilisée telle quelle,
        // sans rallumer la puce de localisation.
        maximumAge: 300_000,
        ...options,
      },
    );
  });
}

/**
 * Traduit le code d'erreur du navigateur.
 *
 * Les constantes (`PERMISSION_DENIED` = 1…) sont comparées par leur VALEUR
 * NUMÉRIQUE et non via `GeolocationPositionError.PERMISSION_DENIED` : cette
 * classe n'existe pas dans tous les environnements, et y accéder lèverait une
 * exception là où l'on est justement en train d'en traiter une.
 */
function raisonDe(echec: GeolocationPositionError): RaisonEchec {
  switch (echec.code) {
    case 1:
      return "permission-refusee";
    case 3:
      return "delai-depasse";
    default:
      return "indisponible";
  }
}
