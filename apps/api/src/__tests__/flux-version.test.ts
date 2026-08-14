import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Les cinq formulaires declarent LA MEME version de Flow JSON, et le brouillon
 * de mesure declare celle-la aussi.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * La version est recopiee dans SIX endroits — les cinq definitions de `docs/`
 * et le brouillon jetable de `flux.mjs` — et rien ne les tenait ensemble.
 * Releve le 13/08/2026 : `flux-ouverture.json`, ecrit ce jour-la, declarait
 * deja 7.0 alors que la version courante annoncee est 7.3. Une version se
 * recopie sans qu'on la choisisse.
 *
 * ── Ce que ce test NE dit PAS ─────────────────────────────────────────────
 *
 * Il ne dit pas que la version est a jour. Il ne le peut pas : le tableau des
 * versions vit dans le journal des changements de Meta, **inatteignable depuis
 * nos environnements** (HTTP 500 reproductible, six tentatives, quatre formes
 * d'URL ; l'archive web est bloquee). Ce test tient la seule propriete
 * verifiable ici — la PARITE —, et laisse la question « a jour ? » a la mesure.
 *
 * ── Pourquoi la parite suffit a rendre le service ─────────────────────────
 *
 * Une version de Flow JSON passe par trois etats : *Active*, *Frozen* (plus de
 * nouveaux Flows, les existants marchent), puis **Expired — les Flows associes
 * CESSENT DE FONCTIONNER**. Meta annonce 90 jours avant chaque palier.
 *
 * Le jour ou il faut monter de version, la parite fait que c'est UNE decision
 * et six edits qui echouent tant qu'ils ne sont pas tous faits — au lieu de
 * cinq formulaires qui derivent chacun de leur cote, dont un seul casse, et
 * dont la casse est SILENCIEUSE : un Flow qui ne s'ouvre pas laisse la question
 * en place (ADR 0063). Personne ne le verrait dans une erreur.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DOCS = join(RACINE, "docs");

const definitions = readdirSync(DOCS)
  .filter((f) => /^flux-.*\.json$/.test(f))
  .map((f) => ({ nom: f, version: JSON.parse(readFileSync(join(DOCS, f), "utf8")).version }));

describe("la version de Flow JSON est UNE decision, pas cinq recopies", () => {
  it("trouve bien les six definitions", () => {
    /* Sans ce garde, un chemin casse ferait passer les tests suivants sur une
       liste vide — et le test le plus dangereux est celui qui ne teste rien. */
    expect(definitions.map((d) => d.nom).sort()).toEqual([
      "flux-article.json",
      "flux-avis.json",
      "flux-comptoir.json",
      "flux-inscription.json",
      "flux-livraison.json",
      "flux-ouverture.json",
    ]);
  });

  it("chaque definition DECLARE une version", () => {
    /* Une definition sans version se depose sans erreur et prend un defaut que
       nous n'avons pas choisi. */
    for (const d of definitions) {
      expect(d.version, `${d.nom} ne declare aucune version`).toMatch(/^\d+\.\d+$/);
    }
  });

  it("les six declarent la MEME version", () => {
    const versions = [...new Set(definitions.map((d) => d.version))];
    expect(
      versions,
      `versions divergentes : ${definitions.map((d) => `${d.nom}=${d.version}`).join(", ")} — ` +
        "monter de version est une decision, elle se prend pour les cinq ou pour aucun",
    ).toHaveLength(1);
  });

  it("le brouillon de mesure de `flux.mjs` declare la version que nous DEPLOYONS", () => {
    /**
     * `--mesurer-photopicker` fabrique un formulaire jetable pour lire ce que
     * Meta accepte. S'il ne declare pas la version de nos vrais formulaires, il
     * mesure autre chose que ce que nous expedions — et son verdict ne vaut
     * rien pour nous.
     *
     * `--mesurer-composants`, lui, prend sa version en ARGUMENT : c'est voulu,
     * il sert justement a sonder une version qu'on n'a pas encore adoptee.
     */
    const script = readFileSync(join(RACINE, "apps/api/scripts/flux.mjs"), "utf8");
    const deployee = definitions[0]?.version;
    const sondes = [...script.matchAll(/^\s*version:\s*"(\d+\.\d+)"/gm)].map((m) => m[1]);
    expect(sondes.length, "aucune version litterale trouvee dans flux.mjs").toBeGreaterThan(0);
    for (const v of sondes) {
      expect(v, "le brouillon de mesure doit declarer la version deployee").toBe(deployee);
    }
  });

  it("tout mode de `flux.mjs` est joignable depuis le workflow", () => {
    /**
     * Les secrets du bot vivent dans la machine Fly, et `depots-meta.yml` est
     * le SEUL chemin qui les atteint. Un mode present dans le script mais
     * absent du menu du workflow n'existe donc pas : il est ecrit, teste
     * peut-etre, et injoignable — le genre d'outil qu'on croit avoir le jour
     * ou l'on en a besoin.
     *
     * Le cas s'est presente avec `--verifier` (14/08) : le seul moyen de
     * savoir si Meta sert bien ce qu'on a depose, et il aurait pu rester dans
     * le fichier sans jamais pouvoir tourner.
     */
    const script = readFileSync(join(RACINE, "apps/api/scripts/flux.mjs"), "utf8");
    const wf = readFileSync(join(RACINE, ".github/workflows/depots-meta.yml"), "utf8");

    const modes = [...script.matchAll(/mode === "(--[a-z-]+)"/g)]
      .map((m) => m[1])
      .filter((m): m is string => m !== undefined);
    expect(modes.length, "aucun mode trouve dans flux.mjs").toBeGreaterThan(0);

    /* `--voir` est le defaut hors ligne : il ne parle a personne et n'a rien a
       faire dans un menu de depot. Tous les autres touchent Meta. */
    const injoignables = modes.filter((m) => m !== "--voir" && !wf.includes(m));
    expect(
      injoignables,
      `modes absents de depots-meta.yml : ${injoignables.join(", ")} — ` +
        "un mode qui ne figure pas au menu ne peut pas etre execute",
    ).toEqual([]);
  });
});
