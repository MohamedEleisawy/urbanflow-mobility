import { afterEach, describe, expect, it, vi } from "vitest";
import { ErreurGeolocalisation, messageGeolocalisation, positionActuelle } from "./geolocalisation";

// =============================================================================
// Géolocalisation (bloc 5D-1)
// =============================================================================
// jsdom n'implémente PAS `navigator.geolocation` : il faut donc l'installer
// soi-même. C'est une chance plutôt qu'une gêne — cela permet de reproduire à
// volonté un refus de permission ou un délai dépassé, ce qu'aucun vrai
// navigateur ne laisse provoquer sur commande.
// =============================================================================

/// Installe une fausse API de géolocalisation qui répond ce qu'on lui dit.
const installer = (
  implementation: (
    succes: PositionCallback,
    echec: PositionErrorCallback,
    options?: PositionOptions,
  ) => void,
) => {
  const getCurrentPosition = vi.fn(implementation);
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
    configurable: true,
  });
  return getCurrentPosition;
};

/// Retire complètement l'API, comme sur une origine non sécurisée.
const retirer = () => {
  Object.defineProperty(navigator, "geolocation", {
    value: undefined,
    configurable: true,
  });
};

/// Le navigateur ne rend PAS de vraie instance de classe : un objet portant
/// `code` suffit, et c'est bien ce que le code sous test doit accepter.
const echecAvec = (code: number) => ({ code }) as GeolocationPositionError;

afterEach(() => {
  retirer();
  vi.restoreAllMocks();
});

describe("positionActuelle", () => {
  it("rend lat/lon et la précision, et RIEN d'autre", async () => {
    installer((succes) =>
      succes({
        coords: {
          latitude: 48.8809,
          longitude: 2.3553,
          accuracy: 12,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition),
    );

    const position = await positionActuelle();

    // Lat/lon pour le backend, `accuracyM` pour le seul halo de précision de
    // la carte (jamais transmis). La vitesse, le cap et l'altitude ne sont pas
    // retenus : une donnée de géolocalisation qu'on ne garde pas est une
    // donnée qui ne peut pas fuiter (minimisation, C8).
    expect(position).toEqual({ latitude: 48.8809, longitude: 2.3553, accuracyM: 12 });
  });

  it("rend `accuracyM: null` quand l'appareil n'annonce pas de précision", async () => {
    installer((succes) =>
      succes({
        coords: { latitude: 1, longitude: 2, accuracy: NaN },
      } as GeolocationPosition),
    );

    const position = await positionActuelle();

    // On ne dessine alors AUCUN halo plutôt qu'un cercle inventé qui
    // donnerait une fausse impression d'exactitude.
    expect(position.accuracyM).toBeNull();
  });

  it("demande une position ÉCONOME par défaut", async () => {
    const appel = installer((succes) =>
      succes({
        coords: { latitude: 1, longitude: 2 },
      } as GeolocationPosition),
    );

    await positionActuelle();

    const options = appel.mock.calls[0][2]!;
    // Pas de GPS haute précision : quelques dizaines de mètres ne changent
    // rien pour trouver un arrêt dans un rayon de 2 km, et la puce coûte
    // cher en batterie (C5).
    expect(options.enableHighAccuracy).toBe(false);
    expect(options.timeout).toBe(10_000);
    // Une position récente est réutilisée sans rallumer la localisation.
    expect(options.maximumAge).toBe(300_000);
  });

  it("laisse surcharger les options", async () => {
    const appel = installer((succes) =>
      succes({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition),
    );

    await positionActuelle({ timeout: 500 });

    expect(appel.mock.calls[0][2]!.timeout).toBe(500);
    // Les autres valeurs par défaut restent en place.
    expect(appel.mock.calls[0][2]!.enableHighAccuracy).toBe(false);
  });

  describe("échecs", () => {
    it("distingue un REFUS DE PERMISSION", async () => {
      installer((_succes, echec) => echec(echecAvec(1)));

      await expect(positionActuelle()).rejects.toMatchObject({
        raison: "permission-refusee",
      });
    });

    it("distingue un DÉLAI DÉPASSÉ", async () => {
      installer((_succes, echec) => echec(echecAvec(3)));

      await expect(positionActuelle()).rejects.toMatchObject({
        raison: "delai-depasse",
      });
    });

    it("traite tout autre code comme INDISPONIBLE", async () => {
      installer((_succes, echec) => echec(echecAvec(2)));

      await expect(positionActuelle()).rejects.toMatchObject({
        raison: "indisponible",
      });
    });

    it("ne PLANTE PAS quand l'API est absente", async () => {
      // Cas réel : rendu serveur, ou origine non sécurisée (http hors
      // localhost), où les navigateurs retirent `navigator.geolocation`.
      // Appeler `getCurrentPosition` dessus lèverait un TypeError qui
      // casserait la page entière, pas seulement la fonctionnalité.
      retirer();

      await expect(positionActuelle()).rejects.toBeInstanceOf(ErreurGeolocalisation);
      await expect(positionActuelle()).rejects.toMatchObject({
        raison: "non-supportee",
      });
    });

    it("porte un message qui dit QUOI FAIRE", async () => {
      installer((_succes, echec) => echec(echecAvec(1)));

      await expect(positionActuelle()).rejects.toThrow(/réglages de votre navigateur/i);
    });
  });
});

describe("messageGeolocalisation", () => {
  it("donne une marche à suivre différente selon la cause", () => {
    // Les confondre sous un « erreur de géolocalisation » laisserait l'usager
    // sans rien à faire.
    const refus = messageGeolocalisation("permission-refusee");
    const delai = messageGeolocalisation("delai-depasse");

    expect(refus).not.toBe(delai);
    expect(refus).toMatch(/autorisez/i);
    expect(delai).toMatch(/réessayez/i);
  });

  it("propose TOUJOURS un repli sur le choix d'un arrêt", () => {
    // La géolocalisation est un raccourci, jamais un passage obligé : le
    // formulaire reste utilisable sans elle.
    for (const raison of ["non-supportee", "permission-refusee", "delai-depasse"] as const) {
      expect(messageGeolocalisation(raison)).toMatch(/arrêt de départ/i);
    }
  });
});
