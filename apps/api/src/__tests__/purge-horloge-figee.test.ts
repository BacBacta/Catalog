import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Le piege de l'horloge figee — ADR 0099.
 *
 * `traiterLivraisonBot` se termine par une purge GLOBALE et DATEE de
 * `bot_message_vu` : elle efface tout ce qui remonte a plus de trois jours de
 * l'horloge de CET appel. En production c'est sans danger — une seule horloge,
 * le temps reel. En test, un fichier qui epingle son horloge dans le passe se
 * fait raser ses lignes par n'importe quel autre fichier joue en parallele.
 *
 * Le defaut a coute cinq jours d'intermittence et un deploiement bloque : le
 * rouge tombait sur `bot-idempotence.test.ts` et accusait le produit, alors que
 * seule l'horloge du TEST etait en cause.
 *
 * ── Ce que ce garde tient, et ce qu'il ne tient pas ───────────────────────
 *
 * Il ne peut pas deviner quel fichier ASSERTE sur `bot_message_vu` — c'est ce
 * qui fait mal, et ca ne se lit pas dans une expression reguliere. Il tient la
 * regle plus simple, et suffisante : **un fichier qui lit ou ecrit cette table
 * ne prend pas son horloge dans le passe.** Les six autres fichiers a horloge
 * figee ne la touchent pas et ne sont donc pas concernes.
 *
 * S'il rougit un jour, la correction est d'une ligne : `new Date()` au lieu
 * d'une date litterale. Ce n'est pas une contrainte de style — c'est la seule
 * facon de ne pas dependre de l'ordre dans lequel Vitest distribue ses
 * fichiers.
 */

const ICI = dirname(fileURLToPath(import.meta.url));

const fichiers = readdirSync(ICI)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => ({ nom: f, source: readFileSync(join(ICI, f), "utf8") }));

describe("aucun test qui touche `bot_message_vu` ne fige son horloge dans le passe", () => {
  it("trouve bien les fichiers de tests", () => {
    /* Un chemin casse ferait passer l'assertion suivante sur une liste vide,
       et le test le plus dangereux est celui qui ne teste rien. */
    expect(fichiers.length).toBeGreaterThan(20);
  });

  it("les fichiers concernes prennent leur horloge au present", () => {
    const fautifs = fichiers
      .filter((f) => f.source.includes("botMessageVu"))
      /* Une date LITTERALE passee en horloge. `new Date()` sans argument, lui,
         est exactement ce qu'on demande. */
      .filter((f) => /new Date\("\d{4}-\d{2}-\d{2}/.test(f.source))
      .map((f) => f.nom);

    expect(
      fautifs,
      `horloge figee dans un fichier qui touche bot_message_vu : ${fautifs.join(", ")} — ` +
        "la purge de `traiterLivraisonBot` est globale et datee, un autre fichier " +
        "joue en parallele effacera ces lignes. Prendre `new Date()`.",
    ).toEqual([]);
  });
});
