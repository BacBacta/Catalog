import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage } from "../adapters/storage-s3.ts";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * Ce que la VENDEUSE voit de sa propre photo — ADR 0106.
 *
 * ── Le constat du 15/08/2026 ──────────────────────────────────────────────
 *
 * « Les photos ne sont pas visibles côté vendeur à l'ajout. » Elle envoyait
 * son image, le fil repondait « ✅ Sac — 8 000 FCFA est dans votre
 * catalogue » en TEXTE, et rien ne lui montrait ce que l'acheteuse verrait.
 * Une photo cadree de travers, ou la mauvaise photo, ne se decouvrait qu'en
 * ouvrant la boutique publique — c'est-a-dire jamais.
 *
 * La carte-vitrine, elle, lui revenait en INITIALES : elle prenait les trois
 * PREMIERS articles (`take: ARTICLES_MAX`), et une boutique dont seuls les
 * ajouts recents portent une photo n'en montrait aucune. Troisieme instance
 * du desaccord de tranche de l'ADR 0105, et la plus visible des trois.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const ids = identifiants("bot-photos-vendeuse");
const NOW = new Date("2026-08-15T22:00:00+01:00");

class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "memoire";
  readonly envoyes: MessageSortant[] = [];
  async envoyer(m: MessageSortant): Promise<void> {
    this.envoyes.push(m);
  }
}

const photoEntrante = (de: string, wamid: string, mediaId: string, legende: string) => ({
  messages: [
    {
      from: de,
      id: wamid,
      type: "image",
      image: { id: mediaId, caption: legende },
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

const texteEntrant = (de: string, corps: string) => ({
  messages: [{ from: de, type: "text", text: { body: corps } }],
});

const ligneEntrante = (de: string, wamid: string, id: string) => ({
  messages: [
    {
      from: de,
      id: wamid,
      type: "interactive",
      interactive: { type: "list_reply", list_reply: { id } },
    },
  ],
});

/** L'en-tete d'image d'une bulle a boutons, s'il y en a un. */
const enTeteImage = (m: MessageSortant): string | null =>
  (m as { interactive?: { header?: { image?: { link?: string } } } }).interactive?.header?.image
    ?.link ?? null;

const corps = (m: MessageSortant): string =>
  (m as { text?: { body?: string } }).text?.body ??
  (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ??
  "";

interface Scene {
  waId: string;
  sellerId: string;
  envoyeur: EnvoyeurMemoire;
  storage: MemoryStorage;
  deps: BotDeps;
}

let jpeg: Uint8Array;

async function scene(): Promise<Scene> {
  const n = ids.suivant();
  const waId = `23767${String(n).padStart(7, "0")}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse photo ${n}`,
      email: ids.email("bot-photos-v"),
      phoneNumber: `+${waId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${waId}`,
      businessName: `Boutique photo ${n}`,
      slug: `bot-photos-v-${n}`,
      city: "Douala",
    },
  });
  const envoyeur = new EnvoyeurMemoire();
  const storage = new MemoryStorage({ NODE_ENV: "test" });
  return {
    waId,
    sellerId: v.id,
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
      media: {
        nom: "memoire-jpeg",
        lire: async () => ({ octets: jpeg, typeAnnonce: "image/jpeg" }),
        lireCdn: async () => ({ octets: jpeg, typeAnnonce: "image/jpeg" }),
      },
      numeroCatalog: "+237600000000",
    },
  };
}

describeDb("les photos cote vendeuse (ADR 0106)", () => {
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

  it("la confirmation d'ajout RENVOIE la photo, sans message de plus", async () => {
    const s = await scene();
    const w = ids.suivant();
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.pv${w}`, "m-1", "Sac en raphia 8000"),
    );

    /* La photo legendee produit d'abord un recapitulatif — « J'ai lu … C'est
       bon ? » (ADR 0032). C'est APRES « Publier » que l'article existe, donc
       apres que la confirmation peut porter sa photo. */
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `wamid.pv${w}-ok`, "publier"));

    const confirmation = s.envoyeur.envoyes.find((m) =>
      corps(m).includes("est dans votre catalogue"),
    );
    expect(confirmation).toBeDefined();
    const lien = enTeteImage(confirmation as MessageSortant);
    expect(lien).not.toBeNull();

    /* Le lien pointe la declinaison JPEG de CET article, et l'objet existe
       vraiment dans le stockage — jamais un lien mort. */
    const article = await prisma.product.findFirstOrThrow({
      where: { sellerId: s.sellerId },
      select: { imageKey: true },
    });
    expect(article.imageKey).not.toBeNull();
    expect(lien).toContain(`${article.imageKey}.jpg`);
    expect(await s.storage.taille(`${article.imageKey}.jpg`)).not.toBeNull();
  });

  it("sans photo enregistree, la bulle reste celle d'avant — pas d'en-tete vide", async () => {
    const s = await scene();
    /* Sans stockage, le pipeline ne peut rien ecrire, donc rien a montrer.
       `delete` et non `= undefined` : `exactOptionalPropertyTypes` distingue
       « absent » de « present et indefini », et c'est l'absence qu'on joue. */
    delete s.deps.storage;
    const w = ids.suivant();
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.pv${w}`, "m-1", "Sac en raphia 8000"),
    );

    /* La photo legendee produit d'abord un recapitulatif — « J'ai lu … C'est
       bon ? » (ADR 0032). C'est APRES « Publier » que l'article existe, donc
       apres que la confirmation peut porter sa photo. */
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `wamid.pv${w}-ok`, "publier"));

    const confirmation = s.envoyeur.envoyes.find((m) =>
      corps(m).includes("est dans votre catalogue"),
    );
    expect(confirmation).toBeDefined();
    expect(enTeteImage(confirmation as MessageSortant)).toBeNull();
    /* Et la cause se dit toujours (ADR 0102) — l'en-tete ne la remplace pas. */
    expect(corps(confirmation as MessageSortant)).toMatch(/photo/i);
  });

  /**
   * Ce test tient la CHAINE, pas la regle de selection : quels articles la
   * carte met devant se demontre sur `selectionVitrine`, une fonction pure,
   * et non en devinant le contenu d'un PNG rendu. Ici on verifie qu'une
   * boutique de huit articles dont le dernier seul est illustre compose et
   * envoie sa carte de bout en bout — le chemin qu'emprunte la regle.
   */
  it("la carte se compose et part, huitieme article illustre compris", async () => {
    const s = await scene();
    /* Sept articles sans photo, deja en place — la disposition ordinaire :
       la vendeuse commence a photographier ses ajouts recents. */
    for (let i = 0; i < 7; i++) {
      await prisma.product.create({
        data: { sellerId: s.sellerId, name: `Ancien ${i}`, priceXaf: 1000 + i, position: i },
      });
    }
    const w = ids.suivant();
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.pv${w}`, "m-1", "Sac en raphia 8000"),
    );
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `wamid.pv${w}-ok`, "publier"));
    s.envoyeur.envoyes.length = 0;

    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `wamid.pv${w}-c`, "carte"));

    /* La carte est une image composee : elle est ECRITE dans le stockage
       sous `carte/`, et c'est le seul endroit ou l'on peut la mesurer. */
    const cartes = [...s.storage.objets.keys()].filter((k) => k.startsWith("carte/"));
    expect(cartes.length).toBeGreaterThan(0);

    /* Ce qui compte est ce que la carte a EU a composer : l'article illustre
       doit etre dans la selection, alors qu'il est huitieme par position. */
    const articles = await prisma.product.findMany({
      where: { sellerId: s.sellerId },
      orderBy: { position: "asc" },
      select: { name: true, imageKey: true },
    });
    expect(articles).toHaveLength(8);
    expect(articles.at(-1)?.name).toBe("Sac en raphia");
    expect(articles.at(-1)?.imageKey).not.toBeNull();
    /* Les sept premiers n'ont pas de photo : sans la selection par illustres,
       la carte n'aurait eu que des initiales a montrer. */
    expect(articles.slice(0, 7).every((a) => a.imageKey === null)).toBe(true);

    const image = s.envoyeur.envoyes.find((m) => (m as { type?: string }).type === "image");
    expect(image).toBeDefined();
    /* Composer une carte, c'est un rendu SVG, un QR, et trois compositions
       d'images : quelques secondes, largement au-dela du delai par defaut. */
  }, 30_000);
});

/**
 * Le catalogue de la VENDEUSE, contre une vraie base — ADR 0107.
 *
 * Ce que le domaine ne peut pas etablir : que la liste lit SES articles et
 * pas ceux d'une autre, que la fiche verifie sa photo dans le stockage, et
 * qu'un identifiant fabrique n'ouvre rien.
 */
describeDb("le catalogue vendeuse dans le fil (ADR 0107)", () => {
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

  it("« mes articles » liste SES articles, avec prix et stock", async () => {
    const s = await scene();
    await prisma.product.createMany({
      data: [
        { sellerId: s.sellerId, name: "Pagne wax", priceXaf: 15000, stock: 3, position: 0 },
        { sellerId: s.sellerId, name: "Sac raphia", priceXaf: 8000, stock: 0, position: 1 },
      ],
    });

    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "mes articles"));

    const listeEnvoyee = s.envoyeur.envoyes.find(
      (m) => (m as { interactive?: { type?: string } }).interactive?.type === "list",
    );
    expect(listeEnvoyee).toBeDefined();
    const rows =
      (
        listeEnvoyee as {
          interactive: {
            action: { sections: Array<{ rows: Array<{ id: string; description?: string }> }> };
          };
        }
      ).interactive.action.sections[0]?.rows ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.description).toContain("3 en stock");
    /* Zero vaut NON SUIVI, jamais « épuisé » : c'est la convention de la base
       et de la boutique publique (ADR 0038). */
    expect(rows[1]?.description).toContain("stock non suivi");
  });

  it("toucher une ligne rend la fiche AVEC sa photo verifiee", async () => {
    const s = await scene();
    const w = ids.suivant();
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.cat${w}`, "m-1", "Sac en raphia 8000"),
    );
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `wamid.cat${w}-ok`, "publier"));
    const article = await prisma.product.findFirstOrThrow({
      where: { sellerId: s.sellerId },
      select: { id: true, imageKey: true },
    });
    s.envoyeur.envoyes.length = 0;

    await traiterLivraisonBot(
      s.deps,
      ligneEntrante(s.waId, `wamid.cat${w}-l`, `vart:${article.id}`),
    );

    const img = s.envoyeur.envoyes.find((m) => (m as { type?: string }).type === "image");
    expect(img).toBeDefined();
    expect((img as { image: { link: string } }).image.link).toContain(`${article.imageKey}.jpg`);
    expect(s.envoyeur.envoyes.map(corps).join("\n")).toContain("Sac en raphia");
  });

  it("l'article d'une AUTRE vendeuse ne s'ouvre pas", async () => {
    const mienne = await scene();
    const autre = await scene();
    const p = await prisma.product.create({
      data: { sellerId: autre.sellerId, name: "Secret", priceXaf: 999, position: 0 },
    });

    /* Le wamid vient du SCHEMA, jamais d'une constante : `traiterLivraisonBot`
       deduplique par identifiant de message, et une valeur fixe est deja
       consommee au deuxieme passage sur la meme base. Le fil resterait muet,
       et l'echec ressemblerait a une fuite de donnees plutot qu'a sa cause. */
    await traiterLivraisonBot(
      mienne.deps,
      ligneEntrante(mienne.waId, `wamid.vol${ids.suivant()}`, `vart:${p.id}`),
    );

    const dit = mienne.envoyeur.envoyes.map(corps).join("\n");
    expect(dit).not.toContain("Secret");
    expect(dit).toMatch(/n'est plus dans votre catalogue/i);
  });
});
