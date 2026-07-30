import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Ce que Node refuse d'executer, et que `tsc --noEmit` laisse passer.
 *
 * Node 24 execute le TypeScript en **retirant** les types, sans les transformer
 * (« strip-only »). Trois constructions de TypeScript n'ont pas d'equivalent une
 * fois les types retires, parce qu'elles GENERENT du code :
 *
 * - `constructor(private readonly x: T)` — la propriete de parametre ;
 * - `enum` — sauf `const enum` en position de type, il produit un objet ;
 * - `namespace` avec du corps executable.
 *
 * Elles compilent parfaitement sous `tsc --noEmit`, passent le lint, passent
 * Vitest — qui transforme le code avec esbuild — et font echouer le serveur **au
 * demarrage**. C'est arrive : `PrismaOtpAttemptStore` utilisait une propriete de
 * parametre, et rien dans la porte de verification ne le voyait.
 *
 * Ce test est la parce qu'aucune des cinq commandes de la definition de terminé
 * n'execute reellement `node src/server.ts`.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function fichiersTs(racine: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(racine)) {
    const p = join(racine, nom);
    if (statSync(p).isDirectory()) {
      out.push(...fichiersTs(p));
    } else if (extname(p) === ".ts") {
      out.push(p);
    }
  }
  return out;
}

/** Source sans commentaires : les blocs de documentation citent les motifs. */
const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const FICHIERS = fichiersTs(SRC).filter((p) => !p.includes("__tests__"));
const relatif = (p: string) => p.slice(SRC.length + 1);

describe("le code tourne sous le TypeScript strip-only de Node", () => {
  it("trouve bien des fichiers a inspecter", () => {
    // Sans ce garde, un chemin casse ferait passer les trois tests suivants
    // sur une liste vide.
    expect(FICHIERS.length).toBeGreaterThan(10);
  });

  it("aucune propriete de parametre dans un constructeur", () => {
    const motif = /constructor\s*\([^)]*\b(private|public|protected|readonly)\s+\w/s;
    const coupables = FICHIERS.filter((p) => motif.test(code(p))).map(relatif);
    expect(
      coupables,
      `propriete de parametre — Node leve ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX au demarrage : ${coupables.join(", ")}`,
    ).toEqual([]);
  });

  it("aucun enum", () => {
    const coupables = FICHIERS.filter((p) => /^\s*(export\s+)?enum\s+\w/m.test(code(p))).map(
      relatif,
    );
    expect(coupables, `enum non executable en strip-only : ${coupables.join(", ")}`).toEqual([]);
  });

  it("aucun namespace ni module interne", () => {
    const coupables = FICHIERS.filter((p) =>
      /^\s*(export\s+)?(namespace|module)\s+\w+\s*\{/m.test(code(p)),
    ).map(relatif);
    expect(coupables, `namespace non executable en strip-only : ${coupables.join(", ")}`).toEqual(
      [],
    );
  });

  it("le motif de detection attrape bien un cas connu", () => {
    // Le garde du garde : sans lui, une expression cassee ferait passer le test
    // sur tout le depot en silence.
    const motif = /constructor\s*\([^)]*\b(private|public|protected|readonly)\s+\w/s;
    expect(motif.test("class A { constructor(private readonly x: T) {} }")).toBe(true);
    expect(motif.test("class A { constructor(x: T) { this.x = x } }")).toBe(false);
  });
});
