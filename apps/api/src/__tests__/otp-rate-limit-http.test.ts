import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { OtpAttemptStore } from "../adapters/otp-attempt-store.ts";
import { DEFAULT_OTP_LIMITS, limitesDepuisEnv, type OtpAttempt } from "../domain/rate-limit.ts";
import { adresseDe, otpRateLimit } from "../middleware/otp-rate-limit.ts";

/**
 * La limitation de debit, prouvee EN COUCHE HTTP.
 *
 * Le domaine est deja couvert. Ce qui se joue ici est le critere de la
 * definition de terminé du lot 4 — « la limitation bloque a la quatrieme
 * demande » — et trois proprietes que seule cette couche peut porter :
 *
 * 1. un refus **n'envoie aucun SMS** : le gain est la, pas dans le code de retour ;
 * 2. une requete qui echoue **n'est pas comptee** ; sinon on enfermerait une
 *    vendeuse dehors avec des requetes invalides ;
 * 3. l'adresse IP est lue depuis la requete, pas devinee.
 */

class MagasinEnMemoire implements OtpAttemptStore {
  lignes: (OtpAttempt & { kind: string })[] = [];
  async depuis(depuis: Date) {
    return this.lignes.filter((l) => l.at >= depuis);
  }
  async enregistrer(a: OtpAttempt & { kind: string }) {
    this.lignes.push(a);
  }
  async purger(avant: Date) {
    const n = this.lignes.length;
    this.lignes = this.lignes.filter((l) => l.at >= avant);
    return n - this.lignes.length;
  }
}

const NOW = new Date("2026-07-30T10:00:00+01:00");

function serveur(store: OtpAttemptStore, aval: () => Response) {
  const app = new Hono();
  app.use(
    "/envoi",
    otpRateLimit({
      store,
      kind: "otp_connexion",
      maintenant: () => NOW,
      numero: (corps) => {
        const n = (corps as { phoneNumber?: unknown } | null)?.phoneNumber;
        return typeof n === "string" ? n : null;
      },
    }),
  );
  app.post("/envoi", () => aval());
  return app;
}

const demande = (phone: string, ip = "41.202.0.7") =>
  new Request("http://x/envoi", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ phoneNumber: phone }),
  });

describe("otpRateLimit", () => {
  it("bloque a la QUATRIEME demande pour le meme numero", async () => {
    const store = new MagasinEnMemoire();
    let envois = 0;
    const app = serveur(store, () => {
      envois++;
      return new Response("{}", { status: 200 });
    });

    for (let i = 1; i <= 3; i++) {
      const r = await app.fetch(demande("+237677000001"));
      expect(r.status, `demande ${i}`).toBe(200);
    }
    const quatrieme = await app.fetch(demande("+237677000001"));
    expect(quatrieme.status).toBe(429);
    expect(await quatrieme.json()).toMatchObject({
      erreur: "trop_de_demandes_pour_ce_numero",
    });

    // Le vrai gain : le quatrieme SMS n'est pas parti.
    expect(envois).toBe(3);
  });

  it("annonce Retry-After en secondes entieres", async () => {
    const store = new MagasinEnMemoire();
    const app = serveur(store, () => new Response("{}", { status: 200 }));
    for (let i = 0; i < 3; i++) await app.fetch(demande("+237677000002"));
    const r = await app.fetch(demande("+237677000002"));
    const entete = r.headers.get("Retry-After");
    expect(entete).toMatch(/^\d+$/);
    expect(Number(entete)).toBeGreaterThan(0);
    expect(Number(entete)).toBeLessThanOrEqual(15 * 60);
  });

  it("ne compte PAS une requete qui a echoue en aval", async () => {
    const store = new MagasinEnMemoire();
    const app = serveur(store, () => new Response("{}", { status: 400 }));
    for (let i = 0; i < 5; i++) {
      const r = await app.fetch(demande("+237677000003"));
      expect(r.status).toBe(400);
    }
    // Aucune tentative retenue : cinq requetes invalides n'enferment personne.
    expect(store.lignes).toHaveLength(0);
  });

  it("limite aussi par ADRESSE, numeros tournants comprises", async () => {
    const store = new MagasinEnMemoire();
    const app = serveur(store, () => new Response("{}", { status: 200 }));
    // Douze numeros differents depuis la meme machine : la limite par numero ne
    // voit rien, celle par adresse arrete.
    for (let i = 0; i < 12; i++) {
      const r = await app.fetch(demande(`+2376770100${i.toString().padStart(2, "0")}`));
      expect(r.status).toBe(200);
    }
    const r = await app.fetch(demande("+237677010099"));
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({
      erreur: "trop_de_demandes_depuis_cette_adresse",
    });
  });

  it("laisse passer une requete sans numero — ce n'est pas a elle de valider", async () => {
    const store = new MagasinEnMemoire();
    const app = serveur(store, () => new Response("{}", { status: 200 }));
    const r = await app.fetch(
      new Request("http://x/envoi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "pas du json",
      }),
    );
    expect(r.status).toBe(200);
    expect(store.lignes).toHaveLength(0);
  });

  it("le corps reste lisible en aval — le middleware ne le consomme pas", async () => {
    const store = new MagasinEnMemoire();
    const app = new Hono();
    app.use(
      "/envoi",
      otpRateLimit({
        store,
        kind: "otp_connexion",
        maintenant: () => NOW,
        numero: (c) => (c as { phoneNumber?: string } | null)?.phoneNumber ?? null,
      }),
    );
    let vuEnAval: unknown = null;
    app.post("/envoi", async (c) => {
      vuEnAval = await c.req.json();
      return c.json({ ok: true });
    });
    await app.fetch(demande("+237677000004"));
    expect(vuEnAval).toEqual({ phoneNumber: "+237677000004" });
  });
});

describe("limitesDepuisEnv", () => {
  it("prend les valeurs de la configuration", () => {
    const l = limitesDepuisEnv({ OTP_MAX_PAR_IP: "40", OTP_MAX_PAR_NUMERO: "5" });
    expect(l.parIp.max).toBe(40);
    expect(l.parNumero.max).toBe(5);
    // Ce qui n'est pas pose garde le defaut.
    expect(l.globalParJour.max).toBe(DEFAULT_OTP_LIMITS.globalParJour.max);
  });

  it("IGNORE une valeur invalide — une faute de frappe n'ouvre pas la vanne", () => {
    for (const v of ["", "abc", "-1", "0", "NaN"]) {
      expect(limitesDepuisEnv({ OTP_MAX_PAR_IP: v }).parIp.max).toBe(DEFAULT_OTP_LIMITS.parIp.max);
    }
  });

  it("sans configuration, rend exactement les defauts", () => {
    expect(limitesDepuisEnv({})).toEqual(DEFAULT_OTP_LIMITS);
  });
});

describe("adresseDe", () => {
  const ctx = (h: Record<string, string>) =>
    ({ req: { header: (n: string) => h[n.toLowerCase()] } }) as never;

  it("garde la PREMIERE entree de x-forwarded-for", () => {
    expect(adresseDe(ctx({ "x-forwarded-for": "41.202.0.7, 10.0.0.1, 10.0.0.2" }))).toBe(
      "41.202.0.7",
    );
  });

  it("retombe sur x-real-ip", () => {
    expect(adresseDe(ctx({ "x-real-ip": "41.202.0.9" }))).toBe("41.202.0.9");
  });

  it("rend une valeur STABLE sans en-tete — sinon ces requetes echapperaient a la regle", () => {
    expect(adresseDe(ctx({}))).toBe("inconnue");
  });
});
