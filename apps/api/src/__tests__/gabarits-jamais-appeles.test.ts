import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  livrerNotificationsEnAttente,
  notifierConteste,
  notifierLivree,
} from "../bot-notifications.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { RAMPE_DEFAUT } from "../domain/ramp/config.ts";
import { suiviRoutes } from "../routes/recu.ts";
import { describeDb } from "./_base.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * Deux gabarits qui existaient sans jamais partir — meme famille que l'ADR
 * 0060, et meme mecanique d'echec.
 *
 * ── Ce que ce fichier tient ────────────────────────────────────────────────
 *
 * 1. **`commande_livree` etait approuve, paye, et jamais appele.**
 *    `notifierLivree` passait bien par `notifier()`, mais SANS le cinquieme
 *    argument : hors des 24 h, la notification partait en file d'attente et
 *    attendait que l'acheteuse reecrive d'elle-meme — ce qu'elle n'a aucune
 *    raison de faire, puisque c'est la vendeuse qui vient de livrer. Or l'avis
 *    verifie se depose depuis CE message : le faire attendre, ce n'est pas le
 *    retarder, c'est le perdre.
 *
 * 2. **La contestation ne prevenait personne.** La contre-signature (ADR 0036)
 *    donne a l'acheteuse un bouton « ce n'est pas moi », qui GELE la commande.
 *    La vendeuse ne l'apprenait qu'a sa prochaine visite dans le fil : elle
 *    continuait a preparer, a livrer, a relancer une commande deja arretee.
 *    Une contestation decouverte trois jours plus tard est un litige devenu
 *    insoluble — la preuve opposable, valeur n° 1 du produit, se retournait
 *    contre celle qu'elle protege.
 *
 * ── Pourquoi les DEUX chemins de contestation sont ici ─────────────────────
 *
 * Il y en a deux, et n'en brancher qu'un laisserait le defaut entier pour
 * l'autre moitie des acheteuses : le bouton du fil, et `POST /:jeton/contester`
 * ouvert depuis le lien de suivi web. Le second passe par la VRAIE route.
 */

const URL = process.env.DATABASE_URL;

let prisma: PrismaClient;
const ids = identifiants("gabarits-jamais-appeles");
const NOW = new Date("2026-08-12T10:00:00+01:00");
/** Hors fenetre : personne n'a ecrit depuis 40 h. Meta refuserait en 131047. */
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

const premierGabarit = (e: EnvoyeurMemoire) =>
  e.envoyes.find((m) => m.type === "template") as
    | { to: string; template: { components: Array<{ parameters: Array<{ text: string }> }> } }
    | undefined;

/**
 * Une commande PROUVEE, sa vendeuse et son acheteuse, toutes deux hors
 * fenetre. `prouve` est necessaire : la machine refuse une contestation sans
 * paiement attribue (`contestation_sans_paiement`).
 */
async function commandeProuvee() {
  const n = ids.suivant();
  const telVendeuse = ids.tel("67");
  const telAcheteuse = ids.tel("69");

  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse gabarit ${n}`,
      email: ids.email("gabarit"),
      phoneNumber: telVendeuse,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: telVendeuse,
      businessName: `Chez Gabarit ${n}`,
      slug: `gabarit-${n}`,
      city: "Douala",
    },
  });
  const commande = await prisma.order.create({
    data: {
      sellerId: v.id,
      ref: `CT-G${n}`,
      buyerPhone: telAcheteuse,
      payMode: "integral",
      totalXaf: 15000,
      amountPaidXaf: 15000,
      balanceXaf: 0,
      proofState: "prouve",
      /* `jetonBienForme` impose 32 caracteres de l'alphabet URL — un jeton
         plus court rend 404, et le 404 est le MEME que pour un jeton inconnu :
         c'est voulu (un 403 apprendrait qu'un jeton existe), mais ca rend un
         test mal calibre indistinguable d'une route cassee. */
      buyerToken: `t${n}`.padEnd(32, "k").slice(0, 32),
      items: [{ nom: "Robe wax", quantite: 1, prixUnitaireXaf: 15000 }],
      delivery: {
        mode: "livraison",
        city: "Douala",
        quartier: "Bonapriso",
        landmark: "en face du marché",
        phone: telAcheteuse,
      },
      verificationCode: ids.codeVerification(),
      createdAt: new Date(NOW.getTime() - 2 * 3600_000),
      expiresAt: new Date(NOW.getTime() + 46 * 3600_000),
    },
  });
  /* Les deux fils existent, mais ils DATENT : les deux portes sont fermees. */
  await prisma.botConversation.create({
    data: { phone: telVendeuse, etat: { nom: "accueil" }, updatedAt: VIEUX },
  });
  /* Cote acheteuse, `derniereCommandeId` n'est pas decoratif : c'est PAR LUI
     que le notificateur retrouve le fil (`conversationDeLaCommande`). Sans
     lui, `notifierLivree` sort en silence — et un test qui l'oublie mesure
     son propre oubli, pas le produit. */
  await prisma.botConversation.create({
    data: {
      phone: telAcheteuse,
      etat: { nom: "accueil" },
      updatedAt: VIEUX,
      derniereCommandeId: commande.id,
    },
  });
  return { commande, telVendeuse, telAcheteuse, nom: v.businessName };
}

describeDb("les gabarits qui existaient sans jamais partir", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("la remise (#44)", () => {
    it("HORS fenetre : le gabarit approuve part au lieu d'attendre en file", async () => {
      /* ROUGE avant le correctif : sans le cinquieme argument, `notifier()`
         ne voyait aucun sujet et tombait directement dans la file. */
      const f = await commandeProuvee();
      const envoyeur = new EnvoyeurMemoire();
      envoyeur.refuseHorsGabarit = true;

      await notifierLivree({ prisma, envoyeur, maintenant: () => NOW }, f.commande.id);

      expect(nomsGabarits(envoyeur)).toEqual(["catalog_commande_livree_v2"]);
    });

    it("il porte la REFERENCE, et il va a l'ACHETEUSE", async () => {
      const f = await commandeProuvee();
      const envoyeur = new EnvoyeurMemoire();
      envoyeur.refuseHorsGabarit = true;
      await notifierLivree({ prisma, envoyeur, maintenant: () => NOW }, f.commande.id);

      const g = premierGabarit(envoyeur);
      expect(g?.template.components[0]?.parameters[0]?.text).toBe(f.commande.ref);
      expect(g?.to).toBe(f.telAcheteuse.replace("+", ""));
    });
  });

  describe("la contestation (#45)", () => {
    it("HORS fenetre : la vendeuse l'apprend par gabarit, pas a sa prochaine visite", async () => {
      const f = await commandeProuvee();
      const envoyeur = new EnvoyeurMemoire();
      envoyeur.refuseHorsGabarit = true;

      await notifierConteste({ prisma, envoyeur, maintenant: () => NOW }, f.commande.id);

      expect(nomsGabarits(envoyeur)).toEqual(["catalog_paiement_conteste"]);
    });

    it("il va a la VENDEUSE — jamais a l'acheteuse, qui vient de le faire", async () => {
      /* L'erreur naturelle serait de reutiliser `conversationDeLaCommande`,
         qui rend le fil de l'ACHETEUSE : la contestation lui reviendrait en
         echo et la vendeuse ne saurait toujours rien. */
      const f = await commandeProuvee();
      const envoyeur = new EnvoyeurMemoire();
      envoyeur.refuseHorsGabarit = true;
      await notifierConteste({ prisma, envoyeur, maintenant: () => NOW }, f.commande.id);

      const g = premierGabarit(envoyeur);
      expect(g?.to).toBe(f.telVendeuse.replace("+", ""));
      expect(g?.to).not.toBe(f.telAcheteuse.replace("+", ""));
      expect(g?.template.components[0]?.parameters[0]?.text).toBe(f.commande.ref);
    });

    it("DANS la fenetre : un texte libre, et AUCUN bouton", async () => {
      /* Un litige ne se tranche pas d'un tap. Le message ouvre la
         conversation, il ne propose pas de la clore. */
      const f = await commandeProuvee();
      await prisma.botConversation.update({
        where: { phone: f.telVendeuse },
        data: { updatedAt: new Date(NOW.getTime() - 3600_000) },
      });
      const envoyeur = new EnvoyeurMemoire();

      await notifierConteste({ prisma, envoyeur, maintenant: () => NOW }, f.commande.id);

      expect(envoyeur.envoyes).toHaveLength(1);
      expect(envoyeur.envoyes[0]?.type).toBe("text");
      const corps = (envoyeur.envoyes[0] as { text: { body: string } }).text.body;
      expect(corps).toContain(f.commande.ref);
      /* La preuve n'est pas effacee — ADR 0021. Le message ne doit pas
         laisser croire le contraire a la vendeuse. */
      expect(corps).toMatch(/pas effacée/);
    });

    it("depuis le LIEN DE SUIVI web, la vendeuse est prevenue aussi", async () => {
      /* Le second chemin. La route est la VRAIE : n'en brancher qu'un
         laisserait le defaut entier pour l'autre moitie des acheteuses. */
      const f = await commandeProuvee();
      const envoyeur = new EnvoyeurMemoire();
      envoyeur.refuseHorsGabarit = true;

      const app = new Hono().route(
        "/api/suivi",
        suiviRoutes({
          prisma,
          rampe: RAMPE_DEFAUT,
          maintenant: () => NOW,
          apresContestation: (orderId) =>
            notifierConteste({ prisma, envoyeur, maintenant: () => NOW }, orderId),
        }),
      );

      const r = await app.request(`/api/suivi/${f.commande.buyerToken}/contester`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motif: "je n'ai jamais payé" }),
      });

      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ etat: "conteste" });
      expect(nomsGabarits(envoyeur)).toEqual(["catalog_paiement_conteste"]);
    });

    it("un envoi qui echoue ne fait PAS echouer la contestation", async () => {
      /* La contestation est enregistree : c'est ce qui compte pour
         l'acheteuse. Une notification qui rate ne doit pas lui rendre une
         erreur sur un geste qui, lui, a reussi — et la vendeuse la recevra a
         son prochain message. */
      const f = await commandeProuvee();
      const mort = new EnvoyeurMemoire();
      mort.envoyer = async () => {
        throw new Error("envoi bot refuse : HTTP 400, code Meta 131047");
      };

      const app = new Hono().route(
        "/api/suivi",
        suiviRoutes({
          prisma,
          rampe: RAMPE_DEFAUT,
          maintenant: () => NOW,
          apresContestation: (orderId) =>
            notifierConteste({ prisma, envoyeur: mort, maintenant: () => NOW }, orderId),
        }),
      );
      const r = await app.request(`/api/suivi/${f.commande.buyerToken}/contester`, {
        method: "POST",
      });
      expect(r.status).toBe(200);

      const enFile = await prisma.botNotification.count({ where: { phone: f.telVendeuse } });
      expect(enFile).toBe(1);

      /* Elle reecrit : la notification sort de la file, rien n'a ete perdu. */
      const vivant = new EnvoyeurMemoire();
      await livrerNotificationsEnAttente(
        { prisma, envoyeur: vivant, maintenant: () => NOW },
        f.telVendeuse,
      );
      expect(vivant.envoyes).toHaveLength(1);
    });
  });
});
