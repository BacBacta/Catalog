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
  /**
   * Les trois serveurs portent un `name` et laissent passer leur `stdout`.
   *
   * Ce n'est pas du confort. Quand un serveur ne repond pas, Playwright dit
   * « Timed out waiting 120000ms from config.webServer. » sans nommer LEQUEL des
   * trois, et `stdout` vaut « ignore » par defaut : le journal de CI ne montre
   * alors rien du tout. Une panne survenue sur le runner et non reproductible en
   * local devient indiagnosticable. Avec le nom en prefixe, le serveur qui n'a
   * jamais annonce son port se lit d'un coup d'oeil.
   */
  webServer: [
    {
      name: "vendeuse:4173",
      /**
       * `--host 127.0.0.1` est OBLIGATOIRE, comme pour la boutique plus bas.
       *
       * Sans lui, `vite preview` se lie a `localhost` — il l'annonce lui-meme :
       * « Network: use --host to expose ». Sur une machine ou `localhost` ne
       * resout qu'en IPv4, c'est equivalent. Sur un runner GitHub, dont le
       * `/etc/hosts` porte AUSSI `::1 localhost`, le serveur peut n'ecouter que
       * sur `::1` — alors que Playwright interroge `127.0.0.1`. Le serveur
       * tourne, repond, et reste injoignable : 120 s d'attente puis un delai
       * depasse qui ne nomme rien.
       *
       * Les serveurs sont lances EN SEQUENCE. Celui-ci etant le premier, son
       * blocage empeche les deux autres de seulement demarrer — ce qui rendait
       * la panne illisible.
       */
      command: "pnpm vite preview --port 4173 --strictPort --host 127.0.0.1",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      stdout: "pipe" as const,
      timeout: 120_000,
    },
    /**
     * La BOUTIQUE publique, pour les deux pages du lot 10 : `/v/<code>` et
     * `/suivi/<jeton>`.
     *
     * En mode `dev` et non `preview`, deliberement : c'est le mode qui exerce
     * les routes attrape-tout `[...code]` telles qu'elles seront servies en
     * production par la reecriture de `public/_redirects`. `preview` exigerait
     * en plus une construction prealable, que rien ne garantit ici.
     *
     * L'API n'est pas sollicitee : ces tests interceptent `/api/**`. Ce qu'ils
     * mesurent — le rendu, l'accessibilite, ce que l'ecran dit et ne dit pas —
     * n'en depend pas, et le serveur est deja couvert par ses propres tests
     * contre une vraie base.
     */
    {
      // `astro dev` directement : le script `dev` du paquet fixe deja un port,
      // et un second `--port` en argument ne le remplace pas.
      /**
       * `build` puis `preview`, et NON `dev`.
       *
       * `astro dev` passe en arriere-plan des qu'il detecte un environnement
       * d'agent : le processus rend la main aussitot, et Playwright conclut que
       * le serveur est mort. `preview` reste au premier plan et sert exactement
       * ce que le CDN servira — c'est-a-dire ce qu'on veut mesurer.
       */
      name: "boutique:4174",
      command:
        "pnpm --filter @catalog/shop build && pnpm --filter @catalog/shop exec astro preview --port 4174 --host 127.0.0.1",
      url: "http://127.0.0.1:4174/",
      reuseExistingServer: !process.env.CI,
      stdout: "pipe" as const,
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
            name: "api:8787",
            command: "node ../api/src/server.ts",
            url: "http://127.0.0.1:8787/health",
            reuseExistingServer: !process.env.CI,
            stdout: "pipe" as const,
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
              /**
               * Les plafonds PAR ADRESSE sont releves pour la suite, et
               * seulement ceux-la.
               *
               * Tous les tests sortent par `127.0.0.1` : c'est litteralement le
               * cas que l'ADR du lot 4 signale — plusieurs vendeuses derriere une
               * meme adresse publique. Au bout de quelques executions, la suite
               * s'enferme dehors et echoue sur « l'envoi du code a echoue »,
               * c'est-a-dire pour la bonne raison au mauvais endroit.
               *
               * Le plafond PAR NUMERO reste a sa valeur de production : c'est lui
               * que `parcours-vendeuse.spec.ts` verifie, et le desserrer viderait
               * ce test de son sens.
               */
              OTP_MAX_PAR_IP: "100000",
              OTP_MAX_PAR_NUMERO_PAR_JOUR: "1000",
              OTP_MAX_GLOBAL_PAR_JOUR: "1000000",
            },
          },
        ]
      : []),
  ],
});
