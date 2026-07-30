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
  webServer: [
    {
      command: "pnpm vite preview --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    /**
     * L'API n'est lancee que si une base est disponible. Le parcours vendeuse
     * s'appuie sur un VRAI serveur — session, OTP, journal — parce qu'une API
     * simulee ne prouverait rien de ce que le lot 4 doit tenir. Sans
     * `DATABASE_URL`, ces tests se declarent ignores plutot que rouges : c'est
     * une dependance d'environnement, pas une regression.
     *
     * Le fournisseur SMS est le factice : `SMS_PROVIDER` non pose vaut
     * « console », et c'est lui qui expose `/api/dev/dernier-code`. Il refuse de
     * se construire si `NODE_ENV=production`.
     */
    ...(process.env.DATABASE_URL
      ? [
          {
            command: "node ../api/src/server.ts",
            url: "http://127.0.0.1:8787/health",
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: {
              DATABASE_URL: process.env.DATABASE_URL,
              PORT: "8787",
              TZ: "Africa/Douala",
              BETTER_AUTH_URL: "http://127.0.0.1:8787",
              // Secret de test uniquement, jamais un secret de production : il
              // n'ouvre rien d'autre que cette base de test.
              BETTER_AUTH_SECRET:
                process.env.BETTER_AUTH_SECRET ?? "secret-de-test-e2e-32-caracteres-minimum",
              // Le navigateur voit l'origine de l'app, pas celle de l'API.
              TRUSTED_ORIGINS: "http://127.0.0.1:4173,http://localhost:4173",
            },
          },
        ]
      : []),
  ],
});
