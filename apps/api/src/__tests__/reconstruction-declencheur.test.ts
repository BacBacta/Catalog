import { describe, expect, it, vi } from "vitest";
import { DeclencheurCrochet, declencheurDepuisEnv } from "../adapters/reconstruction-boutique.ts";

/** Le declencheur de reconstruction — ADR 0065. */

const T0 = new Date("2026-08-11T12:00:00.000Z");
const ok = () => Promise.resolve(new Response(null, { status: 200 }));

describe("absent par defaut", () => {
  it("sans SHOP_REBUILD_HOOK_URL, il n'y a PAS de declencheur", () => {
    /* Un environnement de developpement ne redeploie pas la production parce
       qu'on y a cree un article de test. */
    expect(declencheurDepuisEnv({})).toBeNull();
    expect(declencheurDepuisEnv({ SHOP_REBUILD_HOOK_URL: "   " })).toBeNull();
  });

  it("il refuse de se construire sans URL, plutot que de se taire", () => {
    expect(() => new DeclencheurCrochet({ hookUrl: "" })).toThrow();
  });
});

describe("le regroupement tient dans l'adaptateur", () => {
  it("deux publications rapprochees ne font qu'UN appel", async () => {
    const appels: string[] = [];
    const d = new DeclencheurCrochet({
      hookUrl: "https://crochet.example/abc",
      fetchImpl: ((u: string) => {
        appels.push(String(u));
        return ok();
      }) as unknown as typeof fetch,
      maintenant: () => T0,
    });
    expect(await d.demander("article_publie")).toBe(true);
    expect(await d.demander("article_publie")).toBe(false);
    expect(appels).toHaveLength(1);
  });
});

describe("jamais fatal", () => {
  it("un refus de l'hebergeur ne leve pas", async () => {
    const d = new DeclencheurCrochet({
      hookUrl: "https://crochet.example/abc",
      fetchImpl: (() => Promise.resolve(new Response(null, { status: 500 }))) as never,
      maintenant: () => T0,
    });
    await expect(d.demander("article_publie")).resolves.toBe(false);
  });

  it("un reseau coupe ne leve pas", async () => {
    const d = new DeclencheurCrochet({
      hookUrl: "https://crochet.example/abc",
      fetchImpl: (() => Promise.reject(new Error("ENOTFOUND"))) as never,
      maintenant: () => T0,
    });
    await expect(d.demander("article_publie")).resolves.toBe(false);
  });

  it("l'URL du crochet ne fuit JAMAIS dans une trace — ADR 0023", async () => {
    /* Elle vaut un droit de deploiement : la voir dans un journal, c'est la
       publier. */
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = new DeclencheurCrochet({
      hookUrl: "https://crochet.example/SECRET-TOKEN-42",
      fetchImpl: (() =>
        Promise.resolve(new Response("erreur SECRET-TOKEN-42", { status: 403 }))) as never,
      maintenant: () => T0,
    });
    await d.demander("article_publie");
    const dit = avertir.mock.calls.flat().join(" ");
    expect(dit).not.toContain("SECRET-TOKEN-42");
    expect(dit).toContain("403");
    avertir.mockRestore();
  });
});
