import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CampayProvider,
  mapStatus,
  parseXafAmount,
  timingSafeEqualStr,
  toCampayMsisdn,
  verifyCampayToken,
} from "../adapters/campay.ts";

/**
 * Les charges utiles de ce fichier sont des RELEVES VERBATIM de
 * `demo.campay.net`, faits le 29/07/2026 avec une application de
 * demonstration reelle. Elles ne sont pas inventees a partir d'une doc.
 *
 * Le secret de signature, lui, est un secret de test : la vraie « cle webhook »
 * ne figure nulle part dans le depot.
 */
const TEST_SECRET = "cle-webhook-de-test";

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

const cfg = (fetchImpl: typeof fetch, nowSeconds?: () => number) => ({
  permanentToken: "tok_test",
  environment: "DEV" as const,
  webhookSecret: TEST_SECRET,
  fetchImpl,
  ...(nowSeconds ? { nowSeconds } : {}),
});

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/**
 * Fabrique un jeton de la MEME forme que celui observe : en-tete
 * {"alg":"HS256","app":"…","typ":"JWT"} et charge utile ne contenant que
 * iat / nbf / exp / source. La revendication `app` porte le nom de
 * l'application chez le prestataire ; elle n'entre pas dans la verification.
 */
function makeToken(secret: string, { iat = 1785342145, ttl = 3600, alg = "HS256" as string } = {}) {
  const h = b64url({ alg, app: "Catalog", typ: "JWT" });
  const p = b64url({ iat, nbf: iat, exp: iat + ttl, source: "CamPay" });
  const s = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

/* ───────────── charges utiles relevees verbatim en bac a sable ───────────── */

/** PENDING, MTN — porte une reference operateur a 11 chiffres. */
const STATUS_PENDING_MTN = {
  reference: "d82fd32f-a6da-434d-a6b6-e9fd5e4862dc",
  status: "PENDING",
  amount: "5.00",
  currency: "XAF",
  operator: "MTN",
  code: "D260729D0053YC",
  operator_reference: "18132148736",
  endpoint: "collect",
  signature: "(jeton retire du depot)",
  external_reference: "SUC-237671234567",
  external_user: "",
  extra_first_name: "",
  extra_last_name: "",
  extra_email: "",
  app_amount: "4.00",
  phone_number: "237671234567",
  redirect_url: "",
  failure_redirect_url: "",
  description: "probe success",
  reason: "None",
};

/** SUCCESSFUL, MTN — et pourtant `operator_reference` est VIDE. */
const STATUS_SUCCESSFUL_MTN = {
  ...STATUS_PENDING_MTN,
  reference: "63cffa68-8af0-4af1-bea5-ae336ef45ac7",
  status: "SUCCESSFUL",
  amount: "0.00",
  code: "D260729D0052KJ",
  operator_reference: "",
  app_amount: "0.00",
  phone_number: "237677777777",
};

/** FAILED, Orange — reference operateur au format Orange Money. */
const STATUS_FAILED_ORANGE = {
  ...STATUS_PENDING_MTN,
  reference: "17689a91-606b-4d3c-a034-5b33b97b0daa",
  status: "FAILED",
  amount: "10.00",
  operator: "Orange",
  code: "D260729D0055ZM",
  operator_reference: "MP260729.1716.C73941",
  app_amount: "9.00",
  phone_number: "237690000000",
  reason: "Initiatee not found",
};

/** Reponse de POST /api/history/ — exactement cette forme. */
const HISTORY_RESPONSE = {
  data: [
    {
      datetime: "2026-07-29T17:15:25.670488",
      code: "D260729D0050PM",
      operator_tx_code: null,
      operator: "MTN",
      phone_number: "237680000000",
      description: "probe prefix",
      external_user: "",
      amount: 5.0,
      charge_amount: 1.0,
      debit: 0.0,
      credit: 4.0,
      status: "FAILED",
      reference_uuid: "7d687c8f-4ac9-4d01-931f-c6d1f0ee906d",
    },
  ],
};

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

describe("parseXafAmount", () => {
  it("accepte la chaine decimale de CamPay (« 5.00 ») et rend un entier", () => {
    expect(parseXafAmount("5.00")).toBe(5);
    expect(parseXafAmount("0.00")).toBe(0);
    expect(parseXafAmount(5)).toBe(5);
  });
  it("refuse une partie decimale non nulle — le FCFA n'a pas de sous-unite", () => {
    expect(() => parseXafAmount("5.50")).toThrow(/non entier/);
  });
  it("refuse un montant illisible plutot que de rendre NaN", () => {
    expect(() => parseXafAmount("abc")).toThrow(/illisible/);
    expect(() => parseXafAmount(null)).toThrow(/illisible/);
  });
});

describe("initiate", () => {
  it("envoie un montant entier, en chaine, avec notre reference de commande", async () => {
    // Reponse collect relevee verbatim : exactement ces trois champs.
    const { fn, calls } = fakeFetch([
      {
        body: {
          reference: "818a896a-dadb-4804-984c-735205c65c71",
          ussd_code: "*126#",
          operator: "MTN",
        },
      },
    ]);
    const p = new CampayProvider(cfg(fn));
    const r = await p.initiate({
      amountXaf: 17000,
      orderRef: "CT-1043",
      payerPhone: "+237677123456",
      description: "2x Robe wax",
    });

    expect(r.providerTxId).toBe("818a896a-dadb-4804-984c-735205c65c71");
    expect(r.ussdCode).toBe("*126#");
    expect(r.operator).toBe("mtn");

    const c0 = callAt(calls, 0);
    const sent = JSON.parse(String(c0.init.body));
    expect(sent.amount).toBe("17000"); // chaine, jamais de decimale
    expect(sent.currency).toBe("XAF");
    expect(sent.from).toBe("237677123456");
    expect(sent.external_reference).toBe("CT-1043");
    expect(c0.url).toContain("demo.campay.net/api/collect/");
    expect((c0.init.headers as Record<string, string>).Authorization).toBe("Token tok_test");
  });

  it("remonte le code USSD propre a Orange — il differe de celui de MTN", async () => {
    const { fn } = fakeFetch([
      { body: { reference: "17689a91", ussd_code: "#150*50#", operator: "Orange" } },
    ]);
    const p = new CampayProvider(cfg(fn));
    const r = await p.initiate({
      amountXaf: 10,
      orderRef: "CT-2",
      payerPhone: "+237690000000",
      description: "d",
    });
    expect(r.ussdCode).toBe("#150*50#");
    expect(r.operator).toBe("orange");
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
  it("expose la reference operateur a 11 chiffres — la meme que le SMS MTN", async () => {
    const { fn, calls } = fakeFetch([{ body: STATUS_PENDING_MTN }]);
    const p = new CampayProvider(cfg(fn));
    const r = await p.checkStatus(STATUS_PENDING_MTN.reference);
    expect(r.operatorRef).toBe("18132148736");
    expect(r.amountXaf).toBe(5);
    expect(r.status).toBe("waiting_customer"); // PENDING n'est pas un echec
    expect(callAt(calls, 0).url).toContain(`/api/transaction/${STATUS_PENDING_MTN.reference}/`);
  });

  it("traite la chaine vide comme une absence, meme sur un paiement reussi", async () => {
    // Cas reel : le bac a sable renvoie SUCCESSFUL avec operator_reference "".
    const { fn } = fakeFetch([{ body: STATUS_SUCCESSFUL_MTN }]);
    const p = new CampayProvider(cfg(fn));
    const r = await p.checkStatus(STATUS_SUCCESSFUL_MTN.reference);
    expect(r.status).toBe("paid");
    expect(r.operatorRef).toBeUndefined(); // surtout pas ""
    expect(r.amountXaf).toBe(0);
  });

  it("lit la reference operateur au format Orange, y compris sur un echec", async () => {
    const { fn } = fakeFetch([{ body: STATUS_FAILED_ORANGE }]);
    const p = new CampayProvider(cfg(fn));
    const r = await p.checkStatus(STATUS_FAILED_ORANGE.reference);
    expect(r.status).toBe("failed");
    expect(r.operatorRef).toBe("MP260729.1716.C73941");
  });

  it("ne confond pas le code interne CamPay avec la reference operateur", async () => {
    const { fn } = fakeFetch([{ body: STATUS_PENDING_MTN }]);
    const p = new CampayProvider(cfg(fn));
    const r = await p.checkStatus(STATUS_PENDING_MTN.reference);
    expect(r.operatorRef).not.toBe("D260729D0053YC");
  });
});

describe("verifySignature — jeton JWT dans le CORPS", () => {
  const bodyWith = (token: string) =>
    JSON.stringify({ reference: "d82fd32f", status: "SUCCESSFUL", signature: token });
  const now = 1785342145;

  it("accepte un jeton HS256 valide signe avec la cle webhook", () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider(cfg(fn, () => now));
    expect(p.verifySignature(bodyWith(makeToken(TEST_SECRET, { iat: now })), {})).toBe(true);
  });

  it("rejette un jeton signe avec une autre cle", () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider(cfg(fn, () => now));
    expect(p.verifySignature(bodyWith(makeToken("mauvaise-cle", { iat: now })), {})).toBe(false);
  });

  it("rejette « alg: none » — pas de confusion d'algorithme", () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider(cfg(fn, () => now));
    const t = makeToken(TEST_SECRET, { iat: now, alg: "none" });
    expect(p.verifySignature(bodyWith(t), {})).toBe(false);
  });

  it("rejette un jeton expire — la validite observee est d'une heure", () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider(cfg(fn, () => now + 3600 + 120));
    expect(p.verifySignature(bodyWith(makeToken(TEST_SECRET, { iat: now })), {})).toBe(false);
  });

  it("rejette une notification SANS jeton — jamais de laissez-passer", () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider(cfg(fn, () => now));
    expect(p.verifySignature(JSON.stringify({ reference: "x", status: "SUCCESSFUL" }), {})).toBe(
      false,
    );
  });

  it("rejette un corps qui n'est pas du JSON", () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider(cfg(fn, () => now));
    expect(p.verifySignature("pas du json", {})).toBe(false);
  });

  it("rejette tout si aucun secret n'est configure", () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider({ permanentToken: "t", environment: "DEV", fetchImpl: fn });
    expect(p.verifySignature(bodyWith(makeToken(TEST_SECRET, { iat: now })), {})).toBe(false);
  });

  /**
   * Ce test ne decrit pas un bug : il FIGE une propriete dangereuse de CamPay,
   * pour que personne ne construise dessus. Le jeton ne lie aucune donnee de
   * transaction — le meme jeton valide n'importe quel corps. C'est pourquoi
   * seul checkStatus fait autorite.
   */
  it("un jeton valide authentifie l'origine, PAS le contenu (rejouable)", () => {
    const { fn } = fakeFetch([{ body: {} }]);
    const p = new CampayProvider(cfg(fn, () => now));
    const token = makeToken(TEST_SECRET, { iat: now });
    const vrai = JSON.stringify({ reference: "d82fd32f", status: "PENDING", signature: token });
    const forge = JSON.stringify({
      reference: "COMMANDE-QUI-N-EXISTE-PAS",
      status: "SUCCESSFUL",
      amount: "999999.00",
      signature: token,
    });
    expect(p.verifySignature(vrai, {})).toBe(true);
    expect(p.verifySignature(forge, {})).toBe(true); // <- exactement le danger
  });
});

describe("verifyCampayToken", () => {
  const now = 1785342145;
  it("nomme le motif du refus, pour le journal", () => {
    expect(verifyCampayToken(TEST_SECRET, "pasunjwt", now).reason).toBe("malformed");
    expect(verifyCampayToken(TEST_SECRET, makeToken("autre", { iat: now }), now).reason).toBe(
      "bad_signature",
    );
    expect(
      verifyCampayToken(TEST_SECRET, makeToken(TEST_SECRET, { iat: now }), now + 99999).reason,
    ).toBe("expired");
    expect(verifyCampayToken(TEST_SECRET, makeToken(TEST_SECRET, { iat: now }), now).ok).toBe(true);
  });

  it("tolere une derive d'horloge de quelques secondes", () => {
    const t = makeToken(TEST_SECRET, { iat: now });
    expect(verifyCampayToken(TEST_SECRET, t, now - 30).ok).toBe(true); // nbf - 30 s
    expect(verifyCampayToken(TEST_SECRET, t, now - 600).ok).toBe(false);
  });
});

describe("timingSafeEqualStr", () => {
  it("compare sans fuite de longueur", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
  });
});

describe("balance", () => {
  it("ventile le solde par operateur — un solde MTN a zero casse les reversements MTN", async () => {
    // Forme relevee : les deux champs utility_* etaient absents de la doc.
    const { fn } = fakeFetch([
      {
        body: {
          total_balance: 0,
          mtn_balance: 0,
          orange_balance: 0,
          currency: "XAF",
          utility_balance: 0,
          utility_commission_balance: 0,
        },
      },
    ]);
    const p = new CampayProvider(cfg(fn));
    const b = await p.balance();
    expect(b.mtn_balance).toBe(0);
    expect(b.currency).toBe("XAF");
  });
});

describe("codes d'erreur", () => {
  it("traduit ER101 et conserve le message brut de CamPay", async () => {
    // Releve verbatim sur un numero au format valide mais inexistant.
    const { fn } = fakeFetch([
      {
        ok: false,
        status: 400,
        body: { message: "Invalid phone number", error_code: "ER101" },
      },
    ]);
    const p = new CampayProvider(cfg(fn));
    await expect(
      p.initiate({
        amountXaf: 5,
        orderRef: "CT-1",
        payerPhone: "+237677123456",
        description: "d",
      }),
    ).rejects.toMatchObject({
      code: "ER101",
      retryable: false,
      providerMessage: "Invalid phone number",
    });
  });

  it("ER201 porte le minimum par operateur — 10 XAF chez Orange, 5 passe chez MTN", async () => {
    const { fn } = fakeFetch([
      {
        ok: false,
        status: 400,
        body: { message: "Minimum amount for Orange is 10.00", error_code: "ER201" },
      },
    ]);
    const p = new CampayProvider(cfg(fn));
    await expect(
      p.initiate({
        amountXaf: 5,
        orderRef: "CT-1",
        payerPhone: "+237690000000",
        description: "d",
      }),
    ).rejects.toMatchObject({
      code: "ER201",
      retryable: false,
      providerMessage: "Minimum amount for Orange is 10.00",
    });
  });

  it("traduit ER301 et le marque comme réessayable — c'est le flottant épuisé", async () => {
    const { fn } = fakeFetch([
      { ok: false, status: 400, body: { error_code: "ER301", message: "insufficient balance" } },
    ]);
    const p = new CampayProvider(cfg(fn));
    await expect(
      p.disburse({ amountXaf: 5000, toPhone: "+237677123456", orderRef: "CT-1", description: "d" }),
    ).rejects.toMatchObject({ code: "ER301", retryable: true });
  });

  it("ne devine pas sur un code inconnu", async () => {
    const { fn } = fakeFetch([{ ok: false, status: 500, body: { message: "boom" } }]);
    const p = new CampayProvider(cfg(fn));
    await expect(
      p.initiate({
        amountXaf: 5000,
        orderRef: "CT-1",
        payerPhone: "+237677123456",
        description: "d",
      }),
    ).rejects.toMatchObject({ code: "UNKNOWN", httpStatus: 500 });
  });
});

describe("history", () => {
  it("lit la forme reelle { data: [...] } et le champ operator_tx_code", async () => {
    const { fn, calls } = fakeFetch([{ body: HISTORY_RESPONSE }]);
    const p = new CampayProvider(cfg(fn));
    const h = await p.history({ startDate: "2026-07-22", endDate: "2026-07-29" });

    expect(h.data).toHaveLength(1);
    expect(h.data[0]?.reference_uuid).toBe("7d687c8f-4ac9-4d01-931f-c6d1f0ee906d");
    expect(h.data[0]?.operator_tx_code).toBeNull();

    const c = callAt(calls, 0);
    expect(c.url).toContain("/api/history/");
    const sent = JSON.parse(String(c.init.body));
    expect(sent.start_date).toBe("2026-07-22");
    expect(sent.end_date).toBe("2026-07-29"); // et non la date du jour
  });

  it("ne porte pas notre reference de commande — le rapprochement passe par l'UUID", () => {
    // Fige une limite reelle : aucune ligne d'historique n'a d'external_reference.
    for (const row of HISTORY_RESPONSE.data) {
      expect(row).not.toHaveProperty("external_reference");
    }
  });
});
