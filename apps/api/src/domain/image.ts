import { IMAGE_TAILLE_MAX_OCTETS, type ImageTypeAccepte } from "@catalog/contracts";

/**
 * Reconnaitre une image a sa SIGNATURE BINAIRE, jamais a ce que le client dit.
 *
 * `Content-Type` et l'extension du fichier sont declaratifs : un `.jpg` peut
 * contenir n'importe quoi, et c'est le vecteur habituel — un script televerse
 * sous un nom d'image, servi ensuite depuis notre domaine. La seule chose qui
 * fait foi est le contenu.
 *
 * Ce module est PUR : des octets vers un verdict. Pas de disque, pas de reseau,
 * pas de bibliotheque de traitement d'image. C'est ce qui permet de le tester sur
 * des cas construits a la main, y compris les cas mechants.
 */

export type RefusImage =
  | "fichier_vide"
  | "fichier_trop_gros"
  | "format_non_reconnu"
  /** Le format est une image, mais pas une que nous acceptons (GIF, BMP, TIFF…). */
  | "format_non_accepte";

export type VerdictImage =
  | { ok: true; type: ImageTypeAccepte }
  | { ok: false; raison: RefusImage; detecte?: string };

/** Compare une suite d'octets a une position donnee. */
function commencePar(o: Uint8Array, motif: readonly number[], decalage = 0): boolean {
  if (o.length < decalage + motif.length) return false;
  return motif.every((b, i) => o[decalage + i] === b);
}

/** Les quatre octets ASCII d'une marque de boite ISO-BMFF, ex. « ftyp ». */
function ascii(o: Uint8Array, debut: number, longueur: number): string {
  if (o.length < debut + longueur) return "";
  return String.fromCharCode(...o.subarray(debut, debut + longueur));
}

/**
 * Type detecte, ou `null` si les octets ne designent aucun format connu.
 *
 * Les formats refuses sont nommes quand on les reconnait : dire « ce GIF n'est
 * pas accepte » vaut mieux que « format non reconnu », qui laisse la vendeuse
 * sans piste.
 */
export function detecterTypeImage(octets: Uint8Array): string | null {
  /* JPEG — SOI. */
  if (commencePar(octets, [0xff, 0xd8, 0xff])) return "image/jpeg";

  /* PNG — signature de huit octets. */
  if (commencePar(octets, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";

  /* GIF — reconnu pour etre refuse explicitement. */
  if (commencePar(octets, [0x47, 0x49, 0x46, 0x38])) return "image/gif";

  /* BMP. */
  if (commencePar(octets, [0x42, 0x4d])) return "image/bmp";

  /* TIFF, gros-boutien et petit-boutien. */
  if (commencePar(octets, [0x49, 0x49, 0x2a, 0x00])) return "image/tiff";
  if (commencePar(octets, [0x4d, 0x4d, 0x00, 0x2a])) return "image/tiff";

  /* RIFF….WEBP — le conteneur RIFF porte le sous-type en position 8. */
  if (commencePar(octets, [0x52, 0x49, 0x46, 0x46]) && ascii(octets, 8, 4) === "WEBP") {
    return "image/webp";
  }

  /**
   * AVIF et HEIC partagent le conteneur ISO-BMFF : « ftyp » en position 4, puis
   * une marque de format. Les distinguer compte — un iPhone televerse du HEIC,
   * qu'aucun navigateur Android n'affichera.
   */
  if (ascii(octets, 4, 4) === "ftyp") {
    const marque = ascii(octets, 8, 4);
    if (marque === "avif" || marque === "avis") return "image/avif";
    if (marque === "heic" || marque === "heix" || marque === "hevc" || marque === "mif1") {
      return "image/heic";
    }
    return null;
  }

  return null;
}

/**
 * Verdict complet sur un fichier recu.
 *
 * L'ordre des controles compte : la taille AVANT le format. Analyser trente
 * megaoctets pour conclure qu'ils sont trop gros est du travail offert a
 * l'attaquant.
 */
export function validerImage(
  octets: Uint8Array,
  tailleMax: number = IMAGE_TAILLE_MAX_OCTETS,
): VerdictImage {
  if (octets.length === 0) return { ok: false, raison: "fichier_vide" };
  if (octets.length > tailleMax) return { ok: false, raison: "fichier_trop_gros" };

  const detecte = detecterTypeImage(octets);
  if (!detecte) return { ok: false, raison: "format_non_reconnu" };

  if (
    detecte === "image/jpeg" ||
    detecte === "image/png" ||
    detecte === "image/webp" ||
    detecte === "image/avif"
  ) {
    return { ok: true, type: detecte };
  }
  return { ok: false, raison: "format_non_accepte", detecte };
}

/** Messages destines a la vendeuse. Ils disent quoi faire. */
export const MESSAGE_REFUS_IMAGE: Record<RefusImage, string> = {
  fichier_vide: "Ce fichier est vide. Choisissez une autre photo.",
  fichier_trop_gros:
    "Cette photo est trop lourde. Prenez-la a nouveau, ou choisissez-en une autre.",
  format_non_reconnu: "Ce fichier n'est pas une photo.",
  format_non_accepte: "Ce format de photo n'est pas accepte. Le JPEG et le PNG marchent partout.",
};
