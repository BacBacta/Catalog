/**
 * Remise a zero du BANC D'ESSAI — preproduction uniquement, a la main.
 *
 *   node apps/api/scripts/banc-essai-reinitialiser.mjs --oui-j-efface-tout
 *
 * Ce script n'appartient a AUCUNE chaine pnpm, comme db:restauration : une
 * remise a zero ne se lance pas par megarde. Sans le drapeau, il compte et
 * s'arrete — c'est aussi sa forme « etat des lieux ».
 *
 * ── Pourquoi TRUNCATE, et pas DELETE ─────────────────────────────────────
 *
 * `payment_proof`, `ledger_entry`, `order_event` et `seller_audit_event`
 * portent des triggers BEFORE DELETE qui REFUSENT la suppression ligne a
 * ligne — c'est le contrat d'ajout seul du lot 3, et on ne le desactive pas.
 * TRUNCATE ne passe pas par ces triggers : il repart de zero, ce qui est
 * exactement le geste d'un banc d'essai — et seulement ca. En production,
 * ce script n'a aucune raison d'exister ; c'est pour cela qu'il exige le
 * drapeau en toutes lettres.
 *
 * Ce qui est efface : vendeuses, articles, commandes, preuves, avis, journal
 * d'audit, conversations du bot, files d'attente, comptes crees par
 * telephone. Ce qui RESTE : un eventuel compte Google, et toute la
 * configuration (secrets, gabarits chez Meta, reception entrante).
 */
import { createPrismaClient } from "../../../packages/db/src/index.ts";

const prisma = createPrismaClient();

const compter = async () => ({
  vendeuses: await prisma.seller.count(),
  articles: await prisma.product.count(),
  commandes: await prisma.order.count(),
  preuves: await prisma.paymentProof.count(),
  avis: await prisma.review.count(),
  conversations: await prisma.botConversation.count(),
  messagesVus: await prisma.botMessageVu.count(),
  notifsEnFile: await prisma.botNotification.count(),
  comptesTelephone: await prisma.authUser.count({
    where: {
      OR: [{ phoneNumber: { not: null } }, { email: { endsWith: "@telephone.catalog.invalid" } }],
    },
  }),
});

const avant = await compter();
console.log("Etat du banc :", JSON.stringify(avant, null, 2));

if (!process.argv.includes("--oui-j-efface-tout")) {
  console.log(
    "\nRien n'a ete efface. Pour remettre le banc a zero :\n" +
      "  node apps/api/scripts/banc-essai-reinitialiser.mjs --oui-j-efface-tout",
  );
  process.exit(0);
}

await prisma.$executeRawUnsafe(`TRUNCATE TABLE
  "payment_proof","ledger_entry","order_event","review","order",
  "product_view","product","payout_otp","seller_audit_event","seller",
  "bot_conversation","bot_message_vu","bot_notification","otp_attempt"
  CASCADE`);

/* Les comptes nes d'un numero de telephone (bot et OTP). Leurs sessions,
   liaisons et passkeys suivent par cascade ; un compte Google reste. */
const comptes = await prisma.authUser.deleteMany({
  where: {
    OR: [{ phoneNumber: { not: null } }, { email: { endsWith: "@telephone.catalog.invalid" } }],
  },
});

console.log("\nComptes telephone retires :", comptes.count);
console.log("Apres :", JSON.stringify(await compter(), null, 2));
console.log("\nBanc d'essai remis a zero. Premier geste cote vendeuse : « vendre ».");
await prisma.$disconnect();
