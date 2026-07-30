import { defineConfig } from "vitest/config";

/**
 * Les ilots de la boutique sont en Preact (ADR 0017). Vitest passe par esbuild,
 * qui ne lit pas la configuration JSX de l'integration Astro : sans ces deux
 * lignes, un composant `.tsx` se compile en `React.createElement` et le test
 * echoue sur un React absent — a juste titre, il n'y en a pas ici.
 *
 * Le rendu de test se fait par `preact-render-to-string` : pas de DOM simule.
 * Ce qu'on verifie de ces composants — quels chemins sont proposes, ce qui est
 * ecrit a l'ecran — est present dans le balisage rendu, et un environnement
 * navigateur simule ne le rendrait pas plus vrai.
 */
export default defineConfig({
  // Vite 8 transforme par oxc, pas par esbuild : poser `esbuild` ici n'a aucun
  // effet, et l'avertissement qui le signale est facile a manquer.
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
});
