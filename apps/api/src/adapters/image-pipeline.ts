import { dimensionsCibles, IMAGE_PLUS_GRAND_COTE } from "@catalog/contracts";
import sharp from "sharp";
import { type VerdictImage, validerImage } from "../domain/image.ts";

/**
 * Re-encodage COTE SERVEUR. Le client n'est jamais cru.
 *
 * Le client redimensionne avant d'envoyer, et c'est ce qui economise le forfait
 * de la VENDEUSE. Mais ce travail est fait par du code qu'on ne controle pas :
 * un navigateur ancien peut ne rien faire, une extension peut s'interposer, et un
 * appel direct a l'API peut envoyer n'importe quoi. Le serveur refait donc tout :
 *
 * 1. il **valide la signature binaire** — pas le `Content-Type` declare ;
 * 2. il **applique l'orientation EXIF puis la retire** ;
 * 3. il **redimensionne** a 640 px de plus grand cote, sans jamais agrandir ;
 * 4. il **re-encode** en AVIF et en WebP.
 *
 * **Toutes les metadonnees sont retirees.** Une photo prise au telephone porte
 * ses coordonnees GPS : publier le catalogue publierait l'adresse du domicile de
 * la vendeuse. `sharp` les supprime par defaut — on ne rappelle jamais
 * `withMetadata()`, et un test le verifie.
 */

/**
 * Poids maximal d'un objet stocke.
 *
 * Ce n'est pas une intention, c'est une garantie : l'encodage recommence a
 * qualite plus basse tant que la cible n'est pas tenue. Sans cela, le budget
 * serait vrai sur les photos ordinaires et faux sur les cas difficiles — une
 * image tres bruitee, un tissu a fines rayures, un pagne wax dense. Or c'est
 * exactement ce que vend une vendeuse camerounaise.
 */
export const CIBLE_OCTETS = 100_000;

/**
 * Qualites d'encodage, du meilleur au plus econome.
 *
 * Les deux echelles ne se comparent pas : 45 en AVIF et 72 en WebP donnent une
 * qualite visuelle voisine sur une photo de produit. Les valeurs suivantes ne
 * servent QUE si la premiere depasse la cible ; sur une photo ordinaire, une
 * seule passe suffit.
 */
export const QUALITES_AVIF = [45, 32, 22] as const;

/**
 * L'echelle WebP descend plus bas que celle d'AVIF, et il faut savoir pourquoi :
 * a 640 px, une image de bruit par pixel mesure 144 Ko en WebP a qualite 72 —
 * contre 36 Ko en AVIF a qualite 45. Le WebP a besoin de deux crans de plus pour
 * tenir la meme cible. C'est le prix du repli, et c'est mesure, pas suppose.
 */
export const QUALITES_WEBP = [72, 55, 40, 28] as const;

/**
 * L'echelle JPEG, pour la declinaison destinee aux canaux qui n'acceptent ni
 * AVIF ni WebP — l'API Cloud de WhatsApp en tete (ADR 0032). `mozjpeg` est
 * active : meme qualite visuelle, quelques kilo-octets de moins.
 */
export const QUALITES_JPEG = [78, 62, 46] as const;

/**
 * `effort` de l'encodeur AVIF.
 *
 * 4 sur 9. Au-dela, le gain de poids devient marginal et le temps de calcul
 * explose : un televersement qui prend six secondes fait croire a la vendeuse
 * que ca ne marche pas, et elle recommence — ce qui coute deux fois son forfait.
 */
export const EFFORT_AVIF = 4;

export interface ImageReencodee {
  avif: Uint8Array;
  webp: Uint8Array;
  /** La declinaison des canaux sans AVIF ni WebP (WhatsApp). Jamais servie a la boutique. */
  jpeg: Uint8Array;
  largeur: number;
  hauteur: number;
  /** Type reellement detecte a l'entree. Utile au journal, pas a l'affichage. */
  typeEntree: string;
}

export type ResultatPipeline =
  | { ok: true; image: ImageReencodee }
  | { ok: false; verdict: Extract<VerdictImage, { ok: false }> };

export interface PipelineOptions {
  tailleMax?: number;
  plusGrandCote?: number;
  cibleOctets?: number;
}

/**
 * Encode a la meilleure qualite qui tienne sous la cible.
 *
 * On s'arrete a la premiere qui passe, et on garde la derniere si aucune ne
 * passe : mieux vaut une image un peu lourde qu'un article sans photo. La borne
 * basse de la liste est le garde-fou — descendre indefiniment produirait une
 * bouillie de pixels, ce qui n'aide personne a vendre.
 */
async function sousLaCible(
  qualites: readonly number[],
  cible: number,
  encoder: (qualite: number) => Promise<Buffer>,
): Promise<Buffer> {
  let dernier = await encoder(qualites[0] as number);
  for (const q of qualites.slice(1)) {
    if (dernier.length <= cible) return dernier;
    dernier = await encoder(q);
  }
  return dernier;
}

/**
 * Une seule fonction, deux sorties.
 *
 * Le decodage n'a lieu **qu'apres** la validation : `sharp` sur des octets
 * arbitraires est du travail offert a l'attaquant, et l'echec y serait une
 * exception au lieu d'un refus explicable.
 */
export async function reencoderImage(
  entree: Uint8Array,
  options: PipelineOptions = {},
): Promise<ResultatPipeline> {
  const verdict = options.tailleMax
    ? validerImage(entree, options.tailleMax)
    : validerImage(entree);
  if (!verdict.ok) return { ok: false, verdict };

  // `failOn: "error"` : une image tronquee est refusee, pas devinee. Les bornes
  // de pixels bornent la memoire — une « bombe de decompression » est une petite
  // image compressee qui se decomprime en gigaoctets.
  const source = sharp(Buffer.from(entree), {
    failOn: "error",
    limitInputPixels: 100_000_000,
  });

  const meta = await source.metadata();
  if (!meta.width || !meta.height) {
    return { ok: false, verdict: { ok: false, raison: "format_non_reconnu" } };
  }

  /**
   * `rotate()` sans argument applique l'orientation EXIF. Sans lui, une photo
   * prise en portrait au telephone s'affiche couchee : c'est le defaut le plus
   * visible de toute chaine d'images, et le plus facile a oublier parce qu'il
   * n'apparait pas sur les images de test creees par programme.
   */
  const prepare = source
    .rotate()
    .resize({
      width: options.plusGrandCote ?? IMAGE_PLUS_GRAND_COTE,
      height: options.plusGrandCote ?? IMAGE_PLUS_GRAND_COTE,
      fit: "inside",
      withoutEnlargement: true,
    })
    // Un PNG a fond transparent deviendrait noir en AVIF opaque. Blanc : une
    // photo de produit sur fond transparent est presque toujours un decoupage.
    .flatten({ background: "#ffffff" });

  const cible = options.cibleOctets ?? CIBLE_OCTETS;
  const [avif, webp, jpeg] = await Promise.all([
    sousLaCible(QUALITES_AVIF, cible, (q) =>
      prepare.clone().avif({ quality: q, effort: EFFORT_AVIF }).toBuffer(),
    ),
    sousLaCible(QUALITES_WEBP, cible, (q) => prepare.clone().webp({ quality: q }).toBuffer()),
    sousLaCible(QUALITES_JPEG, cible, (q) =>
      prepare.clone().jpeg({ quality: q, mozjpeg: true }).toBuffer(),
    ),
  ]);

  // Les dimensions annoncees sont celles de l'objet stocke, apres rotation :
  // c'est ce que la boutique publique posera sur `<img width height>` pour tenir
  // le budget de decalage visuel du lot 6.
  const pivote = (meta.orientation ?? 1) >= 5;
  const dims = dimensionsCibles(
    pivote ? meta.height : meta.width,
    pivote ? meta.width : meta.height,
    options.plusGrandCote ?? IMAGE_PLUS_GRAND_COTE,
  );

  return {
    ok: true,
    image: {
      avif: new Uint8Array(avif),
      webp: new Uint8Array(webp),
      jpeg: new Uint8Array(jpeg),
      largeur: dims.largeur,
      hauteur: dims.hauteur,
      typeEntree: verdict.type,
    },
  };
}
