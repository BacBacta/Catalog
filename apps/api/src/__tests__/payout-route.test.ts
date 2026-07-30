import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changerNumeroDeReversement } from "../routes/payout.ts";

/**
 * Le changement de reversement, prouve DE BOUT EN BOUT contre une vraie base.
 *
 * Les tests du domaine prouvent la decision. Ceux-ci prouvent la persistance :
 * qu'un refus laisse bien une trace, et qu'un journal reecrivable est impossible.
 * C'est le critere central de la definition de terminé du lot 4 — « un
 * changement sans OTP est rejete ET journalise » — et il ne peut pas etre
 * verifie sans base.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const RUN = Date.now() % 90000;
let sellerId: string;

const NOW = new Date();
const maintenant = () => NOW;
const il_y_a = (min: number) => new Date(NOW.getTime() - min * 60_000);

beforeAll(async () => {
  if (!URL) return;
  prisma = createPrismaClient(URL);
  const v = await prisma.seller.create({
    data: {
      phone: `+23767${RUN.toString().padStart(7, "0")}`,
      businessName: `Test reversement ${RUN}`,
      slug: `test-reversement-${RUN}`,
      city: "Douala",
      payoutPhone: `+23769${RUN.toString().padStart(7, "0")}`,
      payoutPhoneVerifiedAt: il_y_a(60 * 24),
    },
  });
  sellerId = v.id;
});

afterAll(async () => {
  await prisma?.$disconnect();
});

const NOUVEAU = `+23769${((RUN + 11111) % 10000000).toString().padStart(7, "0")}`;

describeDb("changement de reversement, persistance comprise", () => {
  it("REFUSE sans verification, ET ecrit le refus au journal", async () => {
    const avant = await prisma.sellerAuditEvent.count({ where: { sellerId } });

    const r = await changerNumeroDeReversement(
      { prisma, maintenant },
      {
        sellerId,
        nouveauNumero: NOUVEAU,
        verification: null,
        acteur: { role: "vendeuse", ip: "41.202.0.7" },
      },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.raison).toBe("verification_absente");

    // La trace existe.
    const apres = await prisma.sellerAuditEvent.findMany({
      where: { sellerId, kind: "reversement_refuse" },
      orderBy: { at: "desc" },
      take: 1,
    });
    expect(await prisma.sellerAuditEvent.count({ where: { sellerId } })).toBe(avant + 1);
    expect(apres[0]?.payload).toMatchObject({ raison: "verification_absente", ip: "41.202.0.7" });

    // Et le numero n'a PAS bouge.
    const v = await prisma.seller.findUnique({ where: { id: sellerId } });
    expect(v?.payoutPhone).not.toBe(NOUVEAU);
  });

  it("accepte avec une verification du BON numero, et journalise la modification", async () => {
    const r = await changerNumeroDeReversement(
      { prisma, maintenant },
      {
        sellerId,
        nouveauNumero: NOUVEAU,
        verification: { numero: NOUVEAU, verifieA: il_y_a(1) },
        acteur: { role: "vendeuse" },
      },
    );

    expect(r.ok).toBe(true);
    const v = await prisma.seller.findUnique({ where: { id: sellerId } });
    expect(v?.payoutPhone).toBe(NOUVEAU);
    expect(v?.payoutOperator).toBe("orange");
    expect(v?.payoutPhoneVerifiedAt).toEqual(NOW);

    const j = await prisma.sellerAuditEvent.findFirst({
      where: { sellerId, kind: "reversement_modifie" },
      orderBy: { at: "desc" },
    });
    expect(j?.payload).toMatchObject({ nouveau: NOUVEAU });
  });

  it("le journal est en AJOUT SEUL — on ne peut pas effacer la trace d'une attaque", async () => {
    const j = await prisma.sellerAuditEvent.findFirst({ where: { sellerId } });
    expect(j).toBeTruthy();
    await expect(
      prisma.sellerAuditEvent.update({
        where: { id: j?.id as string },
        data: { kind: "rien_a_signaler" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.sellerAuditEvent.delete({ where: { id: j?.id as string } }),
    ).rejects.toThrow();
  });

  it("aucune entree de journal ne contient de code", async () => {
    const tous = await prisma.sellerAuditEvent.findMany({ where: { sellerId } });
    expect(tous.length).toBeGreaterThan(1);
    for (const e of tous) {
      expect(JSON.stringify(e.payload)).not.toMatch(/code|otp/i);
    }
  });
});
