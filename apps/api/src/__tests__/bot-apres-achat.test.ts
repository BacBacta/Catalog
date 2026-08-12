import { randomBytes } from "node:crypto";
import { CODE_ALPHABET } from "@catalog/contracts";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { selExecution } from "./_identifiants.ts";

/**
 * L'apres-achat DANS le fil, contre une VRAIE base — ADR 0036.
 *
 * Ce que ce fichier etablit et qu'aucun test pur ne peut etablir : que le
 * SERVICE va au bout. La machine est deja couverte cas par cas ; ici on
 * verifie que l'effet se traduit en ecriture — contre-signature appliquee,
 * avis cree avec son label, journal ecrit — et surtout que rien ne LEVE en
 * chemin. `traiterEntree` avale ses exceptions pour ne pas bloquer une
 * livraison : sans ce test, une erreur de service serait parfaitement
 * silencieuse. C'est exactement ce qui s'est produit au premier essai.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
/* Un bloc de 1 000 identifiants PAR FICHIER, plus la minute courante.
   `selExecution()` seul donnait des blocs qui se recouvraient : deux
   fichiers demarres a quelques millisecondes d'ecart visaient le meme
   identifiant, et Vitest les lance en parallele contre UNE base. Le
   defaut a fait echouer deux verifications le 11/08/2026, dont un test
   de fuite — le genre de faux rouge qui masque un vrai. */
const RUN = 74 * 1000 + selExecution();
const NOW = new Date("2026-08-04T12:00:00+01:00");

function codeDeTest(graine: number): string {
  let n = graine;
  const car = () => {
    n = (n * 31 + 17) % 1_000_003;
    return CODE_ALPHABET[n % CODE_ALPHABET.length] as string;
  };
  const bloc = () => Array.from({ length: 4 }, car).join("");
  return `${bloc()}-${bloc()}`;
}

/** Un envoyeur qui garde ce qu'il envoie — le fil se relit dans les tests. */
class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "memoire";
  readonly envoyes: MessageSortant[] = [];
  async envoyer(m: MessageSortant): Promise<void> {
    this.envoyes.push(m);
  }
}

const bouton = (de: string, id: string) => ({
  messages: [
    {
      from: de,
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id } },
    },
  ],
});
const ligne = (de: string, id: string) => ({
  messages: [
    { from: de, type: "interactive", interactive: { type: "list_reply", list_reply: { id } } },
  ],
});
const texteEntrant = (de: string, corps: string) => ({
  messages: [{ from: de, type: "text", text: { body: corps } }],
});

interface Scene {
  phone: string;
  waId: string;
  orderId: string;
  ref: string;
  envoyeur: EnvoyeurMemoire;
  deps: BotDeps;
}

/**
 * Une commande LIVREE et PROUVEE, rattachee au fil : de quoi exercer la
 * contre-signature ET l'avis.
 */
async function scene(suffixe: number, options: { proofState?: string } = {}): Promise<Scene> {
  const waId = `23765${String(1000000 + suffixe).slice(-7)}`;
  const phone = `+${waId}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse ${suffixe}`,
      email: `apres-achat-${suffixe}@telephone.catalog.invalid`,
      phoneNumber: `+23767${String(1000000 + suffixe).slice(-7)}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: u.phoneNumber as string,
      businessName: `Boutique apres-achat ${suffixe}`,
      slug: `apres-achat-${suffixe}`,
      city: "Douala",
    },
  });
  const p = await prisma.product.create({
    data: { sellerId: v.id, name: "Sac en raphia", priceXaf: 8000, position: 0 },
  });
  const ref = `CT-${(700000 + suffixe) % 999999}`;
  const o = await prisma.order.create({
    data: {
      ref,
      sellerId: v.id,
      buyerPhone: "+237677889900",
      buyerToken: `t${suffixe}_`.padEnd(43, "x").slice(0, 43),
      items: [{ productId: p.id, name: p.name, unitPriceXaf: 8000, quantity: 1 }],
      totalXaf: 8000,
      amountPaidXaf: 8000,
      balanceXaf: 0,
      payMode: "integral",
      step: "livree",
      proofState: (options.proofState ?? "prouve") as never,
      delivery: { mode: "retrait", pickupPoint: "Marche central", phone: "+237677889900" },
      verificationCode: codeDeTest(suffixe),
      expiresAt: new Date(NOW.getTime() + 48 * 3600_000),
    },
    select: { id: true, ref: true },
  });
  await prisma.botConversation.create({
    data: { phone, etat: { nom: "accueil" }, derniereCommandeId: o.id },
  });

  const envoyeur = new EnvoyeurMemoire();
  return {
    phone,
    waId,
    orderId: o.id,
    ref: o.ref,
    envoyeur,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      maintenant: () => NOW,
      aleatoire: (n: number) => new Uint8Array(randomBytes(n)),
    },
  };
}

let compteur = 0;
const suivant = () => RUN * 100 + ++compteur;

describeDb("l'apres-achat dans le fil (ADR 0036)", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("« Je confirme » applique la contre-signature et journalise le canal", async () => {
    const s = await scene(suivant());
    await traiterLivraisonBot(s.deps, bouton(s.waId, "contresigner"));

    const apres = await prisma.order.findUniqueOrThrow({
      where: { id: s.orderId },
      select: { proofState: true },
    });
    expect(apres.proofState).toBe("contresigne");

    const journal = await prisma.orderEvent.findFirst({
      where: { orderId: s.orderId, kind: "preuve_avancee" },
      select: { actor: true, payload: true },
    });
    expect(journal?.actor).toBe("acheteuse");
    expect(journal?.payload).toMatchObject({ vers: "contresigne", canal: "bot_whatsapp" });
    /* Et l'acheteuse est repondue — pas seulement la base ecrite. */
    expect(s.envoyeur.envoyes).toHaveLength(1);
  });

  it("sans preuve prealable, elle ne s'applique pas — et le refus est journalise", async () => {
    const s = await scene(suivant(), { proofState: "attendu" });
    await traiterLivraisonBot(s.deps, bouton(s.waId, "contresigner"));

    const apres = await prisma.order.findUniqueOrThrow({
      where: { id: s.orderId },
      select: { proofState: true },
    });
    expect(apres.proofState).toBe("attendu");
    /* La machine a refuse AVANT l'effet : rien n'est ecrit, l'acheteuse est
       prevenue. C'est le contrat de l'ADR — on propose ce qui est permis. */
    expect(await prisma.orderEvent.count({ where: { orderId: s.orderId } })).toBe(0);
  });

  it("la note cree l'avis VERIFIE, le mot l'enrichit ensuite", async () => {
    const s = await scene(suivant());
    await traiterLivraisonBot(s.deps, ligne(s.waId, "note:5"));

    const avis = await prisma.review.findUniqueOrThrow({
      where: { orderId: s.orderId },
      select: { rating: true, verified: true, body: true, productId: true },
    });
    expect(avis.rating).toBe(5);
    /* `prouve` ouvre le label — c'est la regle du lot 12, pas une redite. */
    expect(avis.verified).toBe(true);
    expect(avis.body).toBeNull();
    /* Un seul article dans la commande : l'avis lui est attribue (ADR 0035). */
    expect(avis.productId).not.toBeNull();

    await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "Le sac est magnifique"));
    const enrichi = await prisma.review.findUniqueOrThrow({
      where: { orderId: s.orderId },
      select: { body: true, rating: true },
    });
    expect(enrichi.body).toBe("Le sac est magnifique");
    expect(enrichi.rating).toBe(5);
  });

  it("un paiement declare a la main donne un avis publie mais NON verifie", async () => {
    const s = await scene(suivant(), { proofState: "declare_non_trace" });
    await traiterLivraisonBot(s.deps, ligne(s.waId, "note:4"));

    const avis = await prisma.review.findUniqueOrThrow({
      where: { orderId: s.orderId },
      select: { rating: true, verified: true },
    });
    expect(avis).toEqual({ rating: 4, verified: false });
  });

  it("la contestation gele la commande, apres confirmation seulement", async () => {
    const s = await scene(suivant());
    await traiterLivraisonBot(s.deps, bouton(s.waId, "contester"));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } })).proofState).toBe(
      "prouve",
    );

    await traiterLivraisonBot(s.deps, bouton(s.waId, "contester:oui"));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.orderId } })).proofState).toBe(
      "conteste",
    );
  });

  it("un second avis est refuse par la base, sans casser la conversation", async () => {
    const s = await scene(suivant());
    await traiterLivraisonBot(s.deps, ligne(s.waId, "note:5"));
    await traiterLivraisonBot(s.deps, ligne(s.waId, "note:1"));

    const avis = await prisma.review.findUniqueOrThrow({
      where: { orderId: s.orderId },
      select: { rating: true },
    });
    expect(avis.rating).toBe(5);
    /* La conversation a repondu aux DEUX entrees : rien n'a leve. */
    expect(s.envoyeur.envoyes.length).toBeGreaterThanOrEqual(2);
  });
});
