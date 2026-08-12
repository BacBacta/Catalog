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

  it("une page d'article laisse TOUJOURS un geste possible sans JavaScript", () => {
    // Le point du test, inchange depuis le lot 6 : si le JavaScript n'arrive
    // jamais, l'acheteuse peut quand meme agir. Ce qu'elle peut faire, en
    // revanche, depend desormais de TROIS branches de `[produit].astro`, et la
    // version precedente n'en connaissait qu'une.
    //
    // Elle passait donc pour de mauvaises raisons : sans `PUBLIC_BOT_WHATSAPP`,
    // la construction ne prend jamais la branche du bot, et une boutique en
    // conges n'existe pas dans les donnees semees. Le jour ou la variable est
    // posee en production, ce test aurait cesse de garder ce qu'il decrit —
    // sans jamais rougir.
    //
    // Une page d'article est a `slug/produit/index.html` ; une page de boutique
    // est a `slug/index.html`. Compter les segments du chemin RELATIF, sans le
    // separateur de tete, evite de confondre les deux.
    const articles = pages.filter(
      (p) => p.slice(DIST.length).replace(/^\//, "").split("/").length === 3,
    );
    if (articles.length === 0) return; // aucun instantane : rien a verifier ici

    const vues = { conges: 0, bot: 0, ilot: 0 };
    for (const page of articles) {
      const html = readFileSync(page, "utf8");
      const nom = page.slice(DIST.length);
      const lienVendeuse = /https:\/\/wa\.me\/237\d{9}"/.test(html);

      // L'identifiant `commander` ne distingue PAS les branches : l'ilot rendu
      // cote serveur porte le meme. Ce qui les separe est la presence du SECOND
      // lien — celui de la vendeuse —, que seule la page Astro emet.
      const versLeBot =
        /data-testid="commander"/.test(html) && /data-testid="ecrire-vendeuse"/.test(html);

      if (/ne prend pas de nouvelle commande/.test(html)) {
        // ── Mode conges (ADR 0039). Aucun lien de commande, et c'est la
        //    decision : un bouton qui ne commande rien est une promesse qu'on
        //    ne tient pas. Ce qui NE ferme pas, en revanche, c'est la
        //    conversation — « la vendeuse reste joignable » est la moitie de
        //    l'ADR qu'un test doit tenir, sinon la boutique fermee devient une
        //    page morte.
        vues.conges++;
        expect(/data-testid="ecrire-vendeuse"/.test(html), nom).toBe(true);
        expect(lienVendeuse, `${nom} : ferme ET injoignable`).toBe(true);
        expect(/data-testid="commander"/.test(html), `${nom} : ferme mais commandable`).toBe(false);
        continue;
      }

      if (versLeBot) {
        // ── La branche du comptoir (ADR 0066). Le lien mene au BOT, et porte
        //    la phrase d'entree. C'est la moitie « boutique » du contrat que
        //    l'ADR demande de tenir des deux cotes ; l'autre moitie est
        //    verifiee par `entree-boutique.test.ts`, cote domaine.
        vues.bot++;
        const lien = /https:\/\/wa\.me\/\d{8,15}\?text=([^"'\s\\]+)/.exec(html);
        expect(lien, nom).toBeTruthy();
        const texte = decodeURIComponent((lien?.[1] ?? "").replaceAll("&#38;", "&"));
        // Le mot-cle, la boutique, le canal, l'article : quatre mots, dans cet
        // ordre. L'article est celui de la page — sans lui, l'acheteuse
        // retomberait sur le catalogue entier, ce que l'ADR 0066 refuse.
        const mots = texte.trim().split(/\s+/);
        expect(mots[0], nom).toBe("boutique");
        expect(mots[1], nom).toBe(nom.replace(/^\//, "").split("/")[0]);
        expect(mots[2], nom).toBe("web");
        expect(mots[3], nom).toBe(nom.replace(/^\//, "").split("/")[1]);
        // Et rien d'un secret : ce lien se copie et se transfere.
        expect(texte, nom).not.toMatch(/CT-\d/);
        // La relation ne ferme pas pour autant.
        expect(lienVendeuse, `${nom} : le numero de la vendeuse a disparu`).toBe(true);
        continue;
      }

      // ── L'ilot rendu cote serveur : le lien complet, autosuffisant en texte
      //    brut (AGENTS.md §2). C'est l'assertion d'origine du lot 6.
      vues.ilot++;
      const lien = /https:\/\/wa\.me\/237\d{9}\?text=([^"'\s\\]+)/.exec(html);
      expect(lien, nom).toBeTruthy();
      const texte = decodeURIComponent((lien?.[1] ?? "").replaceAll("&#38;", "&"));
      // Les cinq informations canoniques.
      expect(texte, nom).toContain("Total :");
      expect(texte, nom).toContain("Boutique :");
      expect(texte, nom).toContain(" x ");
      // Et rien d'invente : la reference et le code arrivent au lot 11.
      expect(texte, nom).not.toMatch(/CT-\d/);
    }

    // Ce que la construction a REELLEMENT emis, dit a voix haute. Sans cette
    // ligne, la repartition entre les trois branches reste invisible, et c'est
    // precisement ce qui a laisse le trou : on ne voit pas qu'une branche n'est
    // jamais exercee.
    expect(vues.conges + vues.bot + vues.ilot, JSON.stringify(vues)).toBe(articles.length);
  });

  it("le budget passe sur la vraie sortie", () => {
    const r = lancerBudget(DIST);
    expect(r.out, r.out).toContain("Budget respecte");
    expect(r.code).toBe(0);
  });

  it("dist/ n'est pas vide au point d'etre suspect", () => {
    expect(statSync(join(DIST, "index.html")).size).toBeGreaterThan(200);
  });

  /**
   * La page de rampe (lot 9), telle qu'elle est REELLEMENT livree.
   *
   * C'est le seul endroit ou l'on peut verifier qu'aucun code d'operateur n'a
   * ete fige a la construction : le HTML sorti du regroupeur ne ment pas, la ou
   * une relecture de source peut manquer une valeur inlinee par un plugin.
   */
  describe("la page de paiement", () => {
    const payer = join(DIST, "payer/index.html");
    const html = existsSync(payer) ? readFileSync(payer, "utf8") : "";

    it("est construite", () => {
      expect(html.length).toBeGreaterThan(200);
    });

    it("ne fige AUCUN code USSD dans le HTML livre", () => {
      // Les codes viennent de `GET /api/rampe`, a l'execution. S'ils
      // apparaissaient ici, changer un code exigerait de reconstruire le site —
      // c'est-a-dire trop tard, le jour ou un operateur le change.
      expect(html).not.toMatch(/[*#]\d[\d*#]*#/);
      expect(html).not.toContain("tel:");
    });

    it("dit a une acheteuse sans JavaScript comment payer quand meme", () => {
      expect(html).toContain("<noscript>");
      expect(html).toMatch(/noscript[\s\S]*?WhatsApp/i);
    });

    it("n'est pas indexee — une page de paiement dans un moteur appelle l'hameconnage", () => {
      expect(html).toMatch(/<meta name="robots" content="noindex"/);
    });

    it("n'offre aucun champ de saisie", () => {
      // Ni ici ni ailleurs : Catalog n'a aucun endroit ou un code secret
      // pourrait etre tape.
      expect(html).not.toMatch(/<input/i);
    });

    it("previent que le code secret ne se tape jamais sur Catalog", () => {
      expect(html).toMatch(/code secret/i);
    });
  });
});
