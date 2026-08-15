import type { CheckResult, PayMode } from "@catalog/contracts";
import type { PrismaClient } from "@catalog/db";
import type { Span } from "@opentelemetry/api";
import type { ChiffreurSms } from "./adapters/sms-chiffre.ts";
import { appliquerVersement, planDePaiement } from "./domain/order/paiement.ts";
import {
  appliquerControles,
  type CommandePourControles,
  finaliserAvecUnicite,
} from "./domain/proof/controles.ts";
import { appliquerEvenement } from "./domain/proof/machine.ts";
import { analyserSms } from "./domain/proof/motifs.ts";
import {
  mesurerControles,
  mesurerDelaiPreuve,
  mesurerFormatNonReconnu,
  mesurerIdentifiantRejoue,
} from "./observabilite/mesures.ts";
import { poser, poserIssue } from "./observabilite/traces.ts";

/**
 * Soumission d'une preuve — LE service, partage entre les deux surfaces.
 *
 * Il vivait dans la route (`routes/preuve.ts`) ; l'ADR 0083 le sort de la,
 * parce que le fil WhatsApp rend desormais le meme verdict que l'ecran de
 * collage. Deux implementations du parcours le plus surveille du produit
 * seraient pires qu'aucune : MEMES sept controles, MEME transaction, MEME
 * traduction de la contrainte d'unicite, MEME journal — quelle que soit la
 * porte par laquelle le SMS entre.
 *
 * Les invariants de la route restent les invariants d'ici :
 *
 * - **le SMS brut ne sort jamais en clair** : chiffre avant la base, jamais
 *   journalise, jamais dans un resultat ;
 * - **le controle n° 5 est tranche par la BASE** : on tente l'INSERT, la
 *   contrainte `UNIQUE(operator, operator_tx_id)` accepte ou leve, jamais un
 *   SELECT suivi d'un `if` ;
 * - **seul un SMS entrant accepte fait avancer la commande** ; « accepte
 *   sous reserve » ecrit la preuve sans toucher ni l'etat ni l'argent ;
 * - l'argent ne s'applique QUE depuis « attendu » : un paiement deja declare
 *   a la main est le MEME argent, le SMS eleve la preuve sans compter deux
 *   fois.
 */

export interface PreuveServiceDeps {
  prisma: PrismaClient;
  chiffreur: ChiffreurSms;
  maintenant?: () => Date;
}

/** Ce que la soumission doit savoir de la commande — champs de la route. */
export interface CommandePourPreuve {
  id: string;
  totalXaf: number;
  amountPaidXaf: number;
  balanceXaf: number;
  payMode: string;
  createdAt: Date;
  buyerPhone: string | null;
  proofState: string;
}

export type ResultatPreuve =
  | { issue: "non_reconnue"; raison: string; checks: CheckResult[] }
  | { issue: "refusee"; checks: CheckResult[] }
  | { issue: "identifiant_rejoue"; verdict: string; checks: CheckResult[] }
  /**
   * La commande a change ENTRE la lecture et l'ecriture — un autre versement,
   * une contestation, une autre surface. Rien n'est ecrit (la transaction est
   * defaite, l'identifiant reste libre) : recoller le meme SMS repart d'un
   * etat frais. C'est le correctif du constat A1 de l'audit 2026-08 : avant,
   * l'ecriture etait un dernier-ecrit-gagne silencieux — le CHECK comptable
   * restait satisfait, mais un versement pouvait en ecraser un autre.
   */
  | { issue: "commande_modifiee"; checks: CheckResult[] }
  | {
      issue: "acceptee" | "acceptee_sous_reserve";
      preuveId: string;
      verdict: string;
      checks: CheckResult[];
      /** Ce qui est affichable : jamais le texte, jamais le solde. */
      resume: {
        operateur: string;
        operatorTxId: string;
        montantXaf: number;
        aConfirmer: boolean;
      };
      /** La commande a-t-elle AVANCE ? (faux pour « sous reserve ».) */
      transitionOk: boolean;
      /**
       * Pourquoi elle n'a PAS avance, quand `transitionOk` est faux avec un
       * verdict « accepte » — `litige_ouvert` sur une commande contestee,
       * notamment. Sans ce champ, les deux surfaces disaient « le reçu est
       * émis » alors que la machine venait de refuser (constat A5).
       */
      transitionRaison?: string;
    };

/** Levee DANS la transaction quand l'etat lu ne correspond plus — tout est defait. */
class CommandeModifieeEnCours extends Error {
  constructor() {
    super("commande modifiee pendant la verification");
  }
}

export async function soumettrePreuve(
  deps: PreuveServiceDeps,
  args: {
    vendeuse: { id: string; payoutPhone: string | null };
    commande: CommandePourPreuve;
    texteSms: string;
    /** Le span du parcours, si la surface en a ouvert un. */
    span?: Span | undefined;
  },
): Promise<ResultatPreuve> {
  const { commande, vendeuse, texteSms, span } = args;

  /**
   * Ce que l'acheteuse devait payer MAINTENANT (ADR 0035) : tant que rien
   * n'est arrive, c'est ce que le produit lui a demande — l'ACOMPTE en mode
   * acompte, pas le total. Des qu'un versement est passe, l'attendu redevient
   * le solde.
   */
  const plan = planDePaiement(commande.totalXaf, commande.payMode as PayMode);
  const attenduXaf =
    commande.amountPaidXaf === 0 && plan.duAvantXaf > 0 ? plan.duAvantXaf : commande.balanceXaf;

  const analyse = analyserSms(texteSms);
  if (!analyse.reconnu) {
    /**
     * **C'est CE compteur qu'on regarde en premier le jour d'une panne.**
     * Une bascule soudaine ici ne dit pas « les vendeuses collent mal », elle
     * dit « un operateur a change son format ». `analyse.raison` est une
     * valeur d'un ensemble ferme, jamais le texte recu.
     */
    mesurerFormatNonReconnu(analyse.raison);
    if (span) poserIssue(span, "non_reconnue");
    return {
      issue: "non_reconnue",
      raison: analyse.raison,
      checks: [
        {
          n: 1,
          id: "format",
          state: "fail",
          explanation:
            analyse.raison === "montant_illisible"
              ? "Le montant de ce message n'est pas lisible. Vérifiez que vous avez collé le message entier."
              : "Ce message ne ressemble à aucun SMS d'opérateur connu. Collez le message entier, tel qu'il est arrivé — sans rien enlever.",
        } as CheckResult,
      ],
    };
  }

  const { pattern, sms } = analyse;
  const now = deps.maintenant?.() ?? new Date();

  const pourControles: CommandePourControles = {
    totalXaf: commande.totalXaf,
    attenduXaf,
    creeA: commande.createdAt,
    reversementVendeuse: vendeuse.payoutPhone,
    telephoneAcheteuse: commande.buyerPhone,
    contresigneeParAcheteuse: commande.proofState === "contresigne",
  };

  const brut = appliquerControles({ pattern, sms, commande: pourControles, now });
  if (span) {
    poser(span, {
      "catalog.preuve.operateur": pattern.operatorKey,
      "catalog.preuve.motif": pattern.id,
      "catalog.preuve.a_confirmer": pattern.aConfirmer === true,
    });
  }
  mesurerControles(brut.checks, pattern.operatorKey);

  // Un `fail` parmi les six controles purs : on n'ecrit rien. Reserver
  // l'identifiant pour une preuve refusee empecherait la vraie preuve de
  // passer plus tard.
  const echoue = brut.checks.find((x) => x.state === "fail");
  if (echoue) {
    // Le NUMERO du controle, pas son explication : l'explication est redigee
    // pour la vendeuse et changera de formulation ; le numero est canonique.
    if (span) {
      poser(span, { "catalog.preuve.controle_echoue": echoue.n });
      poserIssue(span, "refusee");
    }
    return { issue: "refusee", checks: brut.checks };
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
      /**
       * L'etat est RELU dans la transaction — constat A1 de l'audit 2026-08.
       *
       * La commande passee en argument a ete lue HORS transaction : entre
       * cette lecture et ici, un autre versement (l'autre surface, une
       * declaration manuelle) ou une contestation a pu passer. Les controles
       * et la transition ci-dessus ont ete calcules sur cet instantane : s'il
       * est perime, on ne « corrige » pas en silence — on defait tout et on
       * le DIT. L'identifiant reste libre, recoller le SMS repart d'un etat
       * frais. Meme philosophie que l'ADR 0040 : plutot perdre une soumission
       * que d'ecraser un versement.
       */
      const fraiche = await tx.order.findUniqueOrThrow({
        where: { id: commande.id },
        select: { amountPaidXaf: true, proofState: true },
      });
      if (
        fraiche.amountPaidXaf !== commande.amountPaidXaf ||
        fraiche.proofState !== commande.proofState
      ) {
        throw new CommandeModifieeEnCours();
      }
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
          rawSms: deps.chiffreur.chiffrer(texteSms),
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
          /* Ceinture sur la relecture : l'ecriture est GARDEE par la valeur
             lue. Sous concurrence, la seconde transaction attend le verrou de
             ligne, revoit la valeur commise, ne correspond plus → count 0. */
          const maj = await tx.order.updateMany({
            where: {
              id: commande.id,
              amountPaidXaf: fraiche.amountPaidXaf,
              proofState: "attendu",
            },
            data: {
              proofState: transition.etat as never,
              amountPaidXaf: versement.etat.amountPaidXaf,
              balanceXaf: versement.etat.balanceXaf,
            },
          });
          if (maj.count === 0) throw new CommandeModifieeEnCours();
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

    if (span) {
      poser(span, { "catalog.preuve.verdict": finalise.verdict });
      poserIssue(span, finalise.verdict === "accepte" ? "acceptee" : "acceptee_sous_reserve");
    }
    mesurerDelaiPreuve(commande.createdAt, now, finalise.verdict);

    return {
      issue: finalise.verdict === "accepte" ? "acceptee" : "acceptee_sous_reserve",
      preuveId: preuve.id,
      verdict: finalise.verdict,
      checks: finalise.checks,
      resume: {
        operateur: pattern.operateur,
        operatorTxId: sms.txId,
        montantXaf: sms.amountXaf,
        aConfirmer: pattern.aConfirmer === true,
      },
      transitionOk: transition.ok,
      ...(transition.ok ? {} : { transitionRaison: transition.raison }),
    };
  } catch (e) {
    if (e instanceof CommandeModifieeEnCours) {
      if (span) poserIssue(span, "refus_transition");
      return { issue: "commande_modifiee", checks: brut.checks };
    }
    if (!estViolationUnicite(e)) throw e;
    /**
     * L'identifiant est deja reclame — chez cette vendeuse ou chez une autre.
     * C'est le controle n° 5 en echec, et c'est la BASE qui l'a dit.
     */
    const refuse = finaliserAvecUnicite(brut, false);
    mesurerIdentifiantRejoue(pattern.operatorKey);
    if (span) {
      poser(span, { "catalog.preuve.identifiant_rejoue": true });
      poserIssue(span, "identifiant_rejoue");
    }
    return { issue: "identifiant_rejoue", verdict: refuse.verdict, checks: refuse.checks };
  }
}

/** Code d'erreur Prisma pour une violation de contrainte d'unicite. */
const VIOLATION_UNICITE = "P2002";

function estViolationUnicite(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === VIOLATION_UNICITE;
}
