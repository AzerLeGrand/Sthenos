// Configuration de test composant DÉDIÉE (séparée de vite.config.js, qui charge VitePWA + Tailwind
// inutiles/gênants en test). Le plugin svelteTesting() pose la condition de résolution « browser »
// pour que Svelte charge son build client — sinon onMount ne s'exécute pas et les tests asynchrones
// (suggestions) échoueraient silencieusement (piège #1 identifié dans le plan). Il ajoute aussi le
// cleanup automatique entre tests. Aucun impact sur `vite build` (vitest n'y entre jamais).
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

export default defineConfig({
  plugins: [svelte({ hot: false }), svelteTesting()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.js"],
  },
});
