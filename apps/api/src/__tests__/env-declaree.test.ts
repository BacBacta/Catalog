import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Toute variable d'environnement LUE par l'API est DECLAREE dans `.env.example`.
 *
 * ── Le defaut que ce test ferme ───────────────────────────────────────────
 *
 * `.env.example` est ce qu'on lit pour provisionner une machine. Ce qu'il ne dit
 * pas ne se pose pas — et une variable absente ne LEVE jamais : le code teste sa
 * presence et retombe sur un repli. Le produit marche, en moins bien, sans que
 * rien ne le dise.
 *
 * Deux cas reels, tous deux releves le 13/08/2026 par le balayage des capacites
 * Meta, aucun par une erreur :
 *
 * 1. **`WABOT_FLUX_OUVERTURE_ID`** — le formulaire qui fait tenir l'ouverture
 *    d'une boutique en UN ecran au lieu de quatre questions (ADR 0087/0088).
 *    Lu par `server.ts`, absent d'ici : le fil retombait sur les questions.
 * 2. **`BASE_BOUTIQUE_PUBLIQUE` / `BASE_APP_VENDEUSE`** — sans elles, le message
 *    de commande part sans lien de suivi, sans lien de verification du recu et
 *    sans rampe de paiement.
 *
 * Le repli silencieux est le bon comportement a l'execution — mieux vaut un
 * message sans lien qu'un lien mort, qui ferait refuser le message entier par
 * Meta. Ce test ne le conteste pas : il empeche que le repli devienne le
 * comportement par defaut d'une machine neuve, faute d'une ligne ici.
 */

const ICI = dirname(fileURLToPath(import.meta.url));
const SOURCES = join(ICI, "..");
const EXEMPLE = join(ICI, "../../../../.env.example");

/**
 * Ce qui n'a pas a etre declare, et pourquoi. Liste FERMEE : y ajouter une
 * ligne est une decision, pas un raccourci pour faire passer le test.
 */
const FOURNIES_PAR_LA_PLATEFORME: Record<string, string> = {
  PORT: "posee par Fly, jamais par nous",
  NODE_ENV: "posee par l'outillage de construction",
  CATALOG_SEL_EXECUTION: "propre aux tests, posee par la CI (voir _identifiants.ts)",
};

function fichiersTs(racine: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(racine)) {
    /* Les tests lisent des variables qui leur sont propres. */
    if (nom === "__tests__") continue;
    const p = join(racine, nom);
    if (statSync(p).isDirectory()) out.push(...fichiersTs(p));
    else if (extname(p) === ".ts") out.push(p);
  }
  return out;
}

const lues = new Set<string>();
for (const f of fichiersTs(SOURCES)) {
  const source = readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const m of source.matchAll(/process\s*\.\s*env\s*\.\s*([A-Z0-9_]+)/g)) {
    const nom = m[1];
    if (nom) lues.add(nom);
  }
}

const declarees = new Set(
  (readFileSync(EXEMPLE, "utf8").match(/^[A-Z0-9_]+(?==)/gm) ?? []) as string[],
);

describe("les variables d'environnement de l'API sont documentees", () => {
  it("trouve bien des variables a inspecter", () => {
    /* Sans ce garde, un chemin casse ferait passer le test suivant sur une
       liste vide — et le test le plus dangereux est celui qui ne teste rien. */
    expect(lues.size).toBeGreaterThan(10);
    expect(lues.has("DATABASE_URL")).toBe(true);
    expect(declarees.size).toBeGreaterThan(30);
  });

  it("chaque variable lue est declaree dans `.env.example`", () => {
    const manquantes = [...lues]
      .filter((v) => !declarees.has(v))
      .filter((v) => !(v in FOURNIES_PAR_LA_PLATEFORME))
      .sort();
    expect(
      manquantes,
      "declarez-les dans `.env.example` — une variable absente ne leve pas, " +
        "elle retombe sur un repli silencieux, et une machine neuve part diminuee",
    ).toEqual([]);
  });

  it("les cinq formulaires ont chacun leur variable, lue ET declaree", () => {
    /* Le cas qui a motive ce fichier. Les Flows sont publies chez Meta ; ce
       sont ces variables qui les BRANCHENT, et l'un des cinq manquait. */
    for (const quoi of ["LIVRAISON", "INSCRIPTION", "OUVERTURE", "ARTICLE", "AVIS"]) {
      const v = `WABOT_FLUX_${quoi}_ID`;
      expect(lues.has(v), `${v} n'est lue nulle part`).toBe(true);
      expect(declarees.has(v), `${v} n'est pas declaree dans .env.example`).toBe(true);
    }
  });
});
