import {
  CODE_ALPHABET,
  formatVerificationCode,
  type OrderStep,
  type ProofState,
} from "@catalog/contracts";
import type { RampeConfig } from "@catalog/contracts/ussd";
import { operateurParId } from "@catalog/contracts/ussd";
import type { PrismaClient } from "@catalog/db";
import { type Context, Hono } from "hono";
import { etapesDuSuivi } from "../domain/order/cycle.ts";
import { appliquerEvenement, type EvenementPreuve } from "../domain/proof/machine.ts";
import { jetonBienForme } from "../domain/receipt/jeton.ts";
import { emettreRecu, porteeDuRecu } from "../domain/receipt/recu.ts";
import { type SessionDeps, vendeuseCourante } from "./seller.ts";

/**
 * Le recu verifiable, et la contre-signature.
 *
 * ── Deux cles, deux pouvoirs ──────────────────────────────────────────────
 *
 * `verificationCode` **identifie** : il est public par construction — le montrer
 * est tout l'interet du recu. `buyerToken` **autorise** : il ouvre la
 * contre-signature, et lui seul. Les melanger ferait de quiconque a vu un recu
 * un contre-signataire, et la contre-signature perdrait ce qui fait sa valeur :
 * etre la voix de l'AUTRE partie.
 *
 * C'est pour la meme raison que la recherche par identifiant d'operateur est
 * reservee a une vendeuse authentifiee, alors que la recherche par code est
 * publique : un identifiant MTN est un nombre a onze chiffres, donc enumerable ;
 * un code de verification tire huit caracteres d'un alphabet de vingt-cinq.
 */

export interface RecuDeps {
  prisma: PrismaClient;
  rampe: RampeConfig;
  session?: SessionDeps;
  maintenant?: () => Date;
}

/** Les colonnes qu'un recu demande. Le SMS brut n'en fait PAS partie. */
const VERDICTS_RECEVABLES: ("accepte" | "accepte_sous_reserve")[] = [
  "accepte",
  "accepte_sous_reserve",
];

const CHAMPS_COMMANDE = {
  id: true,
  ref: true,
  verificationCode: true,
  totalXaf: true,
  amountPaidXaf: true,
  proofState: true,
  balanceXaf: true,
  /** Lot 11 : l'etape et le mode de livraison alimentent le suivi. */
  step: true,
  delivery: true,
  seller: { select: { id: true, businessName: true, payoutPhone: true } },
  proofs: {
    where: { verdict: { in: VERDICTS_RECEVABLES } },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      operator: true,
      operatorTxId: true,
      amountXaf: true,
      occurredAt: true,
      patternAConfirmer: true,
      createdAt: true,
    },
  },
} as const;

type CommandeLue = {
  step: OrderStep;
  delivery: unknown;
  /** Typee au lieu de `string` : `etapesDuSuivi` attend le vocabulaire ferme. */
  id: string;
  ref: string;
  verificationCode: string;
  totalXaf: number;
  amountPaidXaf: number;
  balanceXaf: number;
  proofState: ProofState;
  seller: { id: string; businessName: string; payoutPhone: string | null };
  proofs: Array<{
    operator: string;
    operatorTxId: string;
    amountXaf: number;
    occurredAt: Date | null;
    patternAConfirmer: boolean;
    createdAt: Date;
  }>;
};

/**
 * Normalise un code saisi a la main.
 *
 * Une acheteuse le recopie depuis un ecran ou le dicte au telephone : minuscules,
 * espaces et tirets manquants sont la norme, pas l'exception. Refuser sur la
 * forme serait refuser des gens qui ont le bon code.
 */
export function normaliserCode(brut: string): string | null {
  const net = String(brut ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (net.length !== 8) return null;
  if (![...net].every((c) => CODE_ALPHABET.includes(c))) return null;
  return formatVerificationCode(net);
}

/**
 * Quand l'acheteuse a-t-elle contresigne ?
 *
 * **La date vient du JOURNAL, pas de la preuve.** `payment_proof` est en ajout
 * seul — un declencheur de base refuse tout `UPDATE`, et c'est une garantie
 * qu'on ne va pas desserrer pour une date. La colonne `countersigned_at` heritee
 * du lot 3 est donc inatteignable par construction : elle reste vide, et c'est
 * `order_event` qui fait foi. Voir l'ADR 0021.
 */
async function dateDeContresignature(prisma: PrismaClient, orderId: string): Promise<Date | null> {
  const e = await prisma.orderEvent.findFirst({
    where: { orderId, kind: "preuve_avancee", payload: { path: ["vers"], equals: "contresigne" } },
    orderBy: { at: "asc" },
    select: { at: true },
  });
  return e?.at ?? null;
}

/** Ce qui part sur le reseau. Ni SMS, ni solde de vendeuse, ni jeton. */
function corpsRecu(commande: CommandeLue, rampe: RampeConfig, contresigneA: Date | null) {
  const preuve = commande.proofs[0] ?? null;
  const resultat = emettreRecu(
    {
      ref: commande.ref,
      verificationCode: commande.verificationCode,
      boutique: commande.seller.businessName,
      totalXaf: commande.totalXaf,
      amountPaidXaf: commande.amountPaidXaf,
      proofState: commande.proofState as never,
    },
    preuve
      ? {
          operator: preuve.operator as never,
          operatorTxId: preuve.operatorTxId,
          amountXaf: preuve.amountXaf,
          occurredAt: preuve.occurredAt,
          patternAConfirmer: preuve.patternAConfirmer,
          countersignedAt: contresigneA,
          createdAt: preuve.createdAt,
        }
      : null,
    preuve ? operateurParId(rampe, preuve.operator) : null,
  );

  if ("refus" in resultat) return { refus: resultat.refus, etat: commande.proofState };
  return { recu: resultat.recu, portee: porteeDuRecu(resultat.recu) };
}

/** Le recu change quand l'acheteuse contresigne : il ne se met pas en cache. */
function sansCache(c: { header: (k: string, v: string) => void }) {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Cache-Control", "no-store");
}

/* ─────────────────────────── /api/recu ─────────────────────────── */

export function recuRoutes(deps: RecuDeps) {
  const r = new Hono();
  const contresigneeA = (commande: CommandeLue) =>
    commande.proofState === "contresigne"
      ? dateDeContresignature(deps.prisma, commande.id)
      : Promise.resolve(null);

  /**
   * `GET /api/recu/:code` — la page publique de verification.
   *
   * Sans compte, sans session. Un code inconnu produit un **refus explicite** et
   * jamais une page vide : quelqu'un qui verifie un paiement doit savoir si le
   * code est faux ou si le recu n'existe pas encore.
   */
  r.get("/:code", async (c) => {
    sansCache(c);
    const code = normaliserCode(c.req.param("code"));
    if (!code) return c.json({ refus: "code_inconnu" }, 404);

    const commande = (await deps.prisma.order.findFirst({
      where: { verificationCode: code },
      select: CHAMPS_COMMANDE,
    })) as CommandeLue | null;

    if (!commande) return c.json({ refus: "code_inconnu" }, 404);
    const corps = corpsRecu(commande, deps.rampe, await contresigneeA(commande));
    return c.json(corps, "refus" in corps ? 404 : 200);
  });

  /**
   * `GET /api/recu/identifiant/:txId` — la recherche de la vendeuse.
   *
   * **Authentifiee, et c'est deliberé.** Un identifiant MTN est un nombre a onze
   * chiffres : ouvert a tous, ce point d'entree se parcourrait en boucle.
   */
  r.get("/identifiant/:txId", async (c) => {
    sansCache(c);
    if (!deps.session) return c.json({ erreur: "indisponible" }, 404);
    const v = await vendeuseCourante(deps.session, c.req.raw);
    if (!v) return c.json({ erreur: "non_authentifiee" }, 401);

    const txId = String(c.req.param("txId") ?? "")
      .trim()
      .toUpperCase();
    if (!txId || txId.length > 64) return c.json({ refus: "code_inconnu" }, 404);

    const preuve = await deps.prisma.paymentProof.findFirst({
      where: { operatorTxId: txId },
      orderBy: { createdAt: "desc" },
      select: { orderId: true },
    });
    if (!preuve) return c.json({ refus: "code_inconnu" }, 404);

    const commande = (await deps.prisma.order.findFirst({
      where: { id: preuve.orderId },
      select: CHAMPS_COMMANDE,
    })) as CommandeLue | null;
    if (!commande) return c.json({ refus: "code_inconnu" }, 404);

    const corps = corpsRecu(commande, deps.rampe, await contresigneeA(commande));
    return c.json(corps, "refus" in corps ? 404 : 200);
  });

  return r;
}

/* ─────────────────────────── /api/suivi ─────────────────────────── */

export function suiviRoutes(deps: RecuDeps) {
  const r = new Hono();
  const contresigneeA = (commande: CommandeLue) =>
    commande.proofState === "contresigne"
      ? dateDeContresignature(deps.prisma, commande.id)
      : Promise.resolve(null);

  async function parJeton(jeton: string): Promise<CommandeLue | null> {
    if (!jetonBienForme(jeton)) return null;
    return (await deps.prisma.order.findFirst({
      where: { buyerToken: jeton },
      select: CHAMPS_COMMANDE,
    })) as CommandeLue | null;
  }

  /**
   * `GET /api/suivi/:jeton` — la coquille du suivi.
   *
   * Version MINIMALE, comme le lot le demande : reference, montant, recu,
   * contre-signature. Les etapes de livraison appartiennent au lot 11 et ne
   * s'anticipent pas ici.
   */
  r.get("/:jeton", async (c) => {
    sansCache(c);
    const commande = await parJeton(c.req.param("jeton"));
    // Meme reponse qu'un jeton mal forme : un 403 apprendrait qu'un jeton existe.
    if (!commande) return c.json({ erreur: "lien_inconnu" }, 404);

    const corps = corpsRecu(commande, deps.rampe, await contresigneeA(commande));
    return c.json({
      reference: commande.ref,
      boutique: commande.seller.businessName,
      totalXaf: commande.totalXaf,
      dejaPayeXaf: commande.amountPaidXaf,
      resteXaf: commande.balanceXaf,
      etatPreuve: commande.proofState,
      /**
       * Les etapes de livraison (lot 11). Calculees par le SERVEUR, libelles
       * compris : la page de suivi est bornee a 30 Ko de JS, et un dictionnaire
       * de textes embarque dans l'ilot les consommerait pour rien.
       */
      etapes: etapesDuSuivi({
        etape: commande.step,
        modeLivraison:
          (commande.delivery as { mode?: string } | null)?.mode === "retrait"
            ? "retrait"
            : "livraison",
        totalXaf: commande.totalXaf,
        amountPaidXaf: commande.amountPaidXaf,
        balanceXaf: commande.balanceXaf,
        etatPreuve: commande.proofState,
        annuleeA: null,
      }),
      /** Le numero de reversement : l'acheteuse en a besoin pour payer. */
      numeroDeVersement: commande.seller.payoutPhone,
      ...corps,
      /**
       * Ce que l'acheteuse peut faire MAINTENANT. Calcule ici plutot que devine
       * a l'ecran : deux endroits qui deduisent la meme regle finissent par la
       * deduire differemment.
       */
      actions: {
        contresigner: commande.proofState === "prouve",
        contester: commande.proofState !== "conteste",
      },
    });
  });

  /** Un tap, pas un formulaire : le corps de la requete est vide. */
  r.post("/:jeton/contresigner", (c) =>
    transition(c, { type: "contresignature", par: "acheteuse" }),
  );

  /** La contestation n'efface rien. Elle ouvre un litige, et le dit. */
  r.post("/:jeton/contester", async (c) => {
    const corps = await c.req.json().catch(() => null);
    const motif = typeof corps?.motif === "string" ? corps.motif.slice(0, 500) : undefined;
    return transition(c, { type: "contestation", par: "acheteuse", motif });
  });

  /**
   * Le chemin commun aux deux actions.
   *
   * **Le refus est journalise comme l'acceptation.** C'est le contrat de la
   * machine du lot 7 : une transition arriere ignoree sans trace est une anomalie
   * invisible, et c'est exactement le signal qu'on voudra lire le jour ou un etat
   * parait faux.
   */
  async function transition(c: Context, evenement: EvenementPreuve) {
    sansCache(c);
    const commande = await parJeton(c.req.param("jeton") ?? "");
    if (!commande) return c.json({ erreur: "lien_inconnu" }, 404);

    const now = deps.maintenant?.() ?? new Date();
    const resultat = appliquerEvenement(commande.proofState as never, evenement, now);

    await deps.prisma.$transaction(async (tx) => {
      if (resultat.ok) {
        await tx.order.update({
          where: { id: commande.id },
          data: { proofState: resultat.etat as never },
        });
        /**
         * On NE date PAS la preuve elle-meme : `payment_proof` est en ajout
         * seul, et un declencheur de base refuse l'`UPDATE`. La date de la
         * contre-signature vit dans le journal ci-dessous, qui est fait pour
         * cela. Voir l'ADR 0021.
         */
      }
      await tx.orderEvent.create({
        data: {
          orderId: commande.id,
          sellerId: commande.seller.id,
          kind: resultat.journal.kind,
          actor: resultat.journal.par,
          at: resultat.journal.at,
          /** Jamais le SMS, jamais un solde. Seul l'identifiant y entre. */
          payload: {
            de: resultat.journal.de,
            vers: resultat.journal.vers,
            evenement: resultat.journal.evenement,
            ...(resultat.journal.raison ? { raison: resultat.journal.raison } : {}),
            ...(resultat.journal.motif ? { motif: resultat.journal.motif } : {}),
          },
        },
      });
    });

    if (!resultat.ok) {
      return c.json({ refuse: resultat.raison, etat: resultat.etat }, 409);
    }
    return c.json({ etat: resultat.etat });
  }

  return r;
}
