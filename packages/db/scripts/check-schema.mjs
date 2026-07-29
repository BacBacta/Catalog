/**
 * Controle hors-ligne du schema : verifie les invariants du produit sans
 * appeler le moteur Prisma (utile en environnement sans acces au CDN).
 * `prisma validate` reste la reference et tourne en CI.
 *
 * Mis a jour au lot 3 : les invariants d'agregateur sont remplaces par ceux de
 * la preuve, conformement aux ADR 0009 et 0011.
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

/* ── 1. Aucun champ « adresse » nulle part — ADR 0005 ── */
if (/\baddress\b/i.test(schema)) fail.push("un champ « address » est apparu dans le schema");

/* ── 2. Tous les montants sont des Int — ADR 0004 ── */
for (const line of schema.split("\n")) {
  if (/Xaf\s+/.test(line) && !/\bInt\b/.test(line)) {
    fail.push(`montant non entier: ${line.trim()}`);
  }
  if (/(Float|Decimal)/.test(line)) fail.push(`type flottant interdit: ${line.trim()}`);
}

/* ── 3. Le controle n° 5 vit dans une contrainte UNIQUE, RESEAU-LARGE ──
   C'est l'invariant qui empeche de reclamer deux fois le meme paiement, chez
   n'importe quelle vendeuse. Il remplace l'ancienne assertion d'idempotence de
   webhook, disparue avec l'agregateur (ADR 0011). */
if (!/@@unique\(\[operator,\s*operatorTxId\]\)/.test(schema)) {
  fail.push(
    "la contrainte UNIQUE(operator, operator_tx_id) sur payment_proof a disparu — c'est le controle n° 5",
  );
}

/* ── 4. Il n'y a plus d'agregateur dans le modele de donnees — ADR 0009 ── */
const INTERDITS = [
  ["model PaymentEvent", "la table d'idempotence de webhook est revenue"],
  ["providerTxId", "une reference de prestataire est revenue (provider_tx_id)"],
];
for (const [motif, message] of INTERDITS) {
  if (schema.includes(motif)) fail.push(message);
}

/* ── 5. La preuve ne porte AUCUN solde ──
   Le SMS contient le solde du compte de la vendeuse. Il ne se persiste pas, ne
   se journalise pas, ne se trace pas. Le lot 3 ne lui donne aucune colonne,
   deliberement — et ce controle empeche qu'une en apparaisse par megarde. */
const proofBlock = /model PaymentProof \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
if (!proofBlock) fail.push("le modele PaymentProof est introuvable");
for (const mot of ["solde", "balance"]) {
  if (new RegExp(`\\b${mot}`, "i").test(proofBlock)) {
    fail.push(`payment_proof ne doit porter aucune colonne de solde (« ${mot} » trouve)`);
  }
}

/* ── 6. Le drapeau du motif garde son nom ET sa polarite ──
   `patternAConfirmer`, jamais « confirmed ». Inverser la polarite ferait passer
   un motif reconstitue pour valide : c'est le piege que le lot 8 redoute. */
if (!/patternAConfirmer\s+Boolean/.test(proofBlock)) {
  fail.push("payment_proof doit porter patternAConfirmer (meme nom, meme polarite)");
}
if (/\bconfirmed\b/i.test(proofBlock)) {
  fail.push("polarite inversee : « confirmed » au lieu de patternAConfirmer");
}

/* ── 7. Le code de verification est unique et non nul ──
   Il est la cle de la page publique du recu : une commande sans code n'a pas de
   page de verification. */
if (!/verificationCode\s+String\s+@unique/.test(schema)) {
  fail.push("verificationCode doit rester String @unique et NON NULLABLE");
}

/* ── 8. Les vocabulaires figes au lot 3 ── */
const ENUMS = {
  PayMode: ["integral", "acompte", "sans_prepaiement"],
  OrderStep: ["recue", "preparee", "chez_le_livreur", "livree"],
  ProofState: ["attendu", "declare_non_trace", "prouve", "contresigne", "conteste"],
  OperatorKey: ["mtn", "orange"],
};
for (const [nom, valeurs] of Object.entries(ENUMS)) {
  const bloc = new RegExp(`enum ${nom} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1];
  if (!bloc) {
    fail.push(`enum ${nom} introuvable`);
    continue;
  }
  const lues = bloc
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("@@"));
  if (lues.join(",") !== valeurs.join(",")) {
    fail.push(`enum ${nom} modifie : attendu [${valeurs}], lu [${lues}]`);
  }
}

if (fail.length) {
  console.error("Invariants du schema violes :");
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "Invariants du schema : ok (pas d'adresse, montants entiers, controle n° 5, aucun solde, vocabulaires figes)",
);
