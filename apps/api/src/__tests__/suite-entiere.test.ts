import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { baseDisponible, sansBaseAssume, VARIABLE_BASE, VARIABLE_SANS_BASE } from "./_base.ts";

/**
 * Une suite amputee ne doit pas pouvoir passer pour une suite verte.
 *
 * ── Ce qui est arrive, le 14/08/2026 ──────────────────────────────────────
 *
 * `pnpm test` a rendu « 94 passed | 18 skipped » sur un poste et « 112 passed »
 * en CI, sur LE MEME commit. Le poste disait vert, la CI disait rouge, et les
 * deux avaient raison : sans `DATABASE_URL`, vingt-trois fichiers se sautent.
 * Le chiffre des sauts etait a l'ecran ; il n'arretait rien, et la chaine de
 * verification a ete annoncee complete deux fois de suite alors qu'il lui
 * manquait 231 tests.
 *
 * ── Pourquoi ce test, et pas une banniere par fichier ─────────────────────
 *
 * Vingt-trois avertissements identiques dans une sortie de test, personne ne
 * les lit — c'est la meme raison qui fait qu'on n'a pas lu « 18 skipped ». Un
 * ECHEC unique, qui nomme le compte et les deux sorties, arrete la commande.
 *
 * ── Pourquoi tourner sans base reste possible ─────────────────────────────
 *
 * Le domaine est pur : il n'a besoin ni de base ni de reseau, et pouvoir le
 * jouer seul est utile. Ce qui change, c'est que ce choix se DIT — la commodite
 * reste, le silence part. Meme regle que le sel d'execution : un repli
 * silencieux est pire que le defaut qu'il masque.
 */

const ICI = dirname(fileURLToPath(import.meta.url));

/* Les fichiers qui passent par la porte partagee. On les compte a la lecture
   plutot que de tenir une liste : une liste se perime au premier ajout. */
const parLaPorte = readdirSync(ICI)
  .filter((f) => f.endsWith(".test.ts"))
  .filter((f) =>
    /import \{ describeDb \} from "\.\/_base\.ts";/.test(readFileSync(join(ICI, f), "utf8")),
  );

describe("la suite est entiere, ou elle le dit", () => {
  it("trouve bien les fichiers qui exigent une base", () => {
    /* Sans ce garde, un chemin casse rendrait la liste vide et le test suivant
       passerait toujours — le test le plus dangereux est celui qui ne teste
       rien (meme lecon que `flux-version.test.ts`). */
    expect(parLaPorte.length, "aucun fichier n'importe `describeDb`").toBeGreaterThan(15);
  });

  it("aucun fichier ne refabrique la porte dans son coin", () => {
    /**
     * La ligne `URL ? describe : describe.skip` etait recopiee vingt-trois
     * fois. Un fichier qui la refabrique echapperait au decompte ci-dessus :
     * il se sauterait sans que personne ne le compte, et cette garde
     * mesurerait une suite plus petite qu'elle ne croit.
     */
    const coupables = readdirSync(ICI)
      .filter((f) => f.endsWith(".test.ts") && f !== "suite-entiere.test.ts")
      .filter((f) => /describe\.skip/.test(readFileSync(join(ICI, f), "utf8")));
    expect(
      coupables,
      `fichiers qui fabriquent leur propre porte : ${coupables.join(", ")} — ` +
        "importer `describeDb` de `./_base.ts`, sinon ils sortent du decompte",
    ).toEqual([]);
  });

  it("sans base, la commande REFUSE de passer pour verte", () => {
    if (baseDisponible()) return;
    /* Le message est le livrable de ce test : il doit suffire a agir, sans
       aller lire ce fichier. */
    expect(
      sansBaseAssume(),
      `\n\n  ${VARIABLE_BASE} est absente : ${parLaPorte.length} fichiers de test sont SAUTES.\n` +
        "  La suite n'est pas celle que joue l'integration continue, et son total\n" +
        "  ne veut donc rien dire — c'est ce qui a fait passer un commit rouge\n" +
        "  pour vert le 14/08/2026.\n\n" +
        "  Deux sorties :\n" +
        `    · poser une base   export ${VARIABLE_BASE}="postgresql://…" && pnpm db:migrate\n` +
        `    · l'assumer        export ${VARIABLE_SANS_BASE}=1  (le domaine pur suffit)\n`,
    ).toBe(true);
  });

  it("avec une base, rien n'est saute — le total est le vrai", () => {
    if (!baseDisponible()) return;
    /* L'autre moitie de la bascule : quand la base est la, `CATALOG_TESTS_SANS_BASE`
       n'a aucun effet et ne doit pas donner l'illusion d'en avoir un. */
    expect(parLaPorte.length).toBeGreaterThan(15);
  });
});
