import { describe } from "vitest";

/**
 * La porte des tests qui exigent une VRAIE base.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * Vingt-trois fichiers portaient la meme ligne, recopiee :
 *
 *     const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
 *
 * Elle est juste. Ce qui ne l'etait pas, c'est ce qu'elle produit quand la
 * variable est absente : **un tiers de la suite disparait, et le total reste
 * vert**. Mesure du 14/08/2026 — `pnpm test` rendait « 94 passed | 18 skipped »
 * sur un poste, « 112 passed » en CI, et le meme commit etait rouge la-bas et
 * vert ici. L'information etait a l'ecran ; elle n'arretait rien.
 *
 * C'est la meme forme de defaut que le sel d'execution (`_identifiants.ts`) :
 * un repli SILENCIEUX est pire que l'absence, parce qu'il rend la commande
 * menteuse. AGENTS.md §7.5 dit que la definition de terminé est une commande —
 * elle ne l'est que si elle veut dire la meme chose partout.
 *
 * ── Ce que la garde fait, et ou elle vit ──────────────────────────────────
 *
 * ICI, rien de plus qu'avant : la porte s'ouvre ou se ferme. Le bruit est dans
 * `suite-entiere.test.ts`, qui tourne TOUJOURS et rougit UNE fois, en nommant
 * combien de fichiers manquent — plutot que vingt-trois bannieres identiques
 * noyees dans la sortie.
 *
 * Tourner sans base reste possible : c'est le cas d'usage du domaine pur, qui
 * n'a besoin de rien. Mais il se DECLARE, avec `CATALOG_TESTS_SANS_BASE=1`.
 * On ne perd pas la commodite, on perd seulement le silence.
 */

export const VARIABLE_BASE = "DATABASE_URL";
export const VARIABLE_SANS_BASE = "CATALOG_TESTS_SANS_BASE";

/** Une base est joignable — au sens « une URL est posee », pas « elle repond ». */
export function baseDisponible(): boolean {
  return Boolean(process.env[VARIABLE_BASE]?.trim());
}

/** Quelqu'un a DIT qu'il tournait sans base. Le saut devient alors un choix. */
export function sansBaseAssume(): boolean {
  return Boolean(process.env[VARIABLE_SANS_BASE]?.trim());
}

/**
 * `describe` quand la base est la, `describe.skip` sinon.
 *
 * A importer plutot qu'a reecrire : un fichier qui refabrique la ligne
 * echapperait au decompte de `suite-entiere.test.ts`, et un test qui ne compte
 * pas tout ne compte rien. Un test le verifie.
 */
/**
 * Le type est ANNOTE, et reduit a la seule forme d'appel employee.
 *
 * Deux raisons, decouvertes dans cet ordre :
 *
 * - infere, il exporte des types internes de `@vitest/runner` que TypeScript ne
 *   sait pas nommer depuis un module (TS4023) ;
 * - annote `typeof describe`, il ne compile pas non plus : `describe.skip` est
 *   un `ChainableSuiteAPI` sans `skipIf` ni `runIf`, donc les deux branches
 *   n'ont PAS le meme type. Ce qu'elles partagent, c'est l'appel.
 *
 * Le reduire n'est pas un pis-aller : `describeDb.each` ou `.concurrent` sur
 * une suite qui parle a la base n'aurait pas de sens ici, et ce type le dit.
 */
type PorteSuite = (nom: string, corps: () => void) => void;

export const describeDb: PorteSuite = baseDisponible() ? describe : describe.skip;
