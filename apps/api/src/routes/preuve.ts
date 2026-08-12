import type { PayMode } from "@catalog/contracts";
import type { PrismaClient } from "@catalog/db";
import { Hono } from "hono";
import type { ChiffreurSms } from "../adapters/sms-chiffre.ts";
import { appliquerVersement, planDePaiement } from "../domain/order/paiement.ts";
import {
  appliquerControles,
  type CommandePourControles,
  finaliserAvecUnicite,
} from "../domain/proof/controles.ts";
import { appliquerEvenement } from "../domain/proof/machine.ts";
import { analyserSms } from "../domain/proof/motifs.ts";
import {
  mesurerControles,
  mesurerDelaiPreuve,
  mesurerFormatNonReconnu,
  mesurerIdentifiantRejoue,
} from "../observabilite/mesures.ts";
import { avecSpan, PARCOURS, poser, poserIssue } from "../observabilite/traces.ts";
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
        },
      });
      if (!commande) return c.json({ erreur: "commande_introuvable" }, 404);

      poser(span, { "catalog.commande.id": commande.id, "catalog.vendeuse.id": v.seller.id });

      /**
       * Ce que l'acheteuse devait payer MAINTENANT (ADR 0035) : tant que rien
       * n'est arrive, c'est ce que le produit lui a demande — l'ACOMPTE en
       * mode acompte, pas le total. Comparer l'acompte au solde entier
       * refuserait le paiement que Catalog lui-meme a sollicite. Des qu'un
       * versement est passe, l'attendu redevient le solde.
       */
      const plan = planDePaiement(commande.totalXaf, commande.payMode as PayMode);
      const attenduXaf =
        commande.amountPaidXaf === 0 && plan.duAvantXaf > 0 ? plan.duAvantXaf : commande.balanceXaf;

      const analyse = analyserSms(texte);
      if (!analyse.reconnu) {
        /**
         * **C'est CE compteur qu'on regarde en premier le jour d'une panne.**
         * Une bascule soudaine ici ne dit pas « les vendeuses collent mal », elle
         * dit « un operateur a change son format ». `analyse.raison` est une
         * valeur d'un ensemble ferme, jamais le texte recu.
         */
        mesurerFormatNonReconnu(analyse.raison);
        poserIssue(span, "non_reconnue");
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
        attenduXaf,
        creeA: commande.createdAt,
        reversementVendeuse: v.seller.payoutPhone,
        telephoneAcheteuse: commande.buyerPhone,
        contresigneeParAcheteuse: commande.proofState === "contresigne",
      };

      const brut = appliquerControles({ pattern, sms, commande: pourControles, now });
      poser(span, {
        "catalog.preuve.operateur": pattern.operatorKey,
        "catalog.preuve.motif": pattern.id,
        "catalog.preuve.a_confirmer": pattern.aConfirmer === true,
      });
      mesurerControles(brut.checks, pattern.operatorKey);

      // Un `fail` parmi les six controles purs : on n'ecrit rien. Reserver
      // l'identifiant pour une preuve refusee empecherait la vraie preuve de
      // passer plus tard.
      const echoue = brut.checks.find((x) => x.state === "fail");
      if (echoue) {
        // Le NUMERO du controle, pas son explication : l'explication est redigee
        // pour la vendeuse et changera de formulation ; le numero est canonique.
        poser(span, { "catalog.preuve.controle_echoue": echoue.n });
        poserIssue(span, "refusee");
        return c.json({ verdict: "refuse", checks: brut.checks }, 422);
      }

      /* ────── l'INSERT tranche le controle n° 5 ────── */
      try {
        const finalise = finaliserAvecUnicite(brut, true);
        /**
         * La transition de la COMMANDE — le maillon qui manquait (ADR 0035) :
         * la machine du lot 7 decide (`sms_analyse`), et seul un SMS ENTRANT
         * accepte fait avancer. « Accepte sous reserve » et le message sortant
         * ecrivent la preuve sans toucher ni l'etat ni l'argent — AGENTS.md.
         */
        const transition = appliquerEvenement(
          commande.proofState as never,
          {
            type: "sms_analyse",
            verdict: finalise.verdict,
            operator: pattern.operatorKey,
            operatorTxId: sms.txId,
            sens: pattern.sens === "entrant" ? "entrant" : "sortant",
          },
          now,
        );

        const preuve = await deps.prisma.$transaction(async (tx) => {
          const creee = await tx.paymentProof.create({
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

          /* Le journal — acceptee COMME refusee : une transition arriere est
             journalisee puis ignoree, jamais muette. Aucun texte de SMS. */
          await tx.orderEvent.create({
            data: {
              orderId: commande.id,
              sellerId: vendeuse.id,
              kind: transition.journal.kind,
              actor: transition.journal.par,
              at: transition.journal.at,
              payload: {
                de: transition.journal.de,
                vers: transition.journal.vers,
                evenement: transition.journal.evenement,
                ...(transition.ok ? {} : { raison: transition.raison }),
              },
            },
          });

          if (transition.ok) {
            /**
             * L'argent ne s'applique QUE depuis « attendu » : un paiement deja
             * declare a la main est le MEME argent — le SMS eleve la preuve,
             * il ne compte pas deux fois (ADR 0035). Montants au journal
             * comptable seulement, jamais dans `order_event`.
             */
            if (commande.proofState === "attendu") {
              const versement = appliquerVersement(
                {
                  totalXaf: commande.totalXaf,
                  amountPaidXaf: commande.amountPaidXaf,
                  balanceXaf: commande.balanceXaf,
                },
                sms.amountXaf,
                attenduXaf,
              );
              await tx.order.update({
                where: { id: commande.id },
                data: {
                  proofState: transition.etat as never,
                  amountPaidXaf: versement.etat.amountPaidXaf,
                  balanceXaf: versement.etat.balanceXaf,
                },
              });
              await tx.ledgerEntry.create({
                data: {
                  orderId: commande.id,
                  direction: "entree",
                  amountXaf: sms.amountXaf,
                  reason: "paiement_prouve",
                  metadata: {
                    conformite: versement.conformite.etat,
                    ecartXaf: versement.conformite.ecartXaf,
                    aRendreXaf: versement.aRendreXaf,
                  },
                },
              });
            } else {
              await tx.order.update({
                where: { id: commande.id },
                data: { proofState: transition.etat as never },
              });
            }
          }
          return creee;
        });

        poser(span, { "catalog.preuve.verdict": finalise.verdict });
        poserIssue(span, finalise.verdict === "accepte" ? "acceptee" : "acceptee_sous_reserve");
        mesurerDelaiPreuve(commande.createdAt, now, finalise.verdict);

        /* La notification de l'acheteuse — apres commit, jamais dedans. */
        if (transition.ok && deps.apresPreuve) {
          await deps.apresPreuve(commande.id).catch(() => {});
        }

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
        mesurerIdentifiantRejoue(pattern.operatorKey);
        poser(span, { "catalog.preuve.identifiant_rejoue": true });
        poserIssue(span, "identifiant_rejoue");
        return c.json({ verdict: refuse.verdict, checks: refuse.checks }, 409);
      }
    }),
  );

  return r;
}
