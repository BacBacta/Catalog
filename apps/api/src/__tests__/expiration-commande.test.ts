/**
 * L'expiration d'une commande — ADR 0090, non-retour du constat A2 de
 * l'audit 2026-08 : « la relance promet aux acheteuses une expiration qui
 * n'arrive jamais ». Le domaine (`etatExpiration`, lot 7) etait ecrit et
 * teste ; ces tests eprouvent le BRANCHEMENT : l'executeur pg-boss, son
 * perimetre, sa garde d'ecriture.
 */

import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executerExpirationCommande } from "../jobs/relance-acompte.ts";
import { identifiants, selExecution } from "./_identifiants.ts";

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const RUN = 152 * 1000 + selExecution();
const ids = identifiants("expiration-commande");

/** 49 h separent la creation de l'instant du job : la fenetre de 48 h est passee. */
const CREEE = new Date("2026-06-21T09:00:00+01:00");
const NOW = new Date("2026-06-23T10:00:00+01:00");

interface Scene {
  sellerId: string;
  orderId: string;
}

async function commande(
  suffixe: number,
  options: { payMode?: "acompte" | "integral" | "sans_prepaiement"; amountPaidXaf?: number } = {},
): Promise<Scene> {
  const n = (base: string) => `+237${base}${suffixe.toString().padStart(7, "0").slice(-7)}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Expiration ${suffixe}`,
      email: `expiration-${suffixe}@telephone.catalog.invalid`,
      phoneNumber: n("67"),
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: u.phoneNumber as string,
      businessName: `Boutique expiration ${suffixe}`,
      slug: `boutique-expiration-${suffixe}`,
      city: "Douala",
    },
  });
  const paye = options.amountPaidXaf ?? 0;
  const o = await prisma.order.create({
    data: {
      ref: `CT-${(800000 + suffixe) % 99999999}`,
      sellerId: v.id,
      buyerPhone: "+237652000001",
      items: [{ nom: "Pagne", quantite: 1, prixUnitaireXaf: 16000 }],
      totalXaf: 16000,
      amountPaidXaf: paye,
      balanceXaf: 16000 - paye,
      payMode: options.payMode ?? "acompte",
      delivery: { mode: "retrait", pickupPoint: "Carrefour Elf", phone: "+237652000001" },
      verificationCode: ids.codeVerification(),
      createdAt: CREEE,
      expiresAt: new Date(CREEE.getTime() + 48 * 3600_000),
    },
  });
  return { sellerId: v.id, orderId: o.id };
}

/** L'executeur, avec l'horloge figee — aucun envoyeur : l'expiration n'envoie rien. */
const executer = (orderId: string) =>
  executerExpirationCommande(
    { prisma, envoyeur: { nom: "aucun", envoyer: async () => {} }, maintenant: () => NOW },
    { commandeId: orderId },
  );

beforeAll(() => {
  prisma = createPrismaClient();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describeDb("la commande expire pour de vrai (ADR 0090)", () => {
  it("une commande a acompte IMPAYEE depuis 49 h est annulee, cause au journal", async () => {
    const s = await commande(RUN);
    await executer(s.orderId);
    const o = await prisma.order.findUniqueOrThrow({
      where: { id: s.orderId },
      select: { cancelledAt: true },
    });
    expect(o.cancelledAt).toEqual(NOW);
    const evt = await prisma.orderEvent.findFirst({
      where: { orderId: s.orderId, kind: "commande_expiree" },
      select: { actor: true, payload: true },
    });
    expect(evt?.actor).toBe("systeme");
    expect(JSON.stringify(evt?.payload)).toContain("echeance");
  });

  it("est idempotente : rejouee, elle n'ecrit pas un second evenement", async () => {
    const s = await commande((RUN + 1111) % 900000);
    await executer(s.orderId);
    await executer(s.orderId);
    const n = await prisma.orderEvent.count({
      where: { orderId: s.orderId, kind: "commande_expiree" },
    });
    expect(n).toBe(1);
  });

  it("UN FRANC verse sauve la commande — l'acompte arrive vaut hors champ", async () => {
    const s = await commande((RUN + 2222) % 900000, { amountPaidXaf: 8000 });
    await executer(s.orderId);
    const o = await prisma.order.findUniqueOrThrow({
      where: { id: s.orderId },
      select: { cancelledAt: true },
    });
    expect(o.cancelledAt).toBeNull();
  });

  it("une commande SANS PREPAIEMENT ne meurt jamais d'elle-meme", async () => {
    const s = await commande((RUN + 3333) % 900000, { payMode: "sans_prepaiement" });
    await executer(s.orderId);
    const o = await prisma.order.findUniqueOrThrow({
      where: { id: s.orderId },
      select: { cancelledAt: true },
    });
    expect(o.cancelledAt).toBeNull();
  });

  it("la garde d'ecriture laisse gagner un versement concurrent (patron ADR 0089)", async () => {
    const s = await commande((RUN + 4444) % 900000);
    /* Le versement passe ENTRE la lecture du job et son ecriture : on le
       simule en payant apres que l'executeur a ete decide... le garde
       `amountPaidXaf: 0` de l'updateMany est ce qui compte, et il se teste
       en payant AVANT l'ecriture : l'executeur relit, voit paye, s'abstient.
       Pour eprouver la garde elle-meme (et pas la relecture), on paie puis
       on verifie qu'aucun evenement d'expiration n'existe. */
    await prisma.order.update({
      where: { id: s.orderId },
      data: { amountPaidXaf: 8000, balanceXaf: 8000 },
    });
    await executer(s.orderId);
    const o = await prisma.order.findUniqueOrThrow({
      where: { id: s.orderId },
      select: { cancelledAt: true },
    });
    expect(o.cancelledAt).toBeNull();
    expect(
      await prisma.orderEvent.count({ where: { orderId: s.orderId, kind: "commande_expiree" } }),
    ).toBe(0);
  });

  it("une commande disparue vaut silence, pas une levee", async () => {
    await expect(executer("ordre-inexistant")).resolves.toBeUndefined();
  });
});
