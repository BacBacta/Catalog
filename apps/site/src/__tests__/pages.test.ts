import { existsSync, readFileSync } from "node:fs";
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

  it("aucune metadonnee ne recopie le nom de la societe", async () => {
    /**
     * Le defaut reel, trouve en changeant la denomination (ADR 0046) : les
     * trois attributs `description=` portaient « Horizon Services » EN DUR,
     * alors que le corps des pages lisait `EDITEUR`. Le nom etait donc juste
     * dans la page et faux dans la metadonnee — celle que Google affiche et
     * que WhatsApp met dans l'apercu du lien. Invisible a l'ecran.
     *
     * On teste le PREMIER MOT de la denomination : il suffit a reperer une
     * recopie, et il reste vrai si la casse ou la suite du nom changent.
     */
    const mot = EDITEUR.nom.split(" ")[0];
    for (const f of await fichiers(PAGES_DIR, ".astro")) {
      const source = readFileSync(f, "utf8");
      for (const attr of source.matchAll(/\b(?:title|description)="([^"]*)"/g)) {
        expect(attr[1], `${f} recopie le nom de la societe dans un attribut`).not.toContain(mot);
      }
    }
  });

  it("l'etiquette du monogramme dit le MEME nom que `contracts`", () => {
    /* Le SVG est un fichier statique : il ne peut pas lire `EDITEUR`, donc
       c'est le seul endroit du site ou le nom est ecrit a la main. Il diverge
       en silence — une etiquette n'a pas de rendu visible. */
    const svg = readFileSync(join(LIB_DIR, "..", "public", "favicon.svg"), "utf8");
    expect(svg).toContain(`aria-label="${EDITEUR.nom}"`);
  });

  it("n'affiche NI le numero d'immatriculation NI le nom du gerant", async () => {
    /* Retrait demande, acte par l'ADR 0044. Deux raisons, et la premiere est
       la plus forte : le numero RCCM a ete lu sur un champ MANUSCRIT et n'est
       pas confirme sur l'original — une mention legale fausse est pire qu'une
       mention absente. La seconde : le nom du gerant est une donnee
       personnelle, sur un site dont la page voisine promet le minimum.
       Les deux champs restent dans `editeur.ts` ; c'est leur AFFICHAGE ici
       qui est ferme, et il se rouvre en une ligne le jour venu. */
    for (const f of await fichiers(LIB_DIR, ".astro")) {
      const source = readFileSync(f, "utf8");
      expect(source, `${f} reaffiche le RCCM`).not.toContain("EDITEUR.rccm");
      expect(source, `${f} reaffiche le gerant`).not.toContain("EDITEUR.gerant");
      expect(source, f).not.toContain(EDITEUR.gerant);
    }
  });

  it("chaque icone declaree existe VRAIMENT dans `public/`", () => {
    /* Une balise `<link rel="icon">` qui pointe un fichier absent ne casse
       rien de visible : le navigateur retombe sur son icone par defaut, et
       l'onglet reste vide — exactement le symptome qu'on vient de corriger.
       Le defaut est donc silencieux, et c'est pour cela qu'il se teste. */
    const coquille = readFileSync(join(LIB_DIR, "layouts", "Base.astro"), "utf8");
    const declarees = [...coquille.matchAll(/rel="(?:apple-touch-)?icon"[^>]*href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(declarees.length, "aucune icone declaree — l'onglet resterait vide").toBeGreaterThan(0);
    for (const href of declarees) {
      expect(
        existsSync(join(LIB_DIR, "..", "public", href)),
        `${href} est declare mais absent`,
      ).toBe(true);
    }
    /* L'ICO est reclame a la racine par TOUS les navigateurs, meme sans
       balise. Son absence est un 404 par page ouverte. */
    expect(existsSync(join(LIB_DIR, "..", "public", "favicon.ico"))).toBe(true);
  });

  it("`vercel.json` porte toujours la CSP qui interdit le script", () => {
    /**
     * Ce test ne garantit PAS que l'en-tete est servi — il ne mesure qu'un
     * fichier. C'est important de le dire, parce que le defaut reel a ete
     * exactement l'ecart entre les deux : le fichier etait juste, et Vercel ne
     * le lisait pas (`Root Directory` = racine du depot, ADR 0045).
     *
     * La seule verification qui vaut est la reponse HTTP, et elle vit dans le
     * runbook :
     *   curl -sSI https://horizonservices.store/ | grep -i content-security
     *
     * Ce test tient l'autre moitie : que la regle ne disparaisse pas du
     * fichier une fois qu'on a fait le necessaire pour qu'il soit lu.
     */
    const conf = JSON.parse(readFileSync(join(LIB_DIR, "..", "vercel.json"), "utf8"));
    const entetes = conf.headers?.flatMap((h: { headers: { key: string; value: string }[] }) =>
      h.headers.map((e) => [e.key.toLowerCase(), e.value] as const),
    );
    const csp = entetes?.find(([k]: readonly [string, string]) => k === "content-security-policy");
    expect(csp, "aucune CSP dans vercel.json").toBeDefined();
    expect(csp?.[1]).toContain("default-src 'none'");
    /* Les trois icones sont servies depuis le meme domaine : sans `img-src`,
       l'onglet redeviendrait vide — cette fois par la CSP. */
    expect(csp?.[1]).toContain("img-src 'self'");
  });
});

/**
 * Les gardes du mouvement — ADR 0044.
 *
 * Le site anime au defilement et entre deux pages, entierement en CSS. Les
 * deux regles ci-dessous sont ce qui rend cette animation acceptable ; elles
 * se cassent d'une ligne distraite.
 */
describe("le mouvement du site", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "styles", "global.css"), "utf8");

  /** Extrait le corps de chaque `@keyframes`, accolades equilibrees. */
  function corpsDesKeyframes(source: string): string[] {
    const corps: string[] = [];
    for (const m of source.matchAll(/@keyframes\b/g)) {
      let i = source.indexOf("{", m.index);
      if (i === -1) continue;
      let profondeur = 0;
      const debut = i;
      for (; i < source.length; i++) {
        if (source[i] === "{") profondeur++;
        else if (source[i] === "}" && --profondeur === 0) break;
      }
      corps.push(source.slice(debut, i + 1));
    }
    return corps;
  }

  it("n'anime JAMAIS l'opacite — le contraste doit etre mesurable a tout instant", () => {
    /* Meme raison qu'au lot 2 (voir `tokens.css`) : un fondu rend le contraste
       dependant de l'instant ou on le lit, et axe-core lit la page pendant
       l'animation. Une revelation se fait donc par TRANSLATION. */
    const trouves = corpsDesKeyframes(css);
    expect(
      trouves.length,
      "aucune @keyframes trouvee — le test ne mesure plus rien",
    ).toBeGreaterThan(0);
    for (const corps of trouves) {
      expect(corps, "une @keyframes anime l'opacite").not.toMatch(/\bopacity\s*:/);
    }
  });

  it("la preference `reduced-motion` coupe aussi la transition entre pages", () => {
    /* Les pseudo-elements `::view-transition-*` vivent dans un arbre a part :
       la regle globale de `tokens.css`, qui vise `*`, ne les atteint pas. Il
       faut les nommer, sans quoi la page continue de fondre pour quelqu'un
       qui a demande l'inverse. */
    expect(css).toContain("@view-transition");
    const reduit = css.slice(css.indexOf("prefers-reduced-motion: reduce"));
    expect(reduit, "aucun bloc `reduce` apres la declaration").not.toBe("");
    expect(reduit).toMatch(/::view-transition-group\(\*\)/);
    expect(reduit).toMatch(/animation:\s*none/);
  });
});
