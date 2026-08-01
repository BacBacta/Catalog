#!/usr/bin/env node
/**
 * Instrument de terrain — API SMS Orange.
 *
 * Il répond à deux questions que le code ne peut PAS trancher tout seul, et
 * qui bloquent toutes les deux l'ouverture du parcours vendeuse :
 *
 *   1. Quelle adresse d'expéditeur mon contrat autorise-t-il ?
 *      Elle n'est pas dans le panneau des identifiants de la console — ce n'est
 *      pas un identifiant. Elle relève du contrat SMS souscrit.
 *
 *   2. Suis-je sur `sms-cm` ou sur `sms-onnet-cm` ?
 *      C'est LA question qui décide si les vendeuses MTN reçoivent leur code.
 *      Rien ne la signale en exploitation : `sms-onnet-cm` répond normalement,
 *      les journaux sont propres, et seuls les abonnés Orange sont servis.
 *
 * Il emprunte le MÊME chemin que `apps/api/src/adapters/sms-orange.ts` —
 * mêmes URL, même en-tête, même corps. Un instrument qui prend un raccourci
 * mesure autre chose que la production.
 *
 * ─── MESURE DU 01/08/2026, à ne pas oublier ───────────────────────────────
 *
 * **Orange NE VALIDE PAS l'adresse d'expéditeur.** Un envoi émis depuis
 * `tel:+237000000000` — qui n'est même pas un format camerounais valide — a
 * reçu **HTTP 201 Created**, avec un `resourceURL` et un identifiant de
 * requête. Aucun rejet, aucun avertissement.
 *
 * Deux conséquences, et elles sont structurantes :
 *
 *   • On ne peut PAS valider un numéro candidat par le refus de l'API. Le seul
 *     verdict est un téléphone qui sonne. C'est pour cela que ce script insiste
 *     autant sur « allez VOIR l'appareil ».
 *   • Une mauvaise valeur d'`ORANGE_SENDER_ADDRESS` échoue en SILENCE : 201 en
 *     réponse, journaux propres, code convaincu d'avoir envoyé, vendeuse qui ne
 *     reçoit rien. Le garde de `sms-orange.ts` qui exige la variable est donc la
 *     seule barrière — il n'y en a aucune côté opérateur.
 *
 * Autre observation de la même mesure : cet unique envoi a fait passer le
 * contrat de `availableUnits: 100, requestedUnits: 0` à `30 / 70`. Un forfait
 * d'essai ne se consomme pas message par message ; il réserve par blocs.
 * Comptez large avant de tester.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   node docs/terrain/orange-sms-contrat.mjs
 *       Lecture seule. Jeton, contrats, statistiques. N'envoie rien.
 *
 *   node docs/terrain/orange-sms-contrat.mjs --depuis +237XXXXXXXXX --vers +237YYYYYYYYY
 *       Envoi RÉEL d'un SMS. Coûte un message. Voir l'avertissement plus bas.
 *
 * Les identifiants se lisent dans l'environnement, ou dans `.env` à la racine.
 * Ils ne sont jamais affichés, jamais écrits, jamais recopiés dans une erreur.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.ORANGE_BASE_URL || "https://api.orange.com";
const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/* ────────────────────────── identifiants ────────────────────────── */

/** `.env` n'est pas versionné ; on le lit s'il est là, sans dépendance. */
function depuisDotenv() {
  try {
    const brut = readFileSync(join(RACINE, ".env"), "utf8");
    const out = {};
    for (const ligne of brut.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(ligne);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const dotenv = depuisDotenv();
const lire = (n) => process.env[n] || dotenv[n] || "";

const clientId = lire("ORANGE_CLIENT_ID");
const clientSecret = lire("ORANGE_CLIENT_SECRET");

if (!clientId || !clientSecret) {
  const absents = [
    !clientId && "ORANGE_CLIENT_ID",
    !clientSecret && "ORANGE_CLIENT_SECRET",
  ].filter(Boolean);
  console.error(`\n  Variables absentes : ${absents.join(", ")}.`);
  console.error("  Posez-les dans .env a la racine, ou dans l'environnement :\n");
  console.error("    ORANGE_CLIENT_ID=… ORANGE_CLIENT_SECRET=… node docs/terrain/orange-sms-contrat.mjs\n");
  process.exit(2);
}

/* ────────────────────────── arguments ────────────────────────── */

const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : "";
};
const depuis = arg("--depuis");
const vers = arg("--vers");

if ((depuis && !vers) || (vers && !depuis)) {
  console.error("\n  --depuis et --vers vont ensemble : l'un sans l'autre n'envoie rien.\n");
  process.exit(2);
}

/* ────────────────────────── utilitaires ────────────────────────── */

const titre = (t) => console.log(`\n${"─".repeat(66)}\n  ${t}\n${"─".repeat(66)}`);
const adresseTel = (n) => (n.startsWith("tel:") ? n : `tel:${n}`);

/** Affiche un JSON lisible, tronqué : un contrat peut être volumineux. */
function montrer(v, max = 4000) {
  const s = JSON.stringify(v, null, 2);
  console.log(s.length > max ? `${s.slice(0, max)}\n  […tronqué]` : s);
}

/* ────────────────────────── 1. jeton ────────────────────────── */

titre("1. Authentification");

/**
 * Orange affiche un « en-tete d'autorisation » tout fait dans la console.
 * C'est `base64(clientId:clientSecret)` — le meme secret sous une autre forme.
 * On le reconstruit, exactement comme l'adaptateur, pour qu'il n'y ait pas
 * trois formes du meme secret a poser.
 */
const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

let jeton;
try {
  const r = await fetch(`${BASE}/oauth/v3/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });

  if (!r.ok) {
    // Le corps d'erreur peut refleter l'en-tete envoye, donc le secret.
    // On ne le recopie pas — meme regle que l'adaptateur.
    console.error(`  ✖ Authentification refusee (HTTP ${r.status}).`);
    console.error("    Verifiez ORANGE_CLIENT_ID et ORANGE_CLIENT_SECRET dans la console.");
    process.exit(1);
  }

  const corps = await r.json();
  jeton = corps.access_token;
  if (!jeton) {
    console.error("  ✖ Reponse sans jeton.");
    process.exit(1);
  }
  console.log(`  ✓ Jeton obtenu, valable ${corps.expires_in ?? "?"} s.`);
} catch (e) {
  console.error(`  ✖ Reseau : ${e.message}`);
  process.exit(1);
}

const authentifie = { Authorization: `Bearer ${jeton}`, Accept: "application/json" };

/* ────────────────────────── 2. contrats ────────────────────────── */

titre("2. Contrats souscrits — l'offre, et ce qu'elle autorise");

console.log("  Cherchez deux choses dans ce qui suit :");
console.log("   • le NOM DU SERVICE  → « sms-cm » (tous operateurs) ou");
console.log("     « sms-onnet-cm » (Orange seulement, les vendeuses MTN ne");
console.log("     recevront RIEN, sans que rien ne le signale) ;");
console.log("   • l'ADRESSE D'EXPEDITEUR autorisee → c'est ORANGE_SENDER_ADDRESS.\n");

/**
 * Les chemins d'administration varient selon les pays et les versions de
 * l'offre. On les essaie tous et on rapporte ce que chacun rend, plutot que
 * d'en affirmer un : un 404 est une information, pas un echec du script.
 */
for (const chemin of [
  "/sms/admin/v1/contracts",
  "/sms/admin/v1/statistics",
  "/sms/admin/v1/subscriptions",
]) {
  try {
    const r = await fetch(`${BASE}${chemin}`, { headers: authentifie });
    console.log(`\n  ── GET ${chemin} → HTTP ${r.status}`);
    if (r.ok) {
      montrer(await r.json());
    } else if (r.status === 404) {
      console.log("     absent de cette offre — normal, ce n'est pas une erreur.");
    } else {
      console.log(`     ${(await r.text()).slice(0, 300)}`);
    }
  } catch (e) {
    console.log(`\n  ── GET ${chemin} → reseau : ${e.message}`);
  }
}

/* ────────────────────────── 3. envoi réel ────────────────────────── */

if (!depuis) {
  titre("3. Envoi — non demande");
  console.log("  Aucun SMS envoye. Ce mode est la seule MESURE qui repond");
  console.log("  vraiment a la question « sms-cm ou sms-onnet-cm ? » :\n");
  console.log("    node docs/terrain/orange-sms-contrat.mjs \\");
  console.log("      --depuis +237XXXXXXXXX --vers <UN NUMERO MTN QUE VOUS DETENEZ>\n");
  console.log("  Le numero de destination doit etre MTN. C'est tout l'interet :");
  console.log("  un envoi reussi vers Orange ne prouve rien, les deux offres le font.\n");
  process.exit(0);
}

titre("3. Envoi RÉEL");
console.log(`  De   : ${depuis}`);
console.log(`  Vers : ${vers}`);
console.log("  Ce message est facture et arrive sur un vrai telephone.\n");

try {
  const url = `${BASE}/smsmessaging/v1/outbound/${encodeURIComponent(adresseTel(depuis))}/requests`;
  const nom = lire("ORANGE_SENDER_NAME");

  const r = await fetch(url, {
    method: "POST",
    headers: { ...authentifie, "Content-Type": "application/json" },
    body: JSON.stringify({
      outboundSMSMessageRequest: {
        address: adresseTel(vers),
        senderAddress: adresseTel(depuis),
        ...(nom ? { senderName: nom } : {}),
        outboundSMSTextMessage: {
          message: "Catalog — test de terrain. Aucune action requise.",
        },
      },
    }),
  });

  console.log(`  HTTP ${r.status}`);
  const texte = await r.text();
  try {
    montrer(JSON.parse(texte), 1500);
  } catch {
    console.log(texte.slice(0, 800));
  }

  if (r.ok) {
    console.log("\n  ✓ Accepte par l'API.");
    console.log("    ATTENTION : « accepte » n'est pas « recu ». Si la destination");
    console.log("    etait un numero MTN, allez VOIR le telephone. Une acceptation");
    console.log("    suivie d'une non-reception est la signature de `sms-onnet-cm`.");
    console.log(`\n    Si le SMS arrive : ORANGE_SENDER_ADDRESS="${depuis}"\n`);
  } else {
    /**
     * Mesure du 01/08/2026 : un refus sur l'adresse d'expediteur est
     * IMPROBABLE — Orange accepte meme `tel:+237000000000`. Un echec ici
     * porte donc plutot sur le jeton, le forfait epuise, ou la destination.
     */
    console.log("\n  ✖ Refuse. Regardez le motif : le jeton, le forfait");
    console.log("    epuise et la destination sont les causes probables.");
    console.log("    L'adresse d'expediteur, elle, n'est pas validee par Orange.\n");
    process.exit(1);
  }
} catch (e) {
  console.error(`  ✖ Reseau : ${e.message}`);
  process.exit(1);
}
