import { describe, expect, it } from "vitest";
import { DELAI_RESEAU_MS, fetchBorne } from "../adapters/fetch-borne.ts";

/**
 * Un appel du bot echoue, ou il finit — jamais « il attend ».
 *
 * Banc du 13/08/2026 : le deuxieme article d'une vendeuse entre en base, et
 * le fil reste MUET. Aucune erreur, aucune trace. Un `fetch` nu ne connait
 * pas le temps : une connexion qui n'aboutit jamais suspend la promesse pour
 * toujours, et la route entrante attend la fin du traitement avant son 200.
 * La panne la plus silencieuse possible.
 */
describe("le fetch borne", () => {
  it("rejette une requete qui ne repond jamais, au lieu d'attendre", async () => {
    /* Un transport qui ne resout JAMAIS — la panne exacte du 13/08. */
    const jamais: typeof fetch = (_e, init) =>
      new Promise((_resoudre, rejeter) => {
        init?.signal?.addEventListener("abort", () => rejeter(new Error("aborte")));
      });
    const borne = fetchBorne(jamais, 30);
    await expect(borne("https://exemple.test")).rejects.toThrow();
  });

  it("laisse passer une reponse normale, sans la toucher", async () => {
    const ok: typeof fetch = async () => new Response("bonjour", { status: 200 });
    const r = await fetchBorne(ok, 1000)("https://exemple.test");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("bonjour");
  });

  /**
   * Poser un delai ne doit pas RETIRER une annulation deja demandee : les
   * deux signaux s'additionnent, le premier qui parle gagne.
   */
  it("preserve le signal de l'appelant", async () => {
    const controleur = new AbortController();
    const jamais: typeof fetch = (_e, init) =>
      new Promise((_resoudre, rejeter) => {
        init?.signal?.addEventListener("abort", () => rejeter(new Error("aborte")));
      });
    const promesse = fetchBorne(jamais, 10_000)("https://exemple.test", {
      signal: controleur.signal,
    });
    controleur.abort();
    await expect(promesse).rejects.toThrow();
  });

  /* Le delai borne l'INFINI, pas la performance : un reseau camerounais lent
     doit passer. Quinze secondes est genereux, et c'est voulu. */
  it("le delai par defaut laisse de la place a un reseau lent", () => {
    expect(DELAI_RESEAU_MS).toBeGreaterThanOrEqual(10_000);
  });
});
