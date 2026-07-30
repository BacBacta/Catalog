// @ts-check
import preact from "@astrojs/preact";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

/**
 * Budget : 30 Ko de JS compresses sur le chemin critique, 120 Ko de poids total
 * en premiere visite. `scripts/budget.mjs` fait foi et fait echouer la CI — ce
 * n'est pas un voeu.
 *
 * **Preact et non React.** React fait environ 45 Ko compresses, soit une fois et
 * demie le budget entier, pour un compteur de quantite et un selecteur de
 * variante. Preact en fait moins de cinq. Voir ADR 0017.
 */
export default defineConfig({
  output: "static",
  integrations: [preact()],
  vite: { plugins: [tailwind()] },
  // Les feuilles de style partent en ligne : sur un reseau a forte latence, une
  // requete evitee vaut mieux qu'un cache partage entre deux pages.
  build: { inlineStylesheets: "always" },
  compressHTML: true,
});
