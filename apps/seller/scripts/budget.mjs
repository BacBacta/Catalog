#!/usr/bin/env node
/**
 * Budget de poids de l'ECRAN STATISTIQUES (lot 13).
 *
 * ## Pourquoi un budget sur ce paquet-la, et pas sur l'application entiere
 *
 * `AGENTS.md` fixe un budget a la boutique publique — 30 Ko de JS compresses —
 * parce que c'est une acheteuse qui la telecharge, souvent une fois, souvent sur
 * un forfait compte. L'app vendeuse est un autre objet : elle est derriere
 * authentification, mise en cache par un service worker, et ouverte tous les
 * jours par la meme personne. Elle n'a pas de budget declare, et ce script n'en
 * invente pas un : poser un plafond sur du code deja ecrit reviendrait a choisir
 * un chiffre au doigt mouille, ce que ce depot refuse ailleurs.
 *
 * Ce qui SE mesure, en revanche, c'est la definition de terminé du lot 13 :
 * « aucune bibliotheque de graphiques » et « l'ecran respecte le budget JS ».
 * L'ecran statistiques est charge a la demande, donc il forme son propre paquet,
 * donc il se pese seul.
 *
 * ## D'ou vient le plafond
 *
 * Il n'est pas choisi pour serrer : il est choisi pour etre INFRANCHISSABLE avec
 * une bibliotheque de graphiques, et confortable sans. Les poids compresses
 * publies des candidates habituelles :
 *
 *   uPlot ~10 Ko · Chartist ~11 Ko · Chart.js ~60 Ko · Recharts ~100 Ko
 *
 * La plus legere de toutes depasse deja, a elle seule, le plafond ci-dessous —
 * avant le premier composant de l'ecran. L'ecran entier, lui, tient a 3 Ko :
 * courbe en SVG, barres en CSS, quatre vues tableau, geometrie comprise. Le
 * plafond laisse donc plus du double de marge pour le faire grandir, et refuse
 * la seule chose qu'il doit refuser.
 *
 * Le jour ou ce budget genera un ajout legitime, la reponse n'est pas de le
 * relever en silence : c'est un ADR, comme pour celui de la boutique.
 */

import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = process.env.BUDGET_DIST ?? new URL("../dist/", import.meta.url).pathname;
const ASSETS = join(DIST, "assets");

/** Plafond du paquet de l'ecran statistiques, en octets compresses. */
const STATS_LIMIT = Number(process.env.STATS_JS_LIMIT ?? 8 * 1024);

const ko = (n) => `${(n / 1024).toFixed(2)} Ko`;

try {
  statSync(DIST);
} catch {
  console.error("dist/ introuvable — lancer `pnpm --filter @catalog/seller build` avant.");
  process.exit(1);
}

const fichiers = await readdir(ASSETS);
const gz = (nom) => gzipSync(readFileSync(join(ASSETS, nom))).length;

/**
 * Le paquet de l'ecran statistiques, reconnu a son nom de module.
 *
 * **Son absence est une ERREUR, pas un budget respecte.** Si le decoupage se
 * cassait — un import statique ajoute quelque part, une option de construction
 * changee — le code des graphiques retomberait dans le paquet principal, ce
 * script ne trouverait rien a peser et annoncerait « budget respecte » sur une
 * mesure qui n'a pas eu lieu. C'est le defaut classique du test qui ne teste
 * rien, et il est particulierement traitre ici : tout continuerait de marcher.
 */
const stats = fichiers.filter((f) => /^Statistiques-[\w-]+\.js$/.test(f));

if (stats.length === 0) {
  console.error(
    "\nAucun paquet `Statistiques-*.js` dans dist/assets/.\n" +
      "L'ecran statistiques n'est plus charge a la demande : son code est reparti\n" +
      "dans le paquet principal, et son budget n'est donc plus mesure du tout.\n" +
      "Verifier le `lazy(() => import(...))` de src/App.tsx.",
  );
  process.exit(1);
}
if (stats.length > 1) {
  console.error(`\nPlusieurs paquets Statistiques : ${stats.join(", ")}. dist/ est a nettoyer.`);
  process.exit(1);
}

const nom = stats[0];
const poids = gz(nom);

/* Le paquet principal, pour information SEULEMENT — voir l'en-tete. */
const principal = fichiers.filter((f) => /^index-[\w-]+\.js$/.test(f));
const poidsPrincipal = principal.reduce((s, f) => s + gz(f), 0);

console.log(`\n  Ecran statistiques  ${ko(poids).padStart(9)} / ${ko(STATS_LIMIT)}   — ${nom}`);
console.log(
  `  Paquet principal    ${ko(poidsPrincipal).padStart(9)}             — hors budget, pour information`,
);
console.log("  (la plus legere bibliotheque de graphiques pese ~10 Ko a elle seule)");

if (poids > STATS_LIMIT) {
  console.error(
    `\nBudget depasse : ${ko(poids)} sur ${nom}, plafond ${ko(STATS_LIMIT)}.\n` +
      "Si c'est une bibliotheque de graphiques, la reponse est non — voir AGENTS.md.\n" +
      "Si c'est autre chose, ce plafond ne se releve pas en silence : il faut un ADR.",
  );
  process.exit(1);
}

console.log("\n  Budget respecte.");
