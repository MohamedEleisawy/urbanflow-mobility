import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AutourPage from "./page";
import { LangueProvider } from "@/components/LangueProvider";
import { AuthProvider } from "@/components/AuthProvider";
import type { AutourReponse } from "@/lib/autour-api";

// =============================================================================
// Ce que ces tests verrouillent
// =============================================================================
// Trois honnêtetés, et le fait que la position n'est jamais prise sans geste :
//
//   1. LES DISTANCES SONT À VOL D'OISEAU, et c'est écrit.
//   2. LES HORAIRES SONT THÉORIQUES, et c'est écrit.
//   3. « PAS D'HORAIRE » N'EST PAS « PLUS DE SERVICE ».
// =============================================================================

vi.mock("@/lib/auth-api", () => ({
  utilisateurCourant: vi.fn(),
  connexion: vi.fn(),
  inscription: vi.fn(),
}));

vi.mock("@/lib/autour-api", () => ({ arretsAutourDe: vi.fn() }));
vi.mock("@/lib/geolocalisation", () => ({ positionActuelle: vi.fn() }));

const { arretsAutourDe } = await import("@/lib/autour-api");
const { positionActuelle } = await import("@/lib/geolocalisation");

const REPONSE: AutourReponse = {
  departuresFreshness: "STATIC",
  stops: [
    {
      id: "s1",
      name: "Gare de Lyon",
      latitude: 48.8443,
      longitude: 2.3743,
      distanceM: 180,
      walkMin: 3,
      pmrAccessible: false,
      lines: [
        { id: "l14", name: "14", mode: "METRO" },
        { id: "l63", name: "63", mode: "BUS" },
      ],
      nextDeparture: {
        lineId: "l14",
        lineName: "14",
        mode: "METRO",
        headsign: "Olympiades",
        departureAt: "2026-09-03T08:05:00.000Z",
        waitMin: 4,
      },
    },
  ],
};

const rendre = () =>
  render(
    <AuthProvider>
      <LangueProvider>
        <AutourPage />
      </LangueProvider>
    </AuthProvider>,
  );

const chercher = async () => {
  const utilisateur = userEvent.setup();
  await utilisateur.click(
    screen.getByRole("button", { name: /utiliser ma position/i }),
  );
  return utilisateur;
};

describe("/autour", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(positionActuelle).mockReset();
    vi.mocked(arretsAutourDe).mockReset();
    vi.mocked(positionActuelle).mockResolvedValue({
      latitude: 48.8443,
      longitude: 2.3743,
    });
    vi.mocked(arretsAutourDe).mockResolvedValue(REPONSE);
  });

  it("NE DEMANDE PAS LA POSITION au chargement", () => {
    // ⚠️ Une géolocalisation automatique est le comportement qui apprend aux
    // usagers à refuser systématiquement la permission — y compris là où elle
    // servirait vraiment, comme le guidage.
    rendre();

    expect(positionActuelle).not.toHaveBeenCalled();
  });

  it("cherche les arrêts APRÈS un geste explicite", async () => {
    rendre();
    await chercher();

    await waitFor(() => expect(arretsAutourDe).toHaveBeenCalledTimes(1));
    expect(arretsAutourDe).toHaveBeenCalledWith(48.8443, 2.3743);
  });

  it("affiche distance, marche et lignes", async () => {
    rendre();
    await chercher();

    expect(await screen.findByText("Gare de Lyon")).toBeDefined();
    expect(screen.getByText(/180 m/)).toBeDefined();

    // ⚠️ On vise LES PASTILLES DE LIGNE, pas n'importe quel « 14 » de la page.
    // Un motif nu correspondrait aussi à « 14 » dans une heure ou une durée,
    // et le test passerait pour de mauvaises raisons.
    const pastilles = screen
      .getAllByRole("listitem")
      .map((element) => element.textContent ?? "");

    expect(pastilles.some((texte) => texte.includes("14"))).toBe(true);
    expect(pastilles.some((texte) => texte.includes("63"))).toBe(true);
  });

  it("DIT que les distances sont à vol d’oiseau", async () => {
    // ⚠️ Aucun routeur piéton n'est configuré. « 180 m » peut demander 400 m
    // de marche si une voie ferrée passe entre les deux points.
    rendre();
    await chercher();

    expect(await screen.findByText(/à vol d’oiseau/i)).toBeDefined();
  });

  it("DIT que les horaires sont théoriques", async () => {
    rendre();
    await chercher();

    expect(await screen.findByText(/horaires théoriques/i)).toBeDefined();
    expect(screen.getByText(/retards et suppressions ne sont pas connus/i))
      .toBeDefined();
  });

  it("DISTINGUE « pas d’horaire » de « plus de service »", async () => {
    // ⚠️ LE TEST QUI PORTE L'HONNÊTETÉ DE CET ÉCRAN. Un réseau non horodaté
    // ne prouve rien sur la circulation de ses lignes. Écrire « aucun
    // passage » serait une affirmation qu'on n'a pas les moyens de faire.
    vi.mocked(arretsAutourDe).mockResolvedValue({
      departuresFreshness: "UNKNOWN",
      stops: [{ ...REPONSE.stops[0], nextDeparture: null }],
    });

    rendre();
    await chercher();

    expect(
      await screen.findByText(/horaires de ces lignes ne sont pas importés/i),
    ).toBeDefined();
    expect(screen.queryByText(/aucun passage/i)).toBeNull();
  });

  it("annonce le prochain passage avec sa destination", async () => {
    rendre();
    await chercher();

    expect(await screen.findByText(/Olympiades/)).toBeDefined();
    expect(screen.getByText("4")).toBeDefined();
  });

  it("N’AFFICHE PAS « accessible PMR » sans donnée", async () => {
    // Sur ce point précis, une information fausse ne cause pas un
    // désagrément : elle laisse quelqu'un devant un quai qu'il ne peut pas
    // atteindre.
    rendre();
    await chercher();

    await screen.findByText("Gare de Lyon");
    expect(screen.queryByText(/accessible pmr/i)).toBeNull();
  });

  it("formule le vide comme une réponse, pas comme une panne", async () => {
    vi.mocked(arretsAutourDe).mockResolvedValue({
      departuresFreshness: "UNKNOWN",
      stops: [],
    });

    rendre();
    await chercher();

    expect(await screen.findByText(/aucun arrêt de transport/i)).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("montre une erreur quand la position est REFUSÉE", async () => {
    vi.mocked(positionActuelle).mockRejectedValue(
      new Error("La localisation a été refusée."),
    );

    rendre();
    await chercher();

    expect(await screen.findByRole("alert")).toBeDefined();
    // Aucune requête inutile : on n'appelle pas le backend sans position.
    expect(arretsAutourDe).not.toHaveBeenCalled();
  });
});
