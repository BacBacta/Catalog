#!/usr/bin/env node
/**
 * Exporte un INSTANTANE du catalogue public, pour la construction de la boutique.
 *
 * **Pourquoi un instantane plutot qu'une lecture directe depuis `apps/shop`.**
 * Trois raisons, dans l'ordre :
 *
 * 1. **la regle de dependance.** La boutique publique n'a aucune raison de
 *    connaitre Prisma. Y importer `@catalog/db` ferait entrer un client de base
 *    dans le graphe d'un paquet dont la seule contrainte est de peser moins de
 *    30 Ko de JavaScript ;
 * 2. **la construction reste reproductible et hors ligne.** Le meme instantane
 *    reconstruit le meme site, ce qui est ce qu'on veut d'un site statique servi
 *    depuis le CDN ;
 * 3. **c'est la forme reelle du deploiement.** Publier la boutique, c'est prendre
 *    une photo du catalogue a un instant donne et la pousser au CDN. Autant que
 *    le code le dise.
 *
 * L'instantane est volontairement PROCHE de la base : la mise en forme — noms
 * d'URL, URL d'images, moyenne des avis — vit dans `apps/shop/src/lib`, ou elle
 * est testable sans base.
 *
 * ── Ce script DEMANDE une base ; ce n'est plus le seul chemin ──────────────
 *
 * Depuis l'ADR 0070, l'API sert le meme instantane sur `GET /api/instantane`,
 * et c'est ce chemin-la qu'emprunte le deploiement — pour que `DATABASE_URL`
 * n'ait pas a etre deposee chez GitHub. Voir `recuperer-catalogue.mjs`.
 *
 * Ce script reste le chemin de la CHAINE DE VERIFICATION et du developpement,
 * ou la base est locale et jetable. Le choix des champs, lui, est commun aux
 * deux : il vit dans `src/adapters/instantane-catalogue.ts`.
 *
 * Usage : node apps/api/scripts/exporter-catalogue.mjs [chemin de sortie]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createPrismaClient } from "@catalog/db";
import { construireInstantane } from "../src/adapters/instantane-catalogue.ts";

const SORTIE = resolve(process.argv[2] ?? "apps/shop/src/data/catalogue.json");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL est requise. Sans base, il n'y a pas d'instantane — et on " +
      "n'en fabrique pas un faux : une boutique de demonstration publiee sous le " +
      "nom d'une vraie vendeuse serait pire qu'une page absente.",
  );
  process.exit(1);
}

const prisma = createPrismaClient(url);

try {
  const instantane = await construireInstantane(prisma);

  mkdirSync(dirname(SORTIE), { recursive: true });
  writeFileSync(SORTIE, `${JSON.stringify(instantane, null, 2)}\n`, "utf8");

  const articles = instantane.boutiques.reduce((n, b) => n + b.articles.length, 0);
  console.log(`instantane ecrit : ${SORTIE}`);
  console.log(`  ${instantane.boutiques.length} boutiques, ${articles} articles`);
} finally {
  await prisma.$disconnect();
}
