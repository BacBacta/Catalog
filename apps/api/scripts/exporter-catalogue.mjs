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
 * Usage : node apps/api/scripts/exporter-catalogue.mjs [chemin de sortie]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createPrismaClient } from "@catalog/db";

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
  const vendeuses = await prisma.seller.findMany({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
    select: {
      slug: true,
      businessName: true,
      city: true,
      quartier: true,
      pickupPoint: true,
      phone: true,
      payoutPhoneVerifiedAt: true,
      congesDepuis: true,
      products: {
        where: { archivedAt: null },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          priceXaf: true,
          stock: true,
          variants: true,
          imageKey: true,
          imageWidth: true,
          imageHeight: true,
        },
      },
      // Seuls les avis VERIFIES comptent : une note batie sur des avis non
      // verifies serait exactement la reputation achetable que le produit refuse.
      reviews: { where: { verified: true }, select: { rating: true } },
    },
  });

  const instantane = {
    version: 1,
    boutiques: vendeuses.map((v) => ({
      slug: v.slug,
      nom: v.businessName,
      ville: v.city,
      quartier: v.quartier,
      pointDeRetrait: v.pickupPoint,
      // Le numero de CONNEXION, pas celui de reversement : c'est celui sur lequel
      // la vendeuse discute, et le reversement ne se publie jamais.
      whatsapp: v.phone,
      reversementVerifie: v.payoutPhoneVerifiedAt !== null,
      // Mode conges — ADR 0039. La boutique reste PUBLIEE : ses pages, ses
      // photos et ses avis continuent d'exister, seule la commande se tait.
      // Une boutique retiree de l'instantane perdrait son referencement et le
      // lien deja partage en Statut renverrait sur une page absente.
      enConges: v.congesDepuis !== null,
      notes: v.reviews.map((r) => r.rating),
      articles: v.products.map((p) => ({
        id: p.id,
        nom: p.name,
        prixXaf: p.priceXaf,
        stock: p.stock,
        variantes: Array.isArray(p.variants) ? p.variants : [],
        imageCle: p.imageKey,
        imageLargeur: p.imageWidth,
        imageHauteur: p.imageHeight,
      })),
    })),
  };

  mkdirSync(dirname(SORTIE), { recursive: true });
  writeFileSync(SORTIE, `${JSON.stringify(instantane, null, 2)}\n`, "utf8");

  const articles = instantane.boutiques.reduce((n, b) => n + b.articles.length, 0);
  console.log(`instantane ecrit : ${SORTIE}`);
  console.log(`  ${instantane.boutiques.length} boutiques, ${articles} articles`);
} finally {
  await prisma.$disconnect();
}
