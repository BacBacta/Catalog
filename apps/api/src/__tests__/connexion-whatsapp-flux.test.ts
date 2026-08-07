import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  appliquerMessageEntrant,
  consulterSuivi,
  creerDefi,
  echangerDefi,
  type MagasinDefis,
} from "../auth-connexion-whatsapp.ts";
import { texteMessageDefi } from "../domain/connexion-whatsapp.ts";
import { familleDe } from "../middleware/debit.ts";
import { whatsappEntrantRoutes } from "../routes/whatsapp-entrant.ts";

/**
 * Le flux complet du defi WhatsApp — ADR 0027 — sans Better Auth ni base :
 * le magasin est un faux fidele a `authVerification` (consume = trouve-et-
 * supprime), et la route webhook recoit un `surMessage` espion.
 */

const T0 = new Date("2026-08-01T10:00:00Z");
const T_2MIN = new Date(T0.getTime() + 120_000);
const T_6MIN = new Date(T0.getTime() + 360_000);

/** Fidele au contrat : `consume` retire l'enregistrement en le rendant. */
function fauxMagasin() {
  const table = new Map<string, { value: string; expiresAt: Date }>();
  const magasin: MagasinDefis = {
    async createVerificationValue(d) {
      table.set(d.identifier, { value: d.value, expiresAt: d.expiresAt });
      return d;
    },
    async findVerificationValue(id) {
      return table.get(id) ?? null;
    },
    async consumeVerificationValue(id) {
      const v = table.get(id) ?? null;
      table.delete(id);
      return v;
    },
  };
  return { magasin, table };
}

const DEFI = { code: "7F3K-2M", jeton: "jeton-secret-du-navigateur", suivi: "suivi-public" };

async function defiFrais() {
  const { magasin, table } = fauxMagasin();
  await creerDefi(magasin, { ...DEFI, maintenant: T0 });
  return { magasin, table };
}

/* ═══════════════════ transitions du defi ═══════════════════ */

describe("le cycle de vie d'un defi", () => {
  it("nait en attente, sous ses trois cles", async () => {
    const { magasin, table } = await defiFrais();
    expect(table.size).toBe(3);
    expect(await consulterSuivi(magasin, DEFI.suivi, T_2MIN)).toBe("en_attente");
    expect((await echangerDefi(magasin, DEFI.jeton, T_2MIN)).decision).toBe("en_attente");
  });

  it("le message entrant le verifie, et le numero vient du wa_id — pas du texte", async () => {
    const { magasin } = await defiFrais();
    const r = await appliquerMessageEntrant(magasin, {
      de: "237683921934",
      texte: texteMessageDefi(DEFI.code),
      maintenant: T_2MIN,
    });
    expect(r).toBe("verifie");
    expect(await consulterSuivi(magasin, DEFI.suivi, T_2MIN)).toBe("verifie");
    const echange = await echangerDefi(magasin, DEFI.jeton, T_2MIN);
    expect(echange).toEqual({ decision: "verifie", numero: "+237683921934" });
  });

  it("l'echange consomme : la deuxieme tentative est inconnue", async () => {
    const { magasin } = await defiFrais();
    await appliquerMessageEntrant(magasin, {
      de: "237683921934",
      texte: DEFI.code,
      maintenant: T_2MIN,
    });
    await echangerDefi(magasin, DEFI.jeton, T_2MIN);
    expect((await echangerDefi(magasin, DEFI.jeton, T_2MIN)).decision).toBe("inconnu");
  });

  it("le sondage ne consomme JAMAIS — sonder cent fois ne detruit rien", async () => {
    const { magasin } = await defiFrais();
    for (let i = 0; i < 100; i++) await consulterSuivi(magasin, DEFI.suivi, T_2MIN);
    expect(await consulterSuivi(magasin, DEFI.suivi, T_2MIN)).toBe("en_attente");
  });

  it("un message rejoue par Meta ne re-verifie rien : le code est a usage unique", async () => {
    const { magasin } = await defiFrais();
    await appliquerMessageEntrant(magasin, {
      de: "237683921934",
      texte: DEFI.code,
      maintenant: T_2MIN,
    });
    await echangerDefi(magasin, DEFI.jeton, T_2MIN);
    // Meta relivre le meme message : le code a ete consomme au premier passage.
    const r = await appliquerMessageEntrant(magasin, {
      de: "237683921934",
      texte: DEFI.code,
      maintenant: T_2MIN,
    });
    expect(r).toBe("ignore");
    expect((await echangerDefi(magasin, DEFI.jeton, T_2MIN)).decision).toBe("inconnu");
  });

  it("verifier ne prolonge pas : l'echeance reste celle de la creation", async () => {
    const { magasin } = await defiFrais();
    await appliquerMessageEntrant(magasin, {
      de: "237683921934",
      texte: DEFI.code,
      maintenant: T_2MIN,
    });
    expect((await echangerDefi(magasin, DEFI.jeton, T_6MIN)).decision).toBe("inconnu");
    expect(await consulterSuivi(magasin, DEFI.suivi, T_6MIN)).toBe("inconnu");
  });

  it("un message arrive apres l'expiration ne verifie pas", async () => {
    const { magasin } = await defiFrais();
    const r = await appliquerMessageEntrant(magasin, {
      de: "237683921934",
      texte: DEFI.code,
      maintenant: T_6MIN,
    });
    expect(r).toBe("ignore");
  });

  it("un expediteur hors Cameroun est ignore", async () => {
    const { magasin } = await defiFrais();
    const r = await appliquerMessageEntrant(magasin, {
      de: "33612345678",
      texte: DEFI.code,
      maintenant: T_2MIN,
    });
    expect(r).toBe("ignore");
    expect(await consulterSuivi(magasin, DEFI.suivi, T_2MIN)).toBe("en_attente");
  });

  it("un texte sans code est ignore sans toucher au magasin", async () => {
    const { magasin, table } = await defiFrais();
    await appliquerMessageEntrant(magasin, {
      de: "237683921934",
      texte: "bonjour, je passe demain",
      maintenant: T_2MIN,
    });
    expect(table.size).toBe(3);
  });
});

/* ═══════════════════ la route webhook ═══════════════════ */

const SECRET = "secret-webhook-32-caracteres-abcd";
const APP_SECRET = "secret-application-meta";

function application(surMessage: (m: { de: string; texte: string }) => Promise<void>) {
  const app = new Hono();
  app.route(
    "/api/whatsapp",
    whatsappEntrantRoutes({ secret: SECRET, appSecret: APP_SECRET, surMessage }),
  );
  return app;
}

const livraison = (texte: string, de = "237683921934") =>
  JSON.stringify({
    entry: [
      { changes: [{ value: { messages: [{ from: de, type: "text", text: { body: texte } }] } }] },
    ],
  });

const signature = (corps: string) =>
  `sha256=${createHmac("sha256", APP_SECRET).update(corps).digest("hex")}`;

function poster(app: Hono, corps: string, entetes: Record<string, string> = {}) {
  return app.request(`/api/whatsapp/entrant/${SECRET}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...entetes },
    body: corps,
  });
}

describe("la route webhook", () => {
  it("livre le message signe a surMessage", async () => {
    const recus: Array<{ de: string; texte: string }> = [];
    const corps = livraison("Connexion Catalog : 7F3K-2M.");
    const r = await poster(
      application(async (m) => {
        recus.push(m);
      }),
      corps,
      { "x-hub-signature-256": signature(corps) },
    );
    expect(r.status).toBe(200);
    expect(recus).toEqual([{ de: "237683921934", texte: "Connexion Catalog : 7F3K-2M." }]);
  });

  it("REFUSE un corps sans signature — sinon quiconque a l'URL fabrique une connexion", async () => {
    let appele = false;
    const r = await poster(
      application(async () => {
        appele = true;
      }),
      livraison("7F3K-2M"),
    );
    expect(r.status).toBe(401);
    expect(appele).toBe(false);
  });

  it("refuse une signature calculee avec un autre secret", async () => {
    let appele = false;
    const corps = livraison("7F3K-2M");
    const mauvaise = `sha256=${createHmac("sha256", "autre-secret").update(corps).digest("hex")}`;
    const r = await poster(
      application(async () => {
        appele = true;
      }),
      corps,
      { "x-hub-signature-256": mauvaise },
    );
    expect(r.status).toBe(401);
    expect(appele).toBe(false);
  });

  it("404 sur un mauvais secret d'URL, sans rien traiter", async () => {
    const app = application(async () => {
      throw new Error("ne doit pas etre appele");
    });
    const r = await app.request("/api/whatsapp/entrant/devine", { method: "POST", body: "{}" });
    expect(r.status).toBe(404);
  });

  it("repond 200 meme quand surMessage echoue — Meta ne doit pas relivrer en boucle", async () => {
    const corps = livraison("7F3K-2M");
    const r = await poster(
      application(async () => {
        throw new Error("panne interne");
      }),
      corps,
      { "x-hub-signature-256": signature(corps) },
    );
    expect(r.status).toBe(200);
  });

  it("la poignee de main Meta rend le defi, avec le bon jeton seulement", async () => {
    const app = application(async () => {});
    const ok = await app.request(
      `/api/whatsapp/entrant/${SECRET}?hub.mode=subscribe&hub.verify_token=${SECRET}&hub.challenge=12345`,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");

    const mauvais = await app.request(
      `/api/whatsapp/entrant/${SECRET}?hub.mode=subscribe&hub.verify_token=devine&hub.challenge=12345`,
    );
    expect(mauvais.status).toBe(403);
  });

  it("le webhook est sous la famille lecture du limiteur, comme l'accuse", () => {
    expect(familleDe("POST", `/api/whatsapp/entrant/${SECRET}`)).not.toBe(null);
  });
});

/**
 * Le relais 360dialog (ADR 0035) : pas de secret d'application Meta, donc pas
 * de signature — le verrou est l'en-tete rejoue. Ce qui compte ici est autant
 * ce qui passe que ce qui ne passe PAS sans le secret Meta.
 */
describe("la route webhook servie par un relais, sans secret d'application", () => {
  const AUTH = "Bearer jeton-de-relais-32-caracteres";

  const relais = (surMessage: (m: { de: string; texte: string }) => Promise<void>) => {
    const app = new Hono();
    app.route(
      "/api/whatsapp",
      whatsappEntrantRoutes({ secret: SECRET, authEnTete: AUTH, surMessage }),
    );
    return app;
  };

  it("livre le message porte par le bon en-tete", async () => {
    const recus: Array<{ de: string; texte: string }> = [];
    const r = await poster(
      relais(async (m) => {
        recus.push(m);
      }),
      livraison("Connexion Catalog : 7F3K-2M."),
      { authorization: AUTH },
    );
    expect(r.status).toBe(200);
    expect(recus).toEqual([{ de: "237683921934", texte: "Connexion Catalog : 7F3K-2M." }]);
  });

  it("refuse un en-tete different, et l'absence d'en-tete", async () => {
    const corps = livraison("7F3K-2M");
    const app = relais(async () => {
      throw new Error("ne doit pas etre appele");
    });
    expect((await poster(app, corps, { authorization: "Bearer devine" })).status).toBe(401);
    expect((await poster(app, corps)).status).toBe(401);
  });

  /**
   * Le piege que ce test ferme : sans secret d'application, une signature ne
   * peut pas etre verifiee. L'accepter reviendrait a traiter « je ne sais pas
   * lire ce verrou » comme « ce verrou est bon » — et le bon en-tete est alors
   * absent, donc rien ne doit passer.
   */
  it("refuse une livraison signee quand aucun secret d'application n'est configure", async () => {
    const corps = livraison("7F3K-2M");
    const r = await poster(
      relais(async () => {
        throw new Error("ne doit pas etre appele");
      }),
      corps,
      { "x-hub-signature-256": signature(corps) },
    );
    expect(r.status).toBe(401);
  });

  it("REFUSE DE SE CONSTRUIRE sans aucune preuve d'origine", () => {
    expect(() => whatsappEntrantRoutes({ secret: SECRET, surMessage: async () => {} })).toThrow(
      /preuve d'origine/,
    );
  });
});
