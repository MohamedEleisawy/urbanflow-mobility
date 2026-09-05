import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelecteurModeVoyage } from "./SelecteurModeVoyage";
import { AuthProvider } from "./AuthProvider";
import { LangueProvider } from "./LangueProvider";
import type { ModeVoyage } from "@/lib/types";

// =============================================================================
// Sélecteur de mode de déplacement
// =============================================================================
// LE VRAI DICTIONNAIRE, LE VRAI clavier. Ce qu'on éprouve, c'est le contrat :
// trois choix quand un routeur cyclable existe, deux sinon, et un libellé qui
// dit franchement qu'un changement relance la recherche.
// =============================================================================

const monter = (
  valeur: ModeVoyage = "TRANSIT",
  veloDisponible = false,
) => {
  const onChanger = vi.fn();
  render(
    <AuthProvider>
      <LangueProvider>
        <SelecteurModeVoyage
          valeur={valeur}
          onChanger={onChanger}
          veloDisponible={veloDisponible}
        />
      </LangueProvider>
    </AuthProvider>,
  );
  return { onChanger };
};

describe("SelecteurModeVoyage", () => {
  it("propose transports et à pied, toujours", () => {
    monter();

    expect(screen.getByRole("radio", { name: /transports/i })).toBeDefined();
    expect(screen.getByRole("radio", { name: /à pied/i })).toBeDefined();
  });

  it("CACHE le vélo tant qu'aucun routeur cyclable n'est configuré", () => {
    monter("TRANSIT", false);

    expect(screen.queryByRole("radio", { name: /à vélo/i })).toBeNull();
  });

  it("propose le vélo quand un routeur cyclable existe", () => {
    monter("TRANSIT", true);

    expect(screen.getByRole("radio", { name: /à vélo/i })).toBeDefined();
  });

  it("marque le mode courant comme sélectionné", () => {
    monter("WALK");

    expect(
      screen.getByRole("radio", { name: /à pied/i }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("radio", { name: /transports/i }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("remonte le mode choisi au parent", async () => {
    const { onChanger } = monter("TRANSIT");

    await userEvent.setup().click(screen.getByRole("radio", { name: /à pied/i }));

    expect(onChanger).toHaveBeenCalledWith("WALK");
  });

  it("DIT que changer de mode relance une recherche", () => {
    monter("WALK");

    expect(screen.getByText(/relance une recherche/i)).toBeDefined();
  });
});
