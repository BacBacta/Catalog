import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Le jeton de suivi ne sort jamais de la base.**
 *
 * C'est ce qui rend impossible la troisieme attaque du lot 15 — contresigner
 * sans le lien de suivi. `attaques-preuve.test.ts` prouve qu'aucune AUTRE cle
 * n'ouvre la contre-signature ; ce test-ci prouve que la bonne cle ne se
 * ramasse nulle part.
 *
 * ── Pourquoi un test qui lit les sources ───────────────────────────────────
 *
 * Le defaut redoute n'est pas une route qui rend le jeton exprès : c'est un
 * `select` elargi de bonne foi, ou un `include` ajoute pour depanner un ecran,
 * six mois plus tard. Un tel changement passe toutes les suites existantes —
 * personne n'affirme l'absence d'un champ qu'on vient d'ajouter — et il publie
 * le secret qui autorise la contre-signature (ADR 0021).
 *
 * Il suffirait alors d'avoir lu une reponse d'API pour valider le paiement
 * d'autrui, et le controle n° 7 ne vaudrait plus rien : sa valeur entiere tient
 * a ce qu'il soit la voix de l'AUTRE partie.
 *
 * ── Les usages LEGITIMES, enumeres ─────────────────────────────────────────
 *
 * `buyerToken` a le droit d'apparaitre a trois endroits, et seulement trois :
 *
 * 1. dans une clause `where` — c'est ainsi qu'on retrouve une commande depuis le
 *    lien de suivi ;
 * 2. dans une ecriture, a la creation de la commande ;
 * 3. dans UNE projection, celle de `suivi-pousse.ts` — ADR 0099 : la carte de
 *    suivi poussee porte le lien du jeton, envoye UNIQUEMENT dans le fil
 *    acheteuse qui l'a deja recu a la confirmation. Meme canal, meme
 *    destinataire, aucune exposition nouvelle — et la projection vit dans ce
 *    fichier dedie, jamais ailleurs.
 *
 * Toute autre occurrence dans une projection est un defaut. Le test cherche donc
 * `buyerToken: true`, la forme exacte d'un `select` Prisma.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(RACINE, "src");

const EST_TEST = /(^|[./])__tests__[/]|\.(test|spec)\.[jt]sx?$/;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if ([".ts", ".tsx"].includes(extname(p)) && !EST_TEST.test(p)) out.push(p);
  }
  return out;
}

const FICHIERS = sources(SRC);

describe("le jeton de suivi ne se projette jamais", () => {
  it("trouve bien des fichiers a inspecter", () => {
    // Un chemin casse ferait passer tout le reste sur une liste vide, et le
    // test le plus dangereux est celui qui ne teste rien.
    expect(FICHIERS.length).toBeGreaterThan(20);
    expect(FICHIERS.map((f) => relative(SRC, f))).toContain(join("routes", "recu.ts"));
  });

  it("aucun `select` ne demande buyerToken — hors la cellule nommee (ADR 0099)", () => {
    const fautifs = FICHIERS.filter((f) => /buyerToken\s*:\s*true/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f))
      .filter((f) => f !== "suivi-pousse.ts");
    expect(fautifs).toEqual([]);
  });

  it("la cellule nommee existe et projette bien le jeton — sinon l'exception ment", () => {
    const cellule = readFileSync(join(SRC, "suivi-pousse.ts"), "utf8");
    expect(cellule).toMatch(/buyerToken\s*:\s*true/);
    /* Et elle dit pourquoi elle a le droit : l'ADR qui l'autorise. */
    expect(cellule).toContain("ADR 0099");
  });

  /**
   * Le meme controle, du cote de la sortie : aucune route ne recopie le jeton
   * dans un corps de reponse. On cherche la forme `buyerToken` a droite d'un
   * `c.json`, c'est-a-dire dans ce qui part sur le reseau.
   */
  it("aucune reponse ne recopie le jeton", () => {
    const fautifs: string[] = [];
    for (const f of FICHIERS) {
      const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      // Un objet de reponse qui porterait le jeton, sous ce nom ou renomme.
      if (/(jeton|token|buyerToken)\s*:\s*(commande|order|o)\.buyerToken/.test(code)) {
        fautifs.push(relative(SRC, f));
      }
    }
    expect(fautifs).toEqual([]);
  });

  /**
   * Et l'usage legitime existe bel et bien : sans lui, les deux tests ci-dessus
   * passeraient sur un produit ou la contre-signature ne marche plus du tout.
   */
  it("le jeton reste utilise en clause de recherche", () => {
    const recu = readFileSync(join(SRC, "routes", "recu.ts"), "utf8");
    expect(recu).toMatch(/where:\s*\{\s*buyerToken:\s*jeton\s*\}/);
  });
});
