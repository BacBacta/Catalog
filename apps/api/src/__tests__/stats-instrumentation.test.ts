import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VUES_INSTRUMENTEES } from "../routes/stats.ts";

/**
 * Le drapeau `vuesInstrumentees` doit dire la VERITE, pas une intention.
 *
 * L'ecran statistiques annonce a la vendeuse que ses vues ne sont pas encore
 * comptees. C'est vrai aujourd'hui : la boutique publique est un site statique
 * servi par un CDN, elle ne previent personne quand une page s'ouvre, et les
 * seules lignes de `product_view` viennent du jeu de donnees de developpement.
 *
 * Un drapeau code en dur pourrit toujours de la meme facon : quelqu'un branche
 * le comptage, oublie la constante, et l'ecran continue de dire « pas encore
 * comptees » sur des chiffres qui le sont. Ce test rend l'oubli impossible —
 * le jour ou un chemin de code ecrira dans cette table, il echouera, et c'est
 * a ce moment-la que la constante passera a `true`.
 *
 * L'inverse est verifie aussi : si le drapeau passait a `true` sans qu'aucun
 * chemin n'ecrive, l'ecran mentirait dans l'autre sens — « vos vues sont
 * comptees » sur une table vide, ce qui ferait lire un zero comme un desastre
 * commercial.
 */

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..", "..", "..");

/** Le code d'EXECUTION : ni les tests, ni le jeu de donnees de developpement. */
const ARBRES = [
  join(RACINE, "apps/api/src/routes"),
  join(RACINE, "apps/api/src/adapters"),
  join(RACINE, "apps/api/src/domain"),
  join(RACINE, "apps/shop/src"),
  join(RACINE, "apps/seller/src"),
];

function sources(racine: string, out: string[] = []): string[] {
  for (const nom of readdirSync(racine)) {
    if (nom === "__tests__" || nom === "node_modules") continue;
    const p = join(racine, nom);
    if (statSync(p).isDirectory()) sources(p, out);
    else if ([".ts", ".tsx", ".astro", ".mjs"].includes(extname(p))) out.push(p);
  }
  return out;
}

/** Source sans commentaires : ce fichier-ci et `stats.ts` citent le motif. */
function code(p: string): string {
  return readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FICHIERS = ARBRES.flatMap((a) => sources(a));

/** Toute ecriture Prisma dans `product_view`, quel qu'en soit le verbe. */
const ECRITURE =
  /productView\s*\.\s*(create|createMany|upsert|update|updateMany|delete|deleteMany)|INSERT\s+INTO\s+"?product_view/i;

describe("le drapeau d'instrumentation des vues dit la verite", () => {
  it("trouve bien des fichiers a inspecter", () => {
    expect(FICHIERS.length).toBeGreaterThan(20);
    expect(FICHIERS.some((f) => f.endsWith("routes/stats.ts"))).toBe(true);
  });

  const ecrivains = FICHIERS.filter((f) => ECRITURE.test(code(f))).map((f) =>
    f.slice(RACINE.length + 1),
  );

  it("`VUES_INSTRUMENTEES` vaut exactement « un chemin de code ecrit-il des vues ? »", () => {
    expect(
      VUES_INSTRUMENTEES,
      ecrivains.length > 0
        ? `${ecrivains.join(", ")} ecrit dans product_view : passer VUES_INSTRUMENTEES a true, ` +
            "et retirer l'avertissement de l'ecran statistiques."
        : "aucun chemin de code n'ecrit dans product_view : VUES_INSTRUMENTEES doit rester false, " +
            "sinon l'ecran annonce des vues comptees sur une table vide.",
    ).toBe(ecrivains.length > 0);
  });

  it("le motif de detection attrape bien les ecritures connues", () => {
    // Le garde du garde : une expression cassee ferait passer le test ci-dessus
    // en silence, pour toujours.
    for (const echantillon of [
      "await prisma.productView.create({ data: {} });",
      "prisma.productView.upsert({})",
      "tx.productView.updateMany({})",
      'sql`INSERT INTO "product_view" (id) VALUES (1)`',
    ]) {
      expect(ECRITURE.test(echantillon), echantillon).toBe(true);
    }
    // Et il ne se declenche pas sur une LECTURE, qui est ce que fait la route.
    for (const echantillon of [
      "await deps.prisma.productView.findMany({ where: {} });",
      "prisma.productView.count()",
    ]) {
      expect(ECRITURE.test(echantillon), echantillon).toBe(false);
    }
  });
});
