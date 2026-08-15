import { formatXaf } from "@catalog/contracts/money";
import type { PrismaClient } from "@catalog/db";
import { type Job, PgBoss } from "pg-boss";
import { notifier } from "../bot-notifications.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import { invitationReversement } from "../domain/bot/flux.ts";
import { normaliserEtatVendeuse } from "../domain/bot/inscription.ts";
import { texte } from "../domain/bot/messages.ts";
import { decisionRemise } from "../domain/bot/notifications.ts";
import { carteRafale, FENETRE_RAFALE_MS } from "../domain/bot/rafale.ts";
import {
  decisionRelance,
  decisionRelanceReversement,
  RELANCE_APRES_S,
  RELANCE_REVERSEMENT_APRES_S,
} from "../domain/bot/relance.ts";
import { type Langue, normaliserLangue, TEXTES } from "../domain/bot/textes.ts";
import { etatExpiration, FENETRE_EXPIRATION_MS } from "../domain/order/expiration.ts";

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
/** L'expiration d'une commande a acompte impaye — ADR 0090. */
export const FILE_EXPIRATION = "bot-expiration-commande";
/** La carte recapitulative de la rafale, a la fermeture de la fenetre — ADR 0096. */
export const FILE_RAFALE = "bot-rafale-recap";

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
  /**
   * Le formulaire de reversement — ADR 0097. Pose, la relance de ~20 h
   * devient la carte d'invitation quand la fenetre de service est ouverte ;
   * absent, elle garde son texte et son lien vers l'espace, comme avant.
   */
  fluxReversementId?: string;
  maintenant?: () => Date;
}

export interface JobsBotDeps extends RelanceDeps {
  connexion: string;
}

export interface JobsBot {
  planifierRelance: (charge: ChargeRelance) => Promise<void>;
  planifierRelanceReversement: (charge: ChargeRelanceReversement) => Promise<void>;
  planifierExpiration: (charge: ChargeExpiration) => Promise<void>;
  planifierRafale: (charge: ChargeRafale) => Promise<void>;
  arreter: () => Promise<void>;
}

/** L'expiration ne porte que l'identifiant : tout le reste se relit frais. */
export interface ChargeExpiration {
  commandeId: string;
}

/**
 * La rafale — ADR 0096. `phone` est la cle de conversation (normalisee),
 * `vers` l'adresse WhatsApp d'envoi telle que Meta l'a donnee.
 */
export interface ChargeRafale {
  phone: string;
  vers: string;
}

export async function demarrerJobsBot(deps: JobsBotDeps): Promise<JobsBot> {
  const boss = new PgBoss({ connectionString: deps.connexion });
  /* Une panne de la file ne doit jamais faire tomber l'API : la relance est
     un confort, la conversation est le produit. Trace sans contenu. */
  boss.on("error", () => console.warn("jobs bot : erreur pg-boss (details retenus)"));
  await boss.start();
  await boss.createQueue(FILE_RELANCE);
  await boss.createQueue(FILE_RELANCE_REVERSEMENT);
  await boss.createQueue(FILE_EXPIRATION);

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

  await boss.work<ChargeExpiration>(FILE_EXPIRATION, async (jobs: Job<ChargeExpiration>[]) => {
    for (const job of jobs) {
      await executerExpirationCommande(deps, job.data);
    }
  });

  await boss.work<ChargeRafale>(FILE_RAFALE, async (jobs: Job<ChargeRafale>[]) => {
    for (const job of jobs) {
      await executerRecapRafale(deps, job.data);
    }
  });

  return {
    planifierRelance: async (charge) => {
      await boss.sendAfter(FILE_RELANCE, charge, null, RELANCE_APRES_S);
    },
    planifierRelanceReversement: async (charge) => {
      await boss.sendAfter(FILE_RELANCE_REVERSEMENT, charge, null, RELANCE_REVERSEMENT_APRES_S);
    },
    planifierExpiration: async (charge) => {
      /* A l'echeance de la fenetre — la decision sera REPRISE sur l'etat
         reel : un acompte arrive entre-temps vaut silence (ADR 0090). */
      await boss.sendAfter(FILE_EXPIRATION, charge, null, FENETRE_EXPIRATION_MS / 1000);
    },
    planifierRafale: async (charge) => {
      /* Chaque photo REPLANIFIE : le travail qui se reveille trop tot voit
         un etat plus frais que la fenetre et se tait — le suivant parlera. */
      await boss.sendAfter(FILE_RAFALE, charge, null, FENETRE_RAFALE_MS / 1000);
    },
    arreter: () => boss.stop(),
  };
}

/**
 * La carte recapitulative de la rafale — ADR 0096. Le travail est DEBORDE
 * par conception : chaque photo en planifie un, et seul celui qui trouve la
 * fenetre echue ET la carte non envoyee parle. Tout se decide sur l'etat
 * RELU, jamais sur la charge.
 */
export async function executerRecapRafale(deps: RelanceDeps, charge: ChargeRafale): Promise<void> {
  const enregistrement = await deps.prisma.botConversation.findUnique({
    where: { phone: charge.phone },
    select: { etat: true, updatedAt: true },
  });
  if (!enregistrement) return;
  const etat = normaliserEtatVendeuse(enregistrement.etat);
  if (etat?.nom !== "rafale" || etat.annonce) return;
  const maintenant = deps.maintenant?.() ?? new Date();
  /* Une photo plus recente a replanifie : ce reveil-ci est perime. La marge
     de 2 s absorbe la latence de la file, pas plus. */
  if (maintenant.getTime() - enregistrement.updatedAt.getTime() < FENETRE_RAFALE_MS - 2000) {
    return;
  }
  /* `annonce` se pose AVANT l'envoi : deux travaux qui se reveilleraient
     ensemble prefereront une carte perdue a une carte en double — le meme
     compromis que l'ADR 0040. */
  await deps.prisma.botConversation.update({
    where: { phone: charge.phone },
    data: { etat: { ...etat, annonce: true } as unknown as object },
  });
  await deps.envoyeur.envoyer(carteRafale(charge.vers, etat.brouillons));
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
      dueBeforeXaf: true,
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
      /* Le montant FIGE a la creation — ADR 0094 : la relance redit ce que
         la commande a demande, pas ce que la constante vaut aujourd'hui. */
      duAvantXaf: commande.dueBeforeXaf,
    },
    deps.maintenant?.() ?? new Date(),
  );
  if (!decision.relancer) return;

  /* La charge d'un job a pu etre ecrite par une generation precedente, ou dans
     une langue qui n'est plus servie : elle se normalise comme la colonne. */
  const t = TEXTES[normaliserLangue(charge.langue)];
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
      /* Le GABARIT n'existe qu'en francais et en anglais (ADR 0054) : le
         pidgin retombe sur le francais, comme il retombe partout ou une
         traduction n'a pas ete relue (ADR 0034). Le texte riche, lui, part
         bien dans la langue du fil — c'est la fenetre fermee qui contraint,
         pas nous. */
      langue: normaliserLangue(charge.langue) === "en" ? "en" : "fr",
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

  /**
   * Le Flow quand le canal le permet — ADR 0097, decision 5. Un message a
   * formulaire ne peut etre ni un gabarit ni une notification en attente :
   * il n'a de sens que dans la fenetre de service ouverte. Fenetre sure ET
   * formulaire pose : la relance EST la carte d'invitation. Sinon — fenetre
   * incertaine, formulaire absent, envoi refuse — le texte et son lien vers
   * l'espace reprennent, par la porte de l'ADR 0060, comme avant.
   */
  if (deps.fluxReversementId) {
    const conversation = await deps.prisma.botConversation.findUnique({
      where: { phone: charge.phone },
      select: { updatedAt: true },
    });
    const remise = decisionRemise(
      conversation?.updatedAt ?? null,
      deps.maintenant?.() ?? new Date(),
    );
    if (remise === "envoyer") {
      try {
        await deps.envoyeur.envoyer(
          invitationReversement(charge.phone.replace(/^\+/, ""), deps.fluxReversementId),
        );
        return;
      } catch {
        /* L'envoi a echoue : le texte par la porte, rien n'est perdu. */
      }
    }
  }

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

/**
 * L'expiration d'une commande — ADR 0090. Le domaine decide
 * (`etatExpiration`, ecrit et teste au lot 7, jamais branche jusqu'ici) ;
 * l'ecriture est une ANNULATION DATEE avec sa cause au journal, et elle est
 * GARDEE (patron de l'ADR 0089) : un versement arrive pendant que le job
 * court gagne, silencieusement et correctement.
 *
 * Perimetre (ADR 0090, decision 2) : seul l'acompte attendu dont AUCUN franc
 * n'est arrive expire. Une commande sans prepaiement vit impayee jusqu'a la
 * remise ; un franc verse sauve la commande.
 */
export async function executerExpirationCommande(
  deps: RelanceDeps,
  charge: ChargeExpiration,
): Promise<void> {
  const commande = await deps.prisma.order.findUnique({
    where: { id: charge.commandeId },
    select: {
      id: true,
      sellerId: true,
      payMode: true,
      amountPaidXaf: true,
      cancelledAt: true,
      createdAt: true,
    },
  });
  if (!commande) return;
  if (commande.payMode !== "acompte") return;

  const maintenant = deps.maintenant?.() ?? new Date();
  const etat = etatExpiration(
    {
      creeA: commande.createdAt,
      /* Un franc verse sauve la commande — lecture de l'ADR 0090, plus
         genereuse que « total couvert » : le solde se regle a la remise. */
      soldeRegle: commande.amountPaidXaf > 0,
      annuleeA: commande.cancelledAt,
      rappelsEnvoyes: [],
    },
    maintenant,
  );
  if (etat.etat !== "expiree") return;

  await deps.prisma.$transaction(async (tx) => {
    const maj = await tx.order.updateMany({
      where: { id: commande.id, cancelledAt: null, amountPaidXaf: 0 },
      data: { cancelledAt: maintenant },
    });
    /* Un versement ou une annulation est passe entre la lecture et ici :
       rien a faire, et surtout pas de journal d'expiration mensonger. */
    if (maj.count === 0) return;
    await tx.orderEvent.create({
      data: {
        orderId: commande.id,
        sellerId: commande.sellerId,
        kind: "commande_expiree",
        actor: "systeme",
        at: maintenant,
        payload: { echeance: etat.echeance.toISOString() },
      },
    });
  });
}
