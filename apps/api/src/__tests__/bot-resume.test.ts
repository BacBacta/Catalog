import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { executerResumeMatin } from "../jobs/relance-acompte.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * Le resume du matin, de bout en bout — ADR 0100 (lot P6).
 *
 * Ce que le domaine ne peut pas prouver seul : la deduplication (le travail
 * relance le meme jour n'envoie pas deux fois — et elle s'ecrit MEME pour un
 * silence), l'opt-out persiste et reversible, et la remise par la porte des
 * notifications (fenetre ouverte → message ; fermee → la carte attend,
 * JAMAIS un gabarit).
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const ids = identifiants("bot-resume");
/** 07:30 a Douala. */
const MATIN = new Date("2026-08-16T07:30:00+01:00");
const HIER = new Date("2026-08-15T15:00:00+01:00");

class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "memoire";
  readonly envoyes: MessageSortant[] = [];
  async envoyer(m: MessageSortant): Promise<void> {
    this.envoyes.push(m);
  }
}

const texteEntrant = (de: string, corps: string) => ({
  messages: [{ from: de, type: "text", text: { body: corps } }],
});

const corps = (m: MessageSortant): string => (m as { text?: { body?: string } }).text?.body ?? "";

interface Scene {
  waId: string;
  phone: string;
  sellerId: string;
  envoyeur: EnvoyeurMemoire;
  deps: BotDeps;
}

async function scene(options: { fenetreOuverte?: boolean } = {}): Promise<Scene> {
  const n = ids.suivant();
  const waId = `23767${String(n).padStart(7, "0")}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse resume ${n}`,
      email: ids.email("bot-resume"),
      phoneNumber: `+${waId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${waId}`,
      businessName: `Boutique resume ${n}`,
      slug: `bot-resume-${n}`,
      city: "Douala",
    },
  });
  await prisma.botConversation.create({
    data: {
      phone: `+${waId}`,
      etat: { nom: "accueil" },
      updatedAt:
        options.fenetreOuverte === false
          ? new Date(MATIN.getTime() - 40 * 3600_000)
          : new Date(MATIN.getTime() - 60_000),
    },
  });
  const envoyeur = new EnvoyeurMemoire();
  return {
    waId,
    phone: `+${waId}`,
    sellerId: v.id,
    envoyeur,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      maintenant: () => MATIN,
      aleatoire: (nOctets: number) => new Uint8Array(randomBytes(nOctets)),
    },
  };
}

/** Une commande d'HIER, encore a preparer, acompte deja verse. */
async function commandeDHier(s: Scene): Promise<{ ref: string }> {
  const n = ids.suivant();
  return prisma.order.create({
    data: {
      sellerId: s.sellerId,
      ref: `CT-${n}`,
      buyerPhone: `+23769${String(n).padStart(7, "0")}`,
      payMode: "acompte",
      totalXaf: 21500,
      amountPaidXaf: 10750,
      balanceXaf: 10750,
      items: [{ nom: "Sac tresse", quantite: 2, prixUnitaireXaf: 10750 }],
      delivery: {
        mode: "livraison",
        city: "Douala",
        quartier: "Bonapriso",
        landmark: "pres de la pharmacie du Rail",
        phone: `+23769${String(n).padStart(7, "0")}`,
      },
      verificationCode: ids.codeVerification(),
      createdAt: HIER,
      expiresAt: new Date(HIER.getTime() + 48 * 3600_000),
    },
    select: { ref: true },
  });
}

const resumesRecus = (s: Scene) =>
  s.envoyeur.envoyes.filter(
    (m) => (m as { to?: string }).to === s.waId && corps(m).includes("Votre matin"),
  );

describeDb("le resume du matin — ADR 0100", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("avec des faits : la carte part, une seule fois meme si le travail est relance", async () => {
    const s = await scene();
    const o = await commandeDHier(s);

    await executerResumeMatin(s.deps, MATIN, { sellerId: s.sellerId });
    await executerResumeMatin(s.deps, MATIN, { sellerId: s.sellerId });

    const cartes = resumesRecus(s);
    expect(cartes).toHaveLength(1);
    expect(corps(cartes[0] as MessageSortant)).toContain("🛒 Commandes : 1");
    expect(corps(cartes[0] as MessageSortant)).toContain(`préparer ${o.ref}`);
    /* La premiere carte annonce la porte de sortie. */
    expect(corps(cartes[0] as MessageSortant)).toContain("« stop résumé »");
  });

  it("SANS faits : silence — et la deduplication s'ecrit quand meme", async () => {
    const s = await scene();
    await executerResumeMatin(s.deps, MATIN, { sellerId: s.sellerId });
    expect(resumesRecus(s)).toHaveLength(0);
    expect(await prisma.resumeMatin.count({ where: { sellerId: s.sellerId } })).toBe(1);
  });

  it("« stop résumé » : plus rien — et « résumé » le remet en route", async () => {
    const s = await scene();
    await commandeDHier(s);

    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "stop résumé"));
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("plus de résumé");
    await executerResumeMatin(s.deps, MATIN, { sellerId: s.sellerId });
    expect(resumesRecus(s)).toHaveLength(0);
    /* L'opt-out n'ecrit pas de deduplication : la vendeuse est exclue AVANT. */
    expect(await prisma.resumeMatin.count({ where: { sellerId: s.sellerId } })).toBe(0);

    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "résumé"));
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("reviendra");
    await executerResumeMatin(s.deps, MATIN, { sellerId: s.sellerId });
    expect(resumesRecus(s)).toHaveLength(1);
  });

  it("fenetre FERMEE : la carte attend le prochain entrant — JAMAIS un gabarit", async () => {
    const s = await scene({ fenetreOuverte: false });
    await commandeDHier(s);

    await executerResumeMatin(s.deps, MATIN, { sellerId: s.sellerId });
    expect(resumesRecus(s)).toHaveLength(0);
    expect(s.envoyeur.envoyes.filter((m) => m.type === "template")).toHaveLength(0);
    const enAttente = await prisma.botNotification.findMany({
      where: { phone: s.phone, remisLe: null },
    });
    expect(enAttente).toHaveLength(1);
    expect(enAttente[0]?.corps).toContain("Votre matin");
  });

  it("une vendeuse sans conversation bot n'est pas visee — aucun fil ou poser la carte", async () => {
    const s = await scene();
    await commandeDHier(s);
    await prisma.botConversation.delete({ where: { phone: s.phone } });
    await executerResumeMatin(s.deps, MATIN, { sellerId: s.sellerId });
    expect(s.envoyeur.envoyes).toHaveLength(0);
    expect(await prisma.resumeMatin.count({ where: { sellerId: s.sellerId } })).toBe(0);
  });
});
