import { cheminsDePaiement, type RampeConfig } from "@catalog/contracts/ussd";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { RAMPE_DEFAUT, rampeDepuisEnv } from "../domain/ramp/config.ts";
import { rampeRoutes } from "../routes/rampe.ts";

/**
 * `GET /api/rampe`.
 *
 * Aucune base : la route ne fait que servir une configuration deja construite.
 * Ce qu'on verifie ici, c'est qu'elle est atteignable **sans session** — c'est
 * une acheteuse qui la lit, depuis la boutique statique, avant toute notion de
 * compte — et que ce qu'elle rend est utilisable tel quel.
 */

const app = new Hono().route("/api/rampe", rampeRoutes(rampeDepuisEnv({})));

describe("GET /api/rampe", () => {
  it("repond sans authentification", async () => {
    const r = await app.request("/api/rampe");
    expect(r.status).toBe(200);
  });

  it("rend la configuration effective", async () => {
    const r = await app.request("/api/rampe");
    const config = (await r.json()) as RampeConfig;
    expect(config).toEqual(RAMPE_DEFAUT);
  });

  it("la reponse suffit a construire les chaines dans le navigateur", async () => {
    // La boutique ne connait aucun code : tout ce qu'elle compose vient de la.
    const config = (await (await app.request("/api/rampe")).json()) as RampeConfig;
    for (const op of config.operateurs) {
      const chemins = cheminsDePaiement(op, { numero: "677123456", montantXaf: 7500 });
      expect(chemins.length, op.id).toBeGreaterThanOrEqual(2);
      for (const c of chemins) expect(c.tel, c.id).not.toContain("#");
    }
  });

  it("est lisible depuis le domaine de la boutique", async () => {
    // Boutique statique et API ne sont pas sur le meme domaine.
    const r = await app.request("/api/rampe");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("se met en cache une minute, pas davantage", async () => {
    // Un changement de code doit arriver vite : une chaine USSD fausse n'echoue
    // pas proprement, elle ouvre un menu inattendu.
    const r = await app.request("/api/rampe");
    expect(r.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("sert la surcharge d'environnement, pas le defaut fige", async () => {
    const autre = new Hono().route(
      "/api/rampe",
      rampeRoutes(rampeDepuisEnv({ RAMPE_MTN_ENTREE_MODELE: "*127#" })),
    );
    const config = (await (await autre.request("/api/rampe")).json()) as RampeConfig;
    expect(config.operateurs.find((o) => o.id === "mtn")?.codeEntree.modele).toBe("*127#");
  });

  it("ne porte AUCUNE cle ou un code secret pourrait se loger", async () => {
    // La configuration descend telle quelle dans le navigateur. Une cle nommee
    // `pin` ou `codeSecret` deviendrait un champ a l'ecran : il n'y en a pas, et
    // il ne doit jamais y en avoir.
    const config = await (await app.request("/api/rampe")).json();
    const cles = new Set<string>();
    const parcourir = (v: unknown): void => {
      if (Array.isArray(v)) return void v.forEach(parcourir);
      if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          cles.add(k);
          parcourir(x);
        }
      }
    };
    parcourir(config);
    expect([...cles].filter((k) => /\b(pin|code[_ -]?secret|secret[_ -]?code)\b/i.test(k))).toEqual(
      [],
    );
  });

  it("ne parle du code secret que pour dire qu'il ne se tape PAS ici", async () => {
    // La mention est un avertissement, pas un champ — et c'est exactement ce
    // qu'une acheteuse doit lire avant de composer.
    const config = (await (await app.request("/api/rampe")).json()) as RampeConfig;
    for (const op of config.operateurs) {
      const etapes = op.etapes.join(" ");
      expect(etapes, op.id).toMatch(/code secret/i);
      expect(etapes, op.id).toMatch(/chez l'operateur, jamais ici/i);
    }
  });
});
