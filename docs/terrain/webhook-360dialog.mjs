#!/usr/bin/env node
/**
 * Le relais entrant 360dialog : le voir, et le poser des DEUX côtés.
 *
 * ── Pourquoi cet outil existe ──────────────────────────────────────────────
 *
 * Le 05/08/2026, le bot est resté muet une soirée. L'URL du webhook était
 * juste, mais l'en-tête `Authorization` n'était **pas** enregistré chez
 * 360dialog : leur console a deux endroits pour régler le webhook, et le plus
 * visible — le champ simple de la page *Getting started* — **efface les
 * Custom Headers** quand on l'enregistre. Deux tentatives à la main ont donné
 * `"headers": {}`.
 *
 * Or cet en-tête n'est pas décoratif : les livraisons relayées par 360dialog
 * ne portent AUCUNE signature Meta, donc c'est le seul verrou que la route
 * accepte. Sans lui, chaque livraison rend un 401 — et le symptôme, vu du
 * téléphone, est exactement celui d'un bot éteint.
 *
 * ── Ce que l'outil garantit ────────────────────────────────────────────────
 *
 * Les deux côtés portent la MÊME valeur, parce qu'ils sont posés au même
 * instant depuis la même variable. C'est la seule façon d'éliminer la faute
 * de recopie, qui est la faute la plus probable ici : une chaîne de 64
 * caractères, un « Bearer » ajouté par réflexe, une espace en trop.
 *
 * ── Ce qu'il n'imprime jamais ──────────────────────────────────────────────
 *
 * Ni la clé d'API, ni le secret d'URL, ni la valeur de l'en-tête. On ne voit
 * que des longueurs et des codes de retour — assez pour trancher, jamais assez
 * pour fuir dans un journal de terminal ou une capture d'écran.
 *
 *   D360_API_KEY="…" node docs/terrain/webhook-360dialog.mjs voir
 *   D360_API_KEY="…" node docs/terrain/webhook-360dialog.mjs poser
 *
 * `poser` exige `flyctl` connecté. L'application se règle par `--app`.
 */

import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const BASE = process.env.WABOT_BASE_URL?.trim() || "https://waba-v2.360dialog.io";
const CLE = process.env.D360_API_KEY?.trim();
const args = process.argv.slice(2);
const commande = args[0] ?? "voir";
const app = valeurOption("--app") ?? "catalog-api-preprod";

function valeurOption(nom) {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : undefined;
}

if (!CLE) {
  console.error(
    "D360_API_KEY est absente.\n" +
      "  Hub 360dialog → API Settings → API key → révéler, puis :\n" +
      '  D360_API_KEY="…" node docs/terrain/webhook-360dialog.mjs ' + commande,
  );
  process.exit(1);
}

const entetes = { "D360-API-KEY": CLE, "Content-Type": "application/json" };

/** L'URL sans son dernier segment : celui-ci porte WHATSAPP_ENTRANT_SECRET. */
function urlMasquee(url) {
  try {
    const u = new URL(url);
    const bouts = u.pathname.split("/").filter(Boolean);
    const secret = bouts.pop() ?? "";
    return `${u.origin}/${bouts.join("/")}/‹secret de ${secret.length} car.›`;
  } catch {
    return "‹URL illisible›";
  }
}

async function lireConfig() {
  const r = await fetch(`${BASE}/v1/configs/webhook`, { headers: entetes });
  if (!r.ok) throw new Error(`lecture du webhook refusée : HTTP ${r.status}`);
  return r.json();
}

/** Rejoue ce que 360dialog enverrait, et lit le verdict de NOTRE route. */
async function sonder(url, auth) {
  const h = { "content-type": "application/json" };
  if (auth) h.authorization = auth;
  const r = await fetch(url, { method: "POST", headers: h, body: "{}" });
  const corps = (await r.text()).slice(0, 120);
  const verdict =
    r.status === 200
      ? "✅ la route accepte — l'URL et l'en-tête sont bons"
      : r.status === 404
        ? "❌ le secret de l'URL ne correspond pas à WHATSAPP_ENTRANT_SECRET"
        : r.status === 401
          ? "❌ l'en-tête ne correspond pas à WABOT_WEBHOOK_AUTH"
          : "❌ réponse inattendue";
  return { statut: r.status, corps, verdict };
}

/* ─────────────────────────────── voir ───────────────────────────────────── */

if (commande === "voir") {
  const c = await lireConfig();
  const nbEntetes = Object.keys(c.headers ?? {}).length;
  console.log("URL enregistrée :", c.url ? urlMasquee(c.url) : "‹aucune›");
  console.log("en-têtes        :", nbEntetes ? Object.keys(c.headers).join(", ") : "AUCUN ⚠️");
  if (!nbEntetes) {
    console.log(
      "\n⚠️  Sans en-tête, chaque livraison est refusée (401) et le bot paraît éteint.\n" +
        "    Les livraisons 360dialog ne portent pas de signature Meta : cet en-tête\n" +
        "    est le seul verrou. Lancez « poser » pour le régler des deux côtés.",
    );
  }
  if (c.url) {
    const auth = c.headers?.Authorization ?? c.headers?.authorization;
    const s = await sonder(c.url, auth);
    console.log(`\nsonde POST → HTTP ${s.statut}  ${s.corps}\n${s.verdict}`);
  }
  process.exit(0);
}

/* ────────────────────────────── poser ───────────────────────────────────── */

if (commande !== "poser") {
  console.error(`Commande inconnue : « ${commande} ». Attendu : voir | poser`);
  process.exit(1);
}

const c = await lireConfig();
const url = valeurOption("--url") ?? c.url;
if (!url) {
  console.error(
    "Aucune URL enregistrée et aucune passée en --url.\n" +
      "  L'URL a la forme https://<api>/api/whatsapp/entrant/<WHATSAPP_ENTRANT_SECRET>",
  );
  process.exit(1);
}
console.log("URL retenue :", urlMasquee(url));

/* La valeur est tirée UNE fois et servie aux deux côtés : c'est ce qui
   supprime la faute de recopie, la plus probable des trois possibles. */
const auth = randomBytes(32).toString("hex");
console.log(`nouvelle valeur d'en-tête : ${auth.length} caractères (jamais affichée)`);

console.log(`\n1. pose sur Fly (${app})…`);
try {
  execFileSync("flyctl", ["secrets", "set", "--app", app, `WABOT_WEBHOOK_AUTH=${auth}`], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  console.log("   ✓ secret posé — la machine redémarre");
} catch {
  console.error("   ✗ flyctl a refusé. Connecté ? `flyctl auth login`");
  process.exit(1);
}

/* Poser le secret redémarre la machine. Poster la configuration avant qu'elle
   soit revenue ferait échouer la sonde pour une raison qui n'est pas la
   bonne — on attend que /health réponde. */
process.stdout.write("2. attente du redémarrage");
const racine = new URL(url).origin;
let debout = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  process.stdout.write(".");
  try {
    const r = await fetch(`${racine}/health`);
    if (r.ok) {
      debout = true;
      break;
    }
  } catch {
    /* la machine n'écoute pas encore */
  }
}
console.log(debout ? " ✓ debout" : " ✗ toujours pas de réponse — on continue quand même");

console.log("\n3. enregistrement chez 360dialog…");
const r = await fetch(`${BASE}/v1/configs/webhook`, {
  method: "POST",
  headers: entetes,
  body: JSON.stringify({ url, headers: { Authorization: auth } }),
});
console.log(`   HTTP ${r.status}`);
if (!r.ok) {
  console.error("   ✗ 360dialog a refusé la configuration.");
  process.exit(1);
}

console.log("\n4. relecture chez 360dialog…");
const apres = await lireConfig();
const posees = Object.keys(apres.headers ?? {});
console.log(posees.length ? `   ✓ en-têtes enregistrés : ${posees.join(", ")}` : "   ✗ TOUJOURS aucun en-tête");

console.log("\n5. sonde de bout en bout…");
const s = await sonder(url, auth);
console.log(`   HTTP ${s.statut}  ${s.corps}`);
console.log(`   ${s.verdict}`);

console.log(
  s.statut === 200
    ? "\nLe relais est prêt. Écrivez « Hi » au numéro du canal : le bot doit répondre."
    : "\nLe relais n'est pas prêt — voir le verdict ci-dessus.",
);
