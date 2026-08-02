import { z } from "zod";

/**
 * L'article, et sa chaine d'images.
 *
 * **Le formulaire est reduit au strict minimum : photo, nom, prix.** Rien
 * d'autre n'est obligatoire. Ce n'est pas de la paresse de conception : chaque
 * champ supplementaire est une vendeuse perdue. Elle remplit ce formulaire sur un
 * telephone, entre deux clientes, avec un forfait qui se compte en megaoctets.
 *
 * Le stock existe mais reste optionnel : beaucoup de vendeuses ne le tiennent
 * pas, et le leur imposer les ferait sortir du systeme.
 */

/* ────────────────────────── l'article ────────────────────────── */

/**
 * Le prix est un ENTIER de francs CFA. Le franc n'a pas de sous-unite (ADR
 * 0004) : aucun flottant, aucune division sans arrondi explicite.
 *
 * Un prix a zero est refuse — ce n'est pas un article, c'est une erreur de
 * saisie, et il se propagerait jusqu'au message WhatsApp.
 */
export const priceXafSchema = z
  .number()
  .int("le prix est un nombre entier de francs")
  .positive("le prix doit etre superieur a zero")
  .max(100_000_000, "ce prix depasse ce qu'un article de catalogue peut valoir");

export const productNameSchema = z
  .string()
  .trim()
  .min(2, "le nom fait au moins deux caracteres")
  .max(80, "le nom fait au plus quatre-vingts caracteres");

/**
 * La description, FACULTATIVE et courte — ADR 0033.
 *
 * Elle existe pour la fiche article du bot WhatsApp, ou le nom et le prix ne
 * suffisent pas a vendre un pagne. 300 caracteres : assez pour matiere,
 * dimensions et usage, trop peu pour un roman — la fiche se lit sur un ecran
 * de telephone dans une conversation. Une chaine vide vaut « pas de
 * description » et s'enregistre comme telle.
 */
export const productDescriptionSchema = z
  .string()
  .trim()
  .max(300, "la description fait au plus trois cents caracteres");

export const productDraftSchema = z.object({
  name: productNameSchema,
  priceXaf: priceXafSchema,
  /** Absent = non suivi. Ce n'est pas la meme chose que zero. */
  stock: z.number().int().min(0).max(1_000_000).optional(),
  description: productDescriptionSchema.optional(),
});
export type ProductDraft = z.infer<typeof productDraftSchema>;

/** Modification partielle : au moins un champ, sinon la requete ne veut rien dire. */
export const productPatchSchema = productDraftSchema
  .partial()
  .refine((o) => Object.keys(o).length > 0, "aucun champ a modifier");
export type ProductPatch = z.infer<typeof productPatchSchema>;

/**
 * Reordonnancement : la liste ORDONNEE des identifiants.
 *
 * On envoie l'ordre complet et non un couple (id, position). Deux
 * reordonnancements concurrents laisseraient sinon des positions en double, et
 * l'ordre affiche a la vendeuse ne serait plus celui qu'elle a pose.
 */
export const productOrderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});
export type ProductOrder = z.infer<typeof productOrderSchema>;

/* ────────────────────────── la chaine d'images ────────────────────────── */

/**
 * Plus grand cote de l'image stockee.
 *
 * 640 px, et pas davantage. C'est assez pour une grille de catalogue et une
 * fiche article sur un telephone, y compris a densite doublee sur la vignette.
 * Au-dela, on fait payer a l'acheteuse des pixels qu'elle ne verra pas — et sur
 * un reseau mobile sature, ces pixels sont du temps d'attente.
 */
export const IMAGE_PLUS_GRAND_COTE = 640;

/**
 * Qualite du JPEG produit COTE CLIENT, avant envoi.
 *
 * 0,75 est le point ou l'oeil ne voit plus la difference sur une photo de
 * produit, et ou le poids s'effondre. Ce n'est pas la qualite finale : le
 * serveur re-encode ensuite en AVIF.
 */
export const IMAGE_QUALITE_JPEG = 0.75;

/**
 * Taille maximale acceptee par le serveur.
 *
 * Le client redimensionne avant d'envoyer, donc un envoi conforme fait quelques
 * dizaines de kilooctets. Cette borne est haute exprès : elle laisse passer un
 * envoi depuis un navigateur qui ne sait pas redimensionner — la degradation
 * gracieuse compte — tout en refusant qu'on remplisse le disque.
 */
export const IMAGE_TAILLE_MAX_OCTETS = 8 * 1024 * 1024;

/**
 * Types acceptes en ENTREE.
 *
 * Le type declare par le client n'est jamais cru : cette liste sert a refuser
 * tot et a expliquer clairement, la validation faisant foi etant la signature
 * binaire du fichier. Voir `detecterTypeImage`.
 */
export const IMAGE_TYPES_ACCEPTES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;
export type ImageTypeAccepte = (typeof IMAGE_TYPES_ACCEPTES)[number];

/**
 * Ce que le serveur renvoie apres un televersement reussi.
 *
 * `octets` est le poids de l'objet REELLEMENT stocke. Il n'est pas decoratif :
 * c'est ce qu'on affiche a la vendeuse (« 701 Ko → 80 Ko »), et c'est son
 * forfait data qui est en jeu.
 */
export const imageStockeeSchema = z.object({
  cle: z.string().min(1),
  largeur: z.number().int().positive(),
  hauteur: z.number().int().positive(),
  octets: z.number().int().positive(),
  /** Poids de l'octet-stream recu, pour dire le gain du cote serveur aussi. */
  octetsRecus: z.number().int().positive(),
});
export type ImageStockee = z.infer<typeof imageStockeeSchema>;

/**
 * Poids lisible par un humain, en unites decimales.
 *
 * Kilo-octet decimal (1 000) et non binaire (1 024) : c'est l'unite dans
 * laquelle les operateurs camerounais vendent les forfaits, donc celle dans
 * laquelle une vendeuse compte. Lui afficher des kibi-octets serait exact et
 * inutile.
 */
export function formatOctets(octets: number): string {
  if (octets < 1000) return `${octets} o`;
  if (octets < 1_000_000) return `${Math.round(octets / 100) / 10} Ko`;
  return `${Math.round(octets / 100_000) / 10} Mo`;
}

/**
 * Dimensions cibles apres redimensionnement, a rapport conserve.
 *
 * **On n'agrandit jamais.** Une photo de 300 px portee a 640 px pese davantage
 * et ne montre rien de plus : c'est du forfait depense pour du flou.
 *
 * Le resultat est arrondi, et jamais a zero — une image de 1 px de haut
 * resterait affichable, une image de 0 px ne serait plus une image.
 */
export function dimensionsCibles(
  largeur: number,
  hauteur: number,
  plusGrandCote: number = IMAGE_PLUS_GRAND_COTE,
): { largeur: number; hauteur: number } {
  if (largeur <= 0 || hauteur <= 0) {
    throw new Error(`dimensions invalides : ${largeur}x${hauteur}`);
  }
  const facteur = Math.min(1, plusGrandCote / Math.max(largeur, hauteur));
  return {
    largeur: Math.max(1, Math.round(largeur * facteur)),
    hauteur: Math.max(1, Math.round(hauteur * facteur)),
  };
}
