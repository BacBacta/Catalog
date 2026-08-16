#!/usr/bin/env node
/**
 * DIAGNOSTIC de sante du compte Meta — lecture seule.
 *
 * ── Pourquoi il existe ────────────────────────────────────────────────────
 *
 * Le 16/08/2026, le porteur du produit rapporte un compte « restreint ». Le
 * mot peut recouvrir cinq choses tres differentes, et les confondre coute une
 * journee :
 *
 *   1. le WABA n'est pas revise (`account_review_status`) ;
 *   2. l'entreprise n'est pas verifiee (`business_verification_status`) ;
 *   3. le NUMERO est de mauvaise qualite ou suspendu (`quality_rating`,
 *      `status`) ;
 *   4. le palier de messagerie est bas (`messaging_limit_tier`) — ce n'est
 *      PAS une restriction, c'est le regime normal d'un compte neuf ;
 *   5. une restriction reelle posee par Meta, avec son motif.
 *
 * `health_status` repond directement a la cinquieme : il rend, PAR ENTITE
 * (WABA, numero, application, entreprise, gabarit), si l'envoi est possible
 * et — quand il ne l'est pas — le code d'erreur, sa description et la
 * solution proposee par Meta. C'est la reponse a « pourquoi », pas une
 * deduction a partir d'un symptome.
 *
 * ── Ce qu'il imprime, et ce qu'il n'imprime JAMAIS ────────────────────────
 *
 * Des identifiants de configuration, des statuts et des messages d'erreur de
 * Meta. Jamais `WABOT_API_KEY`, jamais un contenu de conversation. Sa sortie
 * atterrit dans un journal d'integration continue, lisible par qui a acces
 * au depot — meme regime que les autres sondes (ADR 0023).
 *
 * Usage : node apps/api/scripts/diagnostic-meta.mjs
 */

const JETON = process.env.WABOT_API_KEY?.trim();
const WABA = process.env.WHATSAPP_WABA_ID?.trim();
const BASE = (process.env.WABOT_GRAPH_URL ?? "https://graph.facebook.com/v26.0").replace(/\/$/, "");

if (!JETON) {
  console.error("WABOT_API_KEY absent : rien a mesurer sans jeton Graph.");
  process.exit(1);
}
if (!WABA) {
  console.error("WHATSAPP_WABA_ID absent : c'est le compte a diagnostiquer.");
  process.exit(1);
}

async function graph(chemin) {
  try {
    const r = await fetch(`${BASE}/${chemin}`, {
      headers: { Authorization: `Bearer ${JETON}` },
      signal: AbortSignal.timeout(15_000),
    });
    const corps = await r.json().catch(() => ({}));
    return { ok: r.ok, statut: r.status, corps };
  } catch (e) {
    return { ok: false, statut: 0, corps: { error: { message: String(e?.message ?? e) } } };
  }
}

const erreurDe = (r) => r.corps?.error?.message ?? `HTTP ${r.statut}`;

/** Une ligne « clef : valeur » alignee, avec un verdict lisible. */
const dire = (clef, valeur, note = "") =>
  console.log(`  ${String(clef).padEnd(30)} ${valeur ?? "(non rendu)"}${note ? `   ${note}` : ""}`);

/* ── 1. Le compte WhatsApp Business lui-meme ─────────────────────────────── */

console.log("── 1. Le compte WhatsApp Business (WABA) ────────────────");
const champs = [
  "id",
  "name",
  "account_review_status",
  "business_verification_status",
  "country",
  "currency",
  "ownership_type",
  "status",
  "timezone_id",
].join(",");
const waba = await graph(`${WABA}?fields=${champs}`);
if (waba.ok) {
  const w = waba.corps;
  dire("nom", w.name);
  dire("pays / devise", `${w.country ?? "?"} / ${w.currency ?? "?"}`);
  dire(
    "statut du compte",
    w.status,
    w.status && w.status !== "CONNECTED" ? "← ANORMAL : normalement « CONNECTED »" : "",
  );
  dire(
    "revision du compte",
    w.account_review_status,
    w.account_review_status === "APPROVED" ? "" : "← non approuve : bride les fonctions",
  );
  dire(
    "verification de l'entreprise",
    w.business_verification_status,
    w.business_verification_status === "verified"
      ? ""
      : "← NON VERIFIEE : c'est la cause n°1 des restrictions",
  );
} else {
  console.log(`  lecture refusee : ${erreurDe(waba)}`);
}

/* ── 2. La SANTE, entite par entite — la reponse a « pourquoi » ──────────── */

console.log("");
console.log("── 2. Sante : ce qui bloque, et pourquoi (health_status) ─");
const sante = await graph(`${WABA}?fields=health_status`);
if (sante.ok && sante.corps?.health_status) {
  const h = sante.corps.health_status;
  dire("envoi possible (global)", h.can_send_message);
  const entites = Array.isArray(h.entities) ? h.entities : [];
  if (entites.length === 0) {
    console.log("  (aucune entite detaillee — le compte ne signale rien)");
  }
  for (const e of entites) {
    console.log("");
    console.log(`  ── ${e.entity_type ?? "?"}  ${e.id ?? ""}`);
    console.log(`     envoi : ${e.can_send_message ?? "?"}`);
    for (const err of e.errors ?? []) {
      console.log(`     ✗ code ${err.error_code ?? "?"} — ${err.error_description ?? "?"}`);
      if (err.possible_solution) {
        console.log(`       solution proposee par Meta : ${err.possible_solution}`);
      }
    }
  }
} else {
  console.log(`  health_status illisible : ${erreurDe(sante)}`);
  console.log("  (le champ existe depuis v16 ; un refus ici est une piste en soi)");
}

/* ── 3. Les NUMEROS : qualite, statut, palier ────────────────────────────── */

console.log("");
console.log("── 3. Les numeros du compte ─────────────────────────────");
const champsNum = [
  "id",
  "display_phone_number",
  "verified_name",
  "quality_rating",
  "status",
  "name_status",
  "code_verification_status",
  "messaging_limit_tier",
  "throughput",
].join(",");
const nums = await graph(`${WABA}/phone_numbers?fields=${champsNum}`);
if (nums.ok) {
  const liste = nums.corps?.data ?? [];
  if (liste.length === 0) console.log("  aucun numero rattache.");
  for (const n of liste) {
    console.log("");
    console.log(`  ── ${n.display_phone_number ?? "?"}  « ${n.verified_name ?? "?"} »`);
    dire("  statut", n.status, n.status === "CONNECTED" ? "" : "← ANORMAL");
    dire(
      "  qualite",
      n.quality_rating,
      n.quality_rating === "GREEN" || n.quality_rating === "UNKNOWN"
        ? ""
        : "← qualite degradee : Meta bride",
    );
    dire("  nom affiche", n.name_status);
    dire("  verification du code", n.code_verification_status);
    /* Le palier n'est PAS une restriction : c'est le regime d'un compte neuf,
       et il monte tout seul avec l'usage. Le dire evite de le confondre. */
    dire(
      "  palier de messagerie",
      n.messaging_limit_tier,
      "(un palier bas est NORMAL sur un compte neuf, pas une sanction)",
    );
    dire("  debit", n.throughput?.level);
  }
} else {
  console.log(`  lecture refusee : ${erreurDe(nums)}`);
}

/* ── 4. L'entreprise proprietaire ────────────────────────────────────────── */

console.log("");
console.log("── 4. L'entreprise proprietaire ─────────────────────────");
const proprio = await graph(`${WABA}?fields=owner_business_info`);
const business = proprio.corps?.owner_business_info?.id ?? null;
dire("entreprise", `${proprio.corps?.owner_business_info?.name ?? "?"} (${business ?? "?"})`);
if (business) {
  const b = await graph(`${business}?fields=name,verification_status,is_disabled_by_user`);
  if (b.ok) {
    dire(
      "  verification",
      b.corps?.verification_status,
      b.corps?.verification_status === "verified" ? "" : "← a faire pour lever les brides",
    );
    dire("  desactivee par l'utilisateur", String(b.corps?.is_disabled_by_user ?? "?"));
  } else {
    console.log(`  lecture de l'entreprise refusee : ${erreurDe(b)}`);
    console.log("  (attendu si le jeton n'a pas `business_management` — ce n'est PAS");
    console.log("   une restriction du compte, c'est une portee manquante.)");
  }
}

console.log("");
console.log("── Lecture ──────────────────────────────────────────────");
console.log("  Une restriction REELLE apparait en section 2, avec son code et sa");
console.log("  solution. Une entreprise « non verifiee » (section 1 ou 4) bride sans");
console.log("  etre une sanction. Un palier bas (section 3) n'est ni l'un ni l'autre.");
