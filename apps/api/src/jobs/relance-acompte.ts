import { formatXaf } from "@catalog/contracts/money";
import type { PrismaClient } from "@catalog/db";
import { type Job, PgBoss } from "pg-boss";
import { notifier } from "../bot-notifications.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import { texte } from "../domain/bot/messages.ts";
import {
  decisionRelance,
  decisionRelanceReversement,
  RELANCE_APRES_S,
  RELANCE_REVERSEMENT_APRES_S,
} from "../domain/bot/relance.ts";
import { type Langue, TEXTES } from "../domain/bot/textes.ts";

/**
 * La relance d'acompte, portee par pg-boss — ADR 0033.
 *
 * C'est la PREMIERE utilisation reelle de pg-boss, prevu par AGENTS.md depuis
 * le debut (« relances d'expiration de commande, rappels de solde ») et
 * jamais cable jusqu'ici. Le travail tourne DANS le processus de l'API — pas
 * de conteneur a part — et sa file vit dans le schema `pgboss` de la meme
 * base : la sauvegarde du lot 14 l'emporte avec le reste.
 *
 * La DECISION d'envoyer appartient au domaine (`domain/bot/relance.ts`) et se
 * reprend AU MOMENT de l'execution, pas a la planification : entre les deux,
 * l'acheteuse a pu payer, la vendeuse annuler. Le travail recharge la
 * commande et decide sur l'etat REEL.
 */

export const FILE_RELANCE = "bot-relance-acompte";
export const FILE_RELANCE_REVERSEMENT = "bot-relance-reversement";

export interface ChargeRelance {
  commandeId: string;
  /** Le fil WhatsApp de l'ACHETEUSE — la cle de conversation, pas le numero de livraison. */
  phone: string;
  langue: Langue;
}

/** La relance « posez votre reversement » — ADR 0035, T2. */
export interface ChargeRelanceReversement {
  sellerId: string;
  /** Le fil WhatsApp de la VENDEUSE. */
  phone: string;
}

/**
 * Ce dont une relance a besoin — ADR 0060 : la file d'attente et l'envoyeur,
 * pas la connexion pg-boss. Separe de `JobsBotDeps` pour que les deux
 * relances soient appelables — et testables — sans monter une file.
 */
export interface RelanceDeps {
  prisma: PrismaClient;
  envoyeur: EnvoyeurBot;
  /** L'URL de l'espace vendeuse — la relance y pointe. Vide : pas de lien. */
  baseApp?: string;
  maintenant?: () => Date;
}

export interface JobsBotDeps extends RelanceDeps {
  connexion: string;
}

export interface JobsBot {
  planifierRelance: (charge: ChargeRelance) => Promise<void>;
  planifierRelanceReversement: (charge: ChargeRelanceReversement) => Promise<void>;
  arreter: () => Promise<void>;
}

export async function demarrerJobsBot(deps: JobsBotDeps): Promise<JobsBot> {
  const boss = new PgBoss({ connectionString: deps.connexion });
  /* Une panne de la file ne doit jamais faire tomber l'API : la relance est
     un confort, la conversation est le produit. Trace sans contenu. */
  boss.on("error", () => console.warn("jobs bot : erreur pg-boss (details retenus)"));
  await boss.start();
  await boss.createQueue(FILE_RELANCE);
  await boss.createQueue(FILE_RELANCE_REVERSEMENT);

  await boss.work<ChargeRelance>(FILE_RELANCE, async (jobs: Job<ChargeRelance>[]) => {
    for (const job of jobs) {
      await executerRelanceAcompte(deps, job.data);
    }
  });

  await boss.work<ChargeRelanceReversement>(
    FILE_RELANCE_REVERSEMENT,
    async (jobs: Job<ChargeRelanceReversement>[]) => {
      for (const job of jobs) {
        await executerRelanceReversement(deps, job.data);
      }
    },
  );

  return {
    planifierRelance: async (charge) => {
      await boss.sendAfter(FILE_RELANCE, charge, null, RELANCE_APRES_S);
    },
    planifierRelanceReversement: async (charge) => {
      await boss.sendAfter(FILE_RELANCE_REVERSEMENT, charge, null, RELANCE_REVERSEMENT_APRES_S);
    },
    arreter: () => boss.stop(),
  };
}

/**
 * Le travail lui-meme. Il recharge la commande, redecide, et envoie au plus
 * UN message. Une commande disparue vaut silence — pas une levee qui ferait
 * rejouer le travail en boucle.
 */
export async function executerRelanceAcompte(
  deps: RelanceDeps,
  charge: ChargeRelance,
): Promise<void> {
  const commande = await deps.prisma.order.findUnique({
    where: { id: charge.commandeId },
    select: {
      ref: true,
      payMode: true,
      totalXaf: true,
      amountPaidXaf: true,
      cancelledAt: true,
      createdAt: true,
    },
  });
  if (!commande) return;

  const decision = decisionRelance(
    {
      payMode: commande.payMode,
      totalXaf: commande.totalXaf,
      amountPaidXaf: commande.amountPaidXaf,
      annuleeA: commande.cancelledAt,
      creeeA: commande.createdAt,
    },
    deps.maintenant?.() ?? new Date(),
  );
  if (!decision.relancer) return;

  const t = TEXTES[charge.langue] ?? TEXTES.fr;
  /**
   * Par la PORTE — ADR 0060. `notifier` decide de la fenetre, tente le
   * gabarit approuve hors fenetre, et met en attente dans tous les cas
   * d'echec. L'envoi direct d'avant perdait le message des que la fenetre
   * etait fermee — c'est-a-dire precisement quand une relance sert.
   */
  await notifier(
    deps,
    charge.phone,
    t.relanceAcompte(commande.ref, decision.acompteXaf),
    undefined,
    {
      sujet: "acompte_attendu",
      parametres: [commande.ref, formatXaf(decision.acompteXaf)],
      langue: charge.langue === "en" ? "en" : "fr",
    },
  );
}

/**
 * La relance reversement (ADR 0035, T2) : UNE seule, ~20 h apres l'ouverture,
 * re-decidee sur l'etat REEL — un reversement pose entre-temps vaut silence.
 * En francais : le fil vendeuse l'est (ADR 0033).
 */
export async function executerRelanceReversement(
  deps: RelanceDeps,
  charge: ChargeRelanceReversement,
): Promise<void> {
  const seller = await deps.prisma.seller.findUnique({
    where: { id: charge.sellerId },
    /* Le NOM de la boutique : c'est la variable du gabarit, et c'est ce
       qu'une vendeuse reconnait dans une notification (ADR 0060). */
    select: { payoutPhone: true, createdAt: true, businessName: true },
  });
  if (!seller) return;

  const decision = decisionRelanceReversement(
    { reversementPose: seller.payoutPhone !== null, creeeA: seller.createdAt },
    deps.maintenant?.() ?? new Date(),
  );
  if (!decision.relancer) return;

  const lien = deps.baseApp ? `\nVotre espace vendeuse : ${deps.baseApp}/reversement` : "";
  /**
   * Par la PORTE — ADR 0060, et c'est ici que ça comptait le plus.
   *
   * Cette relance part ~20 h apres la CREATION de la boutique, alors que la
   * fenetre compte 24 h depuis le DERNIER MESSAGE de la vendeuse : celle qui
   * s'inscrit puis se tait a deja la porte fermee. Le message qui rapporte le
   * plus etait donc celui qui avait le plus de chances de s'evaporer — et son
   * gabarit, depose et approuve, n'etait jamais appele.
   */
  await notifier(
    deps,
    charge.phone,
    `Votre boutique est prête — il ne lui manque qu'une chose pour être payée d'AVANCE : votre numéro Mobile Money.\nIl a sa propre vérification (c'est le numéro qui reçoit votre argent), et chaque paiement prouvé donnera un reçu vérifiable.${lien}\nSans lui, vos clientes commandent sans acompte.`,
    undefined,
    { sujet: "reversement_absent", parametres: [seller.businessName], langue: "fr" },
  );
}
