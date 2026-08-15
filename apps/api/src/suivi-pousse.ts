import type { PrismaClient } from "@catalog/db";
import { lienDeSuivi } from "./domain/receipt/jeton.ts";

/**
 * LA seule projection du jeton de suivi du depot — ADR 0099, decision 3.
 *
 * `buyerToken` autorise la contre-signature (ADR 0021) : le projeter dans un
 * `select` est interdit partout, et `jeton-jamais-expose.test.ts` le tient en
 * lisant les sources. Ce fichier est l'EXCEPTION NOMMEE de ce test, et la
 * seule — le meme patron que `domain/ramp/config.ts`, seul fichier du depot
 * ou un code USSD s'ecrit.
 *
 * Pourquoi cette projection-ci est sure : le lien rendu part UNIQUEMENT dans
 * le fil WhatsApp de l'ACHETEUSE de la commande — le canal qui a recu ce
 * meme lien a la confirmation, le seul qui le detienne. Meme destinataire,
 * meme secret : aucune exposition nouvelle. Toute autre utilisation — une
 * reponse d'API, un message vendeuse, un journal — reste le defaut que le
 * test attrape.
 */
export async function lienSuiviPourLeFil(
  prisma: PrismaClient,
  orderId: string,
  baseBoutique: string,
): Promise<string | null> {
  if (!baseBoutique) return null;
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: { buyerToken: true },
  });
  return o?.buyerToken ? lienDeSuivi(baseBoutique, o.buyerToken) : null;
}
