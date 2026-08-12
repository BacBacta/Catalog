import { randomBytes } from "node:crypto";
import { CODE_ALPHABET } from "@catalog/contracts";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { basculerConges } from "../routes/seller.ts";
import { selExecution } from "./_identifiants.ts";

/**
 * Le mode conges contre une VRAIE base — ADR 0039.
 *
 * Ce que la machine pure ne peut pas etablir : que la bascule ECRIT, que le
 * journal garde la trace, et surtout que la commande est refusee **a la
 * creation** et pas seulement a l'affichage. Entre le recapitulatif et l'appui
 * sur « Confirmer », la vendeuse a pu partir : c'est la base qui fait foi, pas
 * l'etat de conversation.
 *
 * `traiterEntree` avale ses exceptions pour ne jamais bloquer une livraison —
 * un defaut de service y serait donc parfaitement silencieux sans ce fichier.
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
const RUN = 526 * 1000 + selExecution();
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
  acheteuseWaId: string;
  sellerId: string;
  slug: string;
  productId: string;
  envoyeur: EnvoyeurMemoire;
  deps: BotDeps;
}

async function scene(suffixe: number): Promise<Scene> {
  const vendeuseWaId = `23767${String(1000000 + suffixe).slice(-7)}`;
  const acheteuseWaId = `23769${String(1000000 + suffixe).slice(-7)}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse conges ${suffixe}`,
      email: `conges-${suffixe}@telephone.catalog.invalid`,
      phoneNumber: `+${vendeuseWaId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${vendeuseWaId}`,
      businessName: `Boutique conges ${suffixe}`,
      slug: `conges-${suffixe}`,
      city: "Douala",
      /* Reversement pose : sans lui, le plan de paiement change et le
         recapitulatif ne dirait pas la meme chose. */
      payoutPhone: "+237656746215",
      payoutPhoneVerifiedAt: NOW,
    },
  });
  const p = await prisma.product.create({
    data: { sellerId: v.id, name: "Sac en raphia", priceXaf: 8000, position: 0 },
  });
  void codeDeTest(suffixe);

  const envoyeur = new EnvoyeurMemoire();
  return {
    vendeuseWaId,
    acheteuseWaId,
    sellerId: v.id,
    slug: v.slug,
    productId: p.id,
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

describeDb("le mode conges (ADR 0039)", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("« congés » depuis le fil ferme la boutique et journalise", async () => {
    const s = await scene(suivant());
    await traiterLivraisonBot(s.deps, texteEntrant(s.vendeuseWaId, "congés"));

    const apres = await prisma.seller.findUniqueOrThrow({
      where: { id: s.sellerId },
      select: { congesDepuis: true },
    });
    expect(apres.congesDepuis).not.toBeNull();

    const journal = await prisma.sellerAuditEvent.findMany({
      where: { sellerId: s.sellerId },
      select: { kind: true, actor: true },
    });
    expect(journal).toEqual([{ kind: "boutique_fermee", actor: "bot_whatsapp" }]);

    /* Ce que ca change ET ce que ca ne change pas : les deux sont dits. */
    const dit = s.envoyeur.envoyes.map(corps).join("\n");
    expect(dit).toMatch(/reste en ligne/);
    expect(dit).toMatch(/je reprends/i);
  });

  it("refuse la création APRÈS le récapitulatif — la base fait foi", async () => {
    const s = await scene(suivant());
    /* L'acheteuse est au recapitulatif : son etat de conversation date d'avant
       le depart en conges, et porte encore le bouton « Confirmer ». */
    await prisma.botConversation.create({
      data: {
        phone: `+${s.acheteuseWaId}`,
        etat: {
          nom: "recap",
          slug: s.slug,
          panier: [{ articleId: s.productId, quantite: 1 }],
          mode: "retrait",
          livraison: {
            mode: "retrait",
            city: "Douala",
            pickupPoint: "Marche central",
            landmark: "en face de la pharmacie",
            phone: `+${s.acheteuseWaId}`,
          },
        },
        updatedAt: NOW,
      },
    });
    await basculerConges(prisma, s.sellerId, true, "vendeuse_app", NOW);

    await traiterLivraisonBot(s.deps, bouton(s.acheteuseWaId, "confirmer"));

    const commandes = await prisma.order.count({ where: { sellerId: s.sellerId } });
    expect(commandes).toBe(0);
    expect(s.envoyeur.envoyes.map(corps).join("\n")).toMatch(/nouvelle commande/);
  });

  it("rouvrir laisse commander de nouveau, et la bascule est idempotente", async () => {
    const s = await scene(suivant());
    await basculerConges(prisma, s.sellerId, true, "vendeuse_app", NOW);
    const premier = await prisma.seller.findUniqueOrThrow({
      where: { id: s.sellerId },
      select: { congesDepuis: true },
    });

    /* Refermer une boutique fermee ne repousse pas la date : elle repond a
       « depuis quand », pas a « quand a-t-elle appuye la derniere fois ». */
    await basculerConges(
      prisma,
      s.sellerId,
      true,
      "vendeuse_app",
      new Date(NOW.getTime() + 3600_000),
    );
    const second = await prisma.seller.findUniqueOrThrow({
      where: { id: s.sellerId },
      select: { congesDepuis: true },
    });
    expect(second.congesDepuis?.getTime()).toBe(premier.congesDepuis?.getTime());
    /* Et une bascule sans changement n'ecrit pas au journal. */
    expect(await prisma.sellerAuditEvent.count({ where: { sellerId: s.sellerId } })).toBe(1);

    await basculerConges(prisma, s.sellerId, false, "bot_whatsapp", NOW);
    expect(
      (
        await prisma.seller.findUniqueOrThrow({
          where: { id: s.sellerId },
          select: { congesDepuis: true },
        })
      ).congesDepuis,
    ).toBeNull();
    expect(await prisma.sellerAuditEvent.count({ where: { sellerId: s.sellerId } })).toBe(2);
  });
});
