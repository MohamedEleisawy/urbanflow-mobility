import { describe, expect, it } from "vitest";
import {
  SuiviRecadrage,
  TOLERANCE_RECADRAGE_M,
  type CentreCarte,
} from "./carte-recadrage";

// =============================================================================
// Origine d'un déplacement de carte — régression « Maximum update depth »
// =============================================================================
// Ces cas décrivent la boucle qui s'est réellement produite, et les deux
// régimes de Leaflet qu'il faut distinguer pour la rompre. Aucun DOM, aucune
// carte : ce sont des règles, elles se vérifient sur des nombres.
// =============================================================================

/// Place Kléber — le centre du territoire strasbourgeois.
const KLEBER: CentreCarte = { lat: 48.5834, lng: 7.7452 };
/// Schiltigheim, à trois kilomètres : un déplacement voulu, sans ambiguïté.
const SCHILTIGHEIM: CentreCarte = { lat: 48.6047, lng: 7.7484 };

describe("SuiviRecadrage", () => {
  it("un `moveend` SANS recadrage programmé vient de l'usager", () => {
    const suivi = new SuiviRecadrage();

    expect(suivi.estEcho(SCHILTIGHEIM)).toBe(false);
  });

  it("reconnaît un recadrage NON ANIMÉ, dont l'événement part pendant l'appel", () => {
    const suivi = new SuiviRecadrage();
    let verdict: boolean | null = null;

    // C'est exactement ce que fait Leaflet avec `animate: false` : il émet
    // `moveend` de façon SYNCHRONE, à l'intérieur de `setView`.
    suivi.programmer(KLEBER, () => {
      verdict = suivi.estEcho(KLEBER);
    });

    expect(verdict).toBe(true);
  });

  it("reconnaît un recadrage ANIMÉ, dont l'événement arrive APRÈS l'appel", () => {
    const suivi = new SuiviRecadrage();

    // `panTo({ animate: true })` du suivi GPS : l'appel rend la main tout de
    // suite, l'événement ne part qu'à la fin de l'animation.
    suivi.programmer(KLEBER, () => {});

    expect(suivi.estEcho(KLEBER)).toBe(true);
  });

  it("N'AVALE PAS un vrai glissement survenu après un recadrage", () => {
    const suivi = new SuiviRecadrage();

    suivi.programmer(KLEBER, () => {});

    // L'usager part ailleurs : il doit être entendu, sinon la carte cesserait
    // de recharger ses arrêts.
    expect(suivi.estEcho(SCHILTIGHEIM)).toBe(false);
  });

  it("OUBLIE la cible dès qu'elle a servi", () => {
    const suivi = new SuiviRecadrage();

    suivi.programmer(KLEBER, () => {});

    expect(suivi.estEcho(KLEBER)).toBe(true);
    // ⚠️ Le second passage au MÊME endroit est un geste de l'usager, pas
    // l'écho d'un recadrage déjà consommé.
    expect(suivi.estEcho(KLEBER)).toBe(false);
  });

  it("tolère l'arrondi de `fitBounds` sans avaler un déplacement réel", () => {
    const suivi = new SuiviRecadrage();

    suivi.programmer(KLEBER, () => {});

    // ~11 m au nord : l'ordre de grandeur de l'arrondi au pixel de Leaflet.
    const arrondi = { lat: KLEBER.lat + 0.0001, lng: KLEBER.lng };
    expect(suivi.estEcho(arrondi)).toBe(true);

    suivi.programmer(KLEBER, () => {});

    // ~330 m : au-delà de toute imprécision de rendu, c'est un vrai
    // déplacement.
    const ailleurs = { lat: KLEBER.lat + 0.003, lng: KLEBER.lng };
    expect(suivi.estEcho(ailleurs)).toBe(false);
  });

  it("NE SE BLOQUE PAS quand un recadrage n'émet aucun événement", () => {
    const suivi = new SuiviRecadrage();

    // Recadrer sur la position déjà courante : Leaflet n'émet alors rien du
    // tout. ⚠️ C'est le cas qui aurait désynchronisé un compteur — et fait
    // ignorer en silence tous les gestes suivants de l'usager.
    suivi.programmer(KLEBER, () => {});
    suivi.programmer(KLEBER, () => {});

    expect(suivi.estEcho(SCHILTIGHEIM)).toBe(false);
  });

  it("relâche le drapeau même si le recadrage LÈVE", () => {
    const suivi = new SuiviRecadrage();

    expect(() =>
      suivi.programmer(KLEBER, () => {
        throw new Error("Leaflet a échoué");
      }),
    ).toThrow("Leaflet a échoué");

    // ⚠️ Sans le `finally`, le drapeau resterait levé et la carte cesserait
    // définitivement de rapporter les déplacements de l'usager.
    expect(suivi.estEcho(SCHILTIGHEIM)).toBe(false);
  });

  it("expose une tolérance non nulle — `fitBounds` ne tombe jamais pile", () => {
    expect(TOLERANCE_RECADRAGE_M).toBeGreaterThan(0);
    // Et bien en dessous du seuil de rechargement du parent (50 m) : aucun
    // geste réel ne peut disparaître dans cette tolérance.
    expect(TOLERANCE_RECADRAGE_M).toBeLessThan(50);
  });
});
