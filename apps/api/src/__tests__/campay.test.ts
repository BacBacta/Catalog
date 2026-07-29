import { describe, expect, it, vi } from "vitest";
import {
  CampayProvider,
  hmacSha256Hex,
  mapStatus,
  timingSafeEqualHex,
  toCampayMsisdn,
} from "../adapters/campay.ts";

/** Faux fetch : renvoie les reponses programmees et enregistre les appels. */
function fakeFetch(responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (!r) throw new Error("faux fetch: aucune reponse programmee");
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
    } as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

/** Recupere un appel enregistre, en echouant clairement s'il n'existe pas. */
function callAt(calls: Array<{ url: string; init: RequestInit | undefined }>, i: number) {
  const c = calls[i];
  if (!c?.init) throw new Error(`aucun appel enregistre a l'index ${i}`);
  return { url: c.url, init: c.init };
}

const cfg = (fetchImpl: typeof fetch) => ({
  permanentToken: "tok_test",
  environment: "DEV" as const,
  webhookSecret: "s3cr3t",
  fetchImpl,
});

describe("toCampayMsisdn", () => {
  it("retire le + et garde 237XXXXXXXXX", () => {
    expect(toCampayMsisdn("+237677123456")).toBe("237677123456");
  });
  it("rejette un numero hors Cameroun", () => {
    expect(() => toCampayMsisdn("+33612345678")).toThrow();
  });
});

describe("mapStatus", () => {
  it("PENDING n'est PAS un echec — c'est l'attente du code secret", () => {
    expect(mapStatus("PENDING")).toBe("waiting_customer");
    expect(mapStatus("PENDING")).not.toBe("failed");
  });
  it("projette SUCCESSFUL et FAILED", () => {
    expect(mapStatus("SUCCESSFUL")).toBe("paid");
    expect(mapStatus("FAILED")).toBe("failed");
  });
  it("ne devine pas sur un statut inconnu", () => {
    expect(mapStatus("WHATEVER")).toBe("initiated");
  });
});

describe("initiate", () => {
  it("envoie un montant entier, en chaine, avec notre reference de commande", async () => {
    const { fn, calls } = fakeFetch([
      { body: { reference: "uuid-1", ussd_code: "*126#", operator: "MTN" } },
    ]);
    const p = new CampayProvider(cfg(fn));
    const r = await p.initiate({
      amountXaf: 17000,
      orderRef: "SW-1043",
      payerPhone: "+237677123456",
      description: "2x Robe wax",
    });

    expect(r.providerTxId).toBe("uuid-1");
    expect(r.ussdCode).toBe("*126#");
    expect(r.operator).toBe("mtn");

    const c0 = callAt(calls, 0);
    const sent = JSON.parse(String(c0.init.body));
    expect(sent.amount).toBe("17000"); // chaine, jamais de decimale
    expect(sent.currency).toBe("XAF");
    expect(sent.from).toBe("237677123456");
    expect(sent.external_reference).toBe("SW-1043");
    expect(c0.url).toContain("demo.campay.net/api/collect/");
    expect((c0.init.headers as Record<string, string>).Authorization).toBe("Token tok_test");
  });

  it("refuse un montant non entier — le FCFA n'a pas de sous-unite", async () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider(cfg(fn));
    await expect(
      p.initiate({
        amountXaf: 3750.5,
        orderRef: "X",
        payerPhone: "+237677123456",
        description: "d",
      }),
    ).rejects.toThrow(/entier/);
  });
});

describe("checkStatus", () => {
  it("lit le statut et le montant", async () => {
    const { fn, calls } = fakeFetch([
      { body: { reference: "uuid-1", status: "SUCCESSFUL", amount: "17000" } },
    ]);
    const p = new CampayProvider(cfg(fn));
    const r = await p.checkStatus("uuid-1");
    expect(r.status).toBe("paid");
    expect(r.amountXaf).toBe(17000);
    expect(callAt(calls, 0).url).toContain("/api/transaction/uuid-1/");
  });

  it("expose la reference operateur SI le prestataire la fournit", async () => {
    const { fn } = fakeFetch([
      { body: { reference: "uuid-1", status: "SUCCESSFUL", operator_reference: "17645764679" } },
    ]);
    const p = new CampayProvider(cfg(fn));
    const r = await p.checkStatus("uuid-1");
    expect(r.operatorRef).toBe("17645764679");
  });

  it("n'invente pas de reference operateur quand elle est absente", async () => {
    const { fn } = fakeFetch([{ body: { reference: "uuid-1", status: "PENDING" } }]);
    const p = new CampayProvider(cfg(fn));
    const r = await p.checkStatus("uuid-1");
    expect(r.operatorRef).toBeUndefined();
    expect(r.status).toBe("waiting_customer");
  });
});

describe("verifySignature", () => {
  const body = '{"reference":"uuid-1","status":"SUCCESSFUL"}';

  it("accepte une signature valide", () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider(cfg(fn));
    const sig = hmacSha256Hex("s3cr3t", body);
    expect(p.verifySignature(body, { "x-campay-signature": sig })).toBe(true);
  });

  it("rejette une signature falsifiee", () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider(cfg(fn));
    expect(p.verifySignature(body, { "x-campay-signature": "deadbeef" })).toBe(false);
  });

  it("rejette une notification NON signee — jamais de laissez-passer", () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider(cfg(fn));
    expect(p.verifySignature(body, {})).toBe(false);
  });

  it("rejette tout si aucun secret n'est configure", () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider({ permanentToken: "t", environment: "DEV", fetchImpl: fn });
    expect(p.verifySignature(body, { "x-campay-signature": "x" })).toBe(false);
  });
});

describe("timingSafeEqualHex", () => {
  it("compare sans fuite de longueur", () => {
    expect(timingSafeEqualHex("abc", "abc")).toBe(true);
    expect(timingSafeEqualHex("abc", "abd")).toBe(false);
    expect(timingSafeEqualHex("abc", "abcd")).toBe(false);
  });
});

describe("balance", () => {
  it("ventile le solde par operateur — un solde MTN a zero casse les reversements MTN", async () => {
    const { fn } = fakeFetch([
      { body: { total_balance: 125000, mtn_balance: 0, orange_balance: 125000, currency: "XAF" } },
    ]);
    const p = new CampayProvider(cfg(fn));
    const b = await p.balance();
    expect(b.mtn_balance).toBe(0);
    expect(b.orange_balance).toBe(125000);
  });
});

describe("codes d'erreur", () => {
  it("traduit ER301 et le marque comme réessayable — c'est le flottant épuisé", async () => {
    const { fn } = fakeFetch([
      { ok: false, status: 400, body: { error_code: "ER301", message: "insufficient balance" } },
    ]);
    const p = new CampayProvider(cfg(fn));
    await expect(
      p.disburse({ amountXaf: 5000, toPhone: "+237677123456", orderRef: "SW-1", description: "d" }),
    ).rejects.toMatchObject({ code: "ER301", retryable: true });
  });

  it("ER102 n'est PAS réessayable — un numéro Camtel ne deviendra pas MTN", async () => {
    const { fn } = fakeFetch([{ ok: false, status: 400, body: { error_code: "ER102" } }]);
    const p = new CampayProvider(cfg(fn));
    await expect(
      p.initiate({
        amountXaf: 5000,
        orderRef: "SW-1",
        payerPhone: "+237677123456",
        description: "d",
      }),
    ).rejects.toMatchObject({ code: "ER102", retryable: false });
  });

  it("ne devine pas sur un code inconnu", async () => {
    const { fn } = fakeFetch([{ ok: false, status: 500, body: { message: "boom" } }]);
    const p = new CampayProvider(cfg(fn));
    await expect(
      p.initiate({
        amountXaf: 5000,
        orderRef: "SW-1",
        payerPhone: "+237677123456",
        description: "d",
      }),
    ).rejects.toMatchObject({ code: "UNKNOWN", httpStatus: 500 });
  });
});

describe("history", () => {
  it("appelle /api/history/ — seul endroit où la réf opérateur pourrait apparaître", async () => {
    const { fn, calls } = fakeFetch([{ body: { transactions: [] } }]);
    const p = new CampayProvider(cfg(fn));
    await p.history({ startDate: "2026-07-01", endDate: "2026-07-29" });
    const c = callAt(calls, 0);
    expect(c.url).toContain("/api/history/");
    const sent = JSON.parse(String(c.init.body));
    expect(sent.start_date).toBe("2026-07-01");
  });
});
