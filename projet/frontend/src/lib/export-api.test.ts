import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "./api";
import {
  enregistrerFichier,
  nomDuFichier,
  telechargerExport,
  type ExportDonneesPersonnelles,
} from "./export-api";

// =============================================================================
// Export des données personnelles — couche API (bloc 5F-4)
// =============================================================================
// Deux responsabilités, deux séries de tests : la REQUÊTE (sans DOM) et la
// REMISE AU NAVIGATEUR (sans réseau). C'est précisément pour pouvoir les
// éprouver séparément qu'elles vivent dans deux fonctions.
// =============================================================================

const EXPORT: ExportDonneesPersonnelles = {
  version: 1,
  exportedAt: "2026-08-28T14:05:09.123Z",
  user: {
    id: "11111111-1111-1111-1111-111111111111",
    email: "usager@exemple.fr",
    role: "USER",
    createdAt: "2026-08-01T10:00:00.000Z",
    deletedAt: null,
  },
  preferences: null,
  routes: [],
  carbonRecords: [],
  carbonBudgets: [],
};

const simuler = (corps: unknown, init: { status?: number } = {}) => {
  const faux = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(corps), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", faux);
  return faux;
};

const appel = (faux: ReturnType<typeof vi.fn>) => ({
  url: String(faux.mock.calls[0][0]),
  options: faux.mock.calls[0][1] as RequestInit & { headers: Record<string, string> },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
describe("telechargerExport", () => {
  it("vise /users/me/export", async () => {
    const faux = simuler(EXPORT);

    await telechargerExport("jeton-valide");

    // `/me`, jamais `/:id` : la route n'accepte aucun identifiant, et c'est ce
    // qui rend impossible d'exporter le compte de quelqu'un d'autre.
    expect(appel(faux).url).toContain("/users/me/export");
    expect(appel(faux).url).not.toMatch(/users\/[0-9a-f-]{36}/);
  });

  it("emploie GET et transmet le jeton", async () => {
    const faux = simuler(EXPORT);

    await telechargerExport("jeton-valide");

    expect(appel(faux).options.method).toBe("GET");
    expect(appel(faux).options.headers.Authorization).toBe("Bearer jeton-valide");
  });

  it("n'envoie AUCUN corps ni paramètre", async () => {
    const faux = simuler(EXPORT);

    await telechargerExport("jeton-valide");

    // Rien à passer, donc rien à se tromper de passer.
    expect(appel(faux).options.body).toBeUndefined();
    expect(appel(faux).url).not.toContain("?");
  });

  it("rend le fichier tel que le serveur l'a composé", async () => {
    simuler(EXPORT);

    const resultat = await telechargerExport("jeton-valide");

    expect(resultat.version).toBe(1);
    expect(resultat.user.email).toBe("usager@exemple.fr");
  });

  describe("erreurs", () => {
    it("remonte un 401", async () => {
      simuler({ message: "Token invalide ou expiré" }, { status: 401 });

      const echec = await telechargerExport("jeton-perime").catch((e: unknown) => e);

      expect(echec).toBeInstanceOf(ApiError);
      expect((echec as ApiError).estNonAuthentifie).toBe(true);
    });

    it("remonte un 404", async () => {
      simuler({ message: "Utilisateur introuvable" }, { status: 404 });

      await expect(telechargerExport("jeton-valide")).rejects.toMatchObject({ status: 404 });
    });

    it("distingue une panne réseau", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

      await expect(telechargerExport("jeton-valide")).rejects.toBeInstanceOf(NetworkError);
    });
  });
});

// ---------------------------------------------------------------------------
describe("nomDuFichier", () => {
  it("date le fichier au jour près", () => {
    // Deux exports successifs ne doivent pas s'écraser dans le dossier de
    // téléchargements.
    expect(nomDuFichier("2026-08-28T14:05:09.123Z")).toBe(
      "urbanflow-donnees-personnelles-2026-08-28.json",
    );
  });

  it("garde un ordre CHRONOLOGIQUE au tri alphabétique", () => {
    const ancien = nomDuFichier("2026-01-05T00:00:00.000Z");
    const recent = nomDuFichier("2026-11-30T00:00:00.000Z");

    // C'est pourquoi la date reste au format ISO plutôt que « 30 novembre » :
    // un dossier de téléchargements se trie par nom.
    expect([recent, ancien].sort()).toEqual([ancien, recent]);
  });

  it("se replie sur un nom générique si la date est inexploitable", () => {
    // Mieux qu'un fichier nommé « …-undefined.json ».
    expect(nomDuFichier("")).toBe("urbanflow-donnees-personnelles.json");
    expect(nomDuFichier("pas-une-date")).toBe("urbanflow-donnees-personnelles.json");
  });

  it("porte toujours l'extension .json", () => {
    expect(nomDuFichier(EXPORT.exportedAt).endsWith(".json")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("enregistrerFichier", () => {
  let creerURL: ReturnType<typeof vi.fn>;
  let revoquerURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom n'implémente ni `createObjectURL` ni `revokeObjectURL`.
    creerURL = vi.fn().mockReturnValue("blob:faux-url");
    revoquerURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: creerURL, revokeObjectURL: revoquerURL });
  });

  it("déclenche un téléchargement portant le bon nom", () => {
    const clics: HTMLAnchorElement[] = [];
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clics.push(this);
    });

    enregistrerFichier(EXPORT, "mon-export.json");

    expect(clic).toHaveBeenCalledTimes(1);
    expect(clics[0].download).toBe("mon-export.json");
    expect(clics[0].href).toBe("blob:faux-url");
  });

  it("NE LAISSE RIEN derrière lui", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    enregistrerFichier(EXPORT, "mon-export.json");

    // Sans `revokeObjectURL`, l'intégralité des données personnelles
    // resterait en mémoire du navigateur jusqu'à la fermeture de l'onglet.
    expect(revoquerURL).toHaveBeenCalledWith("blob:faux-url");
    // Et aucun lien orphelin ne subsiste dans le document.
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("n'écrit RIEN dans le stockage du navigateur", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    window.localStorage.clear();

    enregistrerFichier(EXPORT, "mon-export.json");

    // Un export n'a aucune raison de survivre à son téléchargement — et
    // `localStorage` est lisible par tout script de la page.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("produit un JSON LISIBLE, pas une seule ligne", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    enregistrerFichier(EXPORT, "mon-export.json");

    const blob = creerURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    // Un export RGPD se lit : il n'est pas seulement traité par une machine.
    const texte = await blob.text();
    expect(texte).toContain("\n");
    expect(texte).toContain('  "version": 1');
  });
});
