import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Configuration issue du guide officiel de cette version de Next.js
// (node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md).
//
// `resolve.tsconfigPaths` fait comprendre l'alias `@/*` à Vitest, comme au
// compilateur. Le guide de Next.js recommande le greffon `vite-tsconfig-paths`,
// mais Vite le fait nativement depuis sa version 8 — et le dit lui-même au
// démarrage. Une dépendance de moins.
// `jsdom` fournit un DOM : sans lui, aucun rendu React ne serait possible.
//
// ⚠️ Le guide prévient que Vitest ne sait pas tester les Server Components
// ASYNCHRONES. Nos écrans d'authentification sont des composants CLIENT — ils
// ont un état et des gestionnaires d'événements — donc le sujet ne se pose
// pas ici. Les pages serveur, elles, restent couvertes par `next build`, qui
// les prérend.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
});
