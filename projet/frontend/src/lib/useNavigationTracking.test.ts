import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigationTracking } from "./useNavigationTracking";

// =============================================================================
// Suivi GPS continu
// =============================================================================
// ⚠️ `navigator.geolocation` EST SIMULÉ. jsdom ne l'implémente pas, et un vrai
// GPS rendrait les tests dépendants du lieu et de la météo. On remplace donc
// l'API par un couple `watchPosition` / `clearWatch` observable — ce qui teste
// exactement notre usage, et rien du navigateur.
// =============================================================================

type Succes = (position: GeolocationPosition) => void;
type Echec = (erreur: GeolocationPositionError) => void;

describe("useNavigationTracking", () => {
  let watchPosition: ReturnType<typeof vi.fn>;
  let clearWatch: ReturnType<typeof vi.fn>;
  let succes: Succes | null;
  let echec: Echec | null;

  /** Fabrique une mesure, dans la forme exacte du navigateur. */
  const mesure = (
    latitude: number,
    longitude: number,
    coords: Partial<GeolocationCoordinates> = {},
  ) =>
    ({
      coords: {
        latitude,
        longitude,
        accuracy: 12,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        ...coords,
      },
      timestamp: 1_788_000_000_000,
    }) as GeolocationPosition;

  const erreur = (code: number) =>
    ({ code, message: "" }) as GeolocationPositionError;

  beforeEach(() => {
    succes = null;
    echec = null;

    watchPosition = vi.fn((ok: Succes, ko: Echec) => {
      succes = ok;
      echec = ko;
      return 42;
    });
    clearWatch = vi.fn();

    Object.defineProperty(navigator, "geolocation", {
      value: { watchPosition, clearWatch, getCurrentPosition: vi.fn() },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Consentement
  // ---------------------------------------------------------------------------

  it("ne sollicite AUCUNE position tant qu'on ne démarre pas", () => {
    renderHook(() => useNavigationTracking());

    // ⚠️ L'ASSERTION LA PLUS IMPORTANTE DE CE FICHIER. Une invite de
    // permission qui surgit au chargement est une invite qu'on refuse par
    // réflexe — et suivre sans geste explicite serait une collecte sans
    // consentement.
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("démarre le suivi sur demande explicite", () => {
    const { result } = renderHook(() => useNavigationTracking());

    act(() => result.current.demarrer());

    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(result.current.actif).toBe(true);
  });

  it("n'ouvre pas un SECOND suivi si on redémarre", () => {
    const { result } = renderHook(() => useNavigationTracking());

    act(() => result.current.demarrer());
    act(() => result.current.demarrer());

    // Deux veilles doubleraient les relevés et la consommation.
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Positions
  // ---------------------------------------------------------------------------

  it("conserve la dernière position mesurée", () => {
    const { result } = renderHook(() => useNavigationTracking());
    act(() => result.current.demarrer());

    act(() => succes!(mesure(48.86, 2.35)));

    expect(result.current.position).toMatchObject({
      latitude: 48.86,
      longitude: 2.35,
      accuracyM: 12,
    });
  });

  it("ÉCRASE la position précédente au lieu d'accumuler une trace", () => {
    const { result } = renderHook(() => useNavigationTracking());
    act(() => result.current.demarrer());

    act(() => succes!(mesure(48.86, 2.35)));
    act(() => succes!(mesure(48.87, 2.36)));

    // ⚠️ AUCUNE TRACE CONSERVÉE. Le GPS sert à se situer sur un trajet en
    // cours, pas à constituer un historique de déplacements.
    expect(result.current.position?.latitude).toBe(48.87);
  });

  it("rend null pour un cap ou une vitesse NON MESURÉS", () => {
    const { result } = renderHook(() => useNavigationTracking());
    act(() => result.current.demarrer());

    act(() => succes!(mesure(48.86, 2.35, { heading: null, speed: null })));

    // ⚠️ `null`, JAMAIS 0 : « cap 0° » signifie plein nord. Écrire zéro
    // ferait dessiner une flèche vers le nord sur un appareil qui ne mesure
    // simplement rien.
    expect(result.current.position?.headingDeg).toBeNull();
    expect(result.current.position?.speedMs).toBeNull();
  });

  it("écarte un cap NaN comme non mesuré", () => {
    const { result } = renderHook(() => useNavigationTracking());
    act(() => result.current.demarrer());

    act(() => succes!(mesure(48.86, 2.35, { heading: NaN })));

    expect(result.current.position?.headingDeg).toBeNull();
  });

  it("transmet le cap et la vitesse quand l'appareil les mesure", () => {
    const { result } = renderHook(() => useNavigationTracking());
    act(() => result.current.demarrer());

    act(() => succes!(mesure(48.86, 2.35, { heading: 90, speed: 1.4 })));

    expect(result.current.position?.headingDeg).toBe(90);
    expect(result.current.position?.speedMs).toBe(1.4);
  });

  // ---------------------------------------------------------------------------
  // Erreurs
  // ---------------------------------------------------------------------------

  it("explique un refus de permission ET coupe le suivi", () => {
    const { result } = renderHook(() => useNavigationTracking());
    act(() => result.current.demarrer());

    act(() => echec!(erreur(1)));

    expect(result.current.raison).toBe("permission-refusee");
    expect(result.current.erreur).toMatch(/réglages/i);
    // Un refus est définitif : rien ne sert de laisser la veille ouverte.
    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(result.current.actif).toBe(false);
  });

  it("NE COUPE PAS le suivi sur une erreur passagère", () => {
    const { result } = renderHook(() => useNavigationTracking());
    act(() => result.current.demarrer());

    // Code 2 = position indisponible : un tunnel, dont on ressort.
    act(() => echec!(erreur(2)));

    expect(result.current.raison).toBe("indisponible");
    // ⚠️ Couper obligerait l'usager à tout relancer en sortant du tunnel.
    expect(clearWatch).not.toHaveBeenCalled();
    expect(result.current.actif).toBe(true);
  });

  it("distingue un délai dépassé d'une indisponibilité", () => {
    const { result } = renderHook(() => useNavigationTracking());
    act(() => result.current.demarrer());

    act(() => echec!(erreur(3)));

    // Les deux n'appellent pas la même réaction : l'un se réessaie, l'autre
    // demande de vérifier les réglages de l'appareil.
    expect(result.current.raison).toBe("delai-depasse");
  });

  it("efface l'erreur dès qu'une mesure revient", () => {
    const { result } = renderHook(() => useNavigationTracking());
    act(() => result.current.demarrer());

    act(() => echec!(erreur(2)));
    expect(result.current.erreur).not.toBeNull();

    act(() => succes!(mesure(48.86, 2.35)));

    // Le GPS est revenu : garder le message ferait croire à une panne
    // persistante.
    expect(result.current.erreur).toBeNull();
  });

  it("signale un navigateur sans géolocalisation, sans lever", () => {
    Object.defineProperty(navigator, "geolocation", {
      value: undefined,
      configurable: true,
    });

    const { result } = renderHook(() => useNavigationTracking());

    act(() => result.current.demarrer());

    // Un `TypeError` casserait la page entière plutôt que la seule
    // fonctionnalité.
    expect(result.current.raison).toBe("non-supportee");
    expect(result.current.actif).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Nettoyage — la fuite la plus coûteuse
  // ---------------------------------------------------------------------------

  it("arrête le suivi sur demande", () => {
    const { result } = renderHook(() => useNavigationTracking());
    act(() => result.current.demarrer());

    act(() => result.current.arreter());

    expect(clearWatch).toHaveBeenCalledWith(42);
    expect(result.current.actif).toBe(false);
  });

  it("ÉTEINT LA PUCE au démontage du composant", () => {
    const { result, unmount } = renderHook(() => useNavigationTracking());
    act(() => result.current.demarrer());

    unmount();

    // ⚠️ SANS CE NETTOYAGE, le suivi survivrait à la fermeture de l'écran :
    // batterie vidée, et position collectée sans que personne ne la lise.
    expect(clearWatch).toHaveBeenCalledWith(42);
  });

  it("ne rappelle pas clearWatch si rien n'était démarré", () => {
    const { unmount } = renderHook(() => useNavigationTracking());

    unmount();

    expect(clearWatch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Options passées au navigateur
  // ---------------------------------------------------------------------------

  it("demande la HAUTE précision et refuse toute position en cache", () => {
    const { result } = renderHook(() => useNavigationTracking());

    act(() => result.current.demarrer());

    const options = watchPosition.mock.calls[0][2] as PositionOptions;

    // Se situer sur un trajet demande de distinguer deux rues.
    expect(options.enableHighAccuracy).toBe(true);
    // ⚠️ `maximumAge: 0` : réutiliser une position en cache pendant une
    // navigation ferait suivre un fantôme — l'usager avance, le point reste.
    expect(options.maximumAge).toBe(0);
  });
});
