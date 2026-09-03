import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceGuidance } from "./useVoiceGuidance";

// =============================================================================
// Guidage vocal
// =============================================================================
// ⚠️ `speechSynthesis` EST SIMULÉ. jsdom ne l'implémente pas, et un test qui
// ferait réellement parler la machine serait ingérable. On observe donc ce que
// nous LUI DEMANDONS — c'est exactement ce qui doit être verrouillé.
// =============================================================================

describe("useVoiceGuidance", () => {
  let speak: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    speak = vi.fn();
    cancel = vi.fn();

    Object.defineProperty(window, "speechSynthesis", {
      value: { speak, cancel, speaking: false },
      configurable: true,
    });

    // `SpeechSynthesisUtterance` n'existe pas non plus dans jsdom.
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: class {
        lang = "";
        constructor(public text: string) {}
      },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const enonces = () =>
    speak.mock.calls.map((appel) => (appel[0] as { text: string }).text);

  // ---------------------------------------------------------------------------
  // Consentement
  // ---------------------------------------------------------------------------

  it("est ÉTEINT par défaut", () => {
    const { result } = renderHook(() => useVoiceGuidance("fr-FR"));

    // ⚠️ Une application qui se met à parler toute seule dans un métro est une
    // application qu'on coupe.
    expect(result.current.actif).toBe(false);
  });

  it("ne dit RIEN tant qu'il n'est pas activé", () => {
    const { result } = renderHook(() => useVoiceGuidance("fr-FR"));

    act(() => result.current.annoncer("marche-0", "Marchez 180 m"));

    expect(speak).not.toHaveBeenCalled();
  });

  it("parle une fois activé", () => {
    const { result } = renderHook(() => useVoiceGuidance("fr-FR"));

    act(() => result.current.basculer());
    act(() => result.current.annoncer("marche-0", "Marchez 180 m"));

    expect(enonces()).toEqual(["Marchez 180 m"]);
  });

  // ---------------------------------------------------------------------------
  // Répétition — ce qui rend le guidage supportable
  // ---------------------------------------------------------------------------

  it("NE RÉPÈTE PAS la même instruction", () => {
    const { result } = renderHook(() => useVoiceGuidance("fr-FR"));
    act(() => result.current.basculer());

    act(() => result.current.annoncer("marche-0", "Marchez 180 m"));
    act(() => result.current.annoncer("marche-0", "Marchez 180 m"));
    act(() => result.current.annoncer("marche-0", "Marchez 180 m"));

    // ⚠️ LE GPS ÉMET PLUSIEURS RELEVÉS PAR SECONDE. Sans cette mémoire, la
    // phrase serait répétée sans fin et la file d'attente de la synthèse
    // déborderait — la voix parlerait encore de la rue précédente une minute
    // plus tard.
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("parle de nouveau quand l'instruction CHANGE", () => {
    const { result } = renderHook(() => useVoiceGuidance("fr-FR"));
    act(() => result.current.basculer());

    act(() => result.current.annoncer("marche-0", "Marchez 180 m"));
    act(() => result.current.annoncer("prendre-1", "Prenez le Métro 4"));

    expect(enonces()).toEqual(["Marchez 180 m", "Prenez le Métro 4"]);
  });

  it("COUPE l'énoncé en cours avant d'en commencer un autre", () => {
    const { result } = renderHook(() => useVoiceGuidance("fr-FR"));
    act(() => result.current.basculer());

    act(() => result.current.annoncer("marche-0", "Marchez 180 m"));
    cancel.mockClear();
    act(() => result.current.annoncer("prendre-1", "Prenez le Métro 4"));

    // ⚠️ Sans cela, la nouvelle instruction attendrait la fin de la
    // précédente : à l'approche d'une correspondance, l'usager entendrait
    // « descendez à Châtelet » alors qu'il en est déjà reparti.
    expect(cancel).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Langue
  // ---------------------------------------------------------------------------

  it("énonce dans la langue demandée", () => {
    const { result } = renderHook(() => useVoiceGuidance("es-ES"));
    act(() => result.current.basculer());

    act(() => result.current.annoncer("prendre-1", "Toma el Metro 4"));

    // Une phrase espagnole lue par une voix française est inintelligible.
    expect((speak.mock.calls[0][0] as { lang: string }).lang).toBe("es-ES");
  });

  it("suit un changement de langue", () => {
    const { result, rerender } = renderHook(
      ({ langue }) => useVoiceGuidance(langue),
      { initialProps: { langue: "fr-FR" } },
    );
    act(() => result.current.basculer());

    rerender({ langue: "en-US" });
    act(() => result.current.annoncer("prendre-1", "Take Metro 4"));

    expect((speak.mock.calls[0][0] as { lang: string }).lang).toBe("en-US");
  });

  // ---------------------------------------------------------------------------
  // Extinction
  // ---------------------------------------------------------------------------

  it("se tait immédiatement quand on le coupe", () => {
    const { result } = renderHook(() => useVoiceGuidance("fr-FR"));
    act(() => result.current.basculer());
    act(() => result.current.annoncer("marche-0", "Marchez 180 m"));

    act(() => result.current.basculer());

    expect(cancel).toHaveBeenCalled();
    expect(result.current.actif).toBe(false);
  });

  it("RÉPÈTE l'instruction courante quand on le réactive", () => {
    const { result } = renderHook(() => useVoiceGuidance("fr-FR"));
    act(() => result.current.basculer());
    act(() => result.current.annoncer("marche-0", "Marchez 180 m"));

    act(() => result.current.basculer());
    act(() => result.current.basculer());
    act(() => result.current.annoncer("marche-0", "Marchez 180 m"));

    // En réactivant, l'usager doit réentendre OÙ IL EN EST — pas attendre
    // l'instruction suivante en silence.
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it("se tait au démontage du composant", () => {
    const { result, unmount } = renderHook(() => useVoiceGuidance("fr-FR"));
    act(() => result.current.basculer());
    act(() => result.current.annoncer("marche-0", "Marchez 180 m"));
    cancel.mockClear();

    unmount();

    // ⚠️ `speechSynthesis` vit sur `window`, pas sur le composant : quitter
    // l'écran sans couper laisserait la voix finir sa phrase sur une autre
    // page.
    expect(cancel).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Navigateur sans synthèse vocale
  // ---------------------------------------------------------------------------

  it("annonce son indisponibilité sans lever", () => {
    Object.defineProperty(window, "speechSynthesis", {
      value: undefined,
      configurable: true,
    });

    const { result } = renderHook(() => useVoiceGuidance("fr-FR"));

    expect(result.current.disponible).toBe(false);

    // Et parler ne casse rien : le texte reste affiché à l'écran, qui est la
    // source d'information de référence.
    act(() => result.current.basculer());
    expect(() =>
      act(() => result.current.annoncer("marche-0", "Marchez 180 m")),
    ).not.toThrow();
  });
});
