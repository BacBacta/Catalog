/**
 * Stockage d'objets — INTERFACE seulement.
 *
 * Le domaine ne connait ni S3, ni R2, ni MinIO. Meme raison que pour les
 * fournisseurs SMS et les agregateurs de paiement : on doit pouvoir changer de
 * fournisseur sans toucher au metier. Les implementations vivent dans
 * `src/adapters/` et se choisissent par configuration.
 */

export interface ObjetAStocker {
  cle: string;
  corps: Uint8Array;
  contentType: string;
  /**
   * Duree de mise en cache par les intermediaires. Les objets sont immuables —
   * une nouvelle image reçoit une nouvelle cle — donc la valeur peut etre longue.
   */
  cacheControl?: string;
}

export interface ObjectStorage {
  readonly name: string;
  put(objet: ObjetAStocker): Promise<void>;
  /**
   * URL de lecture temporaire.
   *
   * **Les objets ne sont jamais publics.** Une cle opaque ne suffit pas : elle
   * fuit par le journal du navigateur, par le partage d'un lien, par un
   * referrer. Une URL signee expire.
   */
  urlSignee(cle: string, dureeSecondes: number): Promise<string>;
  supprimer(cle: string): Promise<void>;
  /** Poids de l'objet stocke, ou `null` s'il n'existe pas. */
  taille(cle: string): Promise<number | null>;
}

/**
 * Cle d'objet OPAQUE.
 *
 * Elle ne contient ni identifiant de vendeuse, ni identifiant d'article, ni nom
 * de fichier d'origine. Trois raisons, dans l'ordre d'importance :
 *
 * 1. le nom de fichier d'une photo de telephone porte souvent une date et un
 *    numero d'appareil, parfois le nom de la personne ;
 * 2. une cle devinable rend l'URL signee inutile — il suffirait d'enumerer ;
 * 3. une cle qui porte l'identifiant de la vendeuse revele, a qui voit une seule
 *    URL, combien d'articles elle a et depuis quand.
 *
 * Le prefixe a deux caracteres repartit les objets : certains stockages
 * degradent sur un prefixe unique a fort volume.
 */
export function cleOpaque(alea: (n: number) => Uint8Array, prefixe = "img"): string {
  const hex = Array.from(alea(16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefixe}/${hex.slice(0, 2)}/${hex}`;
}

/**
 * Les declinaisons d'une image, derivees de la meme cle de base.
 *
 * **AVIF avec repli WebP.** L'AVIF pese environ trente pour cent de moins a
 * qualite egale, et c'est trente pour cent du forfait de l'acheteuse. Mais il
 * n'est pas universel : le repli WebP n'est pas un luxe, c'est ce qui evite un
 * cadre vide sur un telephone un peu ancien — et le parc camerounais en compte
 * beaucoup.
 *
 * **Le JPEG n'est pas pour les navigateurs.** Il existe pour les canaux qui
 * n'acceptent ni AVIF ni WebP — l'API Cloud de WhatsApp en tete (ADR 0032).
 * La boutique publique ne le sert jamais : elle a mieux.
 */
export function declinaisons(cleDeBase: string): { avif: string; webp: string; jpg: string } {
  return { avif: `${cleDeBase}.avif`, webp: `${cleDeBase}.webp`, jpg: `${cleDeBase}.jpg` };
}
