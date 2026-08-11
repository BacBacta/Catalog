import { describe, expect, it, vi } from "vitest";
import { VerificateurJetonActions } from "../adapters/jeton-actions-github.ts";
import {
  AUDIENCE_INSTANTANE,
  EMETTEUR_ACTIONS,
  verifierRevendications,
} from "../domain/deploiement/jeton-actions.ts";
import { instantaneRoutes } from "../routes/instantane.ts";

/**
 * Le jeton d'identite d'une execution GitHub Actions — ADR 0070.
 *
 * Ce que ces tests protegent, dans l'ordre d'importance :
 *
 * 1. **un jeton d'un AUTRE depot ne vaut rien.** C'est la seule chose qui
 *    separe l'instantane — le numero WhatsApp de toutes les vendeuses actives,
 *    d'un bloc — du premier venu, puisque n'importe qui peut demander a GitHub
 *    un jeton parfaitement signe depuis SON depot ;
 * 2. **un jeton demande pour un autre usage ne vaut rien non plus.** Sans le
 *    controle d'audience, tout jeton du bon depot — celui d'un deploiement AWS,
 *    par exemple — ouvrirait cette route ;
 * 3. **la route ne dit pas POURQUOI elle refuse.** Le motif ferme sert le
 *    diagnostic cote serveur, pas l'appelant.
 */

const DEPOT = "BacBacta/Catalog";
const MAINTENANT = new Date("2026-08-11T12:00:00+01:00");
const dans = (minutes: number) => Math.floor(MAINTENANT.getTime() / 1000) + minutes * 60;

const valides = () => ({
  iss: EMETTEUR_ACTIONS,
  aud: AUDIENCE_INSTANTANE,
  repository: DEPOT,
  exp: dans(10),
  nbf: dans(-1),
});

describe("revendications du jeton d'Actions", () => {
  it("accepte le jeton du bon depot, pour la bonne audience", () => {
    expect(
      verifierRevendications({
        revendications: valides(),
        depotAttendu: DEPOT,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ ok: true });
  });

  /**
   * La casse d'un nom de depot GitHub n'est pas significative. Comparer
   * litteralement ferait echouer le deploiement le jour ou quelqu'un pose
   * `bacbacta/catalog` dans la variable d'environnement — un echec dont la
   * cause serait invisible.
   */
  it("accepte la meme paire proprietaire/depot dans une autre casse", () => {
    expect(
      verifierRevendications({
        revendications: { ...valides(), repository: "bacbacta/catalog" },
        depotAttendu: DEPOT,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ ok: true });
  });

  it("REFUSE un jeton parfaitement signe venu d'un autre depot", () => {
    expect(
      verifierRevendications({
        revendications: { ...valides(), repository: "quelquun-dautre/catalog" },
        depotAttendu: DEPOT,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ ok: false, motif: "depot" });
  });

  it("REFUSE un jeton du bon depot demande pour une autre audience", () => {
    expect(
      verifierRevendications({
        revendications: { ...valides(), aud: "sts.amazonaws.com" },
        depotAttendu: DEPOT,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ ok: false, motif: "audience" });
  });

  it("accepte une audience presentee en tableau", () => {
    expect(
      verifierRevendications({
        revendications: { ...valides(), aud: ["autre-chose", AUDIENCE_INSTANTANE] },
        depotAttendu: DEPOT,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ ok: true });
  });

  it("REFUSE un emetteur qui n'est pas celui d'Actions", () => {
    expect(
      verifierRevendications({
        revendications: { ...valides(), iss: "https://exemple.invalid" },
        depotAttendu: DEPOT,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ ok: false, motif: "emetteur" });
  });

  it("REFUSE un jeton expire", () => {
    expect(
      verifierRevendications({
        revendications: { ...valides(), exp: dans(-10) },
        depotAttendu: DEPOT,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ ok: false, motif: "expire" });
  });

  it("REFUSE un jeton pas encore valide", () => {
    expect(
      verifierRevendications({
        revendications: { ...valides(), nbf: dans(10) },
        depotAttendu: DEPOT,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ ok: false, motif: "pas_encore_valide" });
  });

  /**
   * **L'absence de `exp` est un REFUS, jamais « pas de limite ».** Un jeton
   * sans date de fin serait une cle permanente, et c'est exactement la forme
   * qu'aurait un jeton fabrique.
   */
  it("REFUSE un jeton sans date de fin", () => {
    const { exp: _exp, ...sansExp } = valides();
    expect(
      verifierRevendications({
        revendications: sansExp,
        depotAttendu: DEPOT,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ ok: false, motif: "revendications_absentes" });
  });

  it("REFUSE un jeton sans depot", () => {
    const { repository: _r, ...sansDepot } = valides();
    expect(
      verifierRevendications({
        revendications: sansDepot,
        depotAttendu: DEPOT,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ ok: false, motif: "revendications_absentes" });
  });

  /** Une minute de derive d'horloge ne casse pas un deploiement. */
  it("tolere une derive d'horloge d'une minute", () => {
    expect(
      verifierRevendications({
        revendications: { ...valides(), exp: dans(-0.5) },
        depotAttendu: DEPOT,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ ok: true });
  });
});

describe("verificateur (adaptateur)", () => {
  const verificateur = (resoudre: (j: string) => Promise<Record<string, unknown>>) =>
    new VerificateurJetonActions({
      depot: DEPOT,
      maintenant: () => MAINTENANT,
      resoudre,
    });

  it("refuse quand la signature ne se verifie pas, sans laisser fuir le detail", async () => {
    const v = verificateur(() => Promise.reject(new Error("signature invalide")));
    await expect(v.verifier("peu-importe")).resolves.toEqual({ ok: false, motif: "emetteur" });
  });

  it("delegue les revendications au domaine", async () => {
    const v = verificateur(() => Promise.resolve(valides()));
    await expect(v.verifier("jeton")).resolves.toEqual({ ok: true });
  });

  it("refuse de se construire sur un depot mal forme", () => {
    expect(() => new VerificateurJetonActions({ depot: "pas-un-depot" })).toThrow(/mal forme/);
  });
});

describe("GET /api/instantane", () => {
  const instantane = { version: 1 as const, boutiques: [] };
  const monter = (ok: boolean) =>
    instantaneRoutes({
      verificateur: {
        verifier: () =>
          Promise.resolve(ok ? ({ ok: true } as const) : ({ ok: false, motif: "depot" } as const)),
      },
      construire: () => Promise.resolve(instantane),
    });

  it("sert l'instantane a un jeton accepte", async () => {
    const res = await monter(true).request("/", {
      headers: { authorization: "Bearer un-jeton" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(instantane);
    // Cette reponse porte les numeros de toutes les vendeuses actives : elle ne
    // dort dans aucun cache intermediaire.
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("repond 401 sans en-tete d'autorisation", async () => {
    const res = await monter(true).request("/");
    expect(res.status).toBe(401);
  });

  it("repond 401 sur un en-tete qui n'est pas un porteur", async () => {
    const res = await monter(true).request("/", { headers: { authorization: "Basic abc" } });
    expect(res.status).toBe(401);
  });

  /** Le motif reste cote serveur : la reponse ne l'apprend pas a l'appelant. */
  it("repond 403 sans dire pourquoi", async () => {
    const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await monter(false).request("/", {
      headers: { authorization: "Bearer un-jeton" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ erreur: "non_autorise" });
    expect(avertir).toHaveBeenCalled();
    avertir.mockRestore();
  });
});
