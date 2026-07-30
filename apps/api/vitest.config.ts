import { defineConfig } from "vitest/config";

/**
 * La definition de terminé du lot 7 exige **90 % de couverture sur
 * `src/domain`** — pas sur le paquet entier.
 *
 * La distinction compte : `src/adapters` parle a la base et au reseau, et une
 * cible de couverture globale pousserait a simuler ces frontieres pour faire
 * monter un chiffre. Le domaine, lui, est pur : s'il n'est pas couvert, c'est
 * qu'une regle metier n'est pas verifiee.
 *
 * `thresholds` fait ECHOUER `pnpm test:coverage` sous le seuil. Ce n'est pas un
 * rapport a lire, c'est une porte.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts"],
      /**
       * L'interface d'agregateur est en DORMANCE (ADR 0009) : elle ne contient
       * que des types, aucun code executable, et aucun chemin de code v1 ne
       * l'atteint. L'inclure ferait baisser un chiffre sans rien dire du metier.
       */
      exclude: ["src/domain/payment-provider.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
