import type { PrismaClient } from "@catalog/db";
import { Hono } from "hono";
import {
  appliquerChangementReversement,
  type PayoutChangeRequest,
  type ResultatChangement,
} from "../domain/payout-phone.ts";

/**
 * Changement du numero de reversement.
 *
 * La decision appartient au domaine (`payout-phone.ts`), qui est pur. Cette
 * couche ne fait que trois choses : lire l'etat, appeler le domaine, et
 * persister ce qu'il renvoie.
 *
 * **Le journal est ecrit dans TOUS les cas, refus compris, et dans la MEME
 * transaction que la modification.** Deux raisons :
 *
 * 1. une tentative refusee qui ne laisse pas de trace est une attaque
 *    invisible — et c'est precisement ce champ qu'un attaquant vise ;
 * 2. hors transaction, un numero pourrait changer sans que le journal le dise,
 *    ou l'inverse. Les deux sont pires que l'echec.
 */

export interface PayoutDeps {
  prisma: PrismaClient;
  /** Injectable pour les tests : le domaine ne lit jamais l'horloge. */
  maintenant?: () => Date;
}

/**
 * Applique un changement et persiste tout — modification si acceptee, journal
 * dans les deux cas. Exportee separement de la route pour etre testable contre
 * une vraie base sans passer par HTTP.
 */
export async function changerNumeroDeReversement(
  deps: PayoutDeps,
  entree: {
    sellerId: string;
    nouveauNumero: string;
    verification: PayoutChangeRequest["verification"];
    acteur: PayoutChangeRequest["acteur"];
  },
): Promise<ResultatChangement> {
  const now = deps.maintenant?.() ?? new Date();

  const vendeuse = await deps.prisma.seller.findUnique({
    where: { id: entree.sellerId },
    select: { id: true, phone: true, payoutPhone: true, payoutPhoneVerifiedAt: true },
  });
  if (!vendeuse) throw new Error(`vendeuse introuvable: ${entree.sellerId}`);

  const resultat = appliquerChangementReversement(
    {
      sellerId: vendeuse.id,
      loginPhone: vendeuse.phone,
      payoutPhone: vendeuse.payoutPhone,
      payoutPhoneVerifiedAt: vendeuse.payoutPhoneVerifiedAt,
    },
    { ...entree, now },
  );

  const journal = {
    sellerId: resultat.journal.sellerId,
    kind: resultat.journal.kind,
    actor: resultat.journal.actor,
    payload: resultat.journal.payload,
    at: resultat.journal.at,
  };

  await deps.prisma.$transaction(async (tx) => {
    if (resultat.ok) {
      await tx.seller.update({
        where: { id: entree.sellerId },
        data: resultat.changes,
      });
    }
    await tx.sellerAuditEvent.create({ data: journal });
  });

  return resultat;
}

/** Codes HTTP : un refus metier n'est pas une panne. */
const STATUT: Record<string, number> = {
  verification_absente: 403,
  verification_dun_autre_numero: 403,
  verification_perimee: 403,
  numero_invalide: 422,
  numero_inchange: 409,
};

/**
 * Messages destines a la vendeuse, en francais simple. Ils disent quoi faire,
 * pas ce qui a echoue techniquement.
 */
const MESSAGE: Record<string, string> = {
  verification_absente:
    "Confirmez d'abord le nouveau numero avec le code que nous venons d'envoyer.",
  verification_dun_autre_numero:
    "Le code confirme un autre numero. Demandez un code pour le numero que vous voulez utiliser.",
  verification_perimee: "Le code a expire. Demandez-en un nouveau.",
  numero_invalide: "Ce numero ne ressemble pas a un numero camerounais.",
  numero_inchange: "C'est deja votre numero de reversement.",
};

export function payoutRoutes(deps: PayoutDeps) {
  return new Hono().post("/", async (c) => {
    const corps = await c.req.json().catch(() => null);
    if (!corps?.sellerId || !corps?.nouveauNumero) {
      return c.json({ erreur: "sellerId et nouveauNumero sont requis" }, 422);
    }

    const resultat = await changerNumeroDeReversement(deps, {
      sellerId: String(corps.sellerId),
      nouveauNumero: String(corps.nouveauNumero),
      verification: corps.verification
        ? {
            numero: String(corps.verification.numero),
            verifieA: new Date(corps.verification.verifieA),
          }
        : null,
      acteur: {
        role: "vendeuse",
        // `x-forwarded-for` peut porter une liste : on garde la premiere.
        ...(() => {
          const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
          return ip ? { ip } : {};
        })(),
      },
    });

    if (!resultat.ok) {
      return c.json(
        { erreur: resultat.raison, message: MESSAGE[resultat.raison] },
        (STATUT[resultat.raison] ?? 400) as 400,
      );
    }
    return c.json({
      payoutPhone: resultat.changes.payoutPhone,
      payoutOperator: resultat.changes.payoutOperator,
    });
  });
}
