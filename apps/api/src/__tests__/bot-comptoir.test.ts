import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * Le comptoir vendeuse contre une VRAIE base — rang 1, ADR 0069.
 *
 * Ce que la machine pure ne peut pas etablir : que la commande NAIT, par
 * l'unique moteur, avec le plan de paiement du reversement reel ; que le
 * message a transferer sort SEUL et sans jeton ; et que le journal d'audit dit
 * qui a cree — la vendeuse, par le comptoir.
 *
 * `traiterEntree` avale ses exceptions pour ne jamais bloquer une livraison :
 * un defaut de service y serait parfaitement silencieux sans ce fichier.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const NOW = new Date("2026-08-11T12:00:00+01:00");
const ids = identifiants("bot-comptoir");

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
const bouton = (de: string, id: string) => ({
  messages: [
    {
      from: de,
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id } },
    },
  ],
});

const corps = (m: MessageSortant): string =>
  (m as { text?: { body?: string }; interactive?: { body?: { text?: string } } }).text?.body ??
  (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ??
  "";

interface Scene {
  vendeuseWaId: string;
  sellerId: string;
  envoyeur: EnvoyeurMemoire;
  deps: BotDeps;
}

async function scene(options: { reversement?: boolean; enConges?: boolean } = {}): Promise<Scene> {
  const { reversement = true, enConges = false } = options;
  const n = ids.suivant();
  const vendeuseWaId = `23767${String(n).padStart(7, "0")}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse comptoir ${n}`,
      email: `comptoir-${n}@telephone.catalog.invalid`,
      phoneNumber: `+${vendeuseWaId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${vendeuseWaId}`,
      businessName: `Boutique comptoir ${n}`,
      slug: `comptoir-${n}`,
      city: "Douala",
      ...(reversement
        ? { payoutPhone: "+237656746215", payoutOperator: "mtn", payoutPhoneVerifiedAt: NOW }
        : {}),
      ...(enConges ? { congesDepuis: NOW } : {}),
    },
  });

  const envoyeur = new EnvoyeurMemoire();
  return {
    vendeuseWaId,
    sellerId: v.id,
    envoyeur,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      maintenant: () => NOW,
      aleatoire: (nOctets: number) => new Uint8Array(randomBytes(nOctets)),
    },
  };
}

/** Joue la declaration entiere, jusqu'au recapitulatif inclus. */
async function jusquAuRecap(s: Scene, cliente: string): Promise<void> {
  for (const message of ["vendu", "Robe wax grande taille", "12 500", cliente, "Carrefour Warda"]) {
    await traiterLivraisonBot(s.deps, texteEntrant(s.vendeuseWaId, message));
  }
}

describeDb("le comptoir vendeuse, de bout en bout (ADR 0069)", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("« vendu » ouvre le comptoir, quatre questions, et RIEN en base avant confirmer", async () => {
    const s = await scene();
    await jusquAuRecap(s, "677 00 11 22");
    const dits = s.envoyeur.envoyes.map(corps).join("\n---\n");
    expect(dits).toMatch(/Qu'avez-vous vendu/);
    expect(dits).toMatch(/prix convenu/);
    expect(dits).toMatch(/numéro WhatsApp de votre cliente/);
    expect(dits).toMatch(/Où se fait la remise/);
    expect(dits).toMatch(/Récapitulatif de la vente/);
    /* Le recapitulatif n'a encore rien cree. */
    const n = await prisma.order.count({ where: { sellerId: s.sellerId } });
    expect(n).toBe(0);
  });

  it("« confirmer » cree la commande au PRIX CONVENU, par l'unique moteur", async () => {
    const s = await scene();
    await jusquAuRecap(s, "677 00 11 22");
    await traiterLivraisonBot(s.deps, bouton(s.vendeuseWaId, "confirmer"));

    const commande = await prisma.order.findFirstOrThrow({
      where: { sellerId: s.sellerId },
      include: { events: true },
    });
    expect(commande.totalXaf).toBe(12500);
    /* Reversement pose : l'acompte est le MEME plan que le comptoir acheteuse
       — floor sur l'acompte, le reste au solde, total preserve. */
    expect(commande.payMode).toBe("acompte");
    /* L'acompte du est FIGE a la creation — ADR 0094 (constat A4) : le
       controle n° 2 comparera a CE montant, pas a la constante du jour. */
    expect(commande.dueBeforeXaf).toBe(6250);
    expect(commande.buyerPhone).toBe("+237677001122");
    expect(commande.delivery).toMatchObject({ mode: "retrait", pickupPoint: "Carrefour Warda" });
    /* Le journal dit QUI a cree, et par quelle porte. */
    const creation = commande.events.find((e) => e.kind === "commande_creee");
    expect(creation?.actor).toBe("vendeuse");
    expect(creation?.payload).toMatchObject({ canal: "comptoir_vendeuse" });
    /* L'article est en texte libre : aucun productId n'est invente. */
    const [ligne] = commande.items as Array<Record<string, unknown>>;
    expect(ligne?.name).toBe("Robe wax grande taille");
    expect(ligne?.productId).toBeUndefined();
  });

  it("le message a transferer sort SEUL, autosuffisant, et SANS le jeton", async () => {
    const s = await scene();
    await jusquAuRecap(s, "677 00 11 22");
    await traiterLivraisonBot(s.deps, bouton(s.vendeuseWaId, "confirmer"));

    const commande = await prisma.order.findFirstOrThrow({ where: { sellerId: s.sellerId } });
    const transferable = s.envoyeur.envoyes.map(corps).find((c) => c.includes("— commande"));
    expect(transferable, "aucun message a transferer").toBeTruthy();
    expect(transferable).toContain(commande.ref);
    expect(transferable).toContain(commande.verificationCode);
    /* 12 500 a 50 % : 6 250 dus maintenant — le plan du comptoir acheteuse. */
    expect(transferable).toMatch(/6\D?250/);
    expect(transferable).toMatch(/\*126#|\d{3}.?\d{2}.?\d{2}.?\d{2}/);
    /* JAMAIS le jeton : ce message passe par les mains de la vendeuse, et le
       controle n° 7 — la collusion a une seule voix — en depend. */
    expect(transferable).not.toContain(commande.buyerToken as string);
    expect(transferable).not.toMatch(/\/suivi\//);
  });

  it("sans reversement pose, rien n'est reclame d'avance", async () => {
    const s = await scene({ reversement: false });
    await jusquAuRecap(s, "677 00 11 22");
    await traiterLivraisonBot(s.deps, bouton(s.vendeuseWaId, "confirmer"));

    const commande = await prisma.order.findFirstOrThrow({ where: { sellerId: s.sellerId } });
    expect(commande.payMode).toBe("sans_prepaiement");
    /* Rien n'est du d'avance, et c'est FIGE aussi : zero, pas nul. */
    expect(commande.dueBeforeXaf).toBe(0);
    const transferable = s.envoyeur.envoyes.map(corps).find((c) => c.includes("— commande"));
    expect(transferable).toMatch(/se règle à la remise/);
    expect(transferable).not.toMatch(/payer maintenant/i);
  });

  it("en conges, la vente SE CREE quand meme — et le rappel part", async () => {
    /* L'ADR 0039 ferme la boutique aux commandes que des ACHETEUSES initient.
       Ici la vendeuse declare une vente qu'elle vient de conclure : la refuser
       pousserait la vente hors du moteur — la fuite exacte que le rang 1
       ferme. */
    const s = await scene({ enConges: true });
    await jusquAuRecap(s, "677 00 11 22");
    await traiterLivraisonBot(s.deps, bouton(s.vendeuseWaId, "confirmer"));

    const n = await prisma.order.count({ where: { sellerId: s.sellerId } });
    expect(n).toBe(1);
    expect(s.envoyeur.envoyes.map(corps).join("\n")).toMatch(/conges|congés|🌴/i);
  });

  it("« annuler » au recapitulatif ne cree rien, et le dit", async () => {
    const s = await scene();
    await jusquAuRecap(s, "677 00 11 22");
    await traiterLivraisonBot(s.deps, bouton(s.vendeuseWaId, "annuler"));

    const n = await prisma.order.count({ where: { sellerId: s.sellerId } });
    expect(n).toBe(0);
    expect(s.envoyeur.envoyes.map(corps).join("\n")).toMatch(/annulé/);
  });

  it("un numero illisible est refuse en PHRASE, et la question revient", async () => {
    const s = await scene();
    for (const m of ["vendu", "Robe wax", "12 500", "pas un numero"]) {
      await traiterLivraisonBot(s.deps, texteEntrant(s.vendeuseWaId, m));
    }
    const dits = s.envoyeur.envoyes.map(corps).join("\n");
    expect(dits).toMatch(/Ce numéro ne se lit pas/);
    /* Et la machine attend toujours la cliente — pas la remise. */
    await traiterLivraisonBot(s.deps, texteEntrant(s.vendeuseWaId, "677 00 11 22"));
    expect(s.envoyeur.envoyes.map(corps).join("\n")).toMatch(/Où se fait la remise/);
  });
});
