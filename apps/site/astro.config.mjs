// @ts-check
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

/**
 * Le site de la societe — ADR 0042.
 *
 * **Aucune integration d'interface.** Ni Preact, ni React : ce site n'a pas
 * une seule interaction. Tout ce qu'il fait est de dire qui edite Catalog, ce
 * que le produit fait, et ce qu'il advient des donnees. Ajouter un cadriciel
 * ici serait payer un chargement pour rien — et un verificateur, comme une
 * vendeuse sur reseau bride, ouvre cette page une fois.
 *
 * `site` sert les URL canoniques et le plan du site. Il porte l'APEX, sans
 * `www` : c'est vers lui que la redirection de Vercel pointera.
 */
export default defineConfig({
  site: "https://horizonservices.store",
  output: "static",
  vite: { plugins: [tailwind()] },
  build: { inlineStylesheets: "always" },
  compressHTML: true,
});
