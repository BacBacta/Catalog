import { randomBytes } from "node:crypto";
import { formatXaf } from "@catalog/contracts/money";
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

/**
 * Le comptoir en UN ecran — ADR 0102, contre la vraie base.
 *
 * Ce que le domaine seul ne peut pas etablir : que la reponse du formulaire
 * traverse `traiterLivraisonBot`, atterrit dans le MEME etat que les quatre
 * questions, et que le recapitulatif du fil reste l'unique porte de creation.
 */
const reponseFlux = (de: string, charge: Record<string, unknown>) => ({
  messages: [
    {
      from: de,
      type: "interactive",
      interactive: {
        type: "nfm_reply",
        nfm_reply: { response_json: JSON.stringify(charge) },
      },
    },
  ],
});

describeDb("le comptoir en un écran (ADR 0102)", () => {
  it("formulaire rempli → récapitulatif du fil → Confirmer crée la commande", async () => {
    const s = await scene();
    await traiterLivraisonBot(
      s.deps,
      reponseFlux(s.vendeuseWaId, {
        flow_token: "comptoir:",
        article: "Robe wax",
        prix: "12500",
        cliente: "677 00 11 22",
        remise: "Carrefour Warda",
      }),
    );

    /* Le recapitulatif, avec ses boutons — jamais de creation muette. */
    const recap = s.envoyeur.envoyes.at(-1);
    expect(corps(recap as MessageSortant)).toContain("Robe wax");
    /* Le montant, par la MEME fonction que la copie — pas une espace devinee. */
    expect(corps(recap as MessageSortant)).toContain(formatXaf(12500));
    expect(
      await prisma.order.count({ where: { sellerId: s.sellerId } }),
      "le formulaire ne cree JAMAIS la vente",
    ).toBe(0);

    await traiterLivraisonBot(s.deps, bouton(s.vendeuseWaId, "confirmer"));
    expect(await prisma.order.count({ where: { sellerId: s.sellerId } })).toBe(1);
    const commande = await prisma.order.findFirstOrThrow({
      where: { sellerId: s.sellerId },
      select: { totalXaf: true, buyerPhone: true, delivery: true },
    });
    expect(commande.totalXaf).toBe(12500);
    /* Le numero du formulaire, normalise par la MEME regle que le fil. */
    expect(commande.buyerPhone).toBe("+237677001122");
  });

  it("un numéro illisible refuse LE champ — article et prix restent acquis", async () => {
    const s = await scene();
    await traiterLivraisonBot(
      s.deps,
      reponseFlux(s.vendeuseWaId, {
        flow_token: "comptoir:",
        article: "Robe wax",
        prix: "12500",
        cliente: "pas un numero",
        remise: "Carrefour Warda",
      }),
    );
    const dits = s.envoyeur.envoyes.map((m) => corps(m)).join("\n---\n");
    expect(dits).toMatch(/numéro/i);
    /* La question posee est celle de LA cliente — pas la premiere. */
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toMatch(/cliente/i);

    /* Elle repond dans le fil : l'etat du formulaire est bien le sien. */
    await traiterLivraisonBot(s.deps, texteEntrant(s.vendeuseWaId, "699 11 22 33"));
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toMatch(/remise/i);
  });

  it("« vendu » offre le formulaire quand l'identifiant est posé — la question reste", async () => {
    const s = await scene();
    const deps = { ...s.deps, fluxComptoirId: "1234567890" };
    await traiterLivraisonBot(deps, texteEntrant(s.vendeuseWaId, "vendu"));
    const formes = s.envoyeur.envoyes.map(
      (m) => (m as { interactive?: { type?: string } }).interactive?.type ?? "texte",
    );
    /* Le formulaire d'abord, la QUESTION en dernier : c'est elle qui reste
       visible si le Flow ne s'affiche pas (ADR 0063). */
    expect(formes).toEqual(["flow", "texte"]);
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toMatch(/vendu/i);
  });

  it("sans identifiant, « vendu » est exactement le fil d'hier", async () => {
    const s = await scene();
    await traiterLivraisonBot(s.deps, texteEntrant(s.vendeuseWaId, "vendu"));
    expect(s.envoyeur.envoyes).toHaveLength(1);
    expect(corps(s.envoyeur.envoyes[0] as MessageSortant)).toMatch(/vendu/i);
  });
});
