import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage } from "../adapters/storage-s3.ts";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * Les photos du cote ACHETEUSE, de bout en bout contre une vraie base —
 * ADR 0105.
 *
 * ── Ce que le domaine seul ne pouvait pas attraper ────────────────────────
 *
 * Le defaut du 15/08/2026 vivait dans le DESACCORD entre deux fichiers : le
 * service enrichissait les articles ILLUSTRES, le rendu prenait les PREMIERS.
 * Chacun etait juste isolement, et les tests de chacun passaient. Il fallait
 * un test qui traverse les deux — celui-ci — plus la seule disposition qui
 * les fait diverger : **plus de six articles, dont seuls les derniers portent
 * une photo**.
 *
 * Cette disposition n'est pas un cas tordu, c'est le cas ORDINAIRE. Un
 * article neuf prend `position = max + 1`, donc il arrive en fin de liste ;
 * une vendeuse qui commence a mettre des photos les met sur ses ajouts
 * recents. Le defaut se declenchait au septieme article et pas avant, ce qui
 * explique qu'il ait survecu a tous les essais a trois articles.
 *
 * Les objets sont ecrits dans un `MemoryStorage` reel : `urlJpegVerifiee`
 * appelle vraiment `taille()`, et un article dont l'objet manque doit rester
 * sans photo — c'est la promesse « jamais de lien mort » de l'ADR 0032.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const ids = identifiants("bot-photos-acheteuse");
const NOW = new Date("2026-08-15T21:00:00+01:00");

/** Au-dela de cette tranche, les deux ensembles cessent de se recouvrir. */
const RAFALE_MAX = 6;

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

/** Les messages IMAGE seuls — c'est ce que l'acheteuse voit reellement. */
const images = (ms: readonly MessageSortant[]) =>
  ms.filter((m) => (m as { type?: string }).type === "image") as Array<{
    image: { link: string; caption?: string };
  }>;

const corps = (m: MessageSortant): string =>
  (m as { text?: { body?: string } }).text?.body ??
  (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ??
  "";

interface Scene {
  acheteuseWaId: string;
  slug: string;
  /** Les cles de base des articles illustres, dans l'ordre de la boutique. */
  clesIllustrees: string[];
  envoyeur: EnvoyeurMemoire;
  storage: MemoryStorage;
  deps: BotDeps;
}

/**
 * Une boutique de `total` articles dont les `illustres` DERNIERS portent une
 * photo — la disposition ordinaire, celle qui declenchait le defaut.
 */
async function scene(total: number, illustres: number): Promise<Scene> {
  const n = ids.suivant();
  const vendeuseWaId = `23767${String(n).padStart(7, "0")}`;
  const acheteuseWaId = `23769${String(n).padStart(7, "0")}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse photos ${n}`,
      email: ids.email("bot-photos"),
      phoneNumber: `+${vendeuseWaId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${vendeuseWaId}`,
      businessName: `Boutique photos ${n}`,
      slug: `bot-photos-${n}`,
      city: "Douala",
    },
  });

  const storage = new MemoryStorage({ NODE_ENV: "test" });
  const clesIllustrees: string[] = [];
  for (let i = 0; i < total; i++) {
    const illustre = i >= total - illustres;
    /* Une cle de la meme forme que celles du pipeline : `img/ab/<hex>`. */
    const cle = illustre ? `img/${String(n % 100).padStart(2, "0")}/photo-${n}-${i}` : null;
    if (cle) {
      clesIllustrees.push(cle);
      /* Seule la declinaison JPEG est verifiee — c'est celle que le bot
         envoie, et `urlJpegVerifiee` ne regarde qu'elle. */
      await storage.put({
        cle: `${cle}.jpg`,
        corps: new Uint8Array([0xff, 0xd8, 0xff, 0xdb]),
        contentType: "image/jpeg",
      });
    }
    await prisma.product.create({
      data: {
        sellerId: v.id,
        name: `Article ${i}`,
        priceXaf: 1000 + i * 100,
        position: i,
        ...(cle ? { imageKey: cle } : {}),
      },
    });
  }

  const envoyeur = new EnvoyeurMemoire();
  return {
    acheteuseWaId,
    slug: v.slug,
    clesIllustrees,
    envoyeur,
    storage,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      maintenant: () => NOW,
      aleatoire: (nOctets: number) => new Uint8Array(randomBytes(nOctets)),
      storage,
    },
  };
}

describeDb("les photos cote acheteuse, service et rendu (ADR 0105)", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("huit articles, les deux DERNIERS illustres : la rafale envoie les deux", async () => {
    const s = await scene(8, 2);
    await traiterLivraisonBot(s.deps, texteEntrant(s.acheteuseWaId, `boutique ${s.slug}`));
    s.envoyeur.envoyes.length = 0;

    await traiterLivraisonBot(s.deps, boutonEntrant(s.acheteuseWaId, "photos"));

    const envoyees = images(s.envoyeur.envoyes);
    expect(envoyees).toHaveLength(2);
    /* Chaque lien pointe une declinaison JPEG qui existe VRAIMENT dans le
       stockage : c'est la promesse « jamais de lien mort ». */
    for (const cle of s.clesIllustrees) {
      expect(envoyees.some((m) => m.image.link.includes(`${cle}.jpg`))).toBe(true);
    }
    /* Et pas un mot du repli « aucune photo » — il mentait a l'acheteuse
       pendant que le stockage tenait ses deux objets. */
    expect(s.envoyeur.envoyes.map(corps).join("\n")).not.toMatch(/pas encore mis de photos/i);
  });

  it("l'entree par lien prend en en-tete le premier article ILLUSTRE", async () => {
    const s = await scene(8, 2);
    await traiterLivraisonBot(s.deps, texteEntrant(s.acheteuseWaId, `boutique ${s.slug}`));

    /* L'accueil porte son en-tete d'image : le service enrichit desormais le
       premier article illustre, et non le premier article tout court. */
    const enTetes = s.envoyeur.envoyes.flatMap((m) => {
      const h = (m as { interactive?: { header?: { image?: { link?: string } } } }).interactive
        ?.header?.image?.link;
      return h ? [h] : [];
    });
    expect(enTetes).toHaveLength(1);
    expect(enTetes[0]).toContain(`${s.clesIllustrees[0]}.jpg`);
  });

  it("plus d'illustres que la tranche : la rafale reste bornee a six", async () => {
    const s = await scene(10, 9);
    await traiterLivraisonBot(s.deps, texteEntrant(s.acheteuseWaId, `boutique ${s.slug}`));
    s.envoyeur.envoyes.length = 0;

    await traiterLivraisonBot(s.deps, boutonEntrant(s.acheteuseWaId, "photos"));

    expect(images(s.envoyeur.envoyes)).toHaveLength(RAFALE_MAX);
  });

  it("une cle en base SANS objet dans le stockage ne part pas en lien mort", async () => {
    const s = await scene(8, 2);
    /* Le cas d'un objet perdu, ou d'une cle ecrite alors que `put` a echoue :
       la base dit « illustre », le stockage dit non. C'est le stockage qui
       tranche — un lien mort ferait refuser le message ENTIER par l'API. */
    await s.storage.supprimer(`${s.clesIllustrees[0]}.jpg`);
    await traiterLivraisonBot(s.deps, texteEntrant(s.acheteuseWaId, `boutique ${s.slug}`));
    s.envoyeur.envoyes.length = 0;

    await traiterLivraisonBot(s.deps, boutonEntrant(s.acheteuseWaId, "photos"));

    const envoyees = images(s.envoyeur.envoyes);
    expect(envoyees).toHaveLength(1);
    expect(envoyees[0]?.image.link).toContain(`${s.clesIllustrees[1]}.jpg`);
  });
});
