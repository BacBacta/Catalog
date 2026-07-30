/**
 * Lighthouse CI — seuils DURS, sur profil mobile bas de gamme.
 *
 * Les seuils viennent du blueprint : performance >= 95, accessibilite = 100.
 * Ils ne sont pas indicatifs — `assertions` fait echouer la commande.
 *
 * **Le bridage compte plus que les seuils.** Mesurer sur un poste de
 * developpement donnerait 100 partout et ne prouverait rien : la boutique est
 * ouverte sur un telephone Android d'entree de gamme, sur un reseau mobile
 * sature, depuis Douala, alors que l'origine est en Europe. Le preset `mobile`
 * de Lighthouse applique un bridage de reseau et de processeur qui approche ces
 * conditions.
 *
 * Trois executions et la MEDIANE : une mesure unique de Lighthouse varie de
 * plusieurs points d'un lancement a l'autre, et un seuil dur sur une mesure
 * bruitee produit des echecs qui n'apprennent rien.
 */
const CIBLES = (process.env.LHCI_URLS ?? "").split(",").filter(Boolean);

module.exports = {
  ci: {
    collect: {
      staticDistDir: "./dist",
      // Sans cible explicite, Lighthouse parcourt toutes les pages de dist/ —
      // vingt-deux audits pour rien. On mesure la racine, une boutique et une
      // fiche article : les trois formes de page qui existent.
      ...(CIBLES.length > 0 ? { url: CIBLES } : {}),
      numberOfRuns: 3,
      /**
       * `--no-sandbox` est necessaire en conteneur, ou Chrome tourne en root.
       * Ce n'est pas un relachement de securite du produit : c'est le navigateur
       * de mesure, dans un conteneur jetable de CI.
       */
      chromeFlags: "--no-sandbox --disable-dev-shm-usage",
      settings: {
        formFactor: "mobile",
        screenEmulation: {
          mobile: true,
          width: 360,
          height: 640,
          deviceScaleFactor: 2,
          disabled: false,
        },
        throttlingMethod: "simulate",
        // Slow 4G : c'est le profil de reference d'AGENTS.md.
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
          requestLatencyMs: 150 * 3.75,
          downloadThroughputKbps: 1638.4 * 0.9,
          uploadThroughputKbps: 675,
        },
        /**
         * PAS de `skipAudits` ici.
         *
         * C'est mesure : retirer `uses-http2` — qui appartient a la categorie
         * performance — rend le score de la categorie entiere `null`, et
         * l'assertion `minScore` echoue sur « NaN » sans rien expliquer. Les
         * audits qui ne concernent pas cette page se neutralisent un par un dans
         * `assert`, pas en les retirant de la collecte.
         */
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.95 }],
        "categories:accessibility": ["error", { minScore: 1 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
        "categories:seo": ["warn", { minScore: 0.9 }],
        // Les deux metriques que le blueprint nomme.
        "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        /**
         * Neutralises, avec la raison :
         *  - `uses-http2` depend du serveur de mesure de Lighthouse CI, pas du CDN
         *    qui servira reellement la boutique ;
         *  - `errors-in-console` et `valid-source-maps` remontent les photos
         *    absentes de `dist/` — elles vivent sur le CDN media — ce qui ne dit
         *    rien de la page ;
         *  - `is-crawlable` et `canonical` supposent un site indexable : la
         *    boutique d'une vendeuse s'ouvre par un lien WhatsApp, pas par une
         *    recherche.
         */
        "uses-http2": "off",
        "errors-in-console": "off",
        "valid-source-maps": "off",
        "is-crawlable": "off",
        canonical: "off",
      },
    },
    upload: { target: "filesystem", outputDir: "./.lighthouseci" },
  },
};
