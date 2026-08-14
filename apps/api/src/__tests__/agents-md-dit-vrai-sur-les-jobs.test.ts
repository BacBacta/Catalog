import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `AGENTS.md` dit-il vrai sur les files pg-boss ? — constat C-003.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * Le §3 d'`AGENTS.md` a affirme pendant des mois que pg-boss servait aux
 * « relances d'expiration de commande, rappels de solde, travaux de
 * maintenance ». **Les trois etaient faux.** Il n'a jamais monte que deux
 * files, et aucune ne fait rien de tout cela.
 *
 * Ce n'est pas l'erreur qui coute, c'est sa DUREE. `AGENTS.md` est lu au debut
 * de chaque session et prime sur toute habitude : une session qui y lit que
 * l'expiration tourne ne va pas verifier. Le defaut s'est donc transmis de
 * session en session, protege par sa propre documentation, jusqu'a ce qu'un
 * audit le trouve — des mois plus tard.
 *
 * Corriger la phrase ne suffisait pas : rien n'aurait empeche la derive
 * suivante. Ce test compare le TEXTE au CODE.
 *
 * ── Ce qu'il verifie, et dans les DEUX sens ───────────────────────────────
 *
 * 1. toute file montee par le code est nommee dans `AGENTS.md` — sinon la
 *    documentation est en retard ;
 * 2. `AGENTS.md` ne nomme aucune file qui n'existe pas — c'est CE sens-la qui
 *    a manque, et c'est celui qui fait croire a un comportement absent.
 *
 * Il ne verifie pas ce que les files FONT : une prose ne se compare pas a un
 * comportement. Il tient ce qui se tient — les noms — et c'est deja ce qui
 * aurait suffi a voir C-003 le premier jour.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const JOBS = join(RACINE, "apps/api/src/jobs");

/** Les noms de files, tels que le code les declare. */
const filesDuCode = readdirSync(JOBS)
  .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
  .flatMap((f) => [...readFileSync(join(JOBS, f), "utf8").matchAll(/"(bot-[a-z-]+)"/g)])
  .map((m) => m[1])
  .filter((n): n is string => n !== undefined);

const agents = readFileSync(join(RACINE, "AGENTS.md"), "utf8");

describe("AGENTS.md dit vrai sur les files pg-boss", () => {
  it("trouve bien des files dans le code", () => {
    /* Un chemin casse rendrait les deux assertions suivantes vertes sur une
       liste vide — le test le plus dangereux est celui qui ne teste rien. */
    expect(new Set(filesDuCode).size).toBeGreaterThan(0);
  });

  it("toute file montee par le code est nommee dans AGENTS.md", () => {
    const absentes = [...new Set(filesDuCode)].filter((n) => !agents.includes(n));
    expect(
      absentes,
      `files montees mais absentes d'AGENTS.md : ${absentes.join(", ")} — ` +
        "le contrat de travail est lu au debut de chaque session, il doit etre a jour",
    ).toEqual([]);
  });

  it("AGENTS.md ne nomme AUCUNE file qui n'existe pas", () => {
    /* Le sens qui a manque. Une file citee et absente fait croire a un
       comportement que le code n'a pas — c'est exactement C-003. */
    const citees = [...agents.matchAll(/`(bot-[a-z-]+)`/g)]
      .map((m) => m[1])
      .filter((n): n is string => n !== undefined);
    const inventees = [...new Set(citees)].filter((n) => !filesDuCode.includes(n));
    expect(
      inventees,
      `files citees par AGENTS.md et montees par personne : ${inventees.join(", ")} — ` +
        "une documentation qui promet un job absent le rend indetectable",
    ).toEqual([]);
  });

  it("AGENTS.md ne promet plus l'expiration des commandes comme un job", () => {
    /**
     * La phrase exacte qui a porte le defaut. Elle ne doit pas revenir tant que
     * `expiration.ts` n'est appele par personne — et le jour ou il le sera, ce
     * test rougira, ce qui est le bon moment pour reecrire la phrase.
     */
    const branchee = readdirSync(JOBS)
      .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
      .some((f) => /doitExpirer|etatExpiration/.test(readFileSync(join(JOBS, f), "utf8")));
    const promise = /relances? d'expiration de commande/i.test(agents);
    expect(
      promise,
      branchee
        ? "l'expiration est branchee : AGENTS.md peut — et doit — le dire"
        : "AGENTS.md promet des relances d'expiration que personne ne monte (C-003, ADR 0101)",
    ).toBe(branchee);
  });
});
