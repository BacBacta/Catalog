/**
 * Fabrique les declinaisons binaires de `public/favicon.svg` — ADR 0045.
 *
 * La SOURCE est le SVG, ecrit a la main et versionne. Ce script n'en produit
 * que les formats qu'un navigateur reclame encore :
 *
 * - `favicon.ico`        — demande AUTOMATIQUEMENT a la racine par tous les
 *                          navigateurs, meme sans balise <link>. Sans lui, un
 *                          404 par page ouverte.
 * - `apple-touch-icon.png` — l'ecran d'accueil iOS, qui ignore le SVG.
 *
 * Il se lance a la main, pas a la construction : les trois fichiers produits
 * sont versionnes, et le site se construit sans `sharp`.
 *
 *   node apps/site/scripts/icones.mjs
 *
 * `sharp` est resolu depuis `apps/api`, ou il est deja une dependance du
 * pipeline d'images. L'ajouter a ce site ferait payer une dependance native a
 * un paquet qui n'a aucun code.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const ICI = dirname(new URL(import.meta.url).pathname);
const PUBLIC = join(ICI, "..", "public");
const sharp = createRequire(join(ICI, "..", "..", "api", "package.json"))("sharp");

const svg = readFileSync(join(PUBLIC, "favicon.svg"));

/**
 * Emballe un PNG dans un conteneur ICO.
 *
 * Le format accepte un PNG tel quel depuis Vista ; on evite ainsi d'ecrire un
 * bitmap DIB et son masque de transparence a la main. L'en-tete tient en
 * 22 octets : 6 pour le repertoire, 16 pour l'unique entree.
 */
function empaqueterIco(png, cote) {
  const entete = Buffer.alloc(22);
  entete.writeUInt16LE(0, 0); // reserve
  entete.writeUInt16LE(1, 2); // type : 1 = icone
  entete.writeUInt16LE(1, 4); // nombre d'images
  entete.writeUInt8(cote === 256 ? 0 : cote, 6); // largeur — 0 signifie 256
  entete.writeUInt8(cote === 256 ? 0 : cote, 7); // hauteur
  entete.writeUInt8(0, 8); // palette : aucune
  entete.writeUInt8(0, 9); // reserve
  entete.writeUInt16LE(1, 10); // plans
  entete.writeUInt16LE(32, 12); // bits par pixel
  entete.writeUInt32LE(png.length, 14);
  entete.writeUInt32LE(22, 18); // decalage des donnees
  return Buffer.concat([entete, png]);
}

const png32 = await sharp(svg, { density: 384 }).resize(32, 32).png().toBuffer();
writeFileSync(join(PUBLIC, "favicon.ico"), empaqueterIco(png32, 32));

const png180 = await sharp(svg, { density: 384 }).resize(180, 180).png().toBuffer();
writeFileSync(join(PUBLIC, "apple-touch-icon.png"), png180);

console.log(`favicon.ico          ${png32.length + 22} octets`);
console.log(`apple-touch-icon.png ${png180.length} octets`);
