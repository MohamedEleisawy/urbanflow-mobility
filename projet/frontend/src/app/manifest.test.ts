import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

// =============================================================================
// Manifeste et installabilité (bloc 5C-4)
// =============================================================================
// CE QUI EST TESTABLE ICI, ET CE QUI NE L'EST PAS.
//
// Une installation réelle demande un vrai navigateur, une origine HTTPS et une
// interaction système : rien de tout cela n'existe sous jsdom, et la simuler
// ne prouverait rien. Ce qui se vérifie automatiquement, en revanche, ce sont
// les CONDITIONS de l'installabilité — les champs exigés par la spécification,
// et l'existence réelle des icônes déclarées.
//
// Le dernier bloc garde une promesse de sécurité sur le service worker ajouté
// au bloc 5D-2 : un seul enregistrement, et jamais l'API en cache.
// =============================================================================

const RACINE = process.cwd();
const PUBLIC = join(RACINE, "public");

describe("manifeste", () => {
  const m = manifest();

  it("porte un nom complet ET un nom court", () => {
    expect(m.name).toBe("UrbanFlow Mobility");
    // `short_name` s'affiche sous l'icône d'un écran d'accueil : au-delà d'une
    // douzaine de caractères, le système le tronque.
    expect(m.short_name).toBe("UrbanFlow");
    expect(m.short_name!.length).toBeLessThanOrEqual(12);
  });

  it("décrit l'application", () => {
    expect(m.description).toMatch(/trajets/i);
  });

  it("démarre sur une page consultable SANS compte", () => {
    // Ouvrir l'application sur un écran protégé renverrait l'usager vers
    // /connexion dès le lancement.
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
  });

  it("s'affiche en autonome", () => {
    // `standalone` masque la barre d'adresse ; `fullscreen` masquerait aussi
    // l'heure et la batterie, ce qui n'a pas de sens en marchant.
    expect(m.display).toBe("standalone");
  });

  it("reprend les couleurs de l'identité visuelle", () => {
    // Les mêmes qu'en tête de `globals.css` (§2.8.2 du dossier).
    expect(m.background_color).toBe("#f5f5f5");
    expect(m.theme_color).toBe("#1e3a5f");
  });

  it("est annoncé en français", () => {
    expect(m.lang).toBe("fr");
  });

  describe("icônes", () => {
    const icones = manifest().icons ?? [];

    it("déclare les deux tailles attendues pour l'installation", () => {
      const tailles = icones.map((icone) => icone.sizes);
      expect(tailles).toContain("192x192");
      expect(tailles).toContain("512x512");
    });

    it("prévoit une variante « maskable »", () => {
      // Android découpe l'icône selon la forme du thème : sans variante
      // prévue pour cela, le tracé se ferait rogner sur les bords.
      expect(icones.some((icone) => icone.purpose === "maskable")).toBe(true);
    });

    it("ne déclare AUCUN fichier qui n'existe pas", () => {
      // Une icône déclarée mais absente fait échouer l'installation en
      // silence : le navigateur ne propose simplement pas le bouton.
      for (const icone of icones) {
        const chemin = join(PUBLIC, String(icone.src).replace(/^\//, ""));
        expect(existsSync(chemin), `icône manquante : ${icone.src}`).toBe(true);
        expect(statSync(chemin).size).toBeGreaterThan(0);
      }
    });

    it("sert de vraies images PNG", () => {
      // Un fichier vide ou mal encodé passerait le test d'existence. On lit
      // la signature PNG (‰PNG) plutôt que de faire confiance à l'extension.
      for (const icone of icones) {
        const octets = readFileSync(join(PUBLIC, String(icone.src).replace(/^\//, "")));
        expect(octets.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      }
    });
  });
});

describe("service worker", () => {
  // ═══ CE BLOC A CHANGÉ DE SENS AU BLOC 5D-2 ═══
  //
  // Au bloc 5C-4, il vérifiait qu'AUCUN service worker n'existait : l'analyse
  // d'alors était qu'il n'était pas nécessaire à l'installabilité, ce qui
  // reste vrai. Mais la contrainte C1 du sujet le nomme explicitement
  // (« manifest, service worker, installable »), et cette exigence-là prime.
  //
  // Le garde-fou ne disparaît pas pour autant : il garantit désormais la
  // SÛRETÉ du service worker plutôt que son absence. Ses assertions détaillées
  // vivent dans `src/app/sw.test.ts`, qui charge et exécute le vrai fichier.

  it("existe et est servi à la racine", () => {
    // Le périmètre d'un service worker est limité au dossier qui le sert :
    // placé ailleurs que dans `public/`, il ne contrôlerait qu'une partie du
    // site.
    expect(existsSync(join(PUBLIC, "sw.js"))).toBe(true);
  });

  it("n'est enregistré QU'À UN SEUL endroit", () => {
    /// Parcourt `src/` récursivement.
    const fichiers = (dossier: string): string[] =>
      readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
        const chemin = join(dossier, entree.name);
        return entree.isDirectory() ? fichiers(chemin) : [chemin];
      });

    const enregistrements = fichiers(join(RACINE, "src")).filter(
      (chemin) =>
        !chemin.endsWith(".test.ts") &&
        !chemin.endsWith(".test.tsx") &&
        /serviceWorker\.register/.test(readFileSync(chemin, "utf8")),
    );

    // Deux enregistrements concurrents installeraient deux service workers
    // sur le même périmètre, qui se remplaceraient l'un l'autre sans fin.
    expect(enregistrements).toHaveLength(1);
    expect(enregistrements[0]).toMatch(/ServiceWorker\.tsx$/);
  });

  it("ne met JAMAIS l'API en cache", () => {
    // La garantie la plus importante du bloc, redite ici pour qu'elle soit
    // visible depuis les tests du manifeste : une réponse authentifiée mise
    // en cache serait lisible par la personne suivante sur le même appareil.
    const source = readFileSync(join(PUBLIC, "sw.js"), "utf8");

    expect(source).toContain("Authorization");
    expect(source).toContain("/api/");
  });
});
