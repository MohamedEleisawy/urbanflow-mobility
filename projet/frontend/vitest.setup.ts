import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// Démonte l'arbre React entre deux tests : sans cela, les rendus
// s'accumuleraient dans le même DOM et `getByLabelText` trouverait plusieurs
// champs portant le même libellé.
afterEach(() => {
  cleanup();
});

// Le stockage du jeton est un état GLOBAL du navigateur : un test qui laisse
// un jeton derrière lui ferait passer — ou échouer — le suivant sans rapport
// avec ce qu'il teste.
beforeEach(() => {
  window.localStorage.clear();
});
