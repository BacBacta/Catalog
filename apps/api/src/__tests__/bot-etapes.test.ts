import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import { livrerNotificationsEnAttente, notifier } from "../bot-notifications.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { boutonsNouvelleCommande } from "../domain/bot/notifications.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * Les etapes en boutons, de bout en bout — ADR 0098 (lot P4).
 *
 * La demonstration du lot : la sequence complete recue → preparee →
 * chez_le_livreur → livree pilotee AUX BOUTONS, avec le solde regle entre
 * les deux dernieres — et chaque transition journalisee par LE MEME moteur
 * que l'app. Plus : le refus du bouton presse deux fois, le retrait sans
 * etape de livreur, et l'absence restituee en UNE carte.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const ids = identifiants("bot-etapes");
const NOW = new Date("2026-08-15T10:00:00+01:00");

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

const boutonEntrant = (de: string, id: string) => ({
  messages: [
    {
      from: de,
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id } },
    },
  ],
});

const corps = (m: MessageSortant): string =>
  (m as { text?: { body?: string } }).text?.body ??
  (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ??
  "";

const titresBoutons = (m: MessageSortant): string[] =>
  (
    (m as { interactive?: { action?: { buttons?: Array<{ reply?: { title?: string } }> } } })
      .interactive?.action?.buttons ?? []
  ).map((b) => b.reply?.title ?? "");

interface Scene {
  waId: string;
  phone: string;
  sellerId: string;
  envoyeur: EnvoyeurMemoire;
  deps: BotDeps;
}

async function scene(): Promise<Scene> {
  const n = ids.suivant();
  const waId = `23767${String(n).padStart(7, "0")}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse etapes ${n}`,
      email: ids.email("bot-etapes"),
      phoneNumber: `+${waId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${waId}`,
      businessName: `Boutique etapes ${n}`,
      slug: `bot-etapes-${n}`,
      city: "Douala",
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
      maintenant: () => NOW,
      aleatoire: (nOctets: number) => new Uint8Array(randomBytes(nOctets)),
    },
  };
}

async function commande(
  s: Scene,
  options: { mode?: "livraison" | "retrait"; balanceXaf?: number } = {},
): Promise<{ id: string; ref: string }> {
  const n = ids.suivant();
  const acheteuse = `+23769${String(n).padStart(7, "0")}`;
  const balance = options.balanceXaf ?? 10750;
  const o = await prisma.order.create({
    data: {
      sellerId: s.sellerId,
      ref: `CT-${n}`,
      buyerPhone: acheteuse,
      payMode: "acompte",
      totalXaf: 21500,
      amountPaidXaf: 21500 - balance,
      balanceXaf: balance,
      items: [{ nom: "Sac tresse", quantite: 2, prixUnitaireXaf: 10750 }],
      delivery: {
        mode: options.mode ?? "livraison",
        city: "Douala",
        quartier: "Bonapriso",
        landmark: "pres de la pharmacie du Rail",
        phone: acheteuse,
      },
      verificationCode: ids.codeVerification(),
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 48 * 3600_000),
    },
    select: { id: true, ref: true },
  });
  return o;
}

async function journalEtapes(orderId: string): Promise<Array<{ kind: string; payload: unknown }>> {
  return prisma.orderEvent.findMany({
    where: { orderId, kind: { in: ["etape_avancee", "etape_refusee"] } },
    orderBy: { at: "asc" },
    select: { kind: true, payload: true },
  });
}

describeDb("la sequence pilotee aux boutons — ADR 0098", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("recue → preparee → chez_le_livreur → livree, le solde regle entre les deux dernieres", async () => {
    const s = await scene();
    const o = await commande(s, { mode: "livraison", balanceXaf: 10750 });

    /* 1. « Marquer préparée » : la transition, et le bouton SUIVANT. */
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `etape:preparee:${o.ref}`));
    let carte = s.envoyeur.envoyes.at(-1) as MessageSortant;
    expect(corps(carte)).toContain(`${o.ref} → préparée`);
    expect(titresBoutons(carte)).toEqual(["🛵 Chez le livreur"]);

    /* 2. « Chez le livreur » : solde OUVERT — pas de « Remise faite »,
       le rappel a la place. C'est la garde du produit. */
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `etape:chez_le_livreur:${o.ref}`));
    carte = s.envoyeur.envoyes.at(-1) as MessageSortant;
    expect(corps(carte)).toContain(`${o.ref} → chez le livreur`);
    expect(titresBoutons(carte)).toEqual([]);
    expect(corps(carte)).toContain("Collez ici le SMS");

    /* 3. Un bouton « Remise faite » perime presse quand meme : REFUS
       solde_ouvert, journalise, avec le rappel. */
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `etape:livree:${o.ref}`));
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("solde ouvert");

    /* 4. Le solde se regle (preuve ou declaration — ici, l'etat en base). */
    await prisma.order.update({
      where: { id: o.id },
      data: { balanceXaf: 0, amountPaidXaf: 21500 },
    });

    /* 5. « Remise faite » : la commande se clot, l'acheteuse sera invitee. */
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `etape:livree:${o.ref}`));
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("est marquée livrée");

    const etat = await prisma.order.findUnique({ where: { id: o.id }, select: { step: true } });
    expect(etat?.step).toBe("livree");

    /* Le journal porte TOUT : trois avancees, un refus — meme moteur,
       meme trace que l'app (canal bot_whatsapp). */
    const journal = await journalEtapes(o.id);
    expect(journal.map((j) => j.kind)).toEqual([
      "etape_avancee",
      "etape_avancee",
      "etape_refusee",
      "etape_avancee",
    ]);
    expect((journal[2]?.payload as { raison?: string } | undefined)?.raison).toBe("solde_ouvert");
    expect((journal[0]?.payload as { canal?: string } | undefined)?.canal).toBe("bot_whatsapp");
  });

  it("le bouton presse DEUX fois : recul ignore, journalise — rien ne bouge", async () => {
    const s = await scene();
    const o = await commande(s);
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `etape:preparee:${o.ref}`));
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `etape:preparee:${o.ref}`));

    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("déjà à cette étape");
    const journal = await journalEtapes(o.id);
    expect(journal.map((j) => j.kind)).toEqual(["etape_avancee", "etape_refusee"]);
    const etat = await prisma.order.findUnique({ where: { id: o.id }, select: { step: true } });
    expect(etat?.step).toBe("preparee");
  });

  it("retrait : preparee propose « Remise faite » — jamais d'etape de livreur", async () => {
    const s = await scene();
    const o = await commande(s, { mode: "retrait", balanceXaf: 0 });
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `etape:preparee:${o.ref}`));
    const carte = s.envoyeur.envoyes.at(-1) as MessageSortant;
    expect(titresBoutons(carte)).toEqual(["📦 Remise faite"]);

    /* Et « chez le livreur » force sur un retrait est REFUSE : hors mode. */
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `etape:chez_le_livreur:${o.ref}`));
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("rien n'a bougé");
  });

  it("« Écrire à la cliente » rend le wa.me du numero de livraison", async () => {
    const s = await scene();
    const o = await commande(s);
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `ecrire:${o.ref}`));
    const m = corps(s.envoyeur.envoyes.at(-1) as MessageSortant);
    expect(m).toContain("https://wa.me/23769");
  });

  it("« commandes » tape rend le detail — le mot que la carte d'absence enseigne", async () => {
    const s = await scene();
    const o = await commande(s);
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "commandes"));
    const m = corps(s.envoyeur.envoyes.at(-1) as MessageSortant);
    expect(m).toContain(o.ref);
    expect(m).toContain("reçue");
  });
});

describeDb("l'absence restituee en UNE carte — ADR 0098, decision 3", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Met en attente une notification de commande, comme `notifier` le fait
      quand l'envoi echoue (fenetre fermee sans gabarit approuve). */
  async function commandeEnAttente(s: Scene): Promise<{ ref: string }> {
    const o = await commande(s);
    await prisma.botNotification.create({
      data: {
        phone: s.phone,
        corps: `🛍️ *Nouvelle commande ${o.ref}*`,
        boutons: boutonsNouvelleCommande(o.ref) as unknown as object,
      },
    });
    return o;
  }

  it("3 notifications de commande en attente → UNE carte, montants RELUS de la base", async () => {
    const s = await scene();
    const o1 = await commandeEnAttente(s);
    const o2 = await commandeEnAttente(s);
    const o3 = await commandeEnAttente(s);

    await livrerNotificationsEnAttente(
      { prisma, envoyeur: s.envoyeur, maintenant: () => NOW },
      s.phone,
    );

    expect(s.envoyeur.envoyes).toHaveLength(1);
    const m = corps(s.envoyeur.envoyes[0] as MessageSortant);
    expect(m).toContain("Pendant votre absence");
    expect(m).toContain("3 commandes");
    for (const o of [o1, o2, o3]) expect(m).toContain(o.ref);
    expect(m).toContain("« commandes »");

    const restantes = await prisma.botNotification.count({
      where: { phone: s.phone, remisLe: null },
    });
    expect(restantes).toBe(0);
  });

  it("UNE seule en attente : la carte complete habituelle, boutons compris", async () => {
    const s = await scene();
    const o = await commandeEnAttente(s);
    await livrerNotificationsEnAttente(
      { prisma, envoyeur: s.envoyeur, maintenant: () => NOW },
      s.phone,
    );
    expect(s.envoyeur.envoyes).toHaveLength(1);
    const m = s.envoyeur.envoyes[0] as MessageSortant;
    expect(corps(m)).toContain(o.ref);
    expect(titresBoutons(m)).toEqual(["🧺 Marquer préparée", "Écrire à la cliente"]);
  });

  it("les notifications SANS commande ne se compilent pas — elles se remettent une a une", async () => {
    const s = await scene();
    await commandeEnAttente(s);
    await commandeEnAttente(s);
    await prisma.botNotification.create({
      data: { phone: s.phone, corps: "⚠️ CT-000000 est contestée." },
    });

    await livrerNotificationsEnAttente(
      { prisma, envoyeur: s.envoyeur, maintenant: () => NOW },
      s.phone,
    );

    /* La carte compilee, PUIS la contestation entiere. */
    expect(s.envoyeur.envoyes).toHaveLength(2);
    expect(corps(s.envoyeur.envoyes[0] as MessageSortant)).toContain("Pendant votre absence");
    expect(corps(s.envoyeur.envoyes[1] as MessageSortant)).toContain("contestée");
  });

  it("la notification de commande part AVEC ses boutons des la creation (fenetre ouverte)", async () => {
    const s = await scene();
    const o = await commande(s);
    await prisma.botConversation.create({
      data: { phone: s.phone, etat: { nom: "accueil" }, updatedAt: NOW },
    });
    await notifier(
      { prisma, envoyeur: s.envoyeur, maintenant: () => NOW },
      s.phone,
      `🛍️ *Nouvelle commande ${o.ref}*`,
      boutonsNouvelleCommande(o.ref),
    );
    const m = s.envoyeur.envoyes.at(-1) as MessageSortant;
    expect(titresBoutons(m)).toEqual(["🧺 Marquer préparée", "Écrire à la cliente"]);
  });
});
