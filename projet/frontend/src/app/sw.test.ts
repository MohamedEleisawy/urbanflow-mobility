import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Service worker (bloc 5D-2)
// =============================================================================
// LE VRAI `public/sw.js` EST CHARGÉ ET EXÉCUTÉ ICI, pas une copie ni un
// résumé : le fichier est lu sur le disque et évalué dans un bac à sable qui
// lui fournit un faux `self`, un faux `caches` et un faux `fetch`.
//
// C'est le seul moyen d'éprouver ce qui compte vraiment — les REFUS. Un
// service worker qui met en cache une réponse authentifiée est une faille, et
// cette faille ne se voit pas à la lecture : elle se démontre en lui
// présentant une requête et en vérifiant qu'il n'y touche pas.
// =============================================================================

const ORIGINE = "https://urbanflow.example";

type Ecouteurs = Record<string, (evenement: Record<string, unknown>) => void>;

/// Une requête minimale, telle que le service worker la reçoit.
const requete = (
  url: string,
  { methode = "GET", entetes = {} as Record<string, string>, mode = "cors" } = {},
) => ({
  url,
  method: methode,
  mode,
  headers: { has: (nom: string) => nom in entetes },
});

/**
 * Charge et exécute `public/sw.js`, et rend ses écouteurs.
 *
 * `cachePut` est espionné : c'est LUI qui prouve ce qui est réellement stocké.
 */
function chargerServiceWorker() {
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

  const ecouteurs: Ecouteurs = {};
  const cachePut = vi.fn(() => Promise.resolve());
  const cacheAdd = vi.fn(() => Promise.resolve());
  const cacheDelete = vi.fn(() => Promise.resolve(true));
  const cacheMatch = vi.fn(() => Promise.resolve(undefined));
  const claim = vi.fn();
  const skipWaiting = vi.fn();

  const self = {
    addEventListener: (nom: string, ecouteur: Ecouteurs[string]) => {
      ecouteurs[nom] = ecouteur;
    },
    location: { origin: ORIGINE },
    skipWaiting,
    clients: { claim },
  };

  const caches = {
    open: () => Promise.resolve({ put: cachePut, add: cacheAdd, match: cacheMatch }),
    keys: () => Promise.resolve(["urbanflow-v1", "urbanflow-v0", "autre-projet"]),
    delete: cacheDelete,
    match: cacheMatch,
  };

  const reseau = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, clone: () => ({ corps: "copie" }) }),
  );

  // `new Function` plutôt qu'un import : `sw.js` s'exécute dans un contexte de
  // service worker, qui n'a ni `window` ni système de modules. Lui fournir un
  // faux `self` est le seul moyen de l'exécuter tel quel, sans le réécrire.
  new Function("self", "caches", "fetch", source)(self, caches, reseau);

  return { ecouteurs, cachePut, cacheDelete, cacheMatch, reseau, claim, skipWaiting };
}

/// Déclenche `fetch` et rend la réponse promise, ou `null` si le service
/// worker a laissé passer la requête sans y toucher.
async function interception(sw: ReturnType<typeof chargerServiceWorker>, req: unknown) {
  let promesse: unknown = null;
  sw.ecouteurs.fetch({
    request: req,
    respondWith: (valeur: unknown) => {
      promesse = valeur;
    },
  });
  if (promesse !== null) {
    await promesse;
  }
  return promesse;
}

describe("service worker", () => {
  let sw: ReturnType<typeof chargerServiceWorker>;

  beforeEach(() => {
    sw = chargerServiceWorker();
  });

  it("s'enregistre sur les trois événements attendus", () => {
    expect(Object.keys(sw.ecouteurs).sort()).toEqual(["activate", "fetch", "install"]);
  });

  // ---------------------------------------------------------------------------
  // Ce qu'il REFUSE — le cœur du sujet
  // ---------------------------------------------------------------------------
  describe("refus", () => {
    it("NE TOUCHE PAS aux requêtes de l'API", async () => {
      // L'API vit sur une autre origine (`NEXT_PUBLIC_API_URL`). Mettre en
      // cache un historique ou un profil le rendrait lisible par la personne
      // suivante sur le même appareil.
      const resultat = await interception(sw, requete("http://localhost:3001/api/routes"));

      expect(resultat).toBeNull();
      expect(sw.cachePut).not.toHaveBeenCalled();
    });

    it("NE TOUCHE PAS à une requête authentifiée", async () => {
      // Ceinture et bretelles : même si l'API partageait un jour notre
      // origine, un `Authorization` suffit à l'exclure.
      const resultat = await interception(
        sw,
        requete(`${ORIGINE}/_next/static/chunk.js`, {
          entetes: { Authorization: "Bearer jeton" },
        }),
      );

      expect(resultat).toBeNull();
      expect(sw.cachePut).not.toHaveBeenCalled();
    });

    it("NE TOUCHE PAS à un chemin /api/ de notre propre origine", async () => {
      const resultat = await interception(sw, requete(`${ORIGINE}/api/users/me`));

      expect(resultat).toBeNull();
    });

    it("NE TOUCHE PAS aux écritures", async () => {
      // Une requête qui modifie l'état ne se rejoue pas depuis un cache.
      for (const methode of ["POST", "PATCH", "DELETE", "PUT"]) {
        const resultat = await interception(
          sw,
          requete(`${ORIGINE}/_next/static/chunk.js`, { methode }),
        );
        expect(resultat, `méthode ${methode}`).toBeNull();
      }
    });

    it("NE TOUCHE PAS aux tuiles OpenStreetMap", async () => {
      // Une autre origine : ce n'est pas à nous de stocker ses données, et le
      // volume serait considérable.
      const resultat = await interception(
        sw,
        requete("https://tile.openstreetmap.org/12/2073/1409.png"),
      );

      expect(resultat).toBeNull();
    });

    it("NE MET PAS EN CACHE le HTML d'une page", async () => {
      // Une page peut contenir des données personnelles, et servir celle
      // d'une session précédente serait une fuite.
      const resultat = await interception(sw, requete(`${ORIGINE}/mon-espace`));

      expect(resultat).toBeNull();
      expect(sw.cachePut).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Ce qu'il ACCEPTE
  // ---------------------------------------------------------------------------
  describe("mise en cache", () => {
    it("met en cache les actifs de build", async () => {
      // Leur nom porte une empreinte : le contenu ne change jamais à URL
      // constante, ce qui rend le cache sûr par construction.
      await interception(sw, requete(`${ORIGINE}/_next/static/chunks/abc123.js`));

      expect(sw.reseau).toHaveBeenCalled();
      await vi.waitFor(() => expect(sw.cachePut).toHaveBeenCalled());
    });

    it("met en cache les icônes de l'application", async () => {
      await interception(sw, requete(`${ORIGINE}/icon-192.png`));

      await vi.waitFor(() => expect(sw.cachePut).toHaveBeenCalled());
    });

    it("ne conserve PAS une réponse en erreur", async () => {
      sw.reseau.mockResolvedValue({
        ok: false,
        status: 404,
        clone: () => ({}),
      } as never);

      await interception(sw, requete(`${ORIGINE}/_next/static/chunks/absent.js`));

      // Figer une 404 la servirait pour toute la durée de vie du cache.
      expect(sw.cachePut).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Navigation et repli hors ligne
  // ---------------------------------------------------------------------------
  describe("navigation", () => {
    const navigation = () => requete(`${ORIGINE}/recherche`, { mode: "navigate" });

    it("passe TOUJOURS par le réseau d'abord", async () => {
      await interception(sw, navigation());

      expect(sw.reseau).toHaveBeenCalled();
      // Rien n'est stocké : le HTML n'entre jamais dans le cache.
      expect(sw.cachePut).not.toHaveBeenCalled();
    });

    it("sert la page hors ligne quand le réseau est absent", async () => {
      sw.reseau.mockRejectedValue(new Error("hors ligne"));

      await interception(sw, navigation());

      // Contrainte C10 : « fonctionner en mobilité avec connectivité
      // variable ». Le cache sert de filet, jamais de source.
      expect(sw.cacheMatch).toHaveBeenCalledWith("/hors-ligne");
    });
  });

  // ---------------------------------------------------------------------------
  // Cycle de vie
  // ---------------------------------------------------------------------------
  describe("cycle de vie", () => {
    it("supprime les caches d'une AUTRE version à l'activation", async () => {
      let attendu: unknown;
      sw.ecouteurs.activate({ waitUntil: (valeur: unknown) => (attendu = valeur) });
      await attendu;

      // Sans ce ménage, un actif corrompu resterait servi indéfiniment.
      expect(sw.cacheDelete).toHaveBeenCalledWith("urbanflow-v0");
      expect(sw.cacheDelete).toHaveBeenCalledWith("autre-projet");
      expect(sw.cacheDelete).not.toHaveBeenCalledWith("urbanflow-v1");
    });

    it("porte un nom de cache VERSIONNÉ", () => {
      const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
      // Changer ce numéro doit suffire à tout invalider.
      expect(source).toMatch(/const CACHE = "urbanflow-v\d+"/);
    });

    it("ne PRÉCHARGE aucune page contenant des données", () => {
      const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
      const preCharges = /const PRECHARGES = \[([^\]]*)\]/.exec(source)?.[1] ?? "";

      for (const page of ["/mon-espace", "/historique", "/alertes", "/recherche"]) {
        expect(preCharges, `${page} ne doit pas être préchargée`).not.toContain(page);
      }
      expect(preCharges).toContain("/hors-ligne");
    });

    it("ne RECHARGE JAMAIS la page", () => {
      // ON EXAMINE LE CODE, PAS LES COMMENTAIRES. Le fichier EXPLIQUE en
      // toutes lettres pourquoi il ne recharge pas : chercher le motif dans
      // le texte brut trouverait cette explication et échouerait sur une
      // prose parfaitement correcte.
      const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

      // Le motif `controllerchange` → `location.reload()` est la cause
      // classique des applications qui se rechargent en boucle. Ce test est
      // un garde-fou : il doit échouer si quelqu'un l'introduit un jour.
      expect(source).not.toMatch(/location\.reload|controllerchange/);
    });
  });
});
