#!/usr/bin/env node
/**
 * INVENTAIRE de la base — lecture seule, aucune ecriture.
 *
 * ── Pourquoi ce script existe ─────────────────────────────────────────────
 *
 * Depuis l'ADR 0070, `DATABASE_URL` ne vit plus qu'a UN endroit : les secrets
 * de l'application Fly. C'est voulu, et c'est un progres — mais cela veut dire
 * que plus personne ne peut regarder la base depuis un poste. La seule facon
 * de savoir ce qu'elle contient est de le demander DEPUIS la machine, ou le
 * secret est chez lui.
 *
 * Ce script est ce regard. Il tourne avant toute operation destructrice, pour
 * qu'on efface en sachant ce qu'on efface.
 *
 * ── Ce qu'il n'affiche PAS ────────────────────────────────────────────────
 *
 * Aucun numero de telephone, aucun jeton, aucun code de verification, aucun
 * SMS. Sa sortie atterrit dans un journal d'integration continue, c'est-a-dire
 * dans un endroit lisible par tous ceux qui ont acces au depot. Meme regime
 * que les traces (ADR 0023) : une liste FERMEE de ce qui sort.
 *
 * Usage : node packages/db/scripts/inventaire.mjs
 */

import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant. Ce script tourne DANS la machine Fly.");
  process.exit(1);
}

/** Retire les parametres propres a Prisma (`?schema=…`), que libpq rejette. */
const pourLibpq = (u) => (u.includes("?") ? u.slice(0, u.indexOf("?")) : u);

const client = new Client({ connectionString: pourLibpq(url) });

/** Compte une table, ou rend `null` si elle n'existe pas encore. */
async function compter(table) {
  try {
    const r = await client.query(`SELECT count(*)::int AS n FROM "${table}"`);
    return r.rows[0].n;
  } catch {
    return null;
  }
}

try {
  await client.connect();

  /**
   * Les noms sont ceux des `@@map` du schema Prisma, pas ceux des modeles.
   * `compter` rend `(table absente)` plutot que de lever : une table qui
   * n'existe pas encore est une information, pas une panne.
   */
  const tables = [
    "seller",
    "product",
    "product_view",
    "order",
    "payment_proof",
    "order_event",
    "ledger_entry",
    "review",
    "seller_audit_event",
    "user",
    "session",
    "account",
    "passkey",
    "otp_attempt",
    "payout_otp",
    "bot_conversation",
    "bot_message_vu",
    "bot_notification",
  ];

  console.log("── Volumes ──────────────────────────────────────────────");
  for (const t of tables) {
    const n = await compter(t);
    console.log(`  ${t.padEnd(20)} ${n === null ? "(table absente)" : n}`);
  }

  /**
   * Le detail par boutique. Le numero WhatsApp N'EN EST PAS : il suffit du
   * slug pour reconnaitre une boutique de test.
   */
  const { rows } = await client.query(`
    SELECT s.slug,
           s.business_name                                        AS nom,
           s.status,
           s.created_at                                           AS creee_le,
           (SELECT count(*)::int FROM "product" p WHERE p.seller_id = s.id) AS articles,
           (SELECT count(*)::int FROM "order"   o WHERE o.seller_id = s.id) AS commandes,
           (SELECT count(*)::int FROM "review"  r WHERE r.seller_id = s.id) AS avis
      FROM "seller" s
     ORDER BY s.created_at ASC
  `);

  console.log("");
  console.log("── Boutiques ────────────────────────────────────────────");
  if (rows.length === 0) {
    console.log("  (aucune)");
  }
  for (const b of rows) {
    const date = new Date(b.creee_le).toISOString().slice(0, 10);
    console.log(
      `  ${b.slug.padEnd(24)} ${String(b.status).padEnd(10)} ${date}  ` +
        `${b.articles} art. · ${b.commandes} cmd. · ${b.avis} avis   « ${b.nom} »`,
    );
  }

  /**
   * ── Ce qui empeche une suppression ciblee, dit ICI ────────────────────
   *
   * Les preuves, le journal d'audit, le grand livre et l'audit vendeuse sont en
   * AJOUT SEUL : un declencheur refuse leur suppression. Une boutique qui en a
   * ne peut pas etre effacee sans retirer ces declencheurs. Autant le savoir
   * avant de choisir la methode que devant un message d'erreur.
   */
  const indelebiles = ["payment_proof", "order_event", "ledger_entry", "seller_audit_event"];
  let total = 0;
  for (const t of indelebiles) total += (await compter(t)) ?? 0;
  console.log("");
  console.log("── Lignes indelebiles (ajout seul, ADR 0021) ────────────");
  console.log(`  ${total} au total dans ${indelebiles.join(", ")}`);
  if (total > 0) {
    console.log("  → une suppression CIBLEE est impossible sans retirer les declencheurs ;");
    console.log("    une remise a zero du schema, elle, les emporte avec le reste.");
  }
} finally {
  await client.end();
}
