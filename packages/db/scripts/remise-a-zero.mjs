#!/usr/bin/env node
/**
 * REMISE A ZERO du schema — destructeur, et reserve a la PREPRODUCTION.
 *
 * ── Ce qu'il fait, et pourquoi pas `prisma migrate reset` ─────────────────
 *
 * Il supprime les schemas de donnees puis les recree vides. L'appelant
 * enchaine `prisma migrate deploy` et `apply-constraints.mjs`, qui remontent
 * les tables, les CHECK et les declencheurs d'ajout seul du lot 3.
 *
 * `prisma migrate reset` aurait fait a peu pres pareil, mais son comportement
 * DEPEND des droits du role : selon qu'il peut ou non recreer la base, il
 * supprime la base ou seulement les objets du schema, et il tente un seed. Sur
 * une base geree, on ne veut pas d'un geste dont le sens change avec les
 * permissions. Ici, ce qui se passe est ecrit.
 *
 * ── Trois verrous, et aucun n'est decoratif ───────────────────────────────
 *
 * 1. `FLY_APP_NAME` doit contenir `preprod`. Cette variable est posee par Fly
 *    DANS la machine : le script refuse donc de tourner ailleurs que dans
 *    l'application de preproduction, y compris depuis un poste.
 * 2. `CONFIRMATION` doit valoir exactement la phrase attendue. Un declenchement
 *    par megarde d'un workflow ne suffit pas.
 * 3. Il AFFICHE ce qu'il va detruire avant de le detruire, et le nombre de
 *    lignes indelebiles emportees. Un effacement silencieux n'apprend rien.
 *
 * ── Ce que ce geste coute, dit une fois de plus ───────────────────────────
 *
 * Les reçus deja montres deviennent invérifiables : `verification_code` est
 * public des qu'un recu circule, et `/v/?c=…` repondra 404. Les identifiants
 * d'operateur deja reclames redeviennent reclamables — le controle n° 5 est
 * reseau-large et perpetuel, et sa memoire est precisement ce qu'on efface.
 * Sur des donnees de test c'est sans consequence. C'est la SEULE raison pour
 * laquelle ce script existe.
 *
 * Usage : CONFIRMATION="…" node packages/db/scripts/remise-a-zero.mjs
 */

import { Client } from "pg";

const PHRASE = "REMISE-A-ZERO-PREPRODUCTION";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant. Ce script tourne DANS la machine Fly.");
  process.exit(1);
}

const app = process.env.FLY_APP_NAME ?? "";
if (!app.includes("preprod")) {
  console.error(
    `Refus : FLY_APP_NAME vaut « ${app || "(vide)"} », qui ne contient pas « preprod ».\n` +
      "Ce script ne s'execute que dans l'application de preproduction. Il n'y a\n" +
      "aucun drapeau pour passer outre, et c'est le but.",
  );
  process.exit(1);
}

if (process.env.CONFIRMATION !== PHRASE) {
  console.error(
    `Refus : CONFIRMATION doit valoir exactement « ${PHRASE} ».\n` +
      "Un workflow declenche par megarde ne doit pas suffire a vider une base.",
  );
  process.exit(1);
}

const pourLibpq = (u) => (u.includes("?") ? u.slice(0, u.indexOf("?")) : u);
const client = new Client({ connectionString: pourLibpq(url) });

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

  /** On dit ce qu'on emporte, AVANT de l'emporter. */
  const temoins = ["seller", "product", "order", "payment_proof", "order_event", "review"];
  console.log("── Ce qui va disparaitre ────────────────────────────────");
  for (const t of temoins) {
    const n = await compter(t);
    console.log(`  ${t.padEnd(20)} ${n === null ? "(table absente)" : n}`);
  }

  /**
   * `pgboss` a son propre schema, et il porte les travaux en attente —
   * relances d'acompte, rappels de reversement. Les laisser derriere ferait
   * pointer des travaux vers des commandes disparues. pg-boss recree son
   * schema au demarrage suivant.
   *
   * On DECOUVRE les schemas plutot que de les supposer : celui de pg-boss est
   * configurable, et un nom devine qui n'existe pas ferait echouer la
   * transaction pour rien.
   */
  const { rows: schemas } = await client.query(`
    SELECT schema_name FROM information_schema.schemata
     WHERE schema_name IN ('public', 'pgboss')
  `);
  const noms = schemas.map((r) => r.schema_name);

  console.log("");
  console.log(`── Schemas recrees : ${noms.join(", ")} ─────────────────`);

  /**
   * Une seule transaction : ou tout est repropre, ou rien n'a bouge. Un demi
   * effacement — schema `public` vide, `pgboss` intact — serait pire que rien.
   */
  await client.query("BEGIN");
  for (const nom of noms) {
    await client.query(`DROP SCHEMA "${nom}" CASCADE`);
    await client.query(`CREATE SCHEMA "${nom}"`);
  }
  await client.query("COMMIT");

  console.log("");
  console.log("schemas remis a zero.");
  console.log("Il reste a rejouer les migrations ET les contraintes :");
  console.log("  prisma migrate deploy && node scripts/apply-constraints.mjs");
  console.log("Sans le second, les declencheurs d'ajout seul et les CHECK du lot 3");
  console.log("manquent — une base sans ses invariants est pire qu'une base vide.");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("echec de la remise a zero :", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
