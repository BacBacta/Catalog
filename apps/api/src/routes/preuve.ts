import type { PrismaClient } from "@catalog/db";
import { Hono } from "hono";
import type { ChiffreurSms } from "../adapters/sms-chiffre.ts";
import { avecSpan, PARCOURS, poser } from "../observabilite/traces.ts";
import { soumettrePreuve } from "../preuve-service.ts";
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
  /**
   * Appele APRES la transaction quand la preuve fait passer la commande a
   * « prouve » (ADR 0035) — le bot previent l'acheteuse. Optionnel, et toute
   * levee y est avalee : une notification ratee ne defait jamais une preuve.
   */
  apresPreuve?: (orderId: string) => Promise<void>;
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

  /**
   * **Le parcours le plus surveille du produit, et le plus dangereux a tracer.**
   *
   * Le span porte le motif, l'operateur, le verdict et le controle qui a
   * refuse — jamais le texte, jamais un fragment du texte, jamais le montant.
   * Ce qui est mesure ici est ce qui permet de voir venir un CHANGEMENT DE
   * FORMAT chez un operateur : c'est la panne la plus probable de Catalog, et
   * elle est silencieuse — rien ne tombe, les refus montent, et les vendeuses
   * arretent de coller sans prevenir personne.
   */
  r.post("/:orderId/preuve", async (c) =>
    avecSpan(PARCOURS.preuveSoumise, {}, async (span) => {
      const v = await vendeuseCourante(deps.session, c.req.raw);
      if (!v) return c.json({ erreur: "non_authentifiee" }, 401);
      if (!v.seller) return c.json({ erreur: "profil_absent" }, 409);
      /* Capturee HORS de la fermeture de transaction : le retrecissement de
         `v.seller` ne la traverse pas. */
      const vendeuse = v.seller;

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
          amountPaidXaf: true,
          balanceXaf: true,
          payMode: true,
          createdAt: true,
          buyerPhone: true,
          proofState: true,
          dueBeforeXaf: true,
        },
      });
      if (!commande) return c.json({ erreur: "commande_introuvable" }, 404);

      poser(span, { "catalog.commande.id": commande.id, "catalog.vendeuse.id": v.seller.id });

      /**
       * Le COEUR est partage avec le fil WhatsApp (ADR 0083) : sept
       * controles, INSERT qui tranche le n° 5, transition, versement,
       * journal — tout vit dans `soumettrePreuve`. Cette route ne fait plus
       * que l'authentification, la lecture de la commande et la traduction
       * du resultat en HTTP.
       */
      const resultat = await soumettrePreuve(
        {
          prisma: deps.prisma,
          chiffreur: deps.chiffreur,
          ...(deps.maintenant ? { maintenant: deps.maintenant } : {}),
        },
        {
          vendeuse: { id: vendeuse.id, payoutPhone: vendeuse.payoutPhone },
          commande,
          texteSms: texte,
          span,
        },
      );

      switch (resultat.issue) {
        case "non_reconnue":
          /**
           * Controle n° 1 en echec : aucun motif, rien d'autre a controler. On
           * ne renvoie NI le texte NI un fragment — la reponse partirait dans
           * le journal du navigateur.
           */
          return c.json(
            { erreur: resultat.raison, verdict: "refuse", checks: resultat.checks },
            422,
          );
        case "refusee":
          return c.json({ verdict: "refuse", checks: resultat.checks }, 422);
        case "identifiant_rejoue":
          return c.json({ verdict: resultat.verdict, checks: resultat.checks }, 409);
        case "commande_modifiee":
          /* Rien n'est ecrit, l'identifiant reste libre : recoller repart
             d'un etat frais (constat A1 de l'audit 2026-08). */
          return c.json(
            {
              erreur: "commande_modifiee",
              message:
                "La commande a changé pendant la vérification — un autre versement ou une contestation est passé. Recollez le SMS : rien n'a été perdu.",
              checks: resultat.checks,
            },
            409,
          );
        default: {
          /* La notification de l'acheteuse — apres commit, jamais dedans. */
          if (resultat.transitionOk && deps.apresPreuve) {
            await deps.apresPreuve(commande.id).catch(() => {});
          }
          return c.json({
            preuveId: resultat.preuveId,
            verdict: resultat.verdict,
            checks: resultat.checks,
            /** Ce qui est affichable : jamais le texte, jamais le solde. */
            resume: resultat.resume,
            /**
             * La commande a-t-elle AVANCE ? Sans ce champ, l'ecran disait
             * « le reçu peut être émis » sur une commande en litige dont la
             * machine venait de refuser la transition (constat A5).
             */
            transitionOk: resultat.transitionOk,
            ...(resultat.transitionOk ? {} : { blocage: resultat.transitionRaison ?? null }),
          });
        }
      }
    }),
  );

  return r;
}
