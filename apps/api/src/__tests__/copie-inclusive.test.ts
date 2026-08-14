import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * La copie dit « vendeur/se », jamais « vendeuse » seul — ADR 0108.
 *
 * ── Pourquoi une garde, et pas seulement une relecture ────────────────────
 *
 * Le produit s'est écrit au féminin pendant tout son développement : c'est
 * son public d'abord visé, et les ADR 0001 à 0107 gardent ce mot — un ADR ne
 * se réécrit pas. Mais la COPIE, elle, s'adresse à quiconque vend, et le
 * porteur du produit l'a tranché le 14/08/2026.
 *
 * Une décision de copie sans garde se défait au premier message ajouté : la
 * prochaine phrase écrite reprendra « la vendeuse », parce que c'est ce que
 * les vingt-sept voisines disaient. Ce test lit les SOURCES et attrape la
 * récidive à l'écriture.
 *
 * ── Ce qu'il ne regarde pas ───────────────────────────────────────────────
 *
 * Les IDENTIFIANTS de code — le fil `"vendeuse"`, le module
 * `comptoir-vendeuse.ts`, `EtatVendeuse` — restent tels quels. Même règle que
 * `catalogue` dans AGENTS.md §1 : le nom commun du code n'est pas la copie, et
 * les renommer coûterait un diff illisible pour zéro gain lisible.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Les fichiers qui portent de la copie sortante. */
const SOURCES = [
  "src/domain/bot/textes.ts",
  "src/domain/bot/conversation.ts",
  "src/domain/bot/inscription.ts",
  "src/domain/bot/comptoir-vendeuse.ts",
  "src/domain/bot/notifications.ts",
  "src/domain/bot/pack-statut.ts",
  "src/bot-notifications.ts",
  "src/jobs/relance-acompte.ts",
];

/**
 * Les mots qui DÉSIGNENT une personne au féminin seul. « acheteuse » n'y est
 * pas : elle sera traitée au même titre quand la copie acheteuse sera relue —
 * l'annoncer ici sans le faire serait la promesse creuse que l'ADR 0103
 * interdit.
 */
const AU_FEMININ_SEUL = /\b(vendeuse|vendeuses|cliente|clientes)\b/;

/**
 * L'EXCEPTION, et elle est mesurée : ce texte est un gabarit **approuvé par
 * Meta**. Le modifier ici ne changerait pas ce que Meta envoie — il faudrait
 * re-soumettre et attendre une nouvelle approbation, qui peut être refusée.
 * La copie du dépôt est un miroir de l'approuvé ; la faire diverger la
 * rendrait menteuse. Le mot bouge quand le gabarit est re-soumis, pas avant.
 */
const GABARIT_APPROUVE = "n'a pas encore de numéro de reversement";

/** Une chaîne de code (un identifiant) n'est pas une phrase. */
const EST_UNE_PHRASE = (s: string) => s.length > 14 && /\s/.test(s);

function phrasesDe(source: string): string[] {
  const contenu = readFileSync(join(RACINE, source), "utf8");
  /* Les lignes de commentaire sont du code, pas de la copie : le mot y raconte
     l'histoire du produit, et l'histoire ne se réécrit pas. */
  const lignes = contenu
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");
  return (
    [...lignes.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`]*)`/g)]
      .map((m) => m[1] ?? m[2] ?? "")
      /* Les interpolations sont du CODE — `${etat.cliente}` est un nom de
         champ, pas un mot lu par quelqu'un. Les garder ferait rougir la garde
         sur ses propres identifiants, exactement ce qu'elle dit ne pas
         regarder. */
      .map((s) => s.replace(/\$\{[^}]*\}/g, "…"))
      .filter(EST_UNE_PHRASE)
  );
}

describe("la copie sortante dit « vendeur/se » — ADR 0108", () => {
  it("trouve bien de la copie à inspecter", () => {
    /* Un chemin cassé rendrait la liste vide, et le test passerait toujours —
       le test le plus dangereux est celui qui ne teste rien. */
    const total = SOURCES.reduce((n, s) => n + phrasesDe(s).length, 0);
    expect(total, "aucune phrase trouvée dans les sources de copie").toBeGreaterThan(150);
  });

  it("aucune phrase ne désigne la personne au féminin seul", () => {
    const fautives: string[] = [];
    for (const source of SOURCES) {
      for (const phrase of phrasesDe(source)) {
        if (phrase.includes(GABARIT_APPROUVE)) continue;
        if (AU_FEMININ_SEUL.test(phrase)) {
          fautives.push(`${source} — « ${phrase.slice(0, 80)}… »`);
        }
      }
    }
    expect(
      fautives,
      `copie au féminin seul :\n  ${fautives.join("\n  ")}\n` +
        "Écrire « vendeur/se », « client/e » — ou tourner la phrase autrement.",
    ).toEqual([]);
  });

  it("l'exception du gabarit approuvé EXISTE encore — sinon elle se retire", () => {
    /**
     * Une exception qui ne protège plus rien devient un trou. Si le gabarit
     * est un jour re-soumis au féminin corrigé, ce test tombe et rappelle de
     * supprimer la dérogation ci-dessus.
     */
    const gabarits = readFileSync(join(RACINE, "src/domain/bot/gabarits.ts"), "utf8");
    expect(
      gabarits.includes(GABARIT_APPROUVE) && /vos clientes/.test(gabarits),
      "le gabarit approuvé ne porte plus « vos clientes » : retirer l'exception",
    ).toBe(true);
  });
});
