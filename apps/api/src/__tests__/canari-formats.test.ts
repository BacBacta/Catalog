import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyserSms, PATTERNS } from "../domain/proof/motifs.ts";
import * as FIXTURES from "./fixtures-sms.ts";

/**
 * **Le canari de formats.** Il rejoue la specification, pas les fixtures.
 *
 * ── Ce qu'il attrape, et que rien d'autre n'attrape ────────────────────────
 *
 * `sms-motifs.test.ts` verifie que les analyseurs font ce qu'on attend d'eux.
 * Ce fichier-ci verifie autre chose : que **le code et la specification disent
 * encore la meme chose**. Ce sont deux proprietes distinctes, et la seconde se
 * perd en silence.
 *
 * Le scenario qu'il previent est banal : quelqu'un « nettoie » une expression
 * reguliere, adapte les fixtures pour que la suite repasse au vert, et ne
 * touche pas a `docs/formats-sms-operateurs.md`. Tout est vert. La
 * specification — qui est la SOURCE, AGENTS.md §7.4 — decrit desormais un
 * produit qui n'existe plus, et la prochaine personne qui la lira ecrira du
 * code faux en toute bonne foi.
 *
 * Ce test lit donc le fichier de specification, en extrait les messages tels
 * qu'ils y sont ecrits, et les fait passer par les analyseurs reels.
 *
 * ── Pourquoi il tourne aussi en CI QUOTIDIENNE ─────────────────────────────
 *
 * Sur une reunion de branche, il tourne comme les autres. Le programme
 * quotidien sert a autre chose : il rejoue les formats **sans qu'aucun commit
 * ait eu lieu**. Le jour ou un operateur changera son format, ce test-ci ne
 * cassera pas — c'est la production qui cassera, et le compteur
 * `catalog.preuve.controle{controle=1}` basculera. Le canari quotidien est le
 * repere fixe a cote duquel on lit cette bascule : il prouve que les motifs du
 * depot n'ont pas bouge, donc que le changement vient de l'OPERATEUR.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CHEMIN_SPEC = join(RACINE, "docs/formats-sms-operateurs.md");
const SPEC = readFileSync(CHEMIN_SPEC, "utf8");

/**
 * Les messages de la specification — tout bloc de code clos qui ressemble a un
 * SMS d'operateur.
 *
 * Les blocs de la spec contiennent aussi du TypeScript et des expressions
 * regulieres ; on ne garde que ceux d'une seule ligne, sans caractere de code.
 * Un bloc de motif regulier commence par `/` ou contient `=>`.
 */
function messagesDeLaSpec(): string[] {
  const blocs = [...SPEC.matchAll(/```(?:\w+)?\n([\s\S]*?)```/g)].map((m) => (m[1] ?? "").trim());
  return blocs.filter(
    (b) =>
      !b.includes("\n") &&
      b.length > 20 &&
      !b.includes("=>") &&
      !b.startsWith("/") &&
      !b.startsWith("export") &&
      !b.startsWith("const"),
  );
}

const MESSAGES = messagesDeLaSpec();

/** Le seul message que la spec designe comme NON reconnaissable (§6). */
const TRONQUE = "You have received 650 FCFA of…";

describe("canari de formats — la specification et le code disent la meme chose", () => {
  it("trouve bien des messages a rejouer", () => {
    // Sans ce garde, un changement de mise en forme du fichier viderait la
    // liste et tous les tests suivants passeraient sur zero message. Le test le
    // plus dangereux est celui qui ne teste rien.
    expect(MESSAGES.length, `messages extraits de ${CHEMIN_SPEC}`).toBeGreaterThanOrEqual(5);
    expect(MESSAGES.some((m) => m.startsWith("Vous avez recu"))).toBe(true);
    expect(MESSAGES.some((m) => m.startsWith("Rechargement reussi"))).toBe(true);
  });

  /**
   * Le coeur du canari. Chaque message ECRIT DANS LA SPEC doit encore etre
   * reconnu par le code. Si un motif est resserre sans que la spec le suive,
   * c'est ici que ca casse — avec le message fautif dans le rapport d'echec.
   */
  it("chaque message de la specification est encore reconnu", () => {
    const perdus: string[] = [];
    for (const message of MESSAGES) {
      if (message.startsWith(TRONQUE.slice(0, 20))) continue;
      const r = analyserSms(message);
      if (!r.reconnu) perdus.push(`${r.raison} ← ${message.slice(0, 70)}…`);
    }
    expect(
      perdus,
      "un motif a ete modifie sans que docs/formats-sms-operateurs.md suive :\n" +
        perdus.join("\n"),
    ).toEqual([]);
  });

  /**
   * L'inverse, et il compte autant : la troncature ne doit PAS passer. Un motif
   * elargi « pour etre tolerant » accepterait un debut de message et laisserait
   * entrer un paiement sans identifiant.
   */
  it("le message tronque de la specification reste refuse", () => {
    const r = analyserSms(TRONQUE);
    expect(r.reconnu, "un motif s'est elargi jusqu'a accepter une troncature").toBe(false);
  });

  it("aucun montant analyse n'est un flottant", () => {
    for (const message of MESSAGES) {
      const r = analyserSms(message);
      if (!r.reconnu) continue;
      expect(
        Number.isInteger(r.sms.amountXaf),
        `${message.slice(0, 50)} → ${r.sms.amountXaf}`,
      ).toBe(true);
    }
  });

  /* ────────────────────────── les motifs eux-memes ────────────────────────── */

  const citesDansLaSpec = new Set(
    [...SPEC.matchAll(/`((?:mtn|om)\.[a-z.]+)`/g)].map((m) => m[1] as string),
  );

  it("tout motif du code est documente dans la specification", () => {
    const absents = PATTERNS.map((p) => p.id).filter((id) => !citesDansLaSpec.has(id));
    expect(
      absents,
      `motif(s) ajoute(s) sans passer par la specification : ${absents.join(", ")}`,
    ).toEqual([]);
  });

  it("tout motif cite dans la specification existe dans le code", () => {
    const connus = new Set(PATTERNS.map((p) => p.id));
    const fantomes = [...citesDansLaSpec].filter((id) => !connus.has(id));
    expect(
      fantomes,
      `la specification decrit un motif que le code n'a pas : ${fantomes.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * Le drapeau `aConfirmer` est une PROMESSE faite dans l'interface : tant qu'il
   * est pose, le verdict est plafonne a « accepte sous reserve ». Le retirer du
   * code sans que le terrain ait confirme le format ferait passer une hypothese
   * pour un fait.
   */
  it("le motif Orange de reception reste marque « a confirmer »", () => {
    const om = PATTERNS.find((p) => p.id === "om.entrant");
    expect(om, "le motif om.entrant a disparu").toBeDefined();
    expect(
      om?.aConfirmer,
      "om.entrant n'est plus « a confirmer » : le SMS Orange de reception a-t-il ete " +
        "confirme sur le terrain ? Si oui, mettre a jour docs/formats-sms-operateurs.md §7 " +
        "et AGENTS.md §10 dans le meme commit.",
    ).toBe(true);
    expect(SPEC).toContain("aConfirmer");
  });

  /* ────────────────────────── les fixtures en decoulent ────────────────────────── */

  /**
   * Les fixtures ne sont pas une seconde source : §6 de la specification dit
   * qu'elles en decoulent. Une fixture qui ne figure plus dans la spec est une
   * fixture qu'on a modifiee pour faire passer un test.
   */
  it("chaque fixture de SMS est recopiee de la specification, mot pour mot", () => {
    /**
     * Une fixture DERIVEE est construite par le fichier lui-meme, a partir d'un
     * texte de la spec — identifiant impossible, minuscules, espaces insecables.
     * Elle ne figure evidemment pas telle quelle dans la specification.
     *
     * On les reconnait a leur CONSTRUCTION et non a leur nom : une liste de noms
     * a exclure se perime a la premiere fixture ajoutee, et se perime en
     * silence — dans le sens permissif.
     */
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "fixtures-sms.ts"),
      "utf8",
    );
    const derivee = (nom: string) => {
      const i = source.indexOf(`export const ${nom} =`);
      if (i < 0) return false;
      const j = source.indexOf("export const ", i + 10);
      return source.slice(i, j < 0 ? undefined : j).includes(".replace(");
    };

    const inventees: string[] = [];
    for (const [nom, valeur] of Object.entries(FIXTURES)) {
      if (typeof valeur !== "string" || valeur.length < 40) continue;
      if (derivee(nom)) continue;
      /**
       * Une fixture qu'AUCUN motif ne reconnait ne pretend pas etre un SMS
       * d'operateur : c'est un CONTRE-EXEMPLE — du texte tape a la main, une
       * troncature. La specification les decrit en §6 sans les reproduire, et
       * exiger qu'ils y figurent mot pour mot n'aurait pas de sens.
       */
      if (!analyserSms(valeur).reconnu) continue;
      if (!SPEC.includes(valeur)) inventees.push(nom);
    }
    expect(
      inventees,
      "fixture(s) absente(s) de docs/formats-sms-operateurs.md — la spec est la source " +
        `(AGENTS.md §7.4) : ${inventees.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * La note de confidentialite n'est pas decorative : c'est elle qui interdit de
   * committer un SMS reel non pseudonymise. La retirer du fichier retirerait la
   * regle.
   */
  it("la specification porte toujours sa note de confidentialite", () => {
    expect(SPEC).toMatch(/## Note de confidentialit/);
  });
});
