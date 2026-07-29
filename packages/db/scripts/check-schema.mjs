/**
 * Controle hors-ligne du schema : verifie les invariants du produit sans
 * appeler le moteur Prisma (utile en environnement sans acces au CDN).
 * `prisma validate` reste la reference et tourne en CI.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "..", "prisma", "schema.prisma"), "utf8");
// On ne controle que le code : les commentaires parlent justement de ces regles.
const schema = raw
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("///"))
  .join("\n");
const fail = [];

// 1. Aucun champ « adresse » nulle part — voir ADR 0005.
if (/\baddress\b/i.test(schema)) fail.push("un champ « address » est apparu dans le schema");

// 2. Tous les montants sont des Int — voir ADR 0004.
for (const line of schema.split("\n")) {
  if (/Xaf\s+/.test(line) && !/\bInt\b/.test(line)) {
    fail.push(`montant non entier: ${line.trim()}`);
  }
  if (/(Float|Decimal)/.test(line)) fail.push(`type flottant interdit: ${line.trim()}`);
}

// 3. L'idempotence des webhooks vit dans la contrainte, pas dans le code.
if (!/@@unique\(\[providerTxId,\s*status\]\)/.test(schema)) {
  fail.push("la contrainte UNIQUE(providerTxId, status) sur PaymentEvent a disparu");
}

// 4. Le code de verification est unique.
if (!/verificationCode\s+String\?\s+@unique/.test(schema)) {
  fail.push("verificationCode doit rester UNIQUE");
}

if (fail.length) {
  console.error("Invariants du schema violes :");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "Invariants du schema : ok (address absent, montants entiers, idempotence, code unique)",
);
