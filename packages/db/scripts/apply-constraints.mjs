#!/usr/bin/env node
/**
 * Applique sql/0001_constraints.sql — les invariants que Prisma ne sait pas
 * exprimer : CHECK, contraintes de forme, et triggers d'ajout seul.
 *
 * Pourquoi ce script plutot qu'un appel a `psql` :
 *
 * 1. **`psql` refuse l'URL de Prisma.** `DATABASE_URL` porte `?schema=public`,
 *    un parametre propre a Prisma que libpq rejette (« invalid URI query
 *    parameter »). L'ancien script `psql "$DATABASE_URL"` echouait donc avec
 *    l'URL de `.env.example` — un CHECK jamais applique est un invariant qui
 *    n'existe pas, et rien ne le signalait.
 * 2. **Aucun binaire externe.** Le client `pg` est deja une dependance : le
 *    script marche partout ou l'application marche, sans installer
 *    postgresql-client dans l'image de CI.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const FICHIER = join(HERE, "..", "sql", "0001_constraints.sql");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant.");
  process.exit(1);
}

/** Retire les parametres de requete propres a Prisma (`?schema=…`). */
function pourLibpq(u) {
  const i = u.indexOf("?");
  return i === -1 ? u : u.slice(0, i);
}

const sql = readFileSync(FICHIER, "utf8");
const client = new Client({ connectionString: pourLibpq(url) });

try {
  await client.connect();
  // Un seul aller-retour, dans une transaction : ou tous les invariants sont
  // en place, ou aucun. Un demi-jeu de contraintes serait pire que rien,
  // parce qu'on croirait le tout applique.
  await client.query("BEGIN");
  /**
   * ── Deux delais, parce que ce script tourne PENDANT que le service repond ──
   *
   * `ALTER TABLE … ADD CONSTRAINT` prend un verrou ACCESS EXCLUSIVE. En
   * deploiement `rolling`, l'ancienne version sert encore le trafic : si une
   * requete quelconque tient un verrou sur la table, l'ALTER attend — et,
   * PostgreSQL faisant la queue, toutes les requetes suivantes sur cette table
   * attendent derriere lui. Une commande de migration qui patiente devient
   * alors une panne totale de la table, pendant que le deploiement a l'air de
   * progresser.
   *
   * `lock_timeout` fait echouer l'attente du VERROU en trois secondes ;
   * `statement_timeout` borne une instruction qui, elle, a bien demarre — une
   * validation de contrainte sur une grosse table, par exemple.
   *
   * Echouer vite est ici le bon comportement : la transaction se defait, les
   * contraintes restent celles d'avant, le `release_command` sort en erreur et
   * Fly n'envoie pas la nouvelle version. On relance a un moment plus calme.
   * `SET LOCAL` : la portee est la transaction, rien ne fuit sur la connexion.
   */
  await client.query("SET LOCAL lock_timeout = '3s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("contraintes appliquees");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("echec de l'application des contraintes :", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
