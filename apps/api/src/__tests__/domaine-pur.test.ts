import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `src/domain` ne touche NI la base, NI le reseau, NI l'horloge.
 *
 * C'est la regle de dependance d'AGENTS.md — « `domain` ne depend de rien » — et
 * c'est ce qui rend le metier testable sans base et sans reseau. Elle est
 * verifiee par un test et non par une regle de lint : Biome 2.5 ne sait pas
 * exprimer « ce repertoire-la n'importe pas ce module-la » sans plugin.
 *
 * Les quatre motifs interdits, et le defaut que chacun previent :
 *
 * | motif | ce qu'il ferait entrer | consequence |
 * |---|---|---|
 * | `from "@prisma` | un client de base | le metier ne se teste plus sans Postgres |
 * | `from "hono` | la couche HTTP | une regle metier devient dependante d'une requete |
 * | `fetch(` | un appel reseau | un test devient lent, puis intermittent |
 * | `Date.now(` | l'horloge | un test devient non deterministe, et la fenetre de 48 h invérifiable au bord |
 *
 * Les commentaires sont retires avant l'inspection : les blocs de documentation
 * de ce depot citent volontairement les motifs interdits pour expliquer pourquoi
 * ils le sont, et un test qui les compterait se declencherait sur sa propre
 * explication.
 */

const DOMAINE = join(dirname(fileURLToPath(import.meta.url)), "../domain");

function fichiersTs(racine: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(racine)) {
    const p = join(racine, nom);
    if (statSync(p).isDirectory()) out.push(...fichiersTs(p));
    else if (extname(p) === ".ts") out.push(p);
  }
  return out;
}

/** Source sans commentaires de bloc ni de ligne. */
function code(p: string): string {
  return readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FICHIERS = fichiersTs(DOMAINE);
const relatif = (p: string) => p.slice(DOMAINE.length + 1);

/** Les quatre motifs de la definition de terminé, tels qu'elle les ecrit. */
const INTERDITS: Array<{ nom: string; motif: RegExp; pourquoi: string }> = [
  {
    nom: 'from "@prisma',
    motif: /from\s+"@prisma/,
    pourquoi: "un client de base dans le domaine le rend intestable sans Postgres",
  },
  {
    nom: 'from "hono',
    motif: /from\s+"hono/,
    pourquoi: "la couche HTTP n'a rien a faire dans une regle metier",
  },
  {
    nom: "fetch(",
    motif: /\bfetch\s*\(/,
    pourquoi: "un appel reseau rend le test lent, puis intermittent",
  },
  {
    nom: "Date.now(",
    motif: /\bDate\s*\.\s*now\s*\(/,
    pourquoi: "l'horloge lue dans le domaine rend les tests non deterministes",
  },
];

describe("src/domain reste pur", () => {
  it("trouve bien des fichiers a inspecter", () => {
    // Sans ce garde, un chemin casse ferait passer tous les tests suivants sur
    // une liste vide — et le test le plus dangereux est celui qui ne teste rien.
    expect(FICHIERS.length).toBeGreaterThan(5);
    expect(FICHIERS.map(relatif)).toContain("proof/machine.ts");
    expect(FICHIERS.map(relatif)).toContain("order/expiration.ts");
  });

  for (const { nom, motif, pourquoi } of INTERDITS) {
    it(`aucun fichier ne contient \`${nom}\``, () => {
      const coupables = FICHIERS.filter((p) => motif.test(code(p))).map(relatif);
      expect(coupables, `${pourquoi} — trouve dans : ${coupables.join(", ")}`).toEqual([]);
    });
  }

  it("les motifs de detection attrapent bien des cas connus", () => {
    // Le garde du garde : une expression cassee ferait passer les quatre tests
    // ci-dessus en silence, sur tout le repertoire.
    const echantillons: Record<string, string> = {
      'from "@prisma': 'import { X } from "@prisma/client";',
      'from "hono': 'import { Hono } from "hono";',
      "fetch(": "const r = await fetch(url);",
      "Date.now(": "const t = Date.now();",
    };
    for (const { nom, motif } of INTERDITS) {
      expect(motif.test(echantillons[nom] as string), nom).toBe(true);
    }
    // Et ils ne se declenchent pas sur du code legitime.
    const legitime = 'import type { PrismaClient } from "@catalog/db";\nconst t = now.getTime();';
    for (const { nom, motif } of INTERDITS) {
      expect(motif.test(legitime), nom).toBe(false);
    }
  });

  it("aucun import de `@catalog/db` — meme en type seul", () => {
    // `import type` disparait a la compilation, mais il documente une dependance
    // qui ne devrait pas exister : le domaine definit ses interfaces, les
    // adaptateurs les implementent.
    const coupables = FICHIERS.filter((p) => /from\s+"@catalog\/db"/.test(code(p))).map(relatif);
    expect(coupables).toEqual([]);
  });

  it("aucun acces au systeme de fichiers ni aux variables d'environnement", () => {
    // Ni l'un ni l'autre n'est dans la liste litterale de la definition de
    // terminé, mais les deux cassent la meme propriete : un domaine qui depend de
    // son environnement ne se teste pas de facon reproductible.
    const motifs = [/from\s+"node:fs/, /\bprocess\s*\.\s*env\b/];
    for (const motif of motifs) {
      const coupables = FICHIERS.filter((p) => motif.test(code(p))).map(relatif);
      expect(coupables, `${motif}`).toEqual([]);
    }
  });

  it("aucun `new Date()` sans argument — c'est `Date.now()` deguise", () => {
    // Le motif de la definition de terminé ne l'attrape pas, et il produit
    // exactement le meme defaut.
    const coupables = FICHIERS.filter((p) => /new\s+Date\s*\(\s*\)/.test(code(p))).map(relatif);
    expect(coupables).toEqual([]);
  });

  it("aucun `Math.random()` — l'alea arrive en parametre", () => {
    // C'est la meme discipline que pour l'horloge : `genererCodeOtp` et
    // `cleOpaque` recoivent leur source d'octets, ce qui les rend testables sur
    // des valeurs choisies.
    const coupables = FICHIERS.filter((p) => /Math\s*\.\s*random\s*\(/.test(code(p))).map(relatif);
    expect(coupables).toEqual([]);
  });
});
