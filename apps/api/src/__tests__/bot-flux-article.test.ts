import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import { jetonFlux } from "../domain/bot/flux.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * Le formulaire de creation d'article, de bout en bout — tache #62.
 *
 * ── Ce que ce fichier tient ────────────────────────────────────────────────
 *
 * 1. **Le formulaire s'AJOUTE aux questions, il ne les remplace pas** — meme
 *    regle que l'inscription (#60), la livraison (ADR 0055) et l'avis
 *    (ADR 0063). Sans `fluxArticleId`, le fil est exactement celui d'avant.
 * 2. **La reponse publie par le MEME chemin que les questions** : meme
 *    annonce, meme reconstruction, meme carte au premier article. Un
 *    formulaire qui publierait « a cote » divergerait au premier lot venu.
 * 3. **Le mode d'emploi part au PREMIER article, et a lui seul** — c'est
 *    l'instant ou la boutique devient reelle ; le repeter serait du bruit.
 * 4. **Une reponse qui arrive apres l'expiration de l'etat n'est pas
 *    perdue** : le formulaire reste ouvert sur le telephone aussi longtemps
 *    que la vendeuse veut, l'aiguillage la ramene au fil inscription.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const ids = identifiants("bot-flux-article");
const NOW = new Date("2026-08-12T10:00:00+01:00");
const FLUX_ID = "9876543210987654";

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

/** La reponse d'un formulaire, telle que Meta la livre (`nfm_reply`). */
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

const corps = (m: MessageSortant): string =>
  (m as { text?: { body?: string } }).text?.body ??
  (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ??
  "";

const formes = (ms: MessageSortant[]): string[] =>
  ms.map((m) => (m as { interactive?: { type?: string } }).interactive?.type ?? m.type);

interface Scene {
  waId: string;
  sellerId: string;
  envoyeur: EnvoyeurMemoire;
  deps: BotDeps;
}

async function scene(options: { fluxArticleId?: string } = {}): Promise<Scene> {
  const n = ids.suivant();
  const waId = `23767${String(n).padStart(7, "0")}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse formulaire ${n}`,
      email: ids.email("flux-article"),
      phoneNumber: `+${waId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${waId}`,
      businessName: `Boutique formulaire ${n}`,
      slug: `flux-article-${n}`,
      city: "Douala",
    },
  });
  const envoyeur = new EnvoyeurMemoire();
  return {
    waId,
    sellerId: v.id,
    envoyeur,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      maintenant: () => NOW,
      aleatoire: (nOctets: number) => new Uint8Array(randomBytes(nOctets)),
      ...(options.fluxArticleId ? { fluxArticleId: options.fluxArticleId } : {}),
    },
  };
}

describeDb("le formulaire de creation d'article (tache #62)", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("SANS identifiant de Flow : le fil est exactement celui d'avant", async () => {
    const s = await scene();
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "ajouter"));
    expect(formes(s.envoyeur.envoyes)).not.toContain("flow");
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("nom de l'article");
  });

  it("AVEC identifiant : le formulaire part EN PLUS, la question en DERNIER", async () => {
    const s = await scene({ fluxArticleId: FLUX_ID });
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "ajouter"));
    expect(formes(s.envoyeur.envoyes)).toContain("flow");
    /* C'est la question qui reste visible si le formulaire echoue. */
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("nom de l'article");
  });

  it("la reponse publie l'article — nom, prix, ET stock", async () => {
    const s = await scene({ fluxArticleId: FLUX_ID });
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "ajouter"));
    await traiterLivraisonBot(
      s.deps,
      reponseFlux(s.waId, {
        flow_token: jetonFlux("article"),
        nom: "Pagne wax 6 yards",
        prix: "15 000",
        stock: "3",
      }),
    );
    const article = await prisma.product.findFirst({
      where: { sellerId: s.sellerId },
      select: { name: true, priceXaf: true, stock: true },
    });
    expect(article).toEqual({ name: "Pagne wax 6 yards", priceXaf: 15_000, stock: 3 });
    expect(s.envoyeur.envoyes.map(corps).join("\n")).toContain("Pagne wax 6 yards");
  });

  it("le stock laisse vide vaut ZERO — « non annonce », jamais une invention", async () => {
    const s = await scene({ fluxArticleId: FLUX_ID });
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "ajouter"));
    await traiterLivraisonBot(
      s.deps,
      reponseFlux(s.waId, {
        flow_token: jetonFlux("article"),
        nom: "Sac",
        prix: "8000",
        stock: "",
      }),
    );
    const article = await prisma.product.findFirst({
      where: { sellerId: s.sellerId },
      select: { stock: true },
    });
    expect(article?.stock).toBe(0);
  });

  it("le mode d'emploi part au PREMIER article, et a lui seul", async () => {
    const s = await scene({ fluxArticleId: FLUX_ID });
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "ajouter"));
    await traiterLivraisonBot(
      s.deps,
      reponseFlux(s.waId, { flow_token: jetonFlux("article"), nom: "Sac raphia", prix: "8000" }),
    );
    const premierLot = s.envoyeur.envoyes.map(corps).join("\n");
    expect(premierLot).toContain("mode d'emploi");
    /* Chaque ligne promet un geste qui EXISTE — et le lien de la boutique. */
    expect(premierLot).toContain("livrée");
    expect(premierLot).toContain(`https://boutique.test/flux-article-`);
    expect(premierLot).toContain("https://app.test/reversement");

    s.envoyeur.envoyes.length = 0;
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "ajouter"));
    await traiterLivraisonBot(
      s.deps,
      reponseFlux(s.waId, { flow_token: jetonFlux("article"), nom: "Robe wax", prix: "12500" }),
    );
    expect(s.envoyeur.envoyes.map(corps).join("\n")).not.toContain("mode d'emploi");
  });

  it("une reponse ILLISIBLE ne perd rien : on le dit, la question reste", async () => {
    const s = await scene({ fluxArticleId: FLUX_ID });
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "ajouter"));
    await traiterLivraisonBot(
      s.deps,
      reponseFlux(s.waId, { flow_token: jetonFlux("article"), nom: "Sac", prix: "gratuit" }),
    );
    expect(await prisma.product.count({ where: { sellerId: s.sellerId } })).toBe(0);
    const dits = s.envoyeur.envoyes.map(corps).join("\n");
    expect(dits).toContain("n'a pas pu être lu");
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain("nom de l'article");
  });

  it("une reponse arrivee APRES l'expiration de l'etat publie quand meme", async () => {
    /* Le formulaire reste ouvert sur le telephone aussi longtemps qu'elle
       veut. Sans la regle d'aiguillage, cette reponse partirait au fil
       acheteuse et l'article se perdrait. */
    const s = await scene({ fluxArticleId: FLUX_ID });
    await traiterLivraisonBot(
      s.deps,
      reponseFlux(s.waId, { flow_token: jetonFlux("article"), nom: "Bijou perle", prix: "4500" }),
    );
    const article = await prisma.product.findFirst({
      where: { sellerId: s.sellerId },
      select: { name: true },
    });
    expect(article?.name).toBe("Bijou perle");
  });
});
