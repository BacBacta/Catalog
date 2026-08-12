import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OtpAttemptStore } from "../adapters/otp-attempt-store.ts";
import { comparerEnTempsConstant, PayoutOtpStore } from "../adapters/payout-otp-store.ts";
import { DUREE_OTP_MS, ESSAIS_MAX } from "../domain/payout-otp.ts";
import type { OtpAttempt } from "../domain/rate-limit.ts";
import type { SmsMessage, SmsSender } from "../domain/sms-sender.ts";
import { payoutRoutes } from "../routes/payout.ts";
import { selExecution } from "./_identifiants.ts";

/**
 * L'OTP de reversement contre une VRAIE base, routes comprises.
 *
 * Trois choses ne peuvent pas etre prouvees ailleurs :
 *
 * 1. **le code n'est pas en base en clair** — c'est une lecture de colonne ;
 * 2. **un code faux est refuse ET journalise** — le journal est une table ;
 * 3. **l'identite vient de la session, pas du corps** — un `sellerId` pose dans
 *    le corps ne doit rien pouvoir deplacer.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
let otp: PayoutOtpStore;
/* Un bloc de 1 000 identifiants PAR FICHIER, plus la minute courante.
   `selExecution()` seul donnait des blocs qui se recouvraient : deux
   fichiers demarres a quelques millisecondes d'ecart visaient le meme
   identifiant, et Vitest les lance en parallele contre UNE base. Le
   defaut a fait echouer deux verifications le 11/08/2026, dont un test
   de fuite — le genre de faux rouge qui masque un vrai. */
const RUN = 798 * 1000 + selExecution();
let sellerId: string;
let userId: string;

const NOW = new Date();
const maintenant = () => NOW;
const NOUVEAU = `+23769${((RUN + 22222) % 10000000).toString().padStart(7, "0")}`;

class SmsEnMemoire implements SmsSender {
  readonly name = "memoire";
  readonly envoyes: SmsMessage[] = [];
  async send(m: SmsMessage) {
    this.envoyes.push(m);
  }
  dernierCode(to: string): string | null {
    for (let i = this.envoyes.length - 1; i >= 0; i--) {
      const m = this.envoyes[i];
      if (m?.to === to) return /\b(\d{6})\b/.exec(m.text)?.[1] ?? null;
    }
    return null;
  }
}

class MagasinTentatives implements OtpAttemptStore {
  lignes: (OtpAttempt & { kind: string })[] = [];
  async depuis(d: Date) {
    return this.lignes.filter((l) => l.at >= d);
  }
  async enregistrer(a: OtpAttempt & { kind: string }) {
    this.lignes.push(a);
  }
  async purger() {
    return 0;
  }
}

let sms: SmsEnMemoire;
let app: ReturnType<typeof payoutRoutes>;

beforeAll(async () => {
  if (!URL) return;
  prisma = createPrismaClient(URL);
  const u = await prisma.authUser.create({
    data: {
      name: `Test otp ${RUN}`,
      email: `otp-${RUN}@telephone.catalog.invalid`,
      phoneNumber: `+23767${((RUN + 3333) % 10000000).toString().padStart(7, "0")}`,
      phoneNumberVerified: true,
    },
  });
  userId = u.id;
  const v = await prisma.seller.create({
    data: {
      userId,
      phone: u.phoneNumber as string,
      businessName: `Boutique otp ${RUN}`,
      slug: `boutique-otp-${RUN}`,
      city: "Douala",
    },
  });
  sellerId = v.id;

  otp = new PayoutOtpStore({ prisma, secret: `secret-de-test-${RUN}` });
  sms = new SmsEnMemoire();
  app = payoutRoutes({
    prisma,
    maintenant,
    otp,
    sms,
    otpStore: new MagasinTentatives(),
    session: {
      prisma,
      session: async () => ({ user: { id: userId, phoneNumber: null } }),
    },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

const poste = (chemin: string, corps: unknown) =>
  app.fetch(
    new Request(`http://x${chemin}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "41.202.0.5" },
      body: JSON.stringify(corps),
    }),
  );

describeDb("OTP de reversement, contre la base", () => {
  it("le code n'est JAMAIS stocke en clair", async () => {
    const { code } = await otp.emettre(sellerId, NOUVEAU, NOW);
    const lignes = await prisma.payoutOtp.findMany({ where: { sellerId } });
    expect(lignes.length).toBeGreaterThan(0);
    for (const l of lignes) {
      expect(l.codeHash).not.toContain(code);
      expect(l.codeHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("emettre CONSOMME les codes precedents — un seul code vivant a la fois", async () => {
    await otp.emettre(sellerId, NOUVEAU, NOW);
    const { code } = await otp.emettre(sellerId, NOUVEAU, NOW);
    const vivants = await prisma.payoutOtp.count({ where: { sellerId, consumedAt: null } });
    expect(vivants).toBe(1);
    // Et c'est bien le dernier qui vit.
    const v = await otp.verifier(sellerId, code, NOW);
    expect(v.ok).toBe(true);
  });

  it("un code juste ne vaut QU'UNE FOIS", async () => {
    const { code } = await otp.emettre(sellerId, NOUVEAU, NOW);
    expect((await otp.verifier(sellerId, code, NOW)).ok).toBe(true);
    const rejeu = await otp.verifier(sellerId, code, NOW);
    expect(rejeu).toMatchObject({ ok: false, raison: "code_deja_utilise" });
  });

  it("trois saisies fausses brulent le code, la quatrieme ne peut plus rien", async () => {
    const { code } = await otp.emettre(sellerId, NOUVEAU, NOW);
    const faux = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < ESSAIS_MAX; i++) {
      expect(await otp.verifier(sellerId, faux, NOW)).toMatchObject({
        ok: false,
        raison: "code_incorrect",
      });
    }
    // Meme le BON code ne passe plus : la ligne est brulee.
    expect(await otp.verifier(sellerId, code, NOW)).toMatchObject({
      ok: false,
      raison: "code_deja_utilise",
    });
  });

  it("un code expire est refuse POUR expiration", async () => {
    const { code } = await otp.emettre(sellerId, NOUVEAU, NOW);
    const tard = new Date(NOW.getTime() + DUREE_OTP_MS + 1000);
    expect(await otp.verifier(sellerId, code, tard)).toMatchObject({
      ok: false,
      raison: "code_expire",
    });
  });

  it("POST /code envoie au NOUVEAU numero et ne renvoie pas le code", async () => {
    const r = await poste("/code", { nouveauNumero: NOUVEAU });
    expect(r.status).toBe(200);
    const corps = (await r.json()) as Record<string, unknown>;
    expect(corps).toMatchObject({ envoye: true, numero: NOUVEAU });
    const envoye = sms.envoyes.at(-1);
    expect(envoye?.to).toBe(NOUVEAU);
    expect(envoye?.kind).toBe("otp_reversement");
    // Le code est dans le SMS, et nulle part dans la reponse HTTP.
    const code = sms.dernierCode(NOUVEAU) as string;
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(corps)).not.toContain(code);
  });

  it("un CODE FAUX est refuse et laisse une trace au journal", async () => {
    await poste("/code", { nouveauNumero: NOUVEAU });
    const code = sms.dernierCode(NOUVEAU) as string;
    const faux = code === "000000" ? "111111" : "000000";
    const avant = await prisma.sellerAuditEvent.count({ where: { sellerId } });

    const r = await poste("/", { nouveauNumero: NOUVEAU, code: faux });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ erreur: "code_incorrect" });

    expect(await prisma.sellerAuditEvent.count({ where: { sellerId } })).toBe(avant + 1);
    const j = await prisma.sellerAuditEvent.findFirst({
      where: { sellerId, kind: "reversement_refuse" },
      orderBy: { at: "desc" },
    });
    expect(j?.payload).toMatchObject({ raison: "verification_absente", ip: "41.202.0.5" });
    // Le journal ne porte pas le code, ni le vrai ni le faux.
    expect(JSON.stringify(j?.payload)).not.toContain(code);
    expect(JSON.stringify(j?.payload)).not.toContain(faux);

    // Et le numero n'a pas bouge.
    const v = await prisma.seller.findUnique({ where: { id: sellerId } });
    expect(v?.payoutPhone).not.toBe(NOUVEAU);
  });

  it("un code JUSTE deplace le numero et le journalise", async () => {
    await poste("/code", { nouveauNumero: NOUVEAU });
    const code = sms.dernierCode(NOUVEAU) as string;

    const r = await poste("/", { nouveauNumero: NOUVEAU, code });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ payoutPhone: NOUVEAU, payoutOperator: "orange" });

    const v = await prisma.seller.findUnique({ where: { id: sellerId } });
    expect(v?.payoutPhone).toBe(NOUVEAU);
    const j = await prisma.sellerAuditEvent.findFirst({
      where: { sellerId, kind: "reversement_modifie" },
      orderBy: { at: "desc" },
    });
    expect(j?.payload).toMatchObject({ nouveau: NOUVEAU });
  });

  it("un sellerId pose dans le CORPS ne deplace rien — l'identite vient de la session", async () => {
    const autre = await prisma.seller.create({
      data: {
        phone: `+23767${((RUN + 4444) % 10000000).toString().padStart(7, "0")}`,
        businessName: `Victime ${RUN}`,
        slug: `victime-${RUN}`,
        city: "Yaounde",
      },
    });
    const cible = `+23769${((RUN + 55555) % 10000000).toString().padStart(7, "0")}`;

    await poste("/code", { nouveauNumero: cible });
    const code = sms.dernierCode(cible) as string;
    const r = await poste("/", { sellerId: autre.id, nouveauNumero: cible, code });
    expect(r.status).toBe(200);

    // La vendeuse de la session a bouge ; l'autre n'a pas ete touchee.
    const victime = await prisma.seller.findUnique({ where: { id: autre.id } });
    expect(victime?.payoutPhone).toBeNull();
    const moi = await prisma.seller.findUnique({ where: { id: sellerId } });
    expect(moi?.payoutPhone).toBe(cible);
  });

  it("sans session, tout est refuse en 401", async () => {
    const nu = payoutRoutes({
      prisma,
      maintenant,
      otp,
      sms,
      otpStore: new MagasinTentatives(),
      session: { prisma, session: async () => null },
    });
    for (const chemin of ["/code", "/"]) {
      const r = await nu.fetch(
        new Request(`http://x${chemin}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nouveauNumero: NOUVEAU, code: "123456" }),
        }),
      );
      expect(r.status, chemin).toBe(401);
    }
  });
});

describe("comparerEnTempsConstant", () => {
  it("egalite et inegalite, longueurs differentes comprises", () => {
    expect(comparerEnTempsConstant("abc", "abc")).toBe(true);
    expect(comparerEnTempsConstant("abc", "abd")).toBe(false);
    // timingSafeEqual leve sur des longueurs differentes : la garde est ici.
    expect(comparerEnTempsConstant("abc", "abcd")).toBe(false);
  });
});
