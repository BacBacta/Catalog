import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ── Tout appel sortant FINIT — ADR 0085, puis 0089 ────────────────────────
 *
 * Deux fois en un jour, le fil d'une vendeuse s'est tu sans erreur ni trace.
 * Deux fois, la cause etait la meme : un appel reseau sans delai d'attente.
 *
 * - le 13/08 au matin, le deuxieme article — `fetch` nu dans les adaptateurs
 *   du bot (ADR 0085) ;
 * - le 13/08 au soir, apres la carte-vitrine — le client S3, dont le SDK
 *   n'impose AUCUN delai par defaut (ADR 0089).
 *
 * Un correctif ponctuel ne tient pas : le prochain adaptateur ecrira
 * `fetch(` par reflexe, et le defaut reviendra sous une autre forme. Ce test
 * lit les SOURCES et refuse un appel non borne, quel que soit son auteur.
 *
 * Il ne remplace pas la relecture — il rend le defaut visible AVANT le banc.
 */

const ADAPTATEURS = join(import.meta.dirname, "..", "adapters");

/** Les fichiers dispenses, chacun pour une raison ECRITE. */
const DISPENSES = new Map<string, string>([
  [
    "fetch-borne.ts",
    "c'est lui qui borne : il appelle le `fetch` nu qu'il enveloppe, par construction",
  ],
  [
    "campay.ts",
    "adaptateur en DORMANCE (ADR 0009) — inatteignable depuis un chemin v1, et on ne l'etend pas",
  ],
]);

function sources(): Array<{ nom: string; contenu: string }> {
  return readdirSync(ADAPTATEURS)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((nom) => ({ nom, contenu: readFileSync(join(ADAPTATEURS, nom), "utf8") }));
}

describe("les appels sortants sont bornes", () => {
  it("aucun adaptateur ne garde un `fetch` nu en reserve", () => {
    const fautifs: string[] = [];
    for (const { nom, contenu } of sources()) {
      if (DISPENSES.has(nom)) continue;
      /* Le motif vise l'AFFECTATION du fetch de l'adaptateur — c'est la que
         le choix se fait. Un `fetch(` d'appel est deja borne si le champ
         l'est. */
      const affectations = contenu.match(/#fetch\s*=\s*[^;]+;/g) ?? [];
      for (const a of affectations) {
        if (!a.includes("fetchBorne")) fautifs.push(`${nom} : ${a.trim()}`);
      }
    }
    expect(fautifs).toEqual([]);
  });

  it("le client de stockage porte un delai et un plafond de tentatives", () => {
    const s3 = readFileSync(join(ADAPTATEURS, "storage-s3.ts"), "utf8");
    /* Le SDK v3 attend indefiniment par defaut : sans ces deux lignes, un
       `put` vers un stockage muet pend pour toujours. */
    expect(s3).toMatch(/requestTimeout:\s*DELAI_RESEAU_MS/);
    expect(s3).toMatch(/connectionTimeout:\s*DELAI_CONNEXION_MS/);
    expect(s3).toMatch(/maxAttempts:\s*\d+/);
  });

  it("les trois canaux du code de connexion sont bornes — c'est la porte d'entree", () => {
    /* Une vendeuse qui ne recoit pas son code ne peut RIEN faire d'autre.
       C'est le chemin ou une attente infinie coute le plus cher. */
    for (const canal of ["sms-mboa.ts", "sms-orange.ts", "sms-whatsapp.ts"]) {
      const contenu = readFileSync(join(ADAPTATEURS, canal), "utf8");
      expect(contenu, canal).toMatch(/#fetch\s*=\s*fetchBorne\(/);
    }
  });

  it("chaque dispense porte sa raison, ecrite", () => {
    /* Une dispense sans motif redevient un oubli au bout de trois mois. */
    for (const [nom, raison] of DISPENSES) {
      expect(raison.length, nom).toBeGreaterThan(30);
    }
  });
});
