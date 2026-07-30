import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Ce que produit reellement la construction, et le budget qui la garde.
 *
 * Deux criteres de la definition de terminé du lot 6 se jouent ici :
 *
 * 1. **un depassement delibere fait echouer la porte.** Le blueprint demandait de
 *    le prouver par une pull request de test ; on le prouve par un test, ce qui
 *    est plus fort : c'est verifie a chaque execution, et non une fois. Le script
 *    de budget est lance sur une sortie fabriquee qui depasse expres, et on
 *    verifie qu'il sort en erreur ;
 * 2. **aucune police telechargee, dimensions explicites sur toutes les images.**
 *    Ce sont des proprietes du HTML emis : elles ne se voient ni dans les sources
 *    ni dans un test unitaire de composant.
 *
 * Sans `dist/`, les controles de sortie se declarent ignores — la porte de
 * verification lance `build` avant `size`, mais un `vitest` isole n'a pas cette
 * garantie et ne doit pas rougir pour autant.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DIST = join(RACINE, "dist");
const BUDGET = join(RACINE, "scripts/budget.mjs");

const construit = existsSync(DIST);
const describeConstruit = construit ? describe : describe.skip;

function fichiers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fichiers(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Lance le budget sur un repertoire donne. Rend le code de sortie et la sortie. */
function lancerBudget(dist: string, env: Record<string, string> = {}) {
  try {
    const out = execFileSync(process.execPath, [BUDGET], {
      encoding: "utf8",
      env: { ...process.env, BUDGET_DIST: `${dist}/`, ...env },
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("le budget fait ECHOUER un depassement delibere", () => {
  /** Sortie minimale : une page qui cite un actif JavaScript. */
  function fabriquerDist(octetsJs: number) {
    const dist = mkdtempSync(join(tmpdir(), "budget-"));
    const astro = join(dist, "_astro");
    execFileSync("mkdir", ["-p", astro]);
    // Contenu incompressible : sinon 200 Ko de zeros pesent 200 octets compresses
    // et le test ne prouverait rien.
    let js = "";
    for (let i = 0; js.length < octetsJs; i++) js += `const a${i}=${Math.E * (i + 1)};`;
    writeFileSync(join(astro, "gros.js"), js);
    writeFileSync(
      join(dist, "index.html"),
      `<!doctype html><html lang="fr"><body><script type="module" src="/_astro/gros.js"></script></body></html>`,
    );
    return dist;
  }

  it("passe sur une sortie legere", () => {
    const dist = fabriquerDist(1000);
    const r = lancerBudget(dist);
    expect(r.out).toContain("Budget respecte");
    expect(r.code).toBe(0);
  });

  it("ECHOUE en code 1 quand le JavaScript depasse", () => {
    // 300 Ko de JavaScript incompressible : dix fois le budget.
    const dist = fabriquerDist(300_000);
    const r = lancerBudget(dist);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Budget depasse");
    expect(r.out).toMatch(/JS: .* depasse le budget/);
  });

  it("ECHOUE aussi sur le poids total, JavaScript mis a part", () => {
    const dist = mkdtempSync(join(tmpdir(), "budget-"));
    let html = "<!doctype html><html lang=fr><body>";
    for (let i = 0; html.length < 900_000; i++) html += `<p>ligne ${i} ${Math.PI * i}</p>`;
    writeFileSync(join(dist, "index.html"), `${html}</body></html>`);
    const r = lancerBudget(dist);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Total: .* depasse le budget/);
  });

  it("ECHOUE sur une police telechargee, meme minuscule", () => {
    // Une police de 12 octets passerait tous les seuils. C'est un interdit
    // d'AGENTS.md, pas une question de poids.
    const dist = mkdtempSync(join(tmpdir(), "budget-"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><html lang=fr><body>x</body></html>");
    writeFileSync(join(dist, "marque.woff2"), "police");
    const r = lancerBudget(dist);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Police telechargee");
  });

  it("ECHOUE sur une sortie sans page plutot que d'annoncer zero", () => {
    const dist = mkdtempSync(join(tmpdir(), "budget-"));
    writeFileSync(join(dist, "lisezmoi.txt"), "rien");
    expect(lancerBudget(dist).code).toBe(1);
  });

  it("compte le JavaScript EN LIGNE — sinon on le cacherait dans le HTML", () => {
    const dist = mkdtempSync(join(tmpdir(), "budget-"));
    let js = "";
    for (let i = 0; js.length < 300_000; i++) js += `const b${i}=${Math.LN2 * (i + 3)};`;
    writeFileSync(
      join(dist, "index.html"),
      `<!doctype html><html lang=fr><body><script>${js}</script></body></html>`,
    );
    const r = lancerBudget(dist);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/JS: .* depasse/);
  });
});

describeConstruit("la sortie construite", () => {
  const tous = construit ? fichiers(DIST) : [];
  const pages = tous.filter((f) => extname(f) === ".html");

  it("contient des pages", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it("N'EMBARQUE AUCUNE POLICE", () => {
    const polices = tous.filter((f) => /\.(woff2?|ttf|otf|eot)$/.test(f));
    expect(polices.map((f) => f.slice(DIST.length))).toEqual([]);
  });

  it("chaque <img> porte width ET height", () => {
    // Sans elles, la page saute quand la photo arrive : c'est le decalage visuel
    // que le budget de 0,1 interdit.
    const manquants: string[] = [];
    for (const page of pages) {
      const html = readFileSync(page, "utf8");
      for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
        const balise = m[0];
        if (!/\bwidth=/.test(balise) || !/\bheight=/.test(balise)) {
          manquants.push(`${page.slice(DIST.length)} : ${balise.slice(0, 90)}`);
        }
      }
    }
    expect(manquants).toEqual([]);
  });

  it("ne charge aucun script depuis un autre domaine", () => {
    const externes: string[] = [];
    for (const page of pages) {
      const html = readFileSync(page, "utf8");
      for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)) {
        const src = m[1] as string;
        if (/^https?:\/\//.test(src)) externes.push(`${page.slice(DIST.length)} : ${src}`);
      }
    }
    expect(externes).toEqual([]);
  });

  it("les pages d'article portent un lien wa.me COMPLET dans le HTML", () => {
    // Le point du test : si le JavaScript n'arrive jamais, l'acheteuse peut quand
    // meme commander. Le compteur de quantite est un confort, pas le porteur de
    // la fonction.
    // Une page d'article est a `slug/produit/index.html` ; une page de boutique
    // est a `slug/index.html`. Compter les segments du chemin RELATIF, sans le
    // separateur de tete, evite de confondre les deux.
    const articles = pages.filter(
      (p) => p.slice(DIST.length).replace(/^\//, "").split("/").length === 3,
    );
    if (articles.length === 0) return; // aucun instantane : rien a verifier ici
    for (const page of articles) {
      const html = readFileSync(page, "utf8");
      const lien = /https:\/\/wa\.me\/237\d{9}\?text=([^"'\s\\]+)/.exec(html);
      expect(lien, page.slice(DIST.length)).toBeTruthy();
      const texte = decodeURIComponent((lien?.[1] ?? "").replaceAll("&#38;", "&"));
      // Les cinq informations canoniques.
      expect(texte, page).toContain("Total :");
      expect(texte, page).toContain("Boutique :");
      expect(texte, page).toContain(" x ");
      // Et rien d'invente : la reference et le code arrivent au lot 11.
      expect(texte, page).not.toMatch(/CT-\d/);
    }
  });

  it("le budget passe sur la vraie sortie", () => {
    const r = lancerBudget(DIST);
    expect(r.out, r.out).toContain("Budget respecte");
    expect(r.code).toBe(0);
  });

  it("dist/ n'est pas vide au point d'etre suspect", () => {
    expect(statSync(join(DIST, "index.html")).size).toBeGreaterThan(200);
  });
});
