import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage } from "../adapters/storage-s3.ts";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * La carte-vitrine ENTRETENUE — lot P2 (ADR 0095, decision c).
 *
 * Elle arrive d'elle-meme apres chaque publication : le service rendu avant
 * d'etre demande. Ce que ce fichier tient : une publication = UNE carte
 * (une salve aussi — 2 messages, pas 4), l'echec de la carte poussee est
 * SILENCIEUX, aucun gabarit n'est jamais tente, et « ma carte » ne change
 * pas d'un mot.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const ids = identifiants("bot-carte-entretenue");
const NOW = new Date("2026-08-15T11:00:00+01:00");

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
  (m as { image?: { caption?: string } }).image?.caption ??
  "";

const bulles = (ms: readonly MessageSortant[]): MessageSortant[] =>
  ms.filter((m) => (m as { type?: string }).type !== "reaction");

const estImage = (m: MessageSortant): boolean => (m as { type?: string }).type === "image";

const photoEntrante = (de: string, wamid: string, mediaId: string, caption: string) => ({
  messages: [{ from: de, id: wamid, type: "image", image: { id: mediaId, caption } }],
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

const texteEntrant = (de: string, wamid: string, corpsTexte: string) => ({
  messages: [{ from: de, id: wamid, type: "text", text: { body: corpsTexte } }],
});

interface Scene {
  waId: string;
  phone: string;
  sellerId: string;
  envoyeur: EnvoyeurMemoire;
  deps: BotDeps;
}

let jpeg: Uint8Array;

async function scene(options: { numeroCatalog?: string | null } = {}): Promise<Scene> {
  const n = ids.suivant();
  const waId = `23767${String(n).padStart(7, "0")}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse carte ${n}`,
      email: ids.email("bot-carte"),
      phoneNumber: `+${waId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${waId}`,
      businessName: `Boutique carte ${n}`,
      slug: `bot-carte-${n}`,
      city: "Douala",
    },
  });
  /* Un article DEJA en ligne : la carte se teste hors du cas « premier
     article », dont le mode d'emploi brouillerait les comptes. */
  await prisma.product.create({
    data: { sellerId: v.id, name: "Sac tresse", priceXaf: 8500, position: 0 },
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
      storage: new MemoryStorage({ NODE_ENV: "test" }),
      media: {
        nom: "memoire-jpeg",
        lire: async () => ({ octets: jpeg, typeAnnonce: "image/jpeg" }),
      },
      ...(options.numeroCatalog === null
        ? {}
        : { numeroCatalog: options.numeroCatalog ?? "+237690000000" }),
    },
  };
}

describeDb("la carte-vitrine entretenue (lot P2, ADR 0095-c)", () => {
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

  it("publication unitaire → la confirmation, puis UNE carte — avec la copie de la maquette", async () => {
    const s = await scene();
    const w = ids.suivant();
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.c${w}-1`, "m-1", "Pagne wax 6 yards 15 000"),
    );
    const avant = bulles(s.envoyeur.envoyes).length;
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `wamid.c${w}-pub`, "publier"));

    const nouvelles = bulles(s.envoyeur.envoyes).slice(avant);
    expect(nouvelles).toHaveLength(2);
    expect(corps(nouvelles[0] as MessageSortant)).toContain("est dans votre catalogue");
    expect(estImage(nouvelles[1] as MessageSortant)).toBe(true);
    expect(corps(nouvelles[1] as MessageSortant)).toContain(
      "je la referai à chaque changement, sans que vous la demandiez",
    );
    /* Jamais de gabarit, jamais de mise en attente : la fenetre est ouverte
       par construction — rien n'entre dans la file des notifications. */
    expect(await prisma.botNotification.count({ where: { phone: s.phone } })).toBe(0);
  });

  it("salve → la carte de retour + UNE carte-vitrine : 2 messages, pas 4", async () => {
    const s = await scene();
    const w = ids.suivant();
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.c${w}-1`, "m-1", "Pagne wax 6 yards 15 000"),
    );
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.c${w}-2`, "m-2", "Huile de palme 5 L 4 500"),
    );
    const avant = bulles(s.envoyeur.envoyes).length;
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `wamid.c${w}-pub`, "tout_publier"));

    const nouvelles = bulles(s.envoyeur.envoyes).slice(avant);
    expect(nouvelles).toHaveLength(2);
    expect(corps(nouvelles[0] as MessageSortant)).toContain("Votre boutique passe à 3 articles");
    expect(estImage(nouvelles[1] as MessageSortant)).toBe(true);
  });

  it("la carte poussee qui ne peut pas se fabriquer vaut SILENCE — jamais une excuse non sollicitee", async () => {
    /* Sans numero Catalog, la carte n'a pas de QR a composer : la carte
       DEMANDEE s'excuse, la carte POUSSEE se tait. */
    const s = await scene({ numeroCatalog: null });
    const w = ids.suivant();
    await traiterLivraisonBot(
      s.deps,
      photoEntrante(s.waId, `wamid.c${w}-1`, "m-1", "Pagne wax 6 yards 15 000"),
    );
    const avant = bulles(s.envoyeur.envoyes).length;
    await traiterLivraisonBot(s.deps, boutonEntrant(s.waId, `wamid.c${w}-pub`, "publier"));

    const nouvelles = bulles(s.envoyeur.envoyes).slice(avant);
    expect(nouvelles).toHaveLength(1);
    expect(corps(nouvelles[0] as MessageSortant)).toContain("est dans votre catalogue");
    const tout = s.envoyeur.envoyes.map(corps).join("\n");
    expect(tout).not.toContain("n'est pas disponible");
    expect(tout).not.toContain("n'a pas pu être fabriquée");
  });

  it("« ma carte » demandee reste inchangee — l'excuse comprise quand elle ne peut pas se faire", async () => {
    const s = await scene({ numeroCatalog: null });
    const w = ids.suivant();
    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, `wamid.c${w}-mc`, "ma carte"));
    const tout = s.envoyeur.envoyes.map(corps).join("\n");
    /* Le mode DEMANDE garde son explication : la vendeuse attend une reponse. */
    expect(tout).toContain("n'est pas disponible");
  });
});
