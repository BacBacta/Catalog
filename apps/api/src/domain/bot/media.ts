/**
 * Recuperation d'une photo entrante — INTERFACE seulement, ADR 0034.
 *
 * Meme posture que `ObjectStorage` et `SmsSender` : le domaine declare ce dont
 * il a besoin, l'adaptateur sait qui transporte. Ici le besoin tient en une
 * phrase — d'un identifiant de media, obtenir des octets.
 */

export interface MediaEntrant {
  octets: Uint8Array;
  /** Type ANNONCE par l'operateur. Jamais cru : le pipeline revalide la signature binaire. */
  typeAnnonce: string;
}

/**
 * La photo d'un Flow livree par CDN, chiffree — tache #72. Les cles voyagent
 * dans la reponse du formulaire ; le fichier attend sur le CDN. Tout est en
 * base64 tel que recu : c'est l'adaptateur qui decode et verifie.
 */
export interface PhotoCdnChiffree {
  url: string;
  encryptionKey: string;
  hmacKey: string;
  iv: string;
  plaintextHash: string;
  encryptedHash: string;
}

export interface LecteurMedia {
  readonly nom: string;
  /** `null` quand le media est introuvable, expire ou refuse — jamais une levee. */
  lire(mediaId: string): Promise<MediaEntrant | null>;
  /**
   * La forme CDN chiffree des Flows — FACULTATIVE, comme `accuser` sur
   * l'envoyeur : un lecteur qui ne la sait pas reste un lecteur valide, et
   * l'article se publie sans photo, jamais bloque.
   */
  lireCdn?(photo: PhotoCdnChiffree): Promise<MediaEntrant | null>;
}
