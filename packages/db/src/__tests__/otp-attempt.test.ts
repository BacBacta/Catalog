import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "../index.ts";

/**
 * La limitation de debit, prouvee DURABLE.
 *
 * Les tests du domaine (`apps/api/src/__tests__/rate-limit.test.ts`) prouvent la
 * logique. Ceux-ci prouvent que le compteur survit au processus : c'est toute la
 * raison d'avoir une table plutot qu'une variable. Un compteur en memoire se
 * remet a zero au redeploiement, et un attaquant qui le sait attend un
 * redeploiement.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const RUN = `run-${Date.now().toString(36)}`;
const PHONE = `+2376770${(Date.now() % 100000).toString().padStart(5, "0")}`;

beforeAll(() => {
  if (URL) prisma = createPrismaClient(URL);
});
afterAll(async () => {
  if (prisma) {
    await prisma.otpAttempt.deleteMany({ where: { kind: RUN } });
    await prisma.$disconnect();
  }
});

describeDb("table otp_attempt", () => {
  it("conserve les tentatives et les retrouve par numero", async () => {
    const base = new Date();
    for (let i = 0; i < 3; i++) {
      await prisma.otpAttempt.create({
        data: {
          phone: PHONE,
          ip: "41.202.0.1",
          kind: RUN,
          at: new Date(base.getTime() + i * 1000),
        },
      });
    }
    // Une NOUVELLE connexion : c'est le point du test. Le compteur ne vit pas
    // dans le processus qui a ecrit, il vit en base.
    const autre = createPrismaClient(URL as string);
    try {
      const n = await autre.otpAttempt.count({ where: { phone: PHONE, kind: RUN } });
      expect(n).toBe(3);
    } finally {
      await autre.$disconnect();
    }
  });

  it("se purge — cette table n'est PAS en ajout seul, et c'est voulu", async () => {
    // Les journaux d'audit sont proteges par un trigger. Celui-ci ne l'est pas :
    // c'est de la donnee operationnelle avec une duree de conservation, et sans
    // purge elle grossirait sans fin.
    const vieux = new Date(Date.now() - 40 * 86_400_000);
    await prisma.otpAttempt.create({
      data: { phone: PHONE, ip: "41.202.0.9", kind: RUN, at: vieux },
    });
    const { count } = await prisma.otpAttempt.deleteMany({
      where: { kind: RUN, at: { lt: new Date(Date.now() - 30 * 86_400_000) } },
    });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("les index de lecture existent — la requete tourne a chaque demande d'OTP", async () => {
    const idx = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'otp_attempt'`,
    );
    const noms = idx.map((i) => i.indexname).join(" ");
    expect(noms).toMatch(/phone_at/);
    expect(noms).toMatch(/ip_at/);
  });
});
