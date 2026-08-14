import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * La copie dit « vendeur/se », « client/e », « acheteur/se » — jamais le
 * féminin seul. ADR 0108.
 *
 * ── Pourquoi une garde, et pas seulement une relecture ────────────────────
 *
 * Le produit s'est écrit au féminin pendant tout son développement : c'est
 * son public d'abord visé, et les ADR 0001 à 0107 gardent ce mot — un ADR ne
 * se réécrit pas. Mais la COPIE, elle, s'adresse à quiconque vend et à
 * quiconque achète, et le porteur du produit l'a tranché le 14/08/2026.
 *
 * Une décision de copie sans garde se défait au premier message ajouté : la
 * prochaine phrase écrite reprendra « la vendeuse », parce que c'est ce que
 * les soixante voisines disaient. Ce test lit les SOURCES et attrape la
 * récidive à l'écriture.
 *
 * ── Pourquoi il PARCOURT au lieu d'énumérer ───────────────────────────────
 *
 * Le premier jet tenait une liste de huit fichiers du bot. Une liste ne
 * protège que ce qu'elle nomme : les trente-huit phrases de l'app vendeur/se
 * et de la boutique publique étaient hors garde sans que rien ne le dise, et
 * un écran ajouté demain y échapperait pareillement. La garde parcourt donc
 * les arbres entiers — ce qui est ajouté est couvert d'office.
 *
 * ── Ce qu'il ne regarde pas ───────────────────────────────────────────────
 *
 * Les IDENTIFIANTS de code — le fil `"vendeuse"`, le module
 * `comptoir-vendeuse.ts`, `EtatVendeuse`, la route `/api/vendeuse/moi` —
 * restent tels quels. Même règle que `catalogue` dans AGENTS.md §1 : le nom
 * commun du code n'est pas la copie, et les renommer coûterait un diff
 * illisible pour zéro gain lisible. C'est `EST_UNE_PHRASE` qui fait le tri.
 */

/* La garde vit dans `apps/api` — le seul paquet dont la suite tourne à chaque
   `pnpm test` — mais elle regarde le dépôt entier : la copie ne s'arrête pas
   à la frontière d'une application. */
const RACINE = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Les arbres qui portent de la copie sortante. */
const ARBRES = [
  "apps/api/src",
  "apps/seller/src",
  "apps/shop/src",
  "apps/site/src",
  "packages/ui/src",
  "packages/contracts/src",
  "packages/db/prisma",
];

/** Les mots qui DÉSIGNENT une personne au féminin seul. */
const AU_FEMININ_SEUL = /\b(vendeuse|vendeuses|cliente|clientes|acheteuse|acheteuses)\b/i;

/**
 * Le doublet explicite est la forme la PLUS inclusive, pas une infraction.
 * « les vendeuses et vendeurs camerounais » nomme les deux ; la garde le
 * neutralise avant de chercher, sinon elle rejetterait ce qu'elle demande.
 */
const DOUBLET = /vendeuses et vendeurs/gi;

/**
 * L'EXCEPTION, et elle est mesurée : ces deux textes sont des gabarits
 * **approuvés par Meta**. Les modifier ici ne changerait pas ce que Meta
 * envoie — il faudrait re-soumettre et attendre une nouvelle approbation, qui
 * peut être refusée. La copie du dépôt est un miroir de l'approuvé ; la faire
 * diverger la rendrait menteuse. Le mot bouge quand le gabarit est re-soumis,
 * pas avant.
 */
const GABARITS_APPROUVES = [
  "n'a pas encore de numéro de reversement",
  "ne reconnaît pas ce paiement",
];

/** Une chaîne de code (un identifiant, une clé) n'est pas une phrase. */
const EST_UNE_PHRASE = (s: string) => s.length > 14 && /\s/.test(s);

function fichiersDe(dossier: string, acc: string[] = []): string[] {
  for (const entree of readdirSync(join(RACINE, dossier))) {
    const relatif = `${dossier}/${entree}`;
    if (statSync(join(RACINE, relatif)).isDirectory()) {
      if (entree === "__tests__" || entree === "node_modules" || entree === "migrations") continue;
      fichiersDe(relatif, acc);
    } else if (/\.(ts|tsx|astro)$/.test(entree) && !/\.test\./.test(entree)) {
      acc.push(relatif);
    }
  }
  return acc;
}

function phrasesDe(source: string): string[] {
  const contenu = readFileSync(join(RACINE, source), "utf8");
  /* Les COMMENTAIRES sont du code, pas de la copie : le mot y raconte
     l'histoire du produit, et l'histoire ne se réécrit pas.
     Les deux motifs sont ANCRÉS EN DÉBUT DE LIGNE, et ce n'est pas un détail :
     un `//` cherché n'importe où mange la fin de `"https://…"`, ce qui laisse
     un guillemet ouvert, apparie de travers avec le suivant, et fabrique neuf
     phrases qui n'existent pas — mesuré. Un commentaire de fin de ligne est
     donc laissé en place ; il ne coûte qu'un faux positif improbable, là où
     l'inverse en coûtait neuf certains. */
  const sansCommentaires = contenu
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
    .replace(/^[ \t]*\/\/[^\n]*/gm, " ");
  const chaines = [...sansCommentaires.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`]*)`/g)].map(
    (m) => m[1] ?? m[2] ?? "",
  );
  /* Le texte JSX et Astro n'est pas entre guillemets : `<p>La vendeuse…</p>`
     est un nœud, pas une chaîne. Sans cette extraction, toute la boutique
     publique passait sous la garde. */
  const noeuds = [...sansCommentaires.matchAll(/>([^<>{}]+)</g)].map((m) => m[1] ?? "");
  return (
    [...chaines, ...noeuds]
      /* Les interpolations sont du CODE — `${etat.cliente}` est un nom de
         champ, pas un mot lu par quelqu'un. Les garder ferait rougir la garde
         sur ses propres identifiants, exactement ce qu'elle dit ne pas
         regarder. */
      .map((s) =>
        s
          .replace(/\$\{[^}]*\}/g, "…")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(EST_UNE_PHRASE)
  );
}

function toutesLesPhrases(): Array<{ source: string; phrase: string }> {
  const sortie: Array<{ source: string; phrase: string }> = [];
  for (const arbre of ARBRES) {
    for (const source of fichiersDe(arbre)) {
      for (const phrase of phrasesDe(source)) sortie.push({ source, phrase });
    }
  }
  return sortie;
}

describe("la copie sortante dit « vendeur/se » — ADR 0108", () => {
  it("trouve bien de la copie à inspecter", () => {
    /* Un chemin cassé rendrait la liste vide, et le test passerait toujours —
       le test le plus dangereux est celui qui ne teste rien. */
    expect(
      toutesLesPhrases().length,
      "aucune phrase trouvée : les arbres de copie ne sont plus là où on les cherche",
    ).toBeGreaterThan(1500);
  });

  it("aucune phrase ne désigne la personne au féminin seul", () => {
    const fautives: string[] = [];
    for (const { source, phrase } of toutesLesPhrases()) {
      if (GABARITS_APPROUVES.some((g) => phrase.includes(g))) continue;
      if (AU_FEMININ_SEUL.test(phrase.replace(DOUBLET, "…"))) {
        fautives.push(`${source} — « ${phrase.slice(0, 90)}… »`);
      }
    }
    expect(
      fautives,
      `copie au féminin seul :\n  ${fautives.join("\n  ")}\n` +
        "Écrire « vendeur/se », « client/e », « acheteur/se » — ou tourner la phrase autrement.",
    ).toEqual([]);
  });

  it("les exceptions de gabarit approuvé EXISTENT encore — sinon elles se retirent", () => {
    /**
     * Une exception qui ne protège plus rien devient un trou. Si un gabarit
     * est un jour re-soumis au féminin corrigé, ce test tombe et rappelle de
     * supprimer la dérogation ci-dessus.
     */
    const gabarits = readFileSync(join(RACINE, "apps/api/src/domain/bot/gabarits.ts"), "utf8");
    for (const approuve of GABARITS_APPROUVES) {
      expect(gabarits.includes(approuve), `gabarit approuvé introuvable : ${approuve}`).toBe(true);
    }
    expect(
      /vos clientes/.test(gabarits) && /L'acheteuse de la commande/.test(gabarits),
      "les gabarits approuvés ne portent plus le féminin seul : retirer l'exception",
    ).toBe(true);
  });
});
