#!/usr/bin/env node
/**
 * Genere `dist/_headers` — les en-tetes de securite de la boutique publique.
 *
 * ── Pourquoi un script, et pas un fichier ecrit a la main ──────────────────
 *
 * La politique de securite de contenu de cette boutique doit autoriser des
 * scripts EN LIGNE : Astro emet l'amorce d'hydratation de ses ilots directement
 * dans le HTML, et la boutique inline aussi ses feuilles de style (choix du lot
 * 6 : sur un reseau a forte latence, une requete evitee vaut mieux qu'un cache
 * partage).
 *
 * Deux facons d'autoriser cela :
 *
 * 1. `script-src 'unsafe-inline'` — une ligne, et la politique ne protege plus
 *    de rien : c'est exactement ce contre quoi elle existe ;
 * 2. **l'empreinte de chaque script en ligne**, calculee a la construction.
 *
 * C'est la seconde. Elle n'a de cout qu'ici, et elle rend la politique reelle :
 * un script injecte a l'execution — par une reponse d'API mal echappee, par une
 * dependance compromise — ne porte pas d'empreinte connue, donc le navigateur
 * refuse de l'executer.
 *
 * Le fichier est produit APRES `astro build`, parce que les empreintes ne
 * peuvent pas exister avant le HTML qu'elles decrivent.
 *
 * ── Ce que ce fichier protege, concretement ────────────────────────────────
 *
 * `Referrer-Policy: no-referrer` est l'en-tete le plus important de la
 * boutique, et pas pour une raison generique : **le jeton de suivi de
 * l'acheteuse voyage dans l'URL** (`/suivi/<jeton>`), et c'est lui qui autorise
 * la contre-signature (ADR 0021). Sans cet en-tete, toute requete partant de
 * cette page — une image hebergee ailleurs, un lien sortant — emporterait
 * l'URL complete dans son `Referer`, c'est-a-dire publierait le secret.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIST = process.env.BUDGET_DIST ?? new URL("../dist/", import.meta.url).pathname;

/**
 * L'origine de l'API, vue par le navigateur. Elle entre dans `connect-src` :
 * sans elle, les ilots du recu, du suivi et de la rampe ne pourraient plus
 * joindre l'API, et la boutique tomberait en silence.
 *
 * Vide = meme origine, et `'self'` suffit alors.
 */
const API = (process.env.PUBLIC_API_BASE ?? "").trim();

async function pages(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await pages(p)));
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

const empreinte = (contenu) =>
  `'sha256-${createHash("sha256").update(contenu, "utf8").digest("base64")}'`;

/** Les scripts en ligne d'une page. Un script avec `src` n'en est pas un. */
function scriptsEnLigne(html) {
  const out = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\ssrc\s*=/.test(m[1])) continue;
    // L'empreinte porte sur le contenu EXACT, sans rognage : un octet d'ecart
    // et le navigateur refuse. C'est la propriete qui fait tout l'interet.
    out.push(empreinte(m[2]));
  }
  return out;
}

function politique(empreintes) {
  const connect = API ? `'self' ${API}` : "'self'";
  return [
    "default-src 'none'",
    `script-src 'self' ${empreintes.join(" ")}`.trim(),
    /**
     * Les styles restent en `'unsafe-inline'`, et c'est un arbitrage assume :
     * les composants posent aussi des styles d'ATTRIBUT (`style="…"`), que les
     * empreintes ne couvrent pas sans `'unsafe-hashes'`. Le risque residuel est
     * l'injection de CSS ; il n'a pas de commune mesure avec l'execution de
     * script, qui est ce que ce fichier bloque reellement.
     */
    "style-src 'self' 'unsafe-inline'",
    /** Les photos viennent du CDN media, dont l'hote depend du deploiement. */
    "img-src 'self' https: data:",
    `connect-src ${connect}`,
    "font-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
}

/** Les en-tetes communs a toutes les reponses. */
const COMMUNS = [
  ["X-Content-Type-Options", "nosniff"],
  // Le jeton de suivi voyage dans l'URL : aucun referent ne sort d'ici.
  ["Referrer-Policy", "no-referrer"],
  ["X-Frame-Options", "DENY"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
];

/**
 * Les reecritures dont le produit depend, dans la seule forme qui les decrit.
 *
 * `/v/<code>` et `/suivi/<jeton>` n'existent PAS a la construction : le recu
 * n'est pas ecrit, et il change quand l'acheteuse contresigne. Astro produit une
 * page par route, et ces regles la servent pour toute la famille. Sans elles,
 * `/v/ACDE-4679` rend un 404 — seule `/v/?c=ACDE-4679` fonctionne, et c'est
 * justement la forme dont le produit ne doit PAS dependre (ADR 0021).
 */
const REECRITURES = [
  ["/v/:reste*", "/v/index.html"],
  ["/suivi/:reste*", "/suivi/index.html"],
];

/**
 * **Au-dela de ce nombre d'empreintes distinctes, l'union cesse d'avoir un
 * sens** et il faut repasser a des regles par page.
 *
 * Le seuil n'est pas cosmetique : il signale qu'un ilot s'est mis a embarquer
 * des donnees variables dans son script en ligne — une page par article, donc
 * une empreinte par article. L'union deviendrait alors une liste qui grandit
 * avec le catalogue, et autoriser mille scripts revient a n'en autoriser aucun.
 */
const MAX_EMPREINTES = 20;

const fichiers = (await pages(DIST)).sort();
if (fichiers.length === 0) {
  console.error("dist/ ne contient aucune page : lancez `astro build` d'abord.");
  process.exit(1);
}

/**
 * ── Une seule regle, avec l'UNION des empreintes ───────────────────────────
 *
 * La premiere version emettait une regle par page. Elle etait plus stricte —
 * une empreinte n'y valait que sur la page qui la porte — et **inexploitable** :
 * la boutique construit 357 pages, alors que les hebergeurs statiques plafonnent
 * le nombre de regles d'un `_headers` (cent chez Cloudflare Pages). Le fichier
 * aurait ete tronque en silence, c'est-a-dire qu'une partie des pages serait
 * partie SANS politique, sans que rien ne le dise.
 *
 * L'union est donc un arbitrage, et voici ce qu'il coute exactement : une
 * empreinte valable sur la page d'un article l'est aussi sur la page d'accueil.
 * Ces scripts sont les notres — l'amorce d'hydratation d'Astro —, ils ne
 * portent pas de donnees d'une vendeuse, et le nombre d'empreintes distinctes
 * est verifie ci-dessous pour que cela reste vrai.
 */
const empreintes = new Set();
for (const f of fichiers) {
  for (const e of scriptsEnLigne(await readFile(f, "utf8"))) empreintes.add(e);
}

if (empreintes.size > MAX_EMPREINTES) {
  console.error(
    `${empreintes.size} empreintes distinctes de script en ligne (plafond ${MAX_EMPREINTES}).\n` +
      "Un ilot embarque probablement des donnees variables dans son script en ligne.\n" +
      "Autoriser autant de scripts revient a n'en autoriser aucun : revoir l'ilot,\n" +
      "ou revenir a des regles par page — en verifiant d'abord le plafond de regles\n" +
      "de l'hebergeur.",
  );
  process.exit(1);
}

const csp = politique([...empreintes].sort());
const tous = [...COMMUNS, ["Content-Security-Policy", csp]];

/* ────────────────────────── 1. `_headers` — Netlify, Cloudflare Pages ────── */

const lignes = [
  "# GENERE PAR scripts/entetes.mjs — NE PAS MODIFIER A LA MAIN.",
  "# Les empreintes de la politique de securite de contenu decrivent le HTML",
  "# construit : les reecrire a la main les rendrait fausses au prochain build,",
  "# et une politique fausse casse la page en silence.",
  "#",
  "# Une seule regle : `_headers` s'applique au chemin DEMANDE, et `/v/<code>`",
  "# comme `/suivi/<jeton>` sont servis par reecriture. Un motif `/*` les couvre",
  "# sans qu'on ait a enumerer des chemins qui n'existent pas a la construction.",
  "",
  "/*",
  ...tous.map(([nom, valeur]) => `  ${nom}: ${valeur}`),
];

await writeFile(join(DIST, "_headers"), `${lignes.join("\n")}\n`, "utf8");

/* ────────────────────────── 2. `vercel.json` — Vercel ────────────────────── */

/**
 * **Vercel ne lit NI `_redirects` NI `_headers`.** Ce sont des formats Netlify
 * et Cloudflare Pages. Deployer la boutique sur Vercel sans ce fichier ferait
 * tomber deux choses **sans aucune erreur** :
 *
 * 1. tous les en-tetes de securite, dont `Referrer-Policy: no-referrer` — celui
 *    qui empeche le jeton de suivi de partir dans un `Referer` ;
 * 2. les reecritures `/v/*` et `/suivi/*`, donc les jolies URL de recu et de
 *    suivi. `/v/ACDE-4679` rendrait 404, et seule `/v/?c=ACDE-4679`
 *    fonctionnerait — la forme dont l'ADR 0021 dit que le produit ne doit pas
 *    dependre.
 *
 * ── Il est ecrit DANS `dist/`, et la premiere version se trompait ─────────
 *
 * La premiere version l'ecrivait a la racine du paquet et le versionnait, en
 * supposant que Vercel lit `vercel.json` avant la construction. Deux defauts,
 * tous deux constates :
 *
 * 1. **Le deploiement envoie `apps/shop/dist`.** Vercel lit la configuration a
 *    la racine du repertoire DEPLOYE — le fichier ecrit un cran plus haut
 *    n'aurait jamais ete lu, et la politique ne se serait jamais appliquee.
 *    Sans la moindre erreur : exactement la panne que ce fichier existe pour
 *    empecher.
 * 2. **Son contenu n'est pas reproductible hors du build.** `connect-src`
 *    depend de `PUBLIC_API_BASE`, et les empreintes dependent du HTML produit —
 *    donc de l'instantane du catalogue, que la CI regenere depuis une base
 *    semee. Le comparer par `git diff` en integration continue ne pouvait pas
 *    marcher, et ne marchait pas.
 *
 * C'est donc un ARTEFACT DE CONSTRUCTION, comme `_headers` : produit dans
 * `dist/`, non versionne, regenere a chaque build avec les valeurs de
 * l'environnement qui deploie. Ce que la CI verifie n'est plus l'egalite a un
 * fichier commite, mais la coherence de l'artefact avec le HTML : les
 * empreintes qu'il declare sont celles des scripts reellement emis
 * (`entetes.test.ts`).
 */
const vercel = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  headers: [
    {
      source: "/(.*)",
      headers: tous.map(([key, value]) => ({ key, value })),
    },
  ],
  rewrites: REECRITURES.map(([source, destination]) => ({ source, destination })),
  // Le HTML ne se met pas en cache : le recu change quand l'acheteuse
  // contresigne, et une page de boutique doit refleter un article retire.
  cleanUrls: true,
  trailingSlash: false,
};

await writeFile(join(DIST, "vercel.json"), `${JSON.stringify(vercel, null, 2)}\n`, "utf8");

console.log(
  `_headers et vercel.json ecrits : ${fichiers.length} page(s), ` +
    `${empreintes.size} empreinte(s) de script en ligne.`,
);
