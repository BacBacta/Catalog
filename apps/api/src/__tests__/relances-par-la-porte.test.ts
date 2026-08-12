import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { livrerNotificationsEnAttente } from "../bot-notifications.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { executerRelanceAcompte, executerRelanceReversement } from "../jobs/relance-acompte.ts";
import { identifiants, selExecution } from "./_identifiants.ts";

/**
 * Les deux relances passent par la PORTE — ADR 0060.
 *
 * Elles appelaient `envoyeur.envoyer(texte(...))` en direct, sans passer par
 * `notifier()`. Hors fenetre de 24 h, Meta refuse en 131047 et le message
 * etait PERDU : ni file d'attente, ni gabarit de repli. Or la relance
 * reversement part ~20 h apres la creation de la boutique, alors que la
 * fenetre compte 24 h depuis le DERNIER MESSAGE de la vendeuse : une
 * vendeuse qui s'inscrit puis se tait a deja la porte fermee.
 *
 * Le message qui rapporte le plus — « posez votre Mobile Money » — etait donc
 * celui qui avait le plus de chances de s'evaporer. Et son gabarit,
 * `reversement_absent`, etait depose, approuve, et jamais appele.
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
const RUN = 760 * 1000 + selExecution();
/* Le schema recent ne sert ICI qu'aux codes de verification (tache #68) :
   l'ancien generateur hachait sa graine, et le bloc ne separe pas ce qu'un
   hachage fait des nombres — vu en CI le 12/08 (ADR 0078). */
const ids = identifiants("relances-par-la-porte");
const NOW = new Date("2026-08-11T10:00:00+01:00");
/** Hors fenetre : la vendeuse n'a rien ecrit depuis 40 h. */
const VIEUX = new Date(NOW.getTime() - 40 * 3600_000);

class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "memoire";
  readonly envoyes: MessageSortant[] = [];
  /** Refuse tout hors gabarit, comme Meta hors fenetre (131047). */
  refuseHorsGabarit = false;
  async envoyer(m: MessageSortant): Promise<void> {
    if (this.refuseHorsGabarit && m.type !== "template") {
      throw new Error("envoi bot refuse : HTTP 400, code Meta 131047");
    }
    this.envoyes.push(m);
  }
}

const nomsGabarits = (e: EnvoyeurMemoire) =>
  e.envoyes
    .filter((m) => m.type === "template")
    .map((m) => (m as { template: { name: string } }).template.name);

let compteur = 0;
const suivant = () => RUN * 100 + ++compteur;

async function vendeuseSansReversement(suffixe: number) {
  const waId = `23767${String(1000000 + suffixe).slice(-7)}`;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse relance ${suffixe}`,
      email: `relance-${suffixe}@telephone.catalog.invalid`,
      phoneNumber: `+${waId}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${waId}`,
      businessName: `Chez Relance ${suffixe}`,
      slug: `relance-${suffixe}`,
      city: "Douala",
      /* Creee il y a 21 h : la relance est due (ADR 0035). */
      createdAt: new Date(NOW.getTime() - 21 * 3600_000),
    },
  });
  /* Sa conversation existe, mais elle date : la fenetre est FERMEE. */
  await prisma.botConversation.create({
    data: { phone: `+${waId}`, etat: { nom: "accueil" }, updatedAt: VIEUX },
  });
  return { waId, sellerId: v.id, nom: v.businessName };
}

describeDb("les relances passent par la porte (ADR 0060)", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reversement, HORS fenetre : le gabarit approuve part au lieu du texte perdu", async () => {
    const s = await vendeuseSansReversement(suivant());
    const envoyeur = new EnvoyeurMemoire();
    envoyeur.refuseHorsGabarit = true;

    await executerRelanceReversement(
      { prisma, envoyeur, maintenant: () => NOW, baseApp: "https://app.test" },
      { sellerId: s.sellerId, phone: `+${s.waId}` },
    );

    expect(nomsGabarits(envoyeur)).toEqual(["catalog_reversement_absent_v2"]);
  });

  it("le gabarit porte le NOM de la boutique, pas un numero", async () => {
    const s = await vendeuseSansReversement(suivant());
    const envoyeur = new EnvoyeurMemoire();
    await executerRelanceReversement(
      { prisma, envoyeur, maintenant: () => NOW, baseApp: "https://app.test" },
      { sellerId: s.sellerId, phone: `+${s.waId}` },
    );
    const gab = envoyeur.envoyes.find((m) => m.type === "template") as
      | { template: { components: Array<{ parameters: Array<{ text: string }> }> } }
      | undefined;
    expect(gab?.template.components[0]?.parameters[0]?.text).toBe(s.nom);
  });

  it("un envoi REFUSE ne perd rien : la relance attend le prochain message", async () => {
    const s = await vendeuseSansReversement(suivant());
    const mort = new EnvoyeurMemoire();
    /* Tout echoue, gabarit compris : le pire cas. */
    mort.envoyer = async () => {
      throw new Error("envoi bot refuse : HTTP 400, code Meta 131047");
    };
    await executerRelanceReversement(
      { prisma, envoyeur: mort, maintenant: () => NOW, baseApp: "https://app.test" },
      { sellerId: s.sellerId, phone: `+${s.waId}` },
    );

    const enFile = await prisma.botNotification.count({ where: { phone: `+${s.waId}` } });
    expect(enFile).toBe(1);

    /* Elle reecrit : la relance sort de la file. */
    const vivant = new EnvoyeurMemoire();
    await livrerNotificationsEnAttente(
      { prisma, envoyeur: vivant, maintenant: () => NOW },
      `+${s.waId}`,
    );
    expect(vivant.envoyes.length).toBe(1);
  });

  it("reversement DEJA pose : rien ne part — la decision reste souveraine", async () => {
    const s = await vendeuseSansReversement(suivant());
    await prisma.seller.update({
      where: { id: s.sellerId },
      data: { payoutPhone: "+237656746215", payoutPhoneVerifiedAt: NOW },
    });
    const envoyeur = new EnvoyeurMemoire();
    await executerRelanceReversement(
      { prisma, envoyeur, maintenant: () => NOW, baseApp: "https://app.test" },
      { sellerId: s.sellerId, phone: `+${s.waId}` },
    );
    expect(envoyeur.envoyes).toHaveLength(0);
  });

  it("acompte, HORS fenetre : le gabarit approuve part aussi", async () => {
    const s = await vendeuseSansReversement(suivant());
    /* Un numero d'acheteuse propre a CETTE execution : la conversation est
       unique par telephone, et deux passages du banc se marcheraient dessus. */
    const acheteuse = `23769${String(1000000 + RUN * 10 + compteur).slice(-7)}`;
    const commande = await prisma.order.create({
      data: {
        sellerId: s.sellerId,
        /* `RUN` horodate la serie : sans lui, deux executions du banc se
           disputent la meme reference, qui est UNIQUE en base. */
        ref: `CT-${String(400000 + (RUN % 500000) + compteur)}`,
        buyerPhone: `+${acheteuse}`,
        payMode: "acompte",
        totalXaf: 15000,
        amountPaidXaf: 0,
        balanceXaf: 15000,
        items: [{ nom: "Robe wax", quantite: 1, prixUnitaireXaf: 15000 }],
        delivery: {
          mode: "livraison",
          city: "Douala",
          quartier: "Bonapriso",
          landmark: "en face du marché",
          phone: `+${acheteuse}`,
        },
        /* L'alphabet non ambigu du lot 3 — une contrainte SQL le verifie :
           ni O/0, ni I/1/L, ni B/8, ni S/5, ni Z/2. */
        verificationCode: ids.codeVerification(),
        createdAt: new Date(NOW.getTime() - 2 * 3600_000),
        expiresAt: new Date(NOW.getTime() + 46 * 3600_000),
      },
    });
    await prisma.botConversation.create({
      data: { phone: `+${acheteuse}`, etat: { nom: "accueil" }, updatedAt: VIEUX },
    });

    const envoyeur = new EnvoyeurMemoire();
    envoyeur.refuseHorsGabarit = true;
    await executerRelanceAcompte(
      { prisma, envoyeur, maintenant: () => NOW },
      { commandeId: commande.id, phone: `+${acheteuse}`, langue: "fr" },
    );
    expect(nomsGabarits(envoyeur)).toEqual(["catalog_acompte_attendu_v2"]);
  });
});
