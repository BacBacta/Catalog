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
