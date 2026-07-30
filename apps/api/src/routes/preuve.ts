import type { PrismaClient } from "@catalog/db";
import { Hono } from "hono";
import type { ChiffreurSms } from "../adapters/sms-chiffre.ts";
import {
  appliquerControles,
  type CommandePourControles,
  finaliserAvecUnicite,
} from "../domain/proof/controles.ts";
import { analyserSms } from "../domain/proof/motifs.ts";
import { type SessionDeps, vendeuseCourante } from "./seller.ts";

/**
 * Soumission d'une preuve de paiement.
 *
 * **Le SMS brut ne sort jamais d'ici en clair.** Il est chiffre avant d'entrer en
 * base, il n'est jamais journalise, jamais renvoye dans une reponse, jamais mis
 * dans un message d'erreur. Il porte le SOLDE DU COMPTE de la vendeuse.
 *
 * **Le controle n° 5 est tranche par la BASE, pas par ce fichier.** La sequence,
 * dans cet ordre exact :
 *
 * 1. le domaine applique les six controles purs ; le n° 5 revient `pending` ;
 * 2. si aucun `fail`, on **tente l'INSERT** ;
 * 3. la contrainte `UNIQUE(operator, operator_tx_id)` accepte ou leve `P2002` ;
 * 4. la violation est traduite en echec du controle n° 5.
 *
 * **Jamais un SELECT suivi d'un `if`.** Deux vendeuses qui collent le meme
 * identifiant a la meme seconde passeraient toutes les deux le SELECT : c'est
 * exactement la course que la contrainte existe pour empecher.
 */

export interface PreuveDeps {
  prisma: PrismaClient;
  session: SessionDeps;
  chiffreur: ChiffreurSms;
  maintenant?: () => Date;
}

/** Code d'erreur Prisma pour une violation de contrainte d'unicite. */
const VIOLATION_UNICITE = "P2002";

function estViolationUnicite(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === VIOLATION_UNICITE;
}

export function preuveRoutes(deps: PreuveDeps) {
  const r = new Hono();

  /**
   * Ce que l'ecran de collage a besoin de savoir : le montant attendu et l'etat
   * de la preuve. **Jamais le SMS deja colle** — il est chiffre au repos, et le
   * dechiffrer pour l'afficher ferait sortir le solde de la vendeuse par une
   * reponse HTTP.
   */
  r.get("/:orderId", async (c) => {
    const v = await vendeuseCourante(deps.session, c.req.raw);
    if (!v) return c.json({ erreur: "non_authentifiee" }, 401);
    if (!v.seller) return c.json({ erreur: "profil_absent" }, 409);

    const commande = await deps.prisma.order.findFirst({
      where: { id: c.req.param("orderId"), sellerId: v.seller.id },
      select: {
        id: true,
        ref: true,
        totalXaf: true,
        balanceXaf: true,
        amountPaidXaf: true,
        proofState: true,
        createdAt: true,
        buyerPhone: true,
      },
    });
    if (!commande) return c.json({ erreur: "commande_introuvable" }, 404);
    return c.json(commande);
  });

  r.post("/:orderId/preuve", async (c) => {
    const v = await vendeuseCourante(deps.session, c.req.raw);
    if (!v) return c.json({ erreur: "non_authentifiee" }, 401);
    if (!v.seller) return c.json({ erreur: "profil_absent" }, 409);

    const corps = await c.req.json().catch(() => null);
    const texte = typeof corps?.sms === "string" ? corps.sms : "";
    if (!texte.trim()) {
      return c.json(
        {
          erreur: "sms_absent",
          message: "Collez le SMS que votre opérateur vous a envoyé.",
        },
        422,
      );
    }

    /* La commande doit etre a CETTE vendeuse. 404 et non 403 : un 403
       apprendrait qu'un identifiant est valide. */
    const commande = await deps.prisma.order.findFirst({
      where: { id: c.req.param("orderId"), sellerId: v.seller.id },
      select: {
        id: true,
        totalXaf: true,
        balanceXaf: true,
        createdAt: true,
        buyerPhone: true,
        proofState: true,
      },
    });
    if (!commande) return c.json({ erreur: "commande_introuvable" }, 404);

    const analyse = analyserSms(texte);
    if (!analyse.reconnu) {
      /**
       * Controle n° 1 en echec : aucun motif, rien d'autre a controler. On ne
       * renvoie NI le texte NI un fragment — la reponse partirait dans le journal
       * du navigateur.
       */
      return c.json(
        {
          erreur: analyse.raison,
          verdict: "refuse",
          checks: [
            {
              n: 1,
              id: "format",
              state: "fail",
              explanation:
                analyse.raison === "montant_illisible"
                  ? "Le montant de ce message n'est pas lisible. Vérifiez que vous avez collé le message entier."
                  : "Ce message ne ressemble à aucun SMS d'opérateur connu. Collez le message entier, tel qu'il est arrivé — sans rien enlever.",
            },
          ],
        },
        422,
      );
    }

    const { pattern, sms } = analyse;
    const now = deps.maintenant?.() ?? new Date();

    const pourControles: CommandePourControles = {
      totalXaf: commande.totalXaf,
      /** Ce qui est attendu MAINTENANT : le solde restant, pas le total. */
      attenduXaf: commande.balanceXaf,
      creeA: commande.createdAt,
      reversementVendeuse: v.seller.payoutPhone,
      telephoneAcheteuse: commande.buyerPhone,
      contresigneeParAcheteuse: commande.proofState === "contresigne",
    };

    const brut = appliquerControles({ pattern, sms, commande: pourControles, now });

    // Un `fail` parmi les six controles purs : on n'ecrit rien. Reserver
    // l'identifiant pour une preuve refusee empecherait la vraie preuve de
    // passer plus tard.
    if (brut.checks.some((x) => x.state === "fail")) {
      return c.json({ verdict: "refuse", checks: brut.checks }, 422);
    }

    /* ────── l'INSERT tranche le controle n° 5 ────── */
    try {
      const finalise = finaliserAvecUnicite(brut, true);
      const preuve = await deps.prisma.paymentProof.create({
        data: {
          orderId: commande.id,
          operator: pattern.operatorKey,
          operatorTxId: sms.txId,
          amountXaf: sms.amountXaf,
          counterpartyPhone: sms.counterparty,
          counterpartyName: sms.counterpartyName ?? null,
          occurredAt: sms.at,
          patternId: pattern.id,
          /** MEME NOM, MEME POLARITE que le drapeau du motif. Jamais inverse. */
          patternAConfirmer: pattern.aConfirmer === true,
          /** Chiffre AVANT d'entrer en base. */
          rawSms: deps.chiffreur.chiffrer(texte),
          checks: finalise.checks,
          verdict: finalise.verdict,
        },
        select: { id: true, verdict: true },
      });

      return c.json({
        preuveId: preuve.id,
        verdict: finalise.verdict,
        checks: finalise.checks,
        /** Ce qui est affichable : jamais le texte, jamais le solde. */
        resume: {
          operateur: pattern.operateur,
          operatorTxId: sms.txId,
          montantXaf: sms.amountXaf,
          aConfirmer: pattern.aConfirmer === true,
        },
      });
    } catch (e) {
      if (!estViolationUnicite(e)) throw e;
      /**
       * L'identifiant est deja reclame — chez cette vendeuse ou chez une autre.
       * C'est le controle n° 5 en echec, et c'est la BASE qui l'a dit.
       */
      const refuse = finaliserAvecUnicite(brut, false);
      return c.json({ verdict: refuse.verdict, checks: refuse.checks }, 409);
    }
  });

  return r;
}
