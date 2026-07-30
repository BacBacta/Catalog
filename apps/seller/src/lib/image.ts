import {
  dimensionsCibles,
  IMAGE_PLUS_GRAND_COTE,
  IMAGE_QUALITE_JPEG,
  IMAGE_TAILLE_MAX_OCTETS,
} from "@catalog/contracts";

/**
 * Redimensionnement COTE CLIENT, avant envoi.
 *
 * **C'est le forfait data de la vendeuse.** Une photo de telephone fait deux a
 * cinq megaoctets ; la meme a 640 px de plus grand cote en fait quelques dizaines
 * de kilooctets. Sur un forfait vendu au megaoctet, la difference n'est pas une
 * optimisation, c'est le prix de la mise en ligne d'un article.
 *
 * Le serveur re-encode ensuite de toute facon — il ne croit jamais le client.
 * Ce travail-ci ne sert donc pas la securite : il sert **l'envoi**, qui est la
 * partie lente et payante sur un reseau mobile.
 *
 * `createImageBitmap` avec `imageOrientation: "from-image"` applique
 * l'orientation EXIF. Sans elle, une photo prise en portrait part couchee : c'est
 * le defaut le plus visible d'une chaine d'images, et le plus facile a oublier.
 */

export interface PhotoPreparee {
  fichier: File;
  /** Poids d'origine, pour montrer le gain a la vendeuse. */
  octetsAvant: number;
  octetsApres: number;
  largeur: number;
  hauteur: number;
  /**
   * `true` quand le navigateur n'a pas su redimensionner et que l'original part
   * tel quel. Ce n'est pas une panne : le serveur fera le travail. Mais l'ecran
   * doit pouvoir le dire, parce que l'envoi sera long.
   */
  brut: boolean;
}

export type RefusPhoto = "trop_gros" | "pas_une_image";

export class PhotoRefusee extends Error {
  readonly raison: RefusPhoto;
  constructor(raison: RefusPhoto) {
    super(raison);
    this.name = "PhotoRefusee";
    this.raison = raison;
  }
}

export const MESSAGE_REFUS_PHOTO: Record<RefusPhoto, string> = {
  trop_gros: "Cette photo est trop lourde. Prenez-la a nouveau, ou choisissez-en une autre.",
  pas_une_image: "Ce fichier n'est pas une photo.",
};

/**
 * Prepare une photo pour l'envoi.
 *
 * En cas d'echec du redimensionnement — navigateur ancien, format que le canvas
 * ne sait pas decoder, memoire insuffisante sur un telephone d'entree de gamme —
 * on renvoie **l'original** plutot que de lever. La vendeuse doit pouvoir publier
 * son article ; le serveur, lui, saura re-encoder.
 */
export async function preparerPhoto(
  fichier: File,
  options: { plusGrandCote?: number; qualite?: number } = {},
): Promise<PhotoPreparee> {
  if (!fichier.type.startsWith("image/")) throw new PhotoRefusee("pas_une_image");
  if (fichier.size > IMAGE_TAILLE_MAX_OCTETS) throw new PhotoRefusee("trop_gros");

  const brut = (largeur = 0, hauteur = 0): PhotoPreparee => ({
    fichier,
    octetsAvant: fichier.size,
    octetsApres: fichier.size,
    largeur,
    hauteur,
    brut: true,
  });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(fichier, { imageOrientation: "from-image" });
  } catch {
    return brut();
  }

  try {
    const cible = dimensionsCibles(
      bitmap.width,
      bitmap.height,
      options.plusGrandCote ?? IMAGE_PLUS_GRAND_COTE,
    );

    const toile = document.createElement("canvas");
    toile.width = cible.largeur;
    toile.height = cible.hauteur;
    const ctx = toile.getContext("2d");
    if (!ctx) return brut(bitmap.width, bitmap.height);

    // Lissage de qualite : sans lui, une reduction par quatre cree du moirage sur
    // les tissus a fines rayures — c'est-a-dire sur beaucoup de pagnes.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, cible.largeur, cible.hauteur);

    const blob = await new Promise<Blob | null>((resoudre) => {
      toile.toBlob(resoudre, "image/jpeg", options.qualite ?? IMAGE_QUALITE_JPEG);
    });
    if (!blob) return brut(bitmap.width, bitmap.height);

    return {
      // Le nom d'origine ne part PAS : il porte souvent une date, un numero
      // d'appareil, parfois un prenom. Le serveur n'en fait rien, mais il
      // traverserait le reseau et les journaux pour rien.
      fichier: new File([blob], "photo.jpg", { type: "image/jpeg" }),
      octetsAvant: fichier.size,
      octetsApres: blob.size,
      largeur: cible.largeur,
      hauteur: cible.hauteur,
      brut: false,
    };
  } catch {
    return brut(bitmap.width, bitmap.height);
  } finally {
    // Un bitmap non ferme retient sa memoire decompressee : quelques photos et
    // l'onglet est tue sur un telephone d'entree de gamme.
    bitmap.close();
  }
}
