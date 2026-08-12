#!/usr/bin/env node
/**
 * Recupere l'INSTANTANE du catalogue AUPRES DE L'API, pour construire la
 * boutique publique — ADR 0070.
 *
 * ── Pourquoi ce chemin existe a cote de `exporter-catalogue.mjs` ──────────
 *
 * L'autre script lit la base directement. C'est le bon chemin quand la base est
 * a portee — chaine de verification, developpement. Ce n'etait pas tenable pour
 * le DEPLOIEMENT : il aurait fallu deposer `DATABASE_URL` — hote, identifiant,
 * mot de passe de la base de production — dans les secrets GitHub, pour que
 * l'integration continue interroge la base a la place de l'API. La cle du
 * coffre confiee au coursier.
 *
 * Ici, le coursier demande la photo a celui qui a deja la cle.
 *
 * ── Comment il s'identifie, sans aucun secret ─────────────────────────────
 *
 * GitHub signe sur demande un jeton court decrivant l'execution en cours. Il
 * s'obtient depuis le pas lui-meme, avec `permissions: id-token: write`, par
 * deux variables que le runner pose : `ACTIONS_ID_TOKEN_REQUEST_URL` et
 * `ACTIONS_ID_TOKEN_REQUEST_TOKEN`. L'API le verifie avec la cle publique de
 * GitHub. **Rien n'est a poser ni d'un cote ni de l'autre.**
 *
 * Usage : node apps/api/scripts/recuperer-catalogue.mjs [chemin de sortie]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AUDIENCE_INSTANTANE } from "../src/domain/deploiement/jeton-actions.ts";

const SORTIE = resolve(process.argv[2] ?? "apps/shop/src/data/catalogue.json");

function mourir(message) {
  console.error(message);
  process.exit(1);
}

const base = process.env.API_BASE_URL?.trim().replace(/\/+$/, "");
if (!base) {
  mourir(
    "API_BASE_URL est requise : c'est l'API qui sert desormais l'instantane " +
      "du catalogue. Elle est deja exigee par le pas « L'origine de l'API est " +
      "renseignee » du workflow de deploiement.",
  );
}

const urlJeton = process.env.ACTIONS_ID_TOKEN_REQUEST_URL?.trim();
const jetonDemande = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN?.trim();
if (!urlJeton || !jetonDemande) {
  mourir(
    "Aucun jeton d'identite disponible.\n" +
      "Ce script tourne dans GitHub Actions, et le job doit declarer :\n" +
      "\n" +
      "    permissions:\n" +
      "      contents: read\n" +
      "      id-token: write\n" +
      "\n" +
      "Sans cette permission le runner ne pose pas ACTIONS_ID_TOKEN_REQUEST_URL, " +
      "et il n'y a aucun repli : on ne fabrique pas un instantane de " +
      "remplacement, une boutique fausse etant pire qu'une boutique absente.",
  );
}

/** Le jeton signe de CETTE execution, pour l'audience de l'instantane. */
const reponseJeton = await fetch(
  `${urlJeton}&audience=${encodeURIComponent(AUDIENCE_INSTANTANE)}`,
  { headers: { authorization: `Bearer ${jetonDemande}` } },
);
if (!reponseJeton.ok) {
  mourir(`Le jeton d'identite n'a pas ete delivre (HTTP ${reponseJeton.status}).`);
}
const { value: jeton } = await reponseJeton.json();
if (!jeton) mourir("Le jeton d'identite delivre est vide.");

const reponse = await fetch(`${base}/api/instantane`, {
  headers: { authorization: `Bearer ${jeton}`, accept: "application/json" },
});

if (reponse.status === 401 || reponse.status === 403) {
  mourir(
    `L'API refuse le jeton (HTTP ${reponse.status}).\n` +
      "Trois causes possibles, dans l'ordre de probabilite :\n" +
      "  1. SHOP_REBUILD_GITHUB_REPO ne designe pas ce depot cote API ;\n" +
      "  2. l'API deployee est anterieure a l'ADR 0070 ;\n" +
      "  3. l'horloge d'un des deux cotes a plus d'une minute de derive.",
  );
}
if (reponse.status === 404) {
  mourir(
    "L'API ne sert pas /api/instantane (HTTP 404).\n" +
      "La route est DORMANTE sans SHOP_REBUILD_GITHUB_REPO : c'est la meme " +
      "variable que le declencheur de reconstruction, et elle se pose du cote " +
      "de l'API, pas ici.",
  );
}
if (!reponse.ok) mourir(`L'API n'a pas rendu l'instantane (HTTP ${reponse.status}).`);

const instantane = await reponse.json();

/**
 * On verifie la FORME avant d'ecrire. Une passerelle, un cache ou une page
 * d'erreur peuvent rendre 200 avec du HTML ; ecrire ca dans `catalogue.json`
 * ferait echouer la construction trois etapes plus loin, sur un message qui ne
 * dirait pas d'ou vient le probleme.
 */
if (instantane?.version !== 1 || !Array.isArray(instantane.boutiques)) {
  mourir("La reponse de l'API n'a pas la forme d'un instantane (version 1, boutiques[]).");
}

mkdirSync(dirname(SORTIE), { recursive: true });
writeFileSync(SORTIE, `${JSON.stringify(instantane, null, 2)}\n`, "utf8");

const articles = instantane.boutiques.reduce((n, b) => n + b.articles.length, 0);
console.log(`instantane recupere : ${SORTIE}`);
console.log(`  ${instantane.boutiques.length} boutiques, ${articles} articles`);
