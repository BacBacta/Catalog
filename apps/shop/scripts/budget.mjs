/**
 * Budget de poids de la boutique publique — applique, pas souhaite.
 *
 * Deux seuils, tires du blueprint :
 *   - 30 Ko de JS compresses sur le chemin critique ;
 *   - 120 Ko de poids total en premiere visite.
 *
 * Ce script remplace size-limit parce que size-limit echoue quand un glob ne
 * correspond a aucun fichier — or l'absence totale de JS est ici le resultat
 * NORMAL et souhaite. Un budget qui ne sait pas mesurer zero est inutilisable.
 */

import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = new URL("../dist/", import.meta.url).pathname;
const JS_LIMIT = Number(process.env.JS_LIMIT ?? 30 * 1024);
const TOTAL_LIMIT = Number(process.env.TOTAL_LIMIT ?? 120 * 1024);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const kb = (n) => `${(n / 1024).toFixed(1)} Ko`;

try {
  statSync(DIST);
} catch {
  console.error("dist/ introuvable — lancer `pnpm --filter @catalog/shop build` avant.");
  process.exit(1);
}

const files = await walk(DIST);
let js = 0;
let total = 0;
const rows = [];

/** Astro peut inliner un script dans le HTML : sans cela, une page pourrait
 *  embarquer 500 Ko de JS en ligne et passer le budget « JS » sans broncher. */
function inlineScriptBytes(html) {
  let bytes = 0;
  for (const m of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    bytes += gzipSync(Buffer.from(m[1], "utf8")).length;
  }
  return bytes;
}

for (const f of files) {
  const buf = readFileSync(f);
  const gz = gzipSync(buf).length;
  total += gz;
  if (extname(f) === ".js") {
    js += gz;
  } else if (extname(f) === ".html") {
    const inline = inlineScriptBytes(buf.toString("utf8"));
    js += inline;
    if (inline > 0) rows.push([`${f.replace(DIST, "")} (script en ligne)`, inline]);
  }
  rows.push([f.replace(DIST, ""), gz]);
}

rows.sort((a, b) => b[1] - a[1]);
for (const [name, gz] of rows.slice(0, 10)) {
  console.log(`  ${kb(gz).padStart(9)}  ${name}`);
}

console.log("");
console.log(`  JS    ${kb(js).padStart(9)} / ${kb(JS_LIMIT)}`);
console.log(`  Total ${kb(total).padStart(9)} / ${kb(TOTAL_LIMIT)}`);

const errs = [];
if (js > JS_LIMIT) errs.push(`JS: ${kb(js)} depasse le budget de ${kb(JS_LIMIT)}`);
if (total > TOTAL_LIMIT) errs.push(`Total: ${kb(total)} depasse le budget de ${kb(TOTAL_LIMIT)}`);

if (errs.length) {
  console.error(`\nBudget depasse :\n${errs.map((e) => `  - ${e}`).join("\n")}`);
  console.error("\nCe budget n'est pas negociable sans ADR. Voir AGENTS.md.");
  process.exit(1);
}
console.log("\n  Budget respecte.");
