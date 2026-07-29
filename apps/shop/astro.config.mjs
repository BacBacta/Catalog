// @ts-check
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Budget : 30 Ko de JS compresses sur le chemin critique, 120 Ko de poids
// total en premiere visite. Ces seuils sont appliques par size-limit et
// Lighthouse CI — un depassement fait echouer le build, ce n'est pas un voeu.
export default defineConfig({
  output: "static",
  vite: { plugins: [tailwind()] },
  build: { inlineStylesheets: "always" },
  compressHTML: "jsx",
});
