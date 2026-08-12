/**
 * Reinitialise les boutiques NEES DU BOT — et rien d'autre.
 *
 *   node apps/api/scripts/reinitialiser-boutiques-bot.mjs             → liste (rien n'est touche)
 *   node apps/api/scripts/reinitialiser-boutiques-bot.mjs --vraiment  → supprime
 *
 * ── Ce que « nees du bot » veut dire ──────────────────────────────────────
 *
 * `seller.canal_ouverture = 'bot'` (ADR 0034) : la boutique a ete ouverte dans
 * le fil WhatsApp. Les boutiques de l'espace vendeuse (`web`) et les donnees de
 * demonstration ne sont PAS touchees.
 *
 * ── Pourquoi ce script a le droit de supprimer des journaux d'ajout seul ──
 *
 * `payment_proof`, `ledger_entry`, `order_event` et `seller_audit_event` sont
 * proteges par des declencheurs qui refusent UPDATE et DELETE : c'est le
 * contrat du lot 3, et il est juste. Une REINITIALISATION DE TEST est
 * l'exception assumee : elle retire des boutiques d'essai EN ENTIER, jamais
 * une ligne au milieu d'un journal vivant. Les declencheurs sont suspendus
 * DANS la transaction et retablis avant le COMMIT — si quoi que ce soit
 * echoue en chemin, tout revient, verrous compris.
 *
 * Deux choses restent volontairement en place :
 * - `bot_message_vu` : la deduplication des messages WhatsApp est GLOBALE,
 *   la purger rejouerait d'anciens messages a la prochaine relivraison ;
 * - les objets images dans le stockage S3 : cles opaques, contenu public
 *   (ADR 0017) — des orphelins inoffensifs, pas une fuite.
 *
 * `--vraiment` est un acte destructif : il ne part jamais tout seul, et la
 * liste de ce qui va disparaitre s'obtient d'abord sans option.
 */
import { createPrismaClient } from "@catalog/db";

const URL = process.env.DATABASE_URL;
if (!URL) {
  console.error("DATABASE_URL absente — ce script parle a une vraie base, ou a personne.");
  process.exit(1);
}
const mode = process.argv[2] ?? "--voir";
if (mode !== "--voir" && mode !== "--vraiment") {
  console.error(`mode inconnu : ${mode}. Utilisez --voir (defaut) ou --vraiment.`);
  process.exit(1);
}

const prisma = createPrismaClient(URL);

const boutiques = await prisma.$queryRawUnsafe(`
  SELECT s.id, s.slug, s.business_name, s.phone, s.created_at,
         (SELECT count(*) FROM product p WHERE p.seller_id = s.id)  AS articles,
         (SELECT count(*) FROM "order" o WHERE o.seller_id = s.id)  AS commandes
  FROM seller s
  WHERE s.canal_ouverture = 'bot'
  ORDER BY s.created_at
`);

if (boutiques.length === 0) {
  console.log("Aucune boutique nee du bot — rien a faire.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`${boutiques.length} boutique(s) nee(s) du bot :\n`);
for (const b of boutiques) {
  console.log(
    `  ${b.slug.padEnd(28)} « ${b.business_name} » · ${b.phone} · ` +
      `${b.articles} article(s), ${b.commandes} commande(s)`,
  );
}

if (mode === "--voir") {
  console.log(
    "\nRien n'a ete touche. Pour supprimer :" +
      " node apps/api/scripts/reinitialiser-boutiques-bot.mjs --vraiment",
  );
  await prisma.$disconnect();
  process.exit(0);
}

const compte = await prisma.$transaction(async (tx) => {
  /* Les quatre verrous d'ajout seul, suspendus le temps de la transaction.
     `ALTER TABLE` est transactionnel : un echec plus bas les retablit aussi. */
  for (const [table, declencheur] of [
    ["payment_proof", "proof_no_delete"],
    ["ledger_entry", "ledger_no_delete"],
    ["order_event", "order_event_no_delete"],
    ["seller_audit_event", "seller_audit_no_delete"],
  ]) {
    await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER ${declencheur}`);
  }

  const n = {};
  const cibles = `SELECT id FROM seller WHERE canal_ouverture = 'bot'`;
  const commandes = `SELECT id FROM "order" WHERE seller_id IN (${cibles})`;
  const telephones = `SELECT phone FROM seller WHERE canal_ouverture = 'bot'`;

  n.avis = await tx.$executeRawUnsafe(`DELETE FROM review WHERE seller_id IN (${cibles})`);
  n.preuves = await tx.$executeRawUnsafe(
    `DELETE FROM payment_proof WHERE order_id IN (${commandes})`,
  );
  n.ecritures = await tx.$executeRawUnsafe(
    `DELETE FROM ledger_entry WHERE order_id IN (${commandes})`,
  );
  n.evenements = await tx.$executeRawUnsafe(
    `DELETE FROM order_event WHERE order_id IN (${commandes}) OR seller_id IN (${cibles})`,
  );
  n.commandes = await tx.$executeRawUnsafe(`DELETE FROM "order" WHERE seller_id IN (${cibles})`);
  /* product_view et payout_otp suivent par cascade (product, seller). */
  n.articles = await tx.$executeRawUnsafe(`DELETE FROM product WHERE seller_id IN (${cibles})`);
  n.audit = await tx.$executeRawUnsafe(
    `DELETE FROM seller_audit_event WHERE seller_id IN (${cibles})`,
  );
  n.notifications = await tx.$executeRawUnsafe(
    `DELETE FROM bot_notification WHERE phone IN (${telephones})`,
  );
  n.conversations = await tx.$executeRawUnsafe(
    `DELETE FROM bot_conversation WHERE phone IN (${telephones})`,
  );
  /* Une marraine supprimee ne retient personne : l'attribution est SANS cle
     etrangere, mais on nettoie pour ne pas garder un identifiant mort. */
  await tx.$executeRawUnsafe(
    `UPDATE seller SET parrain_id = NULL
     WHERE parrain_id IN (${cibles}) AND canal_ouverture <> 'bot'`,
  );

  /* Les comptes d'authentification des boutiques supprimees, et leurs
     sessions (elles cascadent du compte). La liste est capturee AVANT la
     suppression des boutiques, et on ne retire un compte que s'il ne porte
     plus AUCUNE boutique — l'email technique ne suffirait pas a les
     distinguer : l'espace web fabrique le meme. */
  const comptesAvant = await tx.$queryRawUnsafe(
    `SELECT user_id AS id FROM seller WHERE canal_ouverture = 'bot' AND user_id IS NOT NULL`,
  );
  n.boutiques = await tx.$executeRawUnsafe(`DELETE FROM seller WHERE canal_ouverture = 'bot'`);
  n.comptes = 0;
  for (const { id } of comptesAvant) {
    n.comptes += await tx.$executeRawUnsafe(
      `DELETE FROM "user" u WHERE u.id = $1
       AND NOT EXISTS (SELECT 1 FROM seller s WHERE s.user_id = u.id)`,
      id,
    );
  }

  for (const [table, declencheur] of [
    ["payment_proof", "proof_no_delete"],
    ["ledger_entry", "ledger_no_delete"],
    ["order_event", "order_event_no_delete"],
    ["seller_audit_event", "seller_audit_no_delete"],
  ]) {
    await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER ${declencheur}`);
  }
  return n;
});

console.log("\nSupprime :");
for (const [quoi, combien] of Object.entries(compte)) {
  console.log(`  ${String(combien).padStart(4)}  ${quoi}`);
}

/* La boutique publique est un site statique : sans reconstruction, les
   boutiques supprimees resteraient en ligne. Meme crochet que la naissance
   d'une boutique (ADR 0065). */
const crochet = process.env.SHOP_REBUILD_HOOK_URL?.trim();
if (crochet) {
  const r = await fetch(crochet, { method: "POST" }).catch(() => null);
  console.log(
    r?.ok
      ? "\nReconstruction de la boutique publique demandee."
      : "\n⚠ La reconstruction de la boutique publique n'a pas pu etre demandee — a relancer.",
  );
} else {
  console.log("\n⚠ SHOP_REBUILD_HOOK_URL absente : reconstruire la boutique publique a la main.");
}

await prisma.$disconnect();
