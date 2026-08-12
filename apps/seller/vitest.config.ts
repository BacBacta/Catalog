import { defineConfig } from "vitest/config";

/**
 * Les tests UNITAIRES de l'app vendeuse.
 *
 * Ils n'existaient pas — `"test": "echo no unit tests"` — et le premier test
 * ecrit ici, le 11/08/2026, n'aurait donc jamais tourne dans `pnpm test`. Un
 * test qui ne s'execute pas est pire qu'aucun test : il donne la confiance
 * sans la garantie.
 *
 * `e2e/` est EXCLU : ce sont des specs Playwright, elles ont leur propre
 * commande et leur propre profil (mobile bas de gamme bride). Lancees par
 * Vitest, elles echouent pour la mauvaise raison.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
