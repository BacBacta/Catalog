import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { EDITEUR } from "@catalog/contracts/editeur";
import { describe, expect, it } from "vitest";

/**
 * Les gardes du site de la societe — ADR 0042.
 *
 * Ce site n'a pas de logique : il a des PROMESSES, et ce sont elles qu'on
 * teste. Chacune de ces regles a ete violee au moins une fois dans un projet
 * quelconque, et se viole en une ligne distraite.
 *
 * Les tests lisent les SOURCES et non la construction : ils tournent sans
 * `astro build`, donc en CI comme en local, et ils echouent au moment ou la
 * ligne fautive est ecrite.
 */

const PAGES_DIR = join(import.meta.dirname, "..", "pages");
const LIB_DIR = join(import.meta.dirname, "..");

async function fichiers(dir: string, ext: string): Promise<string[]> {
  const entrees = await readdir(dir, { recursive: true, withFileTypes: true });
  return entrees
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => join(e.parentPath, e.name));
}

describe("le site de la societe", () => {
  it("n'embarque AUCUN script — la CSP l'interdit, le code ne doit pas essayer", async () => {
    /* `default-src 'none'` dans `vercel.json` rend tout script inoperant. Une
       balise ajoutee par distraction ne casserait donc pas la page : elle
       serait silencieusement morte, ce qui est pire. */
    for (const f of [
      ...(await fichiers(PAGES_DIR, ".astro")),
      ...(await fichiers(LIB_DIR, ".astro")),
    ]) {
      const source = readFileSync(f, "utf8");
      expect(source, f).not.toMatch(/<script/i);
      expect(source, f).not.toMatch(/client:(load|visible|idle|only)/);
    }
  });

  it("ne telecharge aucune police", async () => {
    for (const f of await fichiers(LIB_DIR, ".astro")) {
      const source = readFileSync(f, "utf8");
      expect(source, f).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@font-face/i);
    }
  });

  it("les trois pages declarees au plan du site existent", async () => {
    const plan = readFileSync(
      join(import.meta.dirname, "..", "..", "public", "sitemap.txt"),
      "utf8",
    )
      .split("\n")
      .filter(Boolean);
    const pages = (await fichiers(PAGES_DIR, ".astro")).map((f) =>
      f.slice(PAGES_DIR.length + 1).replace(/\.astro$/, ""),
    );
    expect(pages.sort()).toEqual(["confidentialite", "contact", "index"]);
    /* Un plan qui annonce une page absente est un 404 offert a un moteur — et
       a un verificateur qui le suit. */
    for (const url of plan) {
      const chemin = new URL(url).pathname.replace(/^\/|\/$/g, "");
      expect(pages, url).toContain(chemin === "" ? "index" : chemin);
    }
  });

  it("le plan du site et les canoniques portent le MEME domaine que l'editeur", () => {
    const plan = readFileSync(
      join(import.meta.dirname, "..", "..", "public", "sitemap.txt"),
      "utf8",
    );
    const config = readFileSync(join(import.meta.dirname, "..", "..", "astro.config.mjs"), "utf8");
    /* Trois endroits nomment le domaine ; qu'ils divergent est exactement ce
       qu'un verificateur compare a l'URL declaree. */
    for (const ligne of plan.split("\n").filter(Boolean)) {
      expect(ligne.startsWith(EDITEUR.site), ligne).toBe(true);
    }
    expect(config).toContain(EDITEUR.site);
  });

  it("l'identite legale vient de `contracts`, jamais recopiee dans une page", async () => {
    /* Le premier reflexe avait ete de copier `editeur.ts` dans ce site. Deux
       denominations qui divergent d'un mot, et la verification echoue. */
    for (const f of await fichiers(LIB_DIR, ".astro")) {
      const source = readFileSync(f, "utf8");
      if (source.includes(EDITEUR.societe)) {
        expect(source, `${f} ecrit la denomination en dur`).toContain("EDITEUR");
      }
      expect(source, f).not.toContain(EDITEUR.rccm);
    }
  });
});
