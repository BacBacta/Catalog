#!/usr/bin/env node
/**
 * Sonde CamPay — répond aux questions que la documentation publique ne
 * répond pas. À lancer une fois qu'un compte de démonstration existe.
 *
 *   node apps/api/scripts/campay-probe.mjs
 *
 * Variables attendues (dans .env ou l'environnement) :
 *   CAMPAY_TOKEN    jeton permanent, section APP KEYS
 *   CAMPAY_ENV      DEV (défaut) ou PROD
 *   CAMPAY_TEST_MSISDN  numéro de test, format 237XXXXXXXXX
 *   CAMPAY_TEST_AMOUNT  montant en XAF (défaut 5)
 *
 * Ne touche JAMAIS la production sans CAMPAY_ENV=PROD ET --i-know.
 */

const BASE = { PROD: "https://www.campay.net", DEV: "https://demo.campay.net" };

const env = (process.env.CAMPAY_ENV ?? "DEV").toUpperCase();
const token = process.env.CAMPAY_TOKEN;
const msisdn = process.env.CAMPAY_TEST_MSISDN;
const amount = String(process.env.CAMPAY_TEST_AMOUNT ?? 5);

if (!token) die("CAMPAY_TOKEN manquant. Copiez le jeton permanent depuis APP KEYS.");
if (env === "PROD" && !process.argv.includes("--i-know")) {
  die("Refus d'interroger la PRODUCTION. Relancez avec --i-know si c'est voulu.");
}
const base = BASE[env];

const C = { d: "\x1b[2m", g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", b: "\x1b[1m", x: "\x1b[0m" };
const log = (...a) => console.log(...a);
function die(m) {
  console.error(`${C.r}✗ ${m}${C.x}`);
  process.exit(1);
}
function title(t) {
  log(`\n${C.b}${"─".repeat(4)} ${t} ${"─".repeat(Math.max(0, 56 - t.length))}${C.x}`);
}
function show(o) {
  log(
    C.d +
      JSON.stringify(o, null, 2)
        .split("\n")
        .map((l) => "  " + l)
        .join("\n") +
      C.x,
  );
}

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Token ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* corps non JSON */
  }
  return { ok: res.ok, status: res.status, json, headers: Object.fromEntries(res.headers) };
}

/* ── LA question : une référence d'opérateur se cache-t-elle quelque part ? ── */
const OPERATOR_HINTS =
  /(operator|operateur|financial|momo|external_id|telco|msisdn_ref|partner|third_?party|receipt|txn|trans(action)?_?(id|ref))/i;

function huntOperatorRef(obj, path = "$", found = []) {
  if (obj === null || obj === undefined) return found;
  if (Array.isArray(obj)) {
    for (const [i, v] of obj.entries()) {
      huntOperatorRef(v, `${path}[${i}]`, found);
    }
    return found;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const p = `${path}.${k}`;
      const looksLikeOperatorId = typeof v === "string" && /^\d{9,15}$/.test(v);
      if (OPERATOR_HINTS.test(k) || looksLikeOperatorId) {
        found.push({
          path: p,
          key: k,
          value: v,
          reason: OPERATOR_HINTS.test(k) ? "nom de champ" : "valeur numérique de 9 à 15 chiffres",
        });
      }
      huntOperatorRef(v, p, found);
    }
  }
  return found;
}

const report = { env, base, findings: [] };

/* ═══ 1. Authentification et solde ═══ */
title("1. Authentification et solde");
const bal = await call("GET", "/api/balance/");
if (!bal.ok) die(`Le jeton est refusé (HTTP ${bal.status}). Vérifiez CAMPAY_TOKEN et CAMPAY_ENV.`);
log(`${C.g}✓${C.x} jeton valide sur ${env}`);
show(bal.json);
log(
  `  → le solde est-il ventilé par opérateur ? ${
    bal.json && ("mtn_balance" in bal.json || "orange_balance" in bal.json)
      ? C.g + "oui"
      : C.y + "non"
  }${C.x}`,
);

/* ═══ 2. Historique — le champ le plus intéressant du dossier ═══ */
title("2. POST /api/history/  (endpoint non documenté)");
const today = new Date().toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
const hist = await call("POST", "/api/history/", { start_date: weekAgo, end_date: today });
log(`  HTTP ${hist.status}`);
show(hist.json);
const histHits = huntOperatorRef(hist.json);
if (histHits.length) {
  log(`${C.g}✓ CANDIDATS RÉFÉRENCE OPÉRATEUR :${C.x}`);
  for (const h of histHits) {
    log(`    ${C.b}${h.path}${C.x} = ${JSON.stringify(h.value)}  (${h.reason})`);
  }
  report.findings.push({ source: "history", hits: histHits });
} else {
  log(`${C.y}  aucun champ ressemblant à une référence opérateur${C.x}`);
}

/* ═══ 3. Encaissement de test et statut complet ═══ */
if (!msisdn) {
  title("3. Encaissement — IGNORÉ");
  log(`${C.y}  CAMPAY_TEST_MSISDN non défini. Renseignez-le pour tester collect + status.${C.x}`);
} else {
  title(`3. POST /api/collect/  (${amount} XAF vers ${msisdn})`);
  const col = await call("POST", "/api/collect/", {
    amount,
    currency: "XAF",
    from: msisdn,
    description: "Sonde Swap",
    external_reference: `PROBE-${Date.now()}`,
  });
  log(`  HTTP ${col.status}`);
  show(col.json);
  const ref = col.json?.reference;
  log(
    `  → ussd_code renvoyé ? ${col.json?.ussd_code ? C.g + col.json.ussd_code : C.y + "non"}${C.x}`,
  );

  if (ref) {
    title(`4. GET /api/transaction/${ref}/  — réponse complète`);
    for (const wait of [0, 5, 15, 30]) {
      if (wait) {
        log(`${C.d}  … attente ${wait}s${C.x}`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
      const st = await call("GET", `/api/transaction/${ref}/`);
      log(`  HTTP ${st.status} — statut « ${st.json?.status} »`);
      show(st.json);
      const hits = huntOperatorRef(st.json);
      if (hits.length) {
        log(`${C.g}✓ CANDIDATS RÉFÉRENCE OPÉRATEUR :${C.x}`);
        for (const h of hits) {
          log(`    ${C.b}${h.path}${C.x} = ${JSON.stringify(h.value)}  (${h.reason})`);
        }
        report.findings.push({ source: "status", hits });
      }
      if (st.json?.status && st.json.status !== "PENDING") break;
    }
  }
}

/* ═══ 5. Limites de montant ═══ */
title("5. Limites de montant");
for (const a of ["1", "0", "10000000"]) {
  const r = await call("POST", "/api/collect/", {
    amount: a,
    currency: "XAF",
    from: msisdn ?? "237600000000",
    description: "Sonde limites",
    external_reference: `LIM-${a}`,
  });
  log(
    `  ${String(a).padStart(9)} XAF → HTTP ${r.status}  ${C.d}${JSON.stringify(r.json)?.slice(0, 110)}${C.x}`,
  );
}

/* ═══ Synthèse ═══ */
title("Synthèse");
const found = report.findings.flatMap((f) => f.hits);
if (found.length) {
  log(`${C.g}${C.b}  Une référence d'opérateur semble exposée.${C.x}`);
  log(`  C'est la réponse à la question qui décidait de l'architecture :`);
  log(`  les deux voies de preuve peuvent partager un identifiant.`);
  for (const path of new Set(found.map((h) => h.path))) {
    log(`    ${path}`);
  }
} else {
  log(`${C.y}${C.b}  Aucune référence d'opérateur trouvée.${C.x}`);
  log(`  Le rapprochement avec le SMS devra passer par montant + numéro + horodatage.`);
}
log(`\n${C.d}  Prochaine étape : lancer webhook-capture.mjs et déclencher un paiement,`);
log(`  pour relever la charge utile et l'éventuelle signature.${C.x}\n`);
