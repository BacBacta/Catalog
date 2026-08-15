import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage } from "../adapters/storage-s3.ts";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { FENETRE_RAFALE_MS } from "../domain/bot/rafale.ts";
import { executerRecapRafale } from "../jobs/relance-acompte.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * La rafale, de bout en bout contre une vraie base — ADR 0096 (lot P1).
 *
 * Ce que le domaine ne peut pas prouver seul : la persistance de l'etat
 * rafale, le travail pg-boss qui envoie LA carte une seule fois (deborde par
 * conception), et « Tout publier » qui fait naitre les articles en base par
 * le meme chemin que l'unitaire — UNE carte de retour, pas n.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const ids = identifiants("bot-rafale");
const NOW = new Date("2026-08-15T10:00:00+01:00");

class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "memoire";
  readonly envoyes: MessageSortant[] = [];
  async envoyer(m: MessageSortant): Promise<void> {
    this.envoyes.push(m);
  }
}

const corps = (m: MessageSortant): string =>
  (m as { text?: { body?: string } }).text?.body ??
  (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ??
  "";

/** Les BULLES seulement : une reaction n'occupe pas le fil. */
const bulles = (ms: readonly MessageSortant[]): MessageSortant[] =>
  ms.filter((m) => (m as { type?: string }).type !== "reaction");

const photoEntrante = (de: string, wamid: string, mediaId: string, caption?: string) => ({
  messages: [
    {
      from: de,
      id: wamid,
      type: "image",
      image: { id: mediaId, ...(caption ? { caption } : {}) },
    },
  ],
});

const boutonEntrant = (de: string, wamid: string, id: string) => ({
  messages: [
    {
      from: de,
      id: wamid,
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id } },
    },
  ],
});

interface Scene {
  waId: string;
  phone: string;
  sellerId: string;
  envoyeur: EnvoyeurMemoire;
  planifies: Array<{ phone: string; vers: string }>;
  deps: BotDeps;
}

let jpeg: Uint8Array;

async function scene(): Promise<Scene> {
  const n = ids.suivant();
  const waId = `23767${String(n).padStart(7, "0")}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse rafale ${n}`,
      email: ids.email("bot-rafale"),
      phoneNumber: `+${waId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${waId}`,
      businessName: `Boutique rafale ${n}`,
      slug: `bot-rafale-${n}`,
      city: "Douala",
    },
  });
  const envoyeur = new EnvoyeurMemoire();
  const planifies: Array<{ phone: string; vers: string }> = [];
  return {
    waId,
    phone: `+${waId}`,
    sellerId: v.id,
    envoyeur,
    planifies,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      maintenant: () => NOW,
      aleatoire: (nOctets: number) => new Uint8Array(randomBytes(nOctets)),
      storage: new MemoryStorage({ NODE_ENV: "test" }),
      media: {
        nom: "memoire-jpeg",
        lire: async () => ({ octets: jpeg, typeAnnonce: "image/jpeg" }),
      },
      planifierRafale: async (charge) => {
        planifies.push(charge);
      },
    },
  };
}

describeDb("la rafale, service et travail pg-boss (ADR 0096)", () => {
  beforeAll(async () => {
    prisma = createPrismaClient();
    const sharp = (await import("sharp")).default;
    jpeg = new Uint8Array(
      await sharp({
        create: { width: 320, height: 240, channels: 3, background: { r: 14, g: 122, b: 95 } },
      })
        .jpeg()
        .toBuffer(),
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("deux photos → un etat rafale persiste, ZERO bulle apres la premiere, le recap planifie", async () => {
    const s = await scene();
    const w = ids.suivant();
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.r${w}-1`, "m-1", "Pagne wax 6 yards 15 000"),
    );
    /* La premiere photo : le comportement d'AUJOURD'HUI, confirmation immediate. */
    expect(bulles(s.envoyeur.envoyes)).toHaveLength(1);
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.r${w}-2`, "m-2", "Huile de palme 5 L 4 500"),
    );
    /* La deuxieme : un 👍 et RIEN d'autre — la carte attend la fenetre. */
    expect(bulles(s.envoyeur.envoyes)).toHaveLength(1);
    const enregistrement = await prisma.botConversation.findUniqueOrThrow({
      where: { phone: s.phone },
      select: { etat: true },
    });
    expect(enregistrement.etat).toMatchObject({ nom: "rafale" });
    expect(s.planifies).toEqual([{ phone: s.phone, vers: s.waId }]);
  });

  it("le travail envoie LA carte une fois — trop tot il se tait, rejoue il se tait", async () => {
    const s = await scene();
    const w = ids.suivant();
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.r${w}-1`, "m-1", "Pagne wax 6 yards 15 000"),
    );
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.r${w}-2`, "m-2", "Huile de palme 5 L 4 500"),
    );
    const avant = s.envoyeur.envoyes.length;

    /* Reveille TROP TOT (une photo vient d'arriver) : il se tait — le
       travail replanifie par la photo suivante parlera. */
    await executerRecapRafale(
      { prisma, envoyeur: s.envoyeur, maintenant: () => new Date() },
      { phone: s.phone, vers: s.waId },
    );
    expect(s.envoyeur.envoyes.length).toBe(avant);

    /* Fenetre echue : LA carte part. */
    const apres = () => new Date(Date.now() + FENETRE_RAFALE_MS + 5000);
    await executerRecapRafale(
      { prisma, envoyeur: s.envoyeur, maintenant: apres },
      { phone: s.phone, vers: s.waId },
    );
    expect(s.envoyeur.envoyes.length).toBe(avant + 1);
    expect(corps(s.envoyeur.envoyes.at(-1) as MessageSortant)).toContain(
      "2 articles prêts à publier",
    );

    /* Rejoue : la carte est deja partie, silence — jamais deux cartes. */
    await executerRecapRafale(
      { prisma, envoyeur: s.envoyeur, maintenant: apres },
      { phone: s.phone, vers: s.waId },
    );
    expect(s.envoyeur.envoyes.length).toBe(avant + 1);
  });

  it("« Tout publier » fait naitre la salve en base — et UNE carte de retour", async () => {
    const s = await scene();
    const w = ids.suivant();
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.r${w}-1`, "m-1", "Pagne wax 6 yards 15 000"),
    );
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.r${w}-2`, "m-2", "Huile de palme 5 L 4 500"),
    );
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.r${w}-3`, "m-3", "Bijoux perles 3 000"),
    );
    const avantBulles = bulles(s.envoyeur.envoyes).length;

    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `wamid.r${w}-pub`, "tout_publier"));

    const articles = await prisma.product.findMany({
      where: { sellerId: s.sellerId },
      orderBy: { position: "asc" },
      select: { name: true, priceXaf: true, imageKey: true },
    });
    expect(articles.map((a) => [a.name, a.priceXaf])).toEqual([
      ["Pagne wax 6 yards", 15000],
      ["Huile de palme 5 L", 4500],
      ["Bijoux perles", 3000],
    ]);
    /* Chaque brouillon est passe par le MEME pipeline : la photo est la. */
    expect(articles.every((a) => a.imageKey)).toBe(true);

    /* UNE carte de retour + le mode d'emploi du premier article — pas trois
       confirmations. */
    const nouvelles = bulles(s.envoyeur.envoyes).slice(avantBulles);
    expect(nouvelles).toHaveLength(2);
    expect(corps(nouvelles[0] as MessageSortant)).toContain("Votre boutique passe à 3 articles");
    expect(corps(nouvelles[1] as MessageSortant)).toContain("mode d'emploi");

    /* L'etat est rendu au repos : le fil est libre. */
    const enregistrement = await prisma.botConversation.findUniqueOrThrow({
      where: { phone: s.phone },
      select: { etat: true },
    });
    expect(enregistrement.etat).toMatchObject({ nom: "accueil" });
  });
});
