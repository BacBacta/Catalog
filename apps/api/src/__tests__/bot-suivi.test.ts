import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * Le suivi pousse, de bout en bout — ADR 0099 (lot P5).
 *
 * La demonstration du lot : le parcours complet vu du fil ACHETEUSE — chaque
 * transition de la vendeuse met la carte a jour, la politique de fenetre
 * tient (ouverte : tout de suite, avec le bouton ; fermee : les jalons
 * intermediaires ATTENDENT, seule la remise reveille par gabarit), et deux
 * transitions rapprochees font deux cartes, dans l'ordre.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const ids = identifiants("bot-suivi");
const NOW = new Date("2026-08-15T10:00:00+01:00");
/** Hors fenetre : l'acheteuse n'a rien ecrit depuis 40 h. */
const VIEUX = new Date(NOW.getTime() - 40 * 3600_000);

class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "memoire";
  readonly envoyes: MessageSortant[] = [];
  async envoyer(m: MessageSortant): Promise<void> {
    this.envoyes.push(m);
  }
}

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

interface Scene {
  waIdVendeuse: string;
  waIdAcheteuse: string;
  phoneAcheteuse: string;
  sellerId: string;
  orderId: string;
  ref: string;
  jeton: string;
  envoyeur: EnvoyeurMemoire;
  deps: BotDeps;
}

/** Une vendeuse, une commande, et la conversation ACHETEUSE qui la porte. */
async function scene(options: { fenetreOuverte?: boolean } = {}): Promise<Scene> {
  const n = ids.suivant();
  const waIdVendeuse = `23767${String(n).padStart(7, "0")}`;
  const waIdAcheteuse = `23769${String(n).padStart(7, "0")}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse suivi ${n}`,
      email: ids.email("bot-suivi"),
      phoneNumber: `+${waIdVendeuse}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${waIdVendeuse}`,
      businessName: `Boutique suivi ${n}`,
      slug: `bot-suivi-${n}`,
      city: "Douala",
    },
  });
  const jeton = `jeton-suivi-${n}`;
  const o = await prisma.order.create({
    data: {
      sellerId: v.id,
      ref: `CT-${n}`,
      buyerPhone: `+${waIdAcheteuse}`,
      buyerToken: jeton,
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
        phone: `+${waIdAcheteuse}`,
      },
      verificationCode: ids.codeVerification(),
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 48 * 3600_000),
    },
    select: { id: true, ref: true },
  });
  await prisma.botConversation.create({
    data: {
      phone: `+${waIdAcheteuse}`,
      etat: { nom: "accueil" },
      derniereCommandeId: o.id,
      updatedAt: options.fenetreOuverte === false ? VIEUX : new Date(NOW.getTime() - 60_000),
    },
  });
  const envoyeur = new EnvoyeurMemoire();
  return {
    waIdVendeuse,
    waIdAcheteuse,
    phoneAcheteuse: `+${waIdAcheteuse}`,
    sellerId: v.id,
    orderId: o.id,
    ref: o.ref,
    jeton,
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

const versAcheteuse = (s: Scene) =>
  s.envoyeur.envoyes.filter((m) => (m as { to?: string }).to === s.waIdAcheteuse);

describeDb("le parcours vu du fil acheteuse — ADR 0099", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("fenetre OUVERTE : la transition pousse UNE carte, chemin + bouton « Voir le suivi »", async () => {
    const s = await scene({ fenetreOuverte: true });
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waIdVendeuse, `etape:preparee:${s.ref}`));

    const cartes = versAcheteuse(s);
    expect(cartes).toHaveLength(1);
    const m = cartes[0] as {
      interactive?: {
        type?: string;
        body?: { text?: string };
        action?: { parameters?: { display_text?: string; url?: string } };
      };
    };
    expect(m.interactive?.type).toBe("cta_url");
    expect(m.interactive?.body?.text).toContain(s.ref);
    /* Le chemin complet, meme rendu que « suivi » : fait, en cours, a venir. */
    expect(m.interactive?.body?.text).toContain("➔ Preparee");
    expect(m.interactive?.body?.text).toContain("✓ Commande recue");
    expect(m.interactive?.action?.parameters?.display_text).toBe("Voir le suivi");
    /* Le lien est celui du JETON — jamais la reference ni le code. */
    expect(m.interactive?.action?.parameters?.url).toContain(s.jeton);
    expect(m.interactive?.action?.parameters?.url).not.toContain(s.ref);
  });

  it("deux transitions rapprochees : DEUX cartes, dans l'ordre — une par transition", async () => {
    const s = await scene({ fenetreOuverte: true });
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waIdVendeuse, `etape:preparee:${s.ref}`));
    await traiterLivraisonBot(
      s.deps,
      boutonEntrant(s.waIdVendeuse, `etape:chez_le_livreur:${s.ref}`),
    );

    const cartes = versAcheteuse(s);
    expect(cartes).toHaveLength(2);
    const texteDe = (m: MessageSortant) =>
      (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ?? corps(m);
    expect(texteDe(cartes[0] as MessageSortant)).toContain("➔ Preparee");
    expect(texteDe(cartes[1] as MessageSortant)).toContain("➔ Confiee au livreur");
  });

  it("fenetre FERMEE + jalon intermediaire : RIEN ne part — la carte attend en base", async () => {
    const s = await scene({ fenetreOuverte: false });
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waIdVendeuse, `etape:preparee:${s.ref}`));

    expect(versAcheteuse(s)).toHaveLength(0);
    const enAttente = await prisma.botNotification.findMany({
      where: { phone: s.phoneAcheteuse, remisLe: null },
    });
    expect(enAttente).toHaveLength(1);
    expect(enAttente[0]?.corps).toContain("➔ Preparee");
    /* Et surtout : AUCUN gabarit — informer n'est pas reveiller. */
    expect(s.envoyeur.envoyes.filter((m) => m.type === "template")).toHaveLength(0);
  });

  it("fenetre FERMEE + remise : le gabarit reveille — c'est le jalon qui le merite", async () => {
    const s = await scene({ fenetreOuverte: false });
    await prisma.order.update({
      where: { id: s.orderId },
      data: { balanceXaf: 0, amountPaidXaf: 21500 },
    });
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waIdVendeuse, `etape:livree:${s.ref}`));

    const gabarits = versAcheteuse(s).filter((m) => m.type === "template");
    expect(gabarits).toHaveLength(1);
    expect((gabarits[0] as { template: { name: string } }).template.name).toContain("livree");
  });

  it("une commande sans conversation acheteuse : rien ne part, rien ne casse", async () => {
    const s = await scene({ fenetreOuverte: true });
    await prisma.botConversation.delete({ where: { phone: s.phoneAcheteuse } });
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waIdVendeuse, `etape:preparee:${s.ref}`));
    expect(versAcheteuse(s)).toHaveLength(0);
    /* La vendeuse, elle, a bien recu sa carte de transition. */
    expect(s.envoyeur.envoyes.length).toBeGreaterThan(0);
  });
});
