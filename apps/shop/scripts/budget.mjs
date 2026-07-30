#!/usr/bin/env node
/**
 * Budget de poids de la boutique publique — applique, pas souhaite.
 *
 * Deux seuils, tires du blueprint :
 *   - **30 Ko de JS compresses** sur le chemin critique ;
 *   - **120 Ko de charge de document** en premiere visite.
 *
 * Ce script remplace size-limit parce que size-limit echoue quand un glob ne
 * correspond a aucun fichier — or l'absence totale de JS est ici un resultat
 * NORMAL et souhaite. Un budget qui ne sait pas mesurer zero est inutilisable.
 *
 * ## Ce qui est mesure, et pourquoi PAR PAGE
 *
 * La premiere version sommait tout `dist/`. C'etait juste tant que le site
 * tenait en une page, et faux des qu'il en a eu vingt-deux : le total du site
 * n'est pas ce qu'une acheteuse telecharge. Le budget porte sur **une visite**,
 * donc sur **une page** — on mesure chaque page et on retient la pire.
 *
 * Pour chaque page on compte :
 *   - le HTML compresse, styles et scripts en ligne compris ;
 *   - tout le JavaScript ATTEIGNABLE depuis la page, transitivement. Les ilots
 *     `client:visible` sont differes, mais l'acheteuse les telecharge des
 *     qu'elle fait defiler jusqu'au bouton : les compter est la lecture prudente ;
 *   - les feuilles de style externes referencees.
 *
 * **Les images ne sont pas dans la charge de document.** Elles sont du contenu,
 * servies depuis le CDN media, et bornees ailleurs : le lot 5 garantit qu'un
 * objet stocke tient sous 100 Ko. Les melanger rendrait ce budget-ci
 * ininterpretable — une page a six articles ne pourrait jamais tenir.
 *
 * ## Ce qui est interdit tout court
 *
 * **Aucune police telechargee.** AGENTS.md la range parmi les interdits pour la
 * boutique publique : la pile systeme coute zero octet et s'affiche tout de
 * suite. Le controle est ici parce qu'une police ajoutee par megarde passerait
 * sous les seuils sans se faire voir.
 */

import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = process.env.BUDGET_DIST ?? new URL("../dist/", import.meta.url).pathname;
const JS_LIMIT = Number(process.env.JS_LIMIT ?? 30 * 1024);
const TOTAL_LIMIT = Number(process.env.TOTAL_LIMIT ?? 120 * 1024);

const POLICES = new Set([".woff", ".woff2", ".ttf", ".otf", ".eot"]);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const ko = (n) => `${(n / 1024).toFixed(1)} Ko`;
const relatif = (f) => f.slice(DIST.length);

try {
  statSync(DIST);
} catch {
  console.error("dist/ introuvable — lancer `pnpm --filter @catalog/shop build` avant.");
  process.exit(1);
}

const fichiers = await walk(DIST);
const pages = fichiers.filter((f) => extname(f) === ".html");

if (pages.length === 0) {
  console.error("aucune page HTML dans dist/ — le budget ne mesurerait rien.");
  process.exit(1);
}

/** Taille compressee, mise en cache : un actif est partage par vingt pages. */
const cacheGz = new Map();
function gz(chemin) {
  const vu = cacheGz.get(chemin);
  if (vu !== undefined) return vu;
  let taille = 0;
  try {
    taille = gzipSync(readFileSync(chemin)).length;
  } catch {
    taille = 0;
  }
  cacheGz.set(chemin, taille);
  return taille;
}

/**
 * Actifs `_astro/*` cites dans un texte.
 *
 * On lit les references dans le HTML **et** dans le JavaScript : un ilot importe
 * Preact, qui importe ses crochets. Ne regarder que le HTML sous-estimerait le
 * poids reel d'un facteur trois.
 */
function referencesAstro(texte) {
  return new Set([...texte.matchAll(/_astro\/[\w.-]+\.(?:js|css)/g)].map((m) => m[0]));
}

/** Ferme transitivement l'ensemble des actifs atteignables depuis une page. */
function atteignables(html) {
  const vus = new Set();
  const aVoir = [...referencesAstro(html)];
  while (aVoir.length > 0) {
    const actif = aVoir.pop();
    if (vus.has(actif)) continue;
    vus.add(actif);
    if (!actif.endsWith(".js")) continue;
    try {
      const contenu = readFileSync(join(DIST, actif), "utf8");
      for (const suivant of referencesAstro(contenu)) {
        if (!vus.has(suivant)) aVoir.push(suivant);
      }
    } catch {
      // Actif cite mais absent : le signaler plutot que de le compter pour zero
      // en silence.
      console.warn(`  ! actif cite mais absent : ${actif}`);
    }
  }
  return vus;
}

/**
 * Scripts EN LIGNE. Sans ce comptage, une page pourrait embarquer 500 Ko de
 * JavaScript en ligne et passer le budget « JS » sans broncher.
 */
function scriptsEnLigne(html) {
  let octets = 0;
  for (const m of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    octets += gzipSync(Buffer.from(m[1], "utf8")).length;
  }
  return octets;
}

/* ────────────────────────── polices ────────────────────────── */

const polices = fichiers.filter((f) => POLICES.has(extname(f)));
if (polices.length > 0) {
  console.error("\nPolice telechargee dans la boutique publique :");
  for (const f of polices) console.error(`  - ${relatif(f)}`);
  console.error(
    "\nAGENTS.md l'interdit : la pile systeme coute zero octet et s'affiche tout\n" +
      "de suite. Une police de marque est toleree dans l'app vendeuse, pas ici.",
  );
  process.exit(1);
}

/* ────────────────────────── mesure par page ────────────────────────── */

const mesures = [];
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const htmlGz = gz(page);

  let js = scriptsEnLigne(html);
  let css = 0;
  const actifs = atteignables(html);
  for (const actif of actifs) {
    const taille = gz(join(DIST, actif));
    if (actif.endsWith(".js")) js += taille;
    else css += taille;
  }

  mesures.push({
    nom: relatif(page) || basename(page),
    html: htmlGz,
    js,
    css,
    total: htmlGz + js + css,
  });
}

const pireJs = [...mesures].sort((a, b) => b.js - a.js)[0];
const pireTotal = [...mesures].sort((a, b) => b.total - a.total)[0];

console.log(`  ${pages.length} page(s) mesuree(s). Les cinq plus lourdes :\n`);
for (const m of [...mesures].sort((a, b) => b.total - a.total).slice(0, 5)) {
  console.log(
    `  ${ko(m.total).padStart(9)}  (HTML ${ko(m.html)}, JS ${ko(m.js)}, CSS ${ko(m.css)})  ${m.nom}`,
  );
}

console.log("");
console.log(`  JS    ${ko(pireJs.js).padStart(9)} / ${ko(JS_LIMIT)}   — pire : ${pireJs.nom}`);
console.log(
  `  Total ${ko(pireTotal.total).padStart(9)} / ${ko(TOTAL_LIMIT)}   — pire : ${pireTotal.nom}`,
);
console.log("  (images exclues : contenu du CDN media, borne a 100 Ko par objet — lot 5)");

const erreurs = [];
if (pireJs.js > JS_LIMIT) {
  erreurs.push(`JS: ${ko(pireJs.js)} sur ${pireJs.nom} depasse le budget de ${ko(JS_LIMIT)}`);
}
if (pireTotal.total > TOTAL_LIMIT) {
  erreurs.push(
    `Total: ${ko(pireTotal.total)} sur ${pireTotal.nom} depasse le budget de ${ko(TOTAL_LIMIT)}`,
  );
}

if (erreurs.length > 0) {
  console.error(`\nBudget depasse :\n${erreurs.map((e) => `  - ${e}`).join("\n")}`);
  console.error("\nCe budget n'est pas negociable sans ADR. Voir AGENTS.md.");
  process.exit(1);
}
console.log("\n  Budget respecte.");
