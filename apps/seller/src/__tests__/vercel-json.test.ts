import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Ou vit `vercel.json`, et pourquoi ce n'est pas une question de rangement.
 *
 * Mesure du 11/08/2026, sur un deploiement reel : Vercel lit sa configuration a
 * la racine du repertoire qu'on lui DEPLOIE, et ce repertoire depend du chemin.
 *
 * | chemin                        | racine lue     |
 * |-------------------------------|----------------|
 * | `cd dist && vercel deploy`    | `dist/`        |
 * | construction depuis git       | `apps/seller/` |
 *
 * Le fichier a longtemps vecu dans `public/`, d'ou Vite le recopie dans
 * `dist/` : correct pour le premier chemin, invisible pour le second. Le jour
 * ou le projet a ete relie au depot, l'application s'est deployee SANS son
 * proxy `/api/*`, sans repli SPA et sans en-tetes — et sans la moindre erreur
 * de construction. Symptomes constates : `/commandes` en 404, `/api/rampe` en
 * 404, aucun en-tete de securite.
 *
 * Ce que ce fichier coute quand il manque n'est pas cosmetique : le renvoi
 * `/api/*` est ce qui garde le cookie de session de MEME ORIGINE. Sans lui, le
 * cookie devient tiers et les navigateurs mobiles le jettent — la vendeuse est
 * deconnectee a chaque ouverture, sans message qui l'explique.
 */

const APP = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("vercel.json arrive aux deux racines possibles", () => {
  it("est un fichier SOURCE, a la racine de l'app", () => {
    // C'est cette copie-la que lit une construction depuis git.
    expect(existsSync(join(APP, "vercel.json"))).toBe(true);
  });

  it("n'est PLUS dans public/ — une seule source, pas deux qui divergent", () => {
    // Le remettre ici le ferait disparaitre de la racine, donc du chemin git,
    // en ne cassant rien de visible : la regression se verrait en production.
    expect(existsSync(join(APP, "public/vercel.json"))).toBe(false);
  });

  it("porte le renvoi /api/* AVANT le repli SPA", () => {
    /* L'ordre n'est pas un detail : le repli `/:chemin*` attrape tout. Place
       en premier, il avalerait les appels d'API et renverrait la coquille HTML
       a la place du JSON. */
    const conf = JSON.parse(readFileSync(join(APP, "vercel.json"), "utf8")) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    const api = conf.rewrites.findIndex((r) => r.source.startsWith("/api"));
    const spa = conf.rewrites.findIndex((r) => r.destination === "/index.html");
    expect(api, "aucun renvoi /api/*").toBeGreaterThanOrEqual(0);
    expect(spa, "aucun repli SPA").toBeGreaterThanOrEqual(0);
    expect(api).toBeLessThan(spa);
  });

  it("est recopie a l'identique dans dist/, pour l'autre chemin", () => {
    // Se declare ignore sans `dist/` : `vitest` seul n'a pas construit.
    if (!existsSync(join(APP, "dist"))) return;
    expect(existsSync(join(APP, "dist/vercel.json"))).toBe(true);
    expect(readFileSync(join(APP, "dist/vercel.json"), "utf8")).toBe(
      readFileSync(join(APP, "vercel.json"), "utf8"),
    );
  });
});
