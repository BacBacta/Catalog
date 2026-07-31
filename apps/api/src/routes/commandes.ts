import { type OrderStep, orderStepSchema } from "@catalog/contracts";
import type { PrismaClient } from "@catalog/db";
import { Hono } from "hono";
import {
  avancerEtape,
  type CommandePourCycle,
  etapesPour,
  type ModeLivraison,
  peutDeposerAvisVerifie,
  soldeAEncaisser,
} from "../domain/order/cycle.ts";
import { appliquerVersement } from "../domain/order/paiement.ts";
import { appliquerEvenement } from "../domain/proof/machine.ts";
import { mesurerEtatPreuve } from "../observabilite/mesures.ts";
import { type SessionDeps, vendeuseCourante } from "./seller.ts";

/**
 * Le cycle de vie d'une commande, cote vendeuse.
 *
 * Cette route est MINCE : elle valide, delegue au domaine, serialise. Les deux
 * decisions qu'elle prend elle-meme — a qui appartient la commande, et quoi
 * ecrire dans la meme transaction — ne sont pas du metier.
 *
 * **Rien n'est optimiste ici.** L'interface l'est sur l'avancement d'etape, avec
 * retour arriere visible ; le serveur, lui, ne l'est jamais, et surtout pas sur
 * un mouvement d'argent. La declaration de paiement ecrit l'etat d'argent, le
 * journal d'evenements et le journal comptable dans UNE transaction, ou rien.
 */

export interface CommandeDeps {
  prisma: PrismaClient;
  session: SessionDeps;
  /** Injectee pour rester testable : le domaine recoit `now` en parametre. */
  maintenant?: () => Date;
}

const CHAMPS = {
  id: true,
  ref: true,
  buyerName: true,
  buyerPhone: true,
  items: true,
  totalXaf: true,
  amountPaidXaf: true,
  balanceXaf: true,
  payMode: true,
  step: true,
  proofState: true,
  delivery: true,
  verificationCode: true,
  cancelledAt: true,
  createdAt: true,
} as const;

type CommandeLue = {
  id: string;
  ref: string;
  buyerName: string | null;
  buyerPhone: string;
  items: unknown;
  totalXaf: number;
  amountPaidXaf: number;
  balanceXaf: number;
  payMode: string;
  step: OrderStep;
  proofState: CommandePourCycle["etatPreuve"];
  delivery: unknown;
  verificationCode: string;
  cancelledAt: Date | null;
  createdAt: Date;
};

/**
 * Le mode de livraison, lu depuis le JSON `delivery`.
 *
 * Il n'y a pas de champ `address` a lire — il n'en existe pas et il n'en
 * existera pas (ADR 0005). Un `delivery` illisible est traite comme une
 * livraison : c'est le mode qui a le PLUS d'etapes, donc celui qui ne fait
 * sauter aucune verification. Se tromper dans l'autre sens autoriserait une
 * etape qu'on n'a pas voulue.
 */
function modeLivraison(delivery: unknown): ModeLivraison {
  return (delivery as { mode?: string } | null)?.mode === "retrait" ? "retrait" : "livraison";
}

function pourCycle(c: CommandeLue): CommandePourCycle {
  return {
    etape: c.step,
    modeLivraison: modeLivraison(c.delivery),
    totalXaf: c.totalXaf,
    amountPaidXaf: c.amountPaidXaf,
    balanceXaf: c.balanceXaf,
    etatPreuve: c.proofState,
    annuleeA: c.cancelledAt,
  };
}

/**
 * Ce que l'ecran vendeuse recoit pour une commande.
 *
 * `etapesPossibles` et `avisVerifiePossible` sont calcules ICI plutot que
 * devines a l'ecran : deux endroits qui deduisent la meme regle finissent par
 * la deduire differemment. C'est la meme raison qui a fait mettre `actions`
 * dans la reponse du suivi au lot 10.
 */
function vue(c: CommandeLue) {
  const cycle = pourCycle(c);
  const maintenant = etapesPour(cycle.modeLivraison);
  return {
    id: c.id,
    reference: c.ref,
    acheteuse: { nom: c.buyerName, telephone: c.buyerPhone },
    articles: c.items,
    totalXaf: c.totalXaf,
    dejaPayeXaf: c.amountPaidXaf,
    resteXaf: c.balanceXaf,
    modePaiement: c.payMode,
    etape: c.step,
    etatPreuve: c.proofState,
    modeLivraison: cycle.modeLivraison,
    livraison: c.delivery,
    codeVerification: c.verificationCode,
    annuleeA: c.cancelledAt,
    creeA: c.createdAt,
    /** Les etapes que la vendeuse peut viser MAINTENANT, dans l'ordre. */
    etapesPossibles: maintenant.filter(
      (e) => avancerEtape(cycle, e, c.createdAt).ok || e === c.step,
    ),
    soldeAEncaisserXaf: soldeAEncaisser(cycle),
    avisVerifiePossible: peutDeposerAvisVerifie(cycle),
  };
}

export function commandeRoutes(deps: CommandeDeps) {
  const r = new Hono();
  const now = () => deps.maintenant?.() ?? new Date();

  /** Resout la vendeuse ET la propriete de la commande en une fois. */
  async function commandeDeLaVendeuse(
    req: Request,
    id: string,
  ): Promise<{ sellerId: string; commande: CommandeLue } | null> {
    const v = await vendeuseCourante(deps.session, req);
    if (!v?.seller) return null;
    const commande = (await deps.prisma.order.findFirst({
      // La propriete est dans le WHERE, pas dans un `if` apres coup : une
      // commande d'une autre vendeuse n'est jamais chargee, donc jamais fuitee
      // par un message d'erreur.
      where: { id, sellerId: v.seller.id },
      select: CHAMPS,
    })) as CommandeLue | null;
    return commande ? { sellerId: v.seller.id, commande } : null;
  }

  /**
   * `GET /api/commandes` — la liste, et le total des soldes a encaisser.
   *
   * Le total est calcule sur les MEMES commandes que celles renvoyees, par la
   * meme fonction de domaine. Une agregation SQL separee dirait un jour un
   * chiffre que la liste ne montre pas.
   */
  r.get("/", async (c) => {
    const v = await vendeuseCourante(deps.session, c.req.raw);
    if (!v?.seller) return c.json({ erreur: "non_authentifiee" }, 401);

    const commandes = (await deps.prisma.order.findMany({
      where: { sellerId: v.seller.id },
      select: CHAMPS,
      orderBy: { createdAt: "desc" },
    })) as CommandeLue[];

    const vues = commandes.map(vue);
    return c.json({
      commandes: vues,
      soldesAEncaisserXaf: vues.reduce((s, x) => s + x.soldeAEncaisserXaf, 0),
    });
  });

  /**
   * PAS de `GET /:id` ici. `preuveRoutes` est monte sur le meme prefixe et
   * l'occupe deja avec la vue etroite dont l'ecran de collage a besoin. En
   * ajouter une seconde ferait dependre la reponse de l'ordre de montage des
   * routeurs — un couplage invisible, qui casse le jour ou quelqu'un reordonne
   * `server.ts`. La liste porte deja la vue complete de chaque commande.
   */

  /**
   * `POST /api/commandes/:id/etape` — avancer d'une etape.
   *
   * Le domaine decide, la route persiste. Le refus est ecrit au journal lui
   * aussi : c'est le contrat de `avancerEtape`, et un recul ignore sans trace
   * serait une anomalie invisible.
   */
  r.post("/:id/etape", async (c) => {
    const trouve = await commandeDeLaVendeuse(c.req.raw, c.req.param("id"));
    if (!trouve) return c.json({ erreur: "commande_inconnue" }, 404);

    const corps = await c.req.json().catch(() => null);
    const vers = orderStepSchema.safeParse(corps?.vers);
    if (!vers.success) return c.json({ erreur: "etape_invalide" }, 400);

    const { commande, sellerId } = trouve;
    const decision = avancerEtape(pourCycle(commande), vers.data, now());

    await deps.prisma.$transaction(async (tx) => {
      if (decision.ok) {
        await tx.order.update({ where: { id: commande.id }, data: { step: decision.etape } });
      }
      await tx.orderEvent.create({
        data: {
          orderId: commande.id,
          sellerId,
          kind: decision.journal.kind,
          actor: "vendeuse",
          at: decision.journal.at,
          payload: {
            de: decision.journal.de,
            vers: decision.journal.vers,
            ...(decision.ok ? {} : { raison: decision.raison }),
          },
        },
      });
    });

    if (!decision.ok) {
      return c.json(
        { erreur: "etape_refusee", raison: decision.raison, etape: decision.etape },
        409,
      );
    }
    const relu = (await deps.prisma.order.findUnique({
      where: { id: commande.id },
      select: CHAMPS,
    })) as CommandeLue;
    return c.json(vue(relu));
  });

  /**
   * `POST /api/commandes/:id/paiement-declare` — le depot direct NON TRACE.
   *
   * Il existe et il existera toujours : la vendeuse le ferait de toute facon
   * hors du systeme, et on perdrait aussi la donnee. On ne cherche pas a le
   * bloquer, on le DISTINGUE — pas de recu, pas d'avis verifie. L'interface
   * propose « j'ai le SMS » a cote, qui mene au collage.
   *
   * Deux ecritures dans la meme transaction, et c'est le point : l'etat d'argent
   * et le journal comptable ne peuvent pas diverger. Tout ce qui touche a
   * l'argent ecrit en ajout seul (AGENTS.md §6).
   */
  r.post("/:id/paiement-declare", async (c) => {
    const trouve = await commandeDeLaVendeuse(c.req.raw, c.req.param("id"));
    if (!trouve) return c.json({ erreur: "commande_inconnue" }, 404);

    const corps = await c.req.json().catch(() => null);
    const montantXaf = corps?.montantXaf;
    // Entier strict : un montant a virgule n'est pas arrondi en silence, il est
    // refuse. Le franc CFA n'a pas de sous-unite (ADR 0004).
    if (!Number.isInteger(montantXaf) || montantXaf <= 0) {
      return c.json({ erreur: "montant_invalide" }, 400);
    }

    const { commande, sellerId } = trouve;
    if (commande.cancelledAt) return c.json({ erreur: "commande_annulee" }, 409);

    const instant = now();
    const preuve = appliquerEvenement(
      commande.proofState,
      {
        type: "declaration_manuelle",
        par: "vendeuse",
      },
      instant,
    );

    let versement: ReturnType<typeof appliquerVersement>;
    try {
      versement = appliquerVersement(
        {
          totalXaf: commande.totalXaf,
          amountPaidXaf: commande.amountPaidXaf,
          balanceXaf: commande.balanceXaf,
        },
        montantXaf,
      );
    } catch {
      return c.json({ erreur: "montant_invalide" }, 400);
    }

    await deps.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: commande.id },
        data: {
          amountPaidXaf: versement.etat.amountPaidXaf,
          balanceXaf: versement.etat.balanceXaf,
          // L'etat de preuve ne recule jamais : si la commande etait deja
          // `prouve`, une declaration manuelle ne la degrade pas.
          ...(preuve.ok ? { proofState: preuve.etat } : {}),
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: commande.id,
          sellerId,
          kind: "paiement_declare",
          actor: "vendeuse",
          at: instant,
          // Aucun montant dans ce journal : il est lisible par plus de monde
          // que le solde d'une vendeuse. Les montants vont au journal comptable.
          payload: {
            trace: false,
            etatPreuve: preuve.etat,
            ...(preuve.ok ? {} : { refus: preuve.raison }),
          },
        },
      });
      await tx.ledgerEntry.create({
        data: {
          orderId: commande.id,
          direction: "entree",
          amountXaf: montantXaf,
          reason: "depot_direct_non_trace",
          metadata: {
            conformite: versement.conformite.etat,
            ecartXaf: versement.conformite.ecartXaf,
            aRendreXaf: versement.aRendreXaf,
          },
        },
      });
    });

    /**
     * **La mesure du contournement, cote exploitant.**
     *
     * L'ecran statistiques du lot 13 montre cette part a la vendeuse ; ce
     * compteur la montre pour tout le reseau, en fenetre glissante. C'est le
     * meme chiffre vu de deux bouts, et c'est voulu — celui de la vendeuse
     * l'aide a se corriger, celui-ci dit si le PRODUIT tient sa promesse.
     *
     * Il est pose apres la transaction, pas dedans : une metrique qui compte un
     * evenement non commit ment, et elle ment dans le sens rassurant.
     */
    mesurerEtatPreuve(preuve.ok ? preuve.etat : commande.proofState);

    const relu = (await deps.prisma.order.findUnique({
      where: { id: commande.id },
      select: CHAMPS,
    })) as CommandeLue;
    return c.json({
      ...vue(relu),
      conformite: versement.conformite,
      aRendreXaf: versement.aRendreXaf,
      /** Dit a l'ecran quoi montrer : ce paiement n'ouvre pas droit au recu. */
      trace: false,
    });
  });

  return r;
}
