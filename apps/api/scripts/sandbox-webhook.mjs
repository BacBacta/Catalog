#!/usr/bin/env node
/**
 * Re-pose le webhook entrant chez 360dialog — instrument de terrain.
 *
 * ── Pourquoi ce script existe ──────────────────────────────────────────────
 *
 * La session du bac a sable expire. On la reveille en envoyant `START` au
 * numero 360dialog depuis le telephone enregistre — et **la cle d'API change**.
 * Constate le 04/08/2026 : apres un `START`, `GET /v1/configs/webhook` rend
 * `url: null`. La configuration n'a pas survecu.
 *
 * Ce qui casse alors n'est pas evident, parce que les deux sens tombent pour
 * des raisons DIFFERENTES :
 *
 * - le **sortant** meurt parce que `WABOT_API_KEY` porte l'ancienne cle ;
 * - l'**entrant** meurt parce que la configuration du webhook est vide.
 *
 * Reparer l'un sans l'autre donne un bot a moitie muet, et le diagnostic coute
 * une soiree. La marche a suivre est donc, dans cet ordre :
 *
 *   1. `flyctl secrets set WABOT_API_KEY=<la nouvelle cle>`  (la machine redemarre)
 *   2. `flyctl ssh console --app <app> -C "node /app/apps/api/scripts/sandbox-webhook.mjs"`
 *
 * ── Pourquoi il tourne DANS la machine ─────────────────────────────────────
 *
 * L'URL entrante porte `WHATSAPP_ENTRANT_SECRET`, et l'en-tete porte
 * `WABOT_WEBHOOK_AUTH`. Les deux sont des secrets de production. En tournant
 * la ou ils vivent deja, ce script les lit dans son propre environnement :
 * ils ne transitent ni par un argument de ligne de commande — visible dans
 * `ps` —, ni par l'historique d'un shell, ni par un presse-papiers.
 *
 * Rien de sensible n'est ECRIT sur la sortie : l'URL est masquee avant d'etre
 * affichee. Un journal de deploiement se relit, se copie et se colle.
 *
 * Usage :
 *   node apps/api/scripts/sandbox-webhook.mjs          # pose, puis relit
 *   node apps/api/scripts/sandbox-webhook.mjs --lire   # relit seulement
 */

const cle = process.env.WABOT_API_KEY?.trim();
const base = process.env.WABOT_BASE_URL?.trim()?.replace(/\/+$/, "");
const secret = process.env.WHATSAPP_ENTRANT_SECRET?.trim();
const auth = process.env.WABOT_WEBHOOK_AUTH?.trim();
/**
 * L'API elle-meme, telle que 360dialog doit l'atteindre. `BASE_API_PUBLIQUE`
 * si elle est posee, sinon le nom d'application Fly — c'est ce que le bac a
 * sable appelle, pas ce que la machine croit etre.
 */
const moi =
  process.env.BASE_API_PUBLIQUE?.trim()?.replace(/\/+$/, "") ||
  (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : "");

const lireSeulement = process.argv.includes("--lire");

const manquants = [
  ["WABOT_API_KEY", cle],
  ["WABOT_BASE_URL", base],
  ...(lireSeulement
    ? []
    : [
        ["WHATSAPP_ENTRANT_SECRET", secret],
        ["WABOT_WEBHOOK_AUTH", auth],
        ["BASE_API_PUBLIQUE ou FLY_APP_NAME", moi],
      ]),
]
  .filter(([, v]) => !v)
  .map(([n]) => n);

if (manquants.length > 0) {
  console.error(`Variables absentes de l'environnement : ${manquants.join(", ")}`);
  console.error("Ce script se lance DANS la machine, la ou les secrets vivent deja.");
  process.exit(1);
}

/** L'URL, sans son secret. Ce qui s'affiche doit pouvoir se coller n'importe ou. */
const masquer = (u) =>
  typeof u === "string" ? u.replace(/\/entrant\/[^/?#]+/, "/entrant/<secret>") : String(u);

async function lire() {
  const r = await fetch(`${base}/v1/configs/webhook`, { headers: { "D360-API-KEY": cle } });
  if (!r.ok) {
    /* Le corps d'erreur d'un fournisseur n'est jamais recopie tel quel : il a
       deja porte des identifiants ailleurs. Le statut suffit a decider. */
    console.error(`Lecture refusee : HTTP ${r.status}. La cle est-elle a jour ?`);
    process.exit(1);
  }
  return await r.json();
}

if (!lireSeulement) {
  const r = await fetch(`${base}/v1/configs/webhook`, {
    method: "POST",
    headers: { "D360-API-KEY": cle, "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `${moi}/api/whatsapp/entrant/${secret}`,
      headers: { Authorization: auth },
    }),
  });
  if (!r.ok) {
    console.error(`Pose refusee : HTTP ${r.status}.`);
    process.exit(1);
  }
  console.log("Webhook pose.");
}

const config = await lire();
console.log(`url      : ${masquer(config.url)}`);
console.log(`en-tetes : ${config.headers ? "poses" : "AUCUN"}`);

/* Le verdict, en une ligne : c'est ce qu'on relit six mois plus tard. */
if (!config.url) {
  console.log("\n⚠️  L'entrant est MORT : aucune URL configuree.");
  process.exit(2);
}
console.log("\n✅ L'entrant est arme. Le sortant depend, lui, de WABOT_API_KEY.");
