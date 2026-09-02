import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, valeurDataTheme } from "./ThemeProvider";
import { AuthProvider } from "@/components/AuthProvider";
import type { ThemePreference, User } from "@/lib/types";

// Application du thème (refonte mobilité).
//
// Le VRAI `AuthProvider` : c'est lui la source de vérité du thème, et c'est la
// chaîne complète — préférence du compte → attribut sur `<html>` — qu'on veut
// éprouver. Seul le réseau est simulé.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/lib/auth-api", () => ({
  inscrire: vi.fn(),
  connecter: vi.fn(),
  utilisateurCourant: vi.fn(),
}));

const { utilisateurCourant } = await import("@/lib/auth-api");

const profil = (theme: ThemePreference): User => ({
  id: "11111111-1111-1111-1111-111111111111",
  email: "usager@exemple.fr",
  role: "USER",
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences: {
    id: "p1",
    preferredModes: [],
    pmrMode: false,
    co2BudgetWeekly: 5000,
    notificationsEnabled: true,
    language: "FR",
    theme,
    userId: "11111111-1111-1111-1111-111111111111",
  },
});

const monter = (theme?: ThemePreference) => {
  if (theme) {
    window.localStorage.setItem("urbanflow.token", "jeton-valide");
    vi.mocked(utilisateurCourant).mockResolvedValue(profil(theme));
  }

  return render(
    <AuthProvider>
      <ThemeProvider />
    </AuthProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe("valeurDataTheme", () => {
  it("traduit LIGHT et DARK", () => {
    expect(valeurDataTheme("LIGHT")).toBe("light");
    expect(valeurDataTheme("DARK")).toBe("dark");
  });

  it("rend `null` pour SYSTEM", () => {
    // ⚠️ Pas « light ». Écrire une valeur en dur ignorerait un système
    // configuré en sombre — ce que « Système » promet de respecter.
    expect(valeurDataTheme("SYSTEM")).toBeNull();
  });
});

describe("ThemeProvider", () => {
  it("applique le thème SOMBRE du compte", async () => {
    monter("DARK");

    // LA RÉPARATION : la préférence existait, l'écran l'enregistrait, et rien
    // ne l'appliquait.
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });

  it("applique le thème CLAIR du compte", async () => {
    monter("LIGHT");

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  });

  it("RETIRE l'attribut pour le thème système", async () => {
    document.documentElement.dataset.theme = "dark";

    monter("SYSTEM");

    // L'absence d'attribut est ce qui laisse `prefers-color-scheme` décider.
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeUndefined());
  });

  it("laisse un VISITEUR sur le thème système", async () => {
    monter();

    await waitFor(() => expect(utilisateurCourant).not.toHaveBeenCalled());
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("n'affiche RIEN dans le DOM", () => {
    const { container } = monter("DARK");

    expect(container.textContent).toBe("");
  });

  it("suit un CHANGEMENT de préférence sans rechargement", async () => {
    const { rerender } = monter("LIGHT");
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));

    // L'usager change son thème dans les préférences : `AuthProvider` met le
    // profil à jour, et l'interface doit suivre immédiatement — sans que la
    // page soit rechargée.
    vi.mocked(utilisateurCourant).mockResolvedValue(profil("DARK"));
    window.localStorage.setItem("urbanflow.token", "jeton-renouvele");
    rerender(
      <AuthProvider>
        <ThemeProvider />
      </AuthProvider>,
    );

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });
});
