import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `scripts/entetes.mjs` — la politique de securite de contenu de la boutique.
 *
 * Le defaut redoute n'est pas une politique absente : c'est une politique
 * PRESENTE ET FAUSSE. Une empreinte qui ne correspond pas au script qu'elle
 * decrit ne provoque aucune erreur de construction ; elle casse la page dans le
 * navigateur d'une acheteuse, en silence, et seulement en production. C'est
 * pour cela que ces tests recalculent les empreintes a partir du HTML plutot
 * que de verifier la presence d'un `sha256-`.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DIST = join(RACINE, "dist");
const ENTETES = join(RACINE, "scripts/entetes.mjs");

const lancer = (dist: string, env: NodeJS.ProcessEnv = {}) =>
  execFileSync("node", [ENTETES], {
    encoding: "utf8",
    env: { ...process.env, BUDGET_DIST: dist, ...env },
  });

function distDeTest(pages: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "entetes-"));
  for (const [nom, html] of Object.entries(pages)) {
    const chemin = join(dir, nom);
    mkdirSync(dirname(chemin), { recursive: true });
    writeFileSync(chemin, html, "utf8");
  }
  return dir;
}

const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

describe("generation des en-tetes", () => {
  it("pose les en-tetes communs sur une seule regle", () => {
    const dist = distDeTest({ "index.html": "<html><body>rien</body></html>" });
    lancer(dist);
    const fichier = readFileSync(join(dist, "_headers"), "utf8");

    expect(fichier).toContain("/*\n");
    expect(fichier).toContain("X-Content-Type-Options: nosniff");
    expect(fichier).toContain("X-Frame-Options: DENY");
    /**
     * **L'en-tete le plus important de la boutique.** Le jeton de suivi voyage
     * dans l'URL et autorise la contre-signature (ADR 0021) : sans lui, une
     * requete partant de `/suivi/<jeton>` emporterait le secret dans son
     * `Referer`.
     */
    expect(fichier).toContain("Referrer-Policy: no-referrer");
  });

  it("l'empreinte correspond EXACTEMENT au script en ligne", () => {
    const script = "console.log('bonjour');";
    const dist = distDeTest({ "index.html": `<html><script>${script}</script></html>` });
    lancer(dist);
    expect(readFileSync(join(dist, "_headers"), "utf8")).toContain(sha(script));
  });

  it("ignore un script externe : il est deja couvert par 'self'", () => {
    const dist = distDeTest({
      "index.html": '<html><script type="module" src="/_astro/x.js"></script></html>',
    });
    lancer(dist);
    const csp = readFileSync(join(dist, "_headers"), "utf8");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("sha256-");
  });

  /**
   * **La ligne a ne jamais franchir.** `'unsafe-inline'` sur `script-src` vide
   * la politique de tout contenu : c'est exactement ce contre quoi elle existe.
   */
  it("n'autorise jamais 'unsafe-inline' pour les scripts", () => {
    const dist = distDeTest({ "index.html": "<html><script>x()</script></html>" });
    lancer(dist);
    const csp = readFileSync(join(dist, "_headers"), "utf8");
    const script = /script-src ([^;]*)/.exec(csp)?.[1] ?? "";
    expect(script).not.toContain("unsafe-inline");
  });

  it("l'origine de l'API entre dans connect-src, sinon les ilots ne joignent rien", () => {
    const dist = distDeTest({ "index.html": "<html></html>" });
    lancer(dist, { PUBLIC_API_BASE: "https://api.catalog.cm" });
    expect(readFileSync(join(dist, "_headers"), "utf8")).toContain(
      "connect-src 'self' https://api.catalog.cm",
    );
  });

  /**
   * Le garde-fou de l'union. Trop d'empreintes distinctes veut dire qu'un ilot
   * embarque des donnees variables dans son script en ligne — et autoriser mille
   * scripts revient a n'en autoriser aucun.
   */
  it("echoue quand les empreintes distinctes se multiplient", () => {
    const pages: Record<string, string> = {};
    for (let i = 0; i < 25; i += 1) {
      pages[`p${i}/index.html`] = `<html><script>var a=${i}</script></html>`;
    }
    expect(() => lancer(distDeTest(pages))).toThrow();
  });

  it("echoue plutot que d'ecrire un fichier vide quand dist est vide", () => {
    expect(() => lancer(distDeTest({}))).toThrow();
  });
});

/**
 * Le meme controle, sur la sortie REELLE. Sans `dist/`, on se declare ignore :
 * la porte lance `build` avant `size`, mais un `vitest` isole n'a pas cette
 * garantie et ne doit pas rougir pour autant.
 */
const describeConstruit = existsSync(join(DIST, "_headers")) ? describe : describe.skip;

describeConstruit("la sortie construite", () => {
  const fichier = () => readFileSync(join(DIST, "_headers"), "utf8");

  it("couvre les pages servies par reecriture", () => {
    // `/v/<code>` et `/suivi/<jeton>` n'existent pas a la construction : seul un
    // motif `/*` les atteint. Ce sont les deux pages qui portent une cle.
    expect(fichier()).toMatch(/^\/\*$/m);
  });

  it("chaque script en ligne de la page de suivi a son empreinte", () => {
    const html = readFileSync(join(DIST, "suivi/index.html"), "utf8");
    const csp = fichier();
    for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/\ssrc\s*=/.test(m[1] as string)) continue;
      expect(csp).toContain(sha(m[2] as string));
    }
  });

  it("aucune police n'est autorisee : la pile systeme ne coute rien", () => {
    expect(fichier()).toContain("font-src 'none'");
  });
});

/**
 * `vercel.json` — l'artefact que Vercel lira, et que rien ne verifiait.
 *
 * ── Deux defauts reels, tous deux constates en integration continue ────────
 *
 * 1. **Le fichier etait ecrit au mauvais endroit.** Il atterrissait a la racine
 *    du paquet, alors que le deploiement envoie `apps/shop/dist`. Vercel lit la
 *    configuration a la racine du repertoire DEPLOYE : le fichier n'aurait
 *    jamais ete lu, et ni la politique de securite ni les reecritures ne se
 *    seraient appliquees — sans la moindre erreur.
 * 2. **Il etait versionne et compare par `git diff`.** Or son contenu depend de
 *    `PUBLIC_API_BASE` et des empreintes du HTML, donc de l'instantane du
 *    catalogue que la CI regenere depuis une base semee. Cette garde ne pouvait
 *    pas passer.
 *
 * Ces tests remplacent la comparaison impossible par une verification de
 * COHERENCE : ce que le fichier declare est-il ce que le HTML contient.
 */
describeConstruit("vercel.json", () => {
  const lire = () =>
    JSON.parse(readFileSync(join(DIST, "vercel.json"), "utf8")) as {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
      rewrites: Array<{ source: string; destination: string }>;
    };

  const cspDe = (v: ReturnType<typeof lire>) =>
    v.headers[0]?.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";

  it("est produit DANS dist, la ou le deploiement le cherche", () => {
    expect(existsSync(join(DIST, "vercel.json"))).toBe(true);
    // Et plus a la racine du paquet, ou Vercel ne l'aurait jamais lu.
    expect(existsSync(join(RACINE, "vercel.json"))).toBe(false);
  });

  /**
   * Les deux fichiers decrivent la MEME politique pour la meme sortie. S'ils
   * divergent, l'un des deux hebergeurs sert une page differente — et on ne le
   * verrait que dans un navigateur, en production.
   */
  it("porte exactement la meme politique que _headers", () => {
    const dansHeaders = /Content-Security-Policy: (.+)/.exec(
      readFileSync(join(DIST, "_headers"), "utf8"),
    )?.[1];
    expect(cspDe(lire())).toBe(dansHeaders);
  });

  it("declare les empreintes des scripts reellement emis", () => {
    const csp = cspDe(lire());
    const html = readFileSync(join(DIST, "suivi/index.html"), "utf8");
    for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/\ssrc\s*=/.test(m[1] as string)) continue;
      expect(csp).toContain(sha(m[2] as string));
    }
  });

  /**
   * Sans elles, `/v/ACDE-4679` rend un 404 et seule `/v/?c=…` fonctionne —
   * c'est-a-dire la forme dont l'ADR 0021 dit que le produit ne doit PAS
   * dependre.
   */
  it("porte les reecritures des deux pages qui transportent une cle", () => {
    const sources = lire().rewrites.map((r) => r.source);
    expect(sources.some((s) => s.startsWith("/v/"))).toBe(true);
    expect(sources.some((s) => s.startsWith("/suivi/"))).toBe(true);
  });

  it("porte la politique de referent, des deux cotes", () => {
    const entetes = lire().headers[0]?.headers ?? [];
    expect(entetes.find((h) => h.key === "Referrer-Policy")?.value).toBe("no-referrer");
  });
});
