import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sellerRoutes } from "../routes/seller.ts";
import { describeDb } from "./_base.ts";
import { selExecution } from "./_identifiants.ts";

/**
 * Le RENOMMAGE d'une boutique — ADR 0092, constat C-002 de l'audit du
 * 13/08/2026.
 *
 * Ce que ce fichier etablit, et qu'aucun test de domaine ne peut etablir :
 * que le nom change VRAIMENT en base, que le journal d'audit en garde trace, et
 * surtout que **le slug ne bouge pas**. Ce dernier point est le plus important
 * des trois : l'adresse a peut-etre deja ete partagee, et une regression y
 * serait invisible partout sauf chez l'acheteuse (ADR 0073).
 */

const URL = process.env.DATABASE_URL;

let prisma: PrismaClient;
/* Meme schema que `payout-route.test.ts` : un bloc par fichier, plus le sel
   d'execution. Le bloc 340 n'est utilise par aucun autre fichier. */
const RUN = 340 * 1000 + selExecution();
let sellerId: string;
let userId: string;

const SLUG = `test-renommage-${RUN}`;

beforeAll(async () => {
  if (!URL) return;
  prisma = createPrismaClient(URL);
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse renommage ${RUN}`,
      email: `renommage-${RUN}@telephone.catalog.invalid`,
      phoneNumber: `+23767${RUN.toString().padStart(7, "0")}`,
      phoneNumberVerified: true,
    },
  });
  userId = u.id;
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+23767${RUN.toString().padStart(7, "0")}`,
      businessName: "est-ce que vous vendez des chaussures pour bébé ?",
      slug: SLUG,
      city: "Douala",
    },
  });
  sellerId = v.id;
});

afterAll(async () => {
  await prisma?.$disconnect();
});

/** Une session qui resout vers notre vendeuse — le reste de la pile est reel. */
const routes = () =>
  sellerRoutes({
    prisma,
    session: async () => ({ user: { id: userId, phoneNumber: null } }),
  } as never);

const appeler = (corps: unknown) =>
  routes().request("/renommer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corps),
  });

describeDb("renommer une boutique (ADR 0092)", () => {
  it("le nom change en base, et le journal d'audit le dit", async () => {
    const r = await appeler({ businessName: "Chez Solange", city: "Bafoussam" });
    expect(r.status).toBe(200);

    const v = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
    expect(v.businessName).toBe("Chez Solange");
    expect(v.city).toBe("Bafoussam");

    const journal = await prisma.sellerAuditEvent.findMany({
      where: { sellerId, kind: "boutique_renommee" },
    });
    expect(journal).toHaveLength(1);
    expect(journal[0]?.actor).toBe("vendeuse_app");
  });

  it("le SLUG ne bouge pas — l'adresse a peut-être déjà été partagée", async () => {
    /* Le test le plus important du fichier. Une regression ici casserait les
       liens deja poses en Statut, dans une chaine, ou dans le QR d'une carte
       imprimee — et cela ne se verrait ni en CI ni chez la vendeuse. */
    const r = await appeler({ businessName: "Chez Solange Deux", city: "Douala" });
    const corps = (await r.json()) as { slug: string };
    expect(corps.slug).toBe(SLUG);

    const v = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
    expect(v.slug).toBe(SLUG);
  });

  it("un nom trop court est refusé, et rien n'est écrit", async () => {
    const avant = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
    const r = await appeler({ businessName: "X", city: "Douala" });
    expect(r.status).toBe(422);
    const apres = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
    expect(apres.businessName).toBe(avant.businessName);
  });

  it("une ville de 4 000 caractères est refusée — la MÊME borne qu'à la création", async () => {
    /* Deux portes qui ecrivent le meme champ ne peuvent pas diverger sur ce
       qu'elles acceptent : c'est la lecon de l'ADR 0050. */
    const r = await appeler({ businessName: "Chez Solange", city: "a".repeat(4000) });
    expect(r.status).toBe(422);
  });

  it("renommer avec le même nom n'écrit rien au journal", async () => {
    const v = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
    const avant = await prisma.sellerAuditEvent.count({
      where: { sellerId, kind: "boutique_renommee" },
    });
    const r = await appeler({ businessName: v.businessName, city: v.city });
    expect(r.status).toBe(200);
    const apres = await prisma.sellerAuditEvent.count({
      where: { sellerId, kind: "boutique_renommee" },
    });
    /* Meme regle que la bascule des conges : une bascule sans changement
       n'entre pas au journal, sinon le journal cesse de repondre a « quand ? ». */
    expect(apres).toBe(avant);
  });
});
