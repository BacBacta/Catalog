import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ChiffreurInerte } from "../adapters/sms-chiffre.ts";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { describeDb } from "./_base.ts";
import { identifiants } from "./_identifiants.ts";
import { MTN_RECEPTION } from "./fixtures-sms.ts";

/**
 * Le verdict de preuve DANS le fil, contre une VRAIE base — ADR 0083.
 *
 * Ce qu'aucun test pur ne peut etablir : que le SMS colle dans WhatsApp passe
 * par LE MEME service que l'ecran de collage — INSERT qui tranche le
 * controle n° 5 par la contrainte UNIQUE, transition de la commande,
 * versement, journal — et que le fil recoit le verdict au lieu d'un lien.
 * `traiterEntree` avale ses exceptions : sans ce fichier, une erreur du
 * cablage serait parfaitement silencieuse.
 */

const URL = process.env.DATABASE_URL;

let prisma: PrismaClient;
/** L'horloge est figee : la fixture MTN porte le 23/06/2026 a 09:50. */
const NOW = new Date("2026-06-23T10:00:00+01:00");
const CREEE = new Date("2026-06-23T09:00:00+01:00");
const ids = identifiants("bot-preuve-fil");

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

const tout = (e: EnvoyeurMemoire): string => e.envoyes.map(corps).join("\n");

interface Scene {
  vendeuseWaId: string;
  sellerId: string;
  orderId: string;
  ref: string;
  envoyeur: EnvoyeurMemoire;
  notifiees: string[];
  deps: BotDeps;
}

/** Une vendeuse, et selon le cas une ou deux commandes au solde ouvert. */
async function scene(
  options: { totalXaf?: number; secondeCommande?: boolean } = {},
): Promise<Scene> {
  const { totalXaf = 26800, secondeCommande = false } = options;
  const n = ids.suivant();
  const vendeuseWaId = `23767${String(n).padStart(7, "0")}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse preuve-fil ${n}`,
      email: `preuve-fil-${n}@telephone.catalog.invalid`,
      phoneNumber: `+${vendeuseWaId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${vendeuseWaId}`,
      businessName: `Boutique preuve-fil ${n}`,
      slug: `preuve-fil-${n}`,
      city: "Douala",
      payoutPhone: "+237656746215",
      payoutOperator: "mtn",
      payoutPhoneVerifiedAt: CREEE,
    },
  });
  const commande = async () =>
    prisma.order.create({
      data: {
        ref: `CT-${(100000 + ids.suivant()) % 99999999}`,
        sellerId: v.id,
        /* Le numero de l'acheteuse est celui du SMS de reception MTN. */
        buyerPhone: "+237652000001",
        items: [{ nom: "Pagne", quantite: 1, prixUnitaireXaf: totalXaf }],
        totalXaf,
        amountPaidXaf: 0,
        balanceXaf: totalXaf,
        payMode: "integral",
        delivery: { mode: "retrait", pickupPoint: "Carrefour Elf", phone: "+237652000001" },
        verificationCode: ids.codeVerification(),
        createdAt: CREEE,
        expiresAt: new Date(CREEE.getTime() + 48 * 3600_000),
      },
      select: { id: true, ref: true },
    });
  const o = await commande();
  if (secondeCommande) await commande();

  const envoyeur = new EnvoyeurMemoire();
  const notifiees: string[] = [];
  return {
    vendeuseWaId,
    sellerId: v.id,
    orderId: o.id,
    ref: o.ref,
    envoyeur,
    notifiees,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      maintenant: () => NOW,
      aleatoire: (nOctets: number) => new Uint8Array(randomBytes(nOctets)),
      preuve: {
        chiffreur: new ChiffreurInerte({ NODE_ENV: "test" }),
        apresPreuve: async (orderId: string) => {
          notifiees.push(orderId);
        },
      },
    },
  };
}

describeDb("le verdict de preuve dans le fil (ADR 0083)", () => {
  beforeAll(() => {
    prisma = createPrismaClient(URL as string);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("UNE commande ouverte : le SMS passe les sept controles ICI et la commande avance", async () => {
    const s = await scene();
    const tx = ids.txMtn();
    await traiterLivraisonBot(
      s.deps,
      texteEntrant(s.vendeuseWaId, MTN_RECEPTION.replace("17600000002", tx)),
    );

    /* Le fil recoit le VERDICT, pas un lien vers l'app. */
    const fil = tout(s.envoyeur);
    expect(fil).toMatch(/Paiement prouvé/);
    expect(fil).toContain(s.ref);
    expect(fil).not.toMatch(/collez-le ici/);

    /* La commande a avance par le MEME service que la route. */
    const o = await prisma.order.findUniqueOrThrow({
      where: { id: s.orderId },
      select: { proofState: true, amountPaidXaf: true, balanceXaf: true },
    });
    expect(o.proofState).toBe("prouve");
    expect(o.amountPaidXaf).toBe(26800);
    expect(o.balanceXaf).toBe(0);

    const preuve = await prisma.paymentProof.findFirst({
      where: { orderId: s.orderId },
      select: { operatorTxId: true, verdict: true },
    });
    expect(preuve?.operatorTxId).toBe(tx);
    expect(preuve?.verdict).toBe("accepte");

    const journal = await prisma.ledgerEntry.count({
      where: { orderId: s.orderId, reason: "paiement_prouve" },
    });
    expect(journal).toBe(1);

    /* L'acheteuse est prevenue APRES commit — le cablage `apresPreuve`. */
    expect(s.notifiees).toEqual([s.orderId]);
  });

  it("un refus se DIT, avec l'explication du controle echoue — et rien ne s'ecrit", async () => {
    /* Attendu 50 000, le SMS n'en porte que 26 800 : controle n° 2 en echec. */
    const s = await scene({ totalXaf: 50000 });
    await traiterLivraisonBot(
      s.deps,
      texteEntrant(s.vendeuseWaId, MTN_RECEPTION.replace("17600000002", ids.txMtn())),
    );

    const fil = tout(s.envoyeur);
    expect(fil).toMatch(/n'a pas passé les contrôles/);
    /* L'explication du controle, redigee pour la vendeuse — jamais le texte du SMS. */
    expect(fil).toMatch(/manque|attendu/i);
    expect(fil).toContain(`/commandes/${s.orderId}/preuve`);
    expect(fil).not.toContain("Votre nouveau solde");

    expect(await prisma.paymentProof.count({ where: { orderId: s.orderId } })).toBe(0);
    const o = await prisma.order.findUniqueOrThrow({
      where: { id: s.orderId },
      select: { proofState: true },
    });
    expect(o.proofState).toBe("attendu");
    expect(s.notifiees).toEqual([]);
  });

  it("un identifiant deja reclame ailleurs est refuse ICI aussi — controle n° 5, reseau-large", async () => {
    const a = await scene();
    const b = await scene();
    const tx = ids.txMtn();
    const sms = MTN_RECEPTION.replace("17600000002", tx);
    await traiterLivraisonBot(a.deps, texteEntrant(a.vendeuseWaId, sms));
    await traiterLivraisonBot(b.deps, texteEntrant(b.vendeuseWaId, sms));

    expect(tout(a.envoyeur)).toMatch(/Paiement prouvé/);
    expect(tout(b.envoyeur)).toMatch(/n'a pas passé les contrôles/);
    expect(await prisma.paymentProof.count({ where: { orderId: b.orderId } })).toBe(0);
    expect(b.notifiees).toEqual([]);
  });

  it("PLUSIEURS commandes ouvertes : on aiguille encore vers l'app, rien ne s'ecrit", async () => {
    const s = await scene({ secondeCommande: true });
    await traiterLivraisonBot(
      s.deps,
      texteEntrant(s.vendeuseWaId, MTN_RECEPTION.replace("17600000002", ids.txMtn())),
    );

    const fil = tout(s.envoyeur);
    expect(fil).toMatch(/Plusieurs commandes/);
    expect(fil).toContain("https://app.test/commandes");
    expect(await prisma.paymentProof.count({ where: { orderId: s.orderId } })).toBe(0);
  });

  it("sans la porte `preuve`, le fil aiguille comme avant — rien ne casse", async () => {
    const s = await scene();
    const { preuve: _porte, ...sansPorte } = s.deps;
    await traiterLivraisonBot(
      sansPorte as BotDeps,
      texteEntrant(s.vendeuseWaId, MTN_RECEPTION.replace("17600000002", ids.txMtn())),
    );
    const fil = tout(s.envoyeur);
    expect(fil).toMatch(/collez-le ici/);
    expect(await prisma.paymentProof.count({ where: { orderId: s.orderId } })).toBe(0);
  });
});
