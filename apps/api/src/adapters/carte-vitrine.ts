import QRCode from "qrcode";
import sharp from "sharp";
import {
  CARTE_HAUTEUR,
  CARTE_LARGEUR,
  composerCarte,
  type DonneesCarte,
  EMPLACEMENTS_PHOTOS,
} from "../domain/bot/carte-vitrine.ts";

/**
 * La rasterisation de la carte-vitrine — ADR 0037.
 *
 * Le domaine compose un SVG ; ici on l'encode en pixels avec `sharp`, deja
 * present pour le pipeline de photos. Les photos d'articles sont **composees
 * par-dessus** plutot qu'encodees en base64 dans le SVG : trois images en
 * base64 gonfleraient la chaine de plusieurs centaines de kilo-octets.
 *
 * ── Le piege des polices ───────────────────────────────────────────────────
 *
 * `node:24-slim` n'embarque AUCUNE police : sans `fonts-dejavu-core` dans
 * l'image, ce module rend une carte aux textes VIDES — en production
 * seulement, et sans erreur. C'est pour cela que le paquet est installe dans
 * le Dockerfile a cote d'`openssl`, et que la definition de terminé de cette
 * tranche est de REGARDER une carte.
 */

/** Une photo d'article a poser, deja lue depuis le stockage. */
export interface PhotoCarte {
  octets: Uint8Array;
}

export interface EntreeCarte {
  donnees: Omit<DonneesCarte, "qrChemin" | "qrTaille">;
  /** Dans l'ordre des articles ; `null` la ou l'article n'a pas de photo. */
  photos: ReadonlyArray<PhotoCarte | null>;
}

/**
 * Le QR, rendu en chemin SVG depuis la MATRICE de modules.
 *
 * On ne decoupe pas le SVG de la bibliotheque : il porte deux chemins — un
 * fond blanc plein, puis les modules en `stroke` et non en `fill`. Extraire
 * « le chemin » y donne le fond, c'est-a-dire un carre noir plein. Constate a
 * la premiere carte rendue. La matrice, elle, est sans ambiguite : un module
 * sombre devient un petit carre, et la composition garde la main sur
 * l'echelle et la couleur.
 *
 * Un echec rend `null` : une carte sans QR vaut mieux que pas de carte.
 */
function qrChemin(lien: string): { chemin: string; taille: number } | null {
  try {
    const qr = QRCode.create(lien, { errorCorrectionLevel: "M" });
    const cote = qr.modules.size;
    const donnees = qr.modules.data;
    let d = "";
    for (let y = 0; y < cote; y++) {
      for (let x = 0; x < cote; x++) {
        if (donnees[y * cote + x]) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return d ? { chemin: d, taille: cote } : null;
  } catch {
    return null;
  }
}

/**
 * Rend la carte en PNG. Le calibrage sous 100 Ko et les trois declinaisons
 * viennent APRES, par `reencoderImage` — un seul chemin de stockage d'images
 * dans le produit (ADR 0016).
 */
export async function rendreCarte(entree: EntreeCarte): Promise<Uint8Array> {
  const qr = qrChemin(entree.donnees.lien);
  const svg = composerCarte({
    ...entree.donnees,
    ...(qr ? { qrChemin: qr.chemin, qrTaille: qr.taille } : {}),
  });

  /* Les photos, redimensionnees a leur emplacement exact. `cover` remplit le
     cadre sans deformer — un pagne etire ne donne envie a personne. */
  const calques = await Promise.all(
    entree.photos.slice(0, EMPLACEMENTS_PHOTOS.length).map(async (photo, i) => {
      const e = EMPLACEMENTS_PHOTOS[i];
      if (!photo || !e) return null;
      try {
        const vignette = await sharp(Buffer.from(photo.octets), { failOn: "error" })
          .resize(e.largeur, e.hauteur, { fit: "cover", position: "centre" })
          .png()
          .toBuffer();
        return { input: vignette, top: e.y, left: e.x };
      } catch {
        /* Une photo illisible laisse son aplat : la carte sort quand meme. */
        return null;
      }
    }),
  );

  const fond = sharp(Buffer.from(svg), { density: 96 }).resize(CARTE_LARGEUR, CARTE_HAUTEUR);
  const composee = calques.filter((c) => c !== null);
  const png = await (composee.length > 0 ? fond.composite(composee) : fond).png().toBuffer();
  return new Uint8Array(png);
}
