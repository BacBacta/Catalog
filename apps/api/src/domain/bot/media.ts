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

export interface LecteurMedia {
  readonly nom: string;
  /** `null` quand le media est introuvable, expire ou refuse — jamais une levee. */
  lire(mediaId: string): Promise<MediaEntrant | null>;
}
