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
// les TROIS choix sont toujours proposés — sans routeur cyclable, le backend
// dégrade en estimation honnête, il ne bloque pas — et un libellé dit
// franchement qu'un changement relance la recherche.
// =============================================================================

const monter = (valeur: ModeVoyage = "TRANSIT") => {
  const onChanger = vi.fn();
  render(
    <AuthProvider>
      <LangueProvider>
        <SelecteurModeVoyage valeur={valeur} onChanger={onChanger} />
      </LangueProvider>
    </AuthProvider>,
  );
  return { onChanger };
};

describe("SelecteurModeVoyage", () => {
  it("propose transports, à pied ET à vélo, toujours", () => {
    monter();

    expect(screen.getByRole("radio", { name: /transports/i })).toBeDefined();
    expect(screen.getByRole("radio", { name: /à pied/i })).toBeDefined();
    // ⚠️ Le vélo n'est plus conditionné à un routeur configuré : sans lui, le
    // résultat est une estimation annoncée comme telle, jamais un blocage.
    expect(screen.getByRole("radio", { name: /à vélo/i })).toBeDefined();
  });

  it("bascule sur le vélo comme sur la marche", async () => {
    const { onChanger } = monter("TRANSIT");

    await userEvent.setup().click(screen.getByRole("radio", { name: /à vélo/i }));

    expect(onChanger).toHaveBeenCalledWith("BIKE");
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
