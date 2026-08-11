import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DeclencheurCrochet,
  DeclencheurDispatch,
  declencheurDepuisEnv,
  EVENEMENT_DISPATCH,
} from "../adapters/reconstruction-boutique.ts";

/** Le declencheur de reconstruction — ADR 0065, deux transports depuis 0068. */

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

describe("le transport dispatch — ADR 0068", () => {
  const dispatch = (
    fetchImpl: unknown,
    reste: { environnement?: string } = {},
  ): DeclencheurDispatch =>
    new DeclencheurDispatch({
      depot: "BacBacta/Catalog",
      jeton: "JETON-SECRET-42",
      fetchImpl: fetchImpl as typeof fetch,
      maintenant: () => T0,
      ...reste,
    });

  it("appelle l'API des dispatches du bon depot, avec l'evenement attendu", async () => {
    /* Le nom de l'evenement est un CONTRAT avec
       `.github/workflows/deploiement.yml` : s'ils divergent, le dispatch part,
       GitHub repond 204, et rien ne se construit — la panne muette exacte que
       ce lot vient de corriger. */
    const vus: Array<{ url: string; init: RequestInit }> = [];
    const d = dispatch((url: string, init: RequestInit) => {
      vus.push({ url: String(url), init });
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    expect(await d.demander("boutique_creee")).toBe(true);
    expect(vus).toHaveLength(1);
    expect(vus[0]?.url).toBe("https://api.github.com/repos/BacBacta/Catalog/dispatches");
    const corps = JSON.parse(String(vus[0]?.init.body)) as {
      event_type: string;
      client_payload: { motif: string; environnement: string };
    };
    expect(corps.event_type).toBe(EVENEMENT_DISPATCH);
    expect(corps.client_payload.motif).toBe("boutique_creee");
    // Sans precision, on ne touche PAS la production.
    expect(corps.client_payload.environnement).toBe("preproduction");
  });

  it("le regroupement vaut pour ce transport aussi", async () => {
    let n = 0;
    const d = dispatch(() => {
      n++;
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    expect(await d.demander("article_publie")).toBe(true);
    expect(await d.demander("article_publie")).toBe(false);
    expect(n).toBe(1);
  });

  it("un depot mal forme leve a la CONSTRUCTION, pas au premier article", () => {
    /* Une faute de frappe dans une variable d'environnement ne doit pas se
       decouvrir le jour ou une vendeuse publie. C'est la lecon du Root
       Directory saisi « app/seller » le meme jour. */
    for (const depot of ["Catalog", "", "BacBacta/Catalog/trop", "Bac Bacta/Catalog"]) {
      expect(() => dispatch(() => Promise.resolve(new Response()), { depot } as never)).toThrow();
    }
  });

  it("le jeton ne fuit JAMAIS dans une trace — ADR 0023", async () => {
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = dispatch(() =>
      Promise.resolve(new Response("Bad credentials: JETON-SECRET-42", { status: 401 })),
    );
    expect(await d.demander("article_publie")).toBe(false);
    const dit = avertir.mock.calls.flat().join(" ");
    expect(dit).not.toContain("JETON-SECRET-42");
    expect(dit).toContain("401");
    avertir.mockRestore();
  });

  it("un reseau coupe ne leve pas — la publication passe avant la page web", async () => {
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = dispatch(() => Promise.reject(new Error("ECONNRESET")));
    await expect(d.demander("article_publie")).resolves.toBe(false);
    avertir.mockRestore();
  });
});

describe("lequel des deux transports est monte", () => {
  it("le dispatch l'emporte : c'est le seul qui atteint la boutique", () => {
    /* Mesure du 11/08 : le projet Vercel de la boutique n'est relie a aucun
       depot, donc il ne peut porter aucun crochet. Si les deux jeux de
       variables sont poses, celui qui marche gagne. */
    const d = declencheurDepuisEnv({
      SHOP_REBUILD_GITHUB_REPO: "BacBacta/Catalog",
      SHOP_REBUILD_GITHUB_TOKEN: "x",
      SHOP_REBUILD_HOOK_URL: "https://crochet.example/abc",
    });
    expect(d).toBeInstanceOf(DeclencheurDispatch);
  });

  it("le crochet reste le repli quand le dispatch n'est pas configure", () => {
    expect(
      declencheurDepuisEnv({ SHOP_REBUILD_HOOK_URL: "https://crochet.example/abc" }),
    ).toBeInstanceOf(DeclencheurCrochet);
  });

  it("un jeton sans depot — ou l'inverse — ne monte PAS le dispatch", () => {
    /* A moitie configure est le cas dangereux : on croirait la reconstruction
       branchee alors qu'elle ne part nulle part. */
    expect(declencheurDepuisEnv({ SHOP_REBUILD_GITHUB_TOKEN: "x" })).toBeNull();
    expect(declencheurDepuisEnv({ SHOP_REBUILD_GITHUB_REPO: "BacBacta/Catalog" })).toBeNull();
  });

  it("rien de pose, rien de monte", () => {
    expect(declencheurDepuisEnv({})).toBeNull();
  });
});

describe("le contrat avec le workflow", () => {
  it("le nom de l'evenement est celui que le workflow ecoute", () => {
    /* Ce nom est la SEULE chose qui relie l'API au deploiement. S'ils
       divergent, le dispatch part, GitHub repond 204, et rien ne se construit :
       une panne parfaitement muette, cote API comme cote GitHub. Le test lit le
       workflow reel plutot que de recopier la chaine. */
    const wf = readFileSync(
      new URL("../../../../.github/workflows/deploiement.yml", import.meta.url),
      "utf8",
    );
    expect(wf).toContain(`types: [${EVENEMENT_DISPATCH}]`);
  });
});
