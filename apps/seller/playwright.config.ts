import { defineConfig, devices } from "@playwright/test";

/**
 * Les tests de bout en bout tournent sur un profil mobile bas de gamme bride
 * (AGENTS.md). Le design system doit tenir la ou il sera reellement lu :
 * un telephone Android d'entree de gamme, pas un portable de developpeur.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    // Profil de reference : Pixel 5, tactile, 393x851.
    ...devices["Pixel 5"],
    // En CI, `playwright install chromium` fournit le navigateur a l'endroit
    // attendu et il n'y a rien a preciser. Dans un conteneur qui embarque deja
    // un Chromium d'une autre version, poser CHROMIUM_PATH evite un second
    // telechargement — c'est le seul cas ou ce reglage sert.
    ...(process.env.CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    { name: "clair", use: { colorScheme: "light" } },
    { name: "sombre", use: { colorScheme: "dark" } },
  ],
  webServer: {
    command: "pnpm vite preview --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
