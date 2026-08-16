import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage } from "../adapters/storage-s3.ts";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import type { FicheCatalogue, SynchroniseurCatalogue } from "../domain/catalogue.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * Le catalogue natif Meta, contre une vraie base — ADR 0108.
 *
 * Ce que le domaine ne peut pas etablir seul :
 *
 * 1. **La synchronisation suit la publication.** C'est une decoration du
 *    service, et son contenu — les illustres seulement, le prix entier XAF,
 *    l'URL publique — se verifie sur ce qui atteint le synchroniseur.
 * 2. **Un panier natif retrouve sa boutique par ses FICHES.** Le catalogue
 *    du profil melange toutes les vendeuses : l'acheteuse peut composer un
 *    panier sans conversation prealable, et c'est l'article qui dit sa
 *    vendeuse — pas l'etat, qui peut designer une AUTRE boutique.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const ids = identifiants("bot-catalogue");
const NOW = new Date("2026-08-16T09:00:00+01:00");

class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "memoire";
  readonly envoyes: MessageSortant[] = [];
  async envoyer(m: MessageSortant): Promise<void> {
    this.envoyes.push(m);
  }
}

/** Un synchroniseur qui ENREGISTRE — le double de test du contrat du domaine. */
class CatalogueMemoire implements SynchroniseurCatalogue {
  readonly nom = "memoire";
  readonly pousses: FicheCatalogue[][] = [];
  readonly retires: string[][] = [];
  async pousser(fiches: readonly FicheCatalogue[]): Promise<void> {
    this.pousses.push([...fiches]);
  }
  async retirer(articleIds: readonly string[]): Promise<void> {
    this.retires.push([...articleIds]);
  }
}

const photoEntrante = (de: string, wamid: string, mediaId: string, legende: string) => ({
  messages: [{ from: de, id: wamid, type: "image", image: { id: mediaId, caption: legende } }],
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
const commandeEntrante = (
  de: string,
  wamid: string,
  lignes: Array<{ id: string; quantite: number }>,
) => ({
  messages: [
    {
      from: de,
      id: wamid,
      type: "order",
      order: {
        catalog_id: "cat-test",
        product_items: lignes.map((l) => ({
          product_retailer_id: l.id,
          quantity: l.quantite,
          item_price: 1,
          currency: "XAF",
        })),
      },
    },
  ],
});

const corps = (m: MessageSortant): string =>
  (m as { text?: { body?: string } }).text?.body ??
  (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ??
  "";

interface Scene {
  vendeuseWaId: string;
  acheteuseWaId: string;
  sellerId: string;
  slug: string;
  envoyeur: EnvoyeurMemoire;
  catalogue: CatalogueMemoire;
  deps: BotDeps;
}

let jpeg: Uint8Array;

async function scene(): Promise<Scene> {
  const n = ids.suivant();
  const vendeuseWaId = `23767${String(n).padStart(7, "0")}`;
  const acheteuseWaId = `23769${String(n).padStart(7, "0")}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse catalogue ${n}`,
      email: ids.email("bot-catalogue"),
      phoneNumber: `+${vendeuseWaId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${vendeuseWaId}`,
      businessName: `Boutique catalogue ${n}`,
      slug: `bot-catalogue-${n}`,
      city: "Douala",
      payoutPhone: "+237656746215",
      payoutPhoneVerifiedAt: NOW,
    },
  });
  const envoyeur = new EnvoyeurMemoire();
  const catalogue = new CatalogueMemoire();
  return {
    vendeuseWaId,
    acheteuseWaId,
    sellerId: v.id,
    slug: v.slug,
    envoyeur,
    catalogue,
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
        lireCdn: async () => ({ octets: jpeg, typeAnnonce: "image/jpeg" }),
      },
      catalogueId: "cat-test",
      catalogue,
      mediaPublicBase: "https://media.test",
    },
  };
}

describeDb("le catalogue natif Meta, service (ADR 0108)", () => {
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

  it("publier un article avec photo SYNCHRONISE sa fiche — prix entier XAF, URL publique", async () => {
    const s = await scene();
    const w = ids.suivant();
    /* Un article SANS photo, deja en place : il ne doit jamais partir. */
    await prisma.product.create({
      data: { sellerId: s.sellerId, name: "Sans photo", priceXaf: 500, position: 0 },
    });
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.vendeuseWaId, `wamid.bc${w}`, "m-1", "Pagne wax 15000"),
    );
    await traiterLivraisonBot(s.deps, boutonEntrant(s.vendeuseWaId, `wamid.bc${w}-ok`, "publier"));

    expect(s.catalogue.pousses.length).toBeGreaterThan(0);
    const fiches = s.catalogue.pousses.at(-1) as FicheCatalogue[];
    /* L'illustre seul — « Sans photo » reste a la liste (ADR 0107). */
    expect(fiches).toHaveLength(1);
    const fiche = fiches[0] as FicheCatalogue;
    expect(fiche.nom).toBe("Pagne wax");
    expect(fiche.prixXaf).toBe(15000);
    expect(fiche.disponible).toBe(true);
    expect(fiche.lienBoutique).toBe(`https://boutique.test/${s.slug}`);
    expect(fiche.imageUrl).toMatch(/^https:\/\/media\.test\/img\/[0-9a-f]{2}\/[0-9a-f]{32}\.jpg$/);
    /* Et la fiche porte l'identifiant de l'article EN BASE — pas de table de
       correspondance, c'est la decision de l'ADR. */
    const article = await prisma.product.findFirstOrThrow({
      where: { sellerId: s.sellerId, name: "Pagne wax" },
      select: { id: true },
    });
    expect(fiche.id).toBe(article.id);
  });

  it("un panier natif SANS conversation prealable retrouve sa boutique par la fiche", async () => {
    const s = await scene();
    const article = await prisma.product.create({
      data: { sellerId: s.sellerId, name: "Sac en raphia", priceXaf: 8000, position: 0, stock: 3 },
    });

    /* L'acheteuse n'a JAMAIS ecrit : son premier geste est le panier, compose
       depuis le catalogue du profil. */
    await traiterLivraisonBot(
      s.deps,
      commandeEntrante(s.acheteuseWaId, `wamid.bc${ids.suivant()}`, [
        { id: article.id, quantite: 2 },
      ]),
    );

    const tout = s.envoyeur.envoyes.map(corps).join("\n");
    /* Le recapitulatif EXISTANT, re-tarife depuis la base : 2 × 8 000. */
    expect(tout).toContain("Sac en raphia");
    expect(tout).toContain("16");
    /* Et l'etat est bien accroche a la bonne boutique. */
    const enregistrement = await prisma.botConversation.findUniqueOrThrow({
      where: { phone: `+${s.acheteuseWaId}` },
      select: { etat: true },
    });
    expect(enregistrement.etat).toMatchObject({ nom: "ajout", slug: s.slug });
  });
});
