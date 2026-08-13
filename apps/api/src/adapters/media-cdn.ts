import { createDecipheriv, createHash, createHmac } from "node:crypto";
import type { PhotoCdnChiffree } from "../domain/bot/media.ts";

/**
 * Dechiffrement d'un media de Flow livre par CDN — tache #72, ADR 0079.
 *
 * ── Pourquoi cette forme existe ────────────────────────────────────────────
 *
 * Un Flow SANS endpoint (le notre — mesure du 12/08/2026, ADR 0079) livre la
 * photo du `PhotoPicker` dans la reponse `nfm_reply`, sous DEUX formes
 * documentees par Meta : un `media_id` classique (le chemin deja ecrit), ou
 * un couple `cdn_url` + `encryption_metadata` — le fichier attend sur le CDN,
 * CHIFFRE, et les cles voyagent dans la reponse du formulaire. Le banc du
 * 12/08 a produit des articles SANS photo alors que le formulaire en portait
 * une : c'est cette seconde forme qui arrivait, et personne ne la lisait.
 *
 * ── Le protocole, tel que documente ────────────────────────────────────────
 *
 * Le fichier telecharge se termine par 10 octets de HMAC. Dans l'ordre :
 *
 *   1. `sha256(fichier entier)` doit valoir `encrypted_hash` ;
 *   2. `HMAC-SHA256(hmac_key, iv ‖ chiffre)` tronque a 10 octets doit valoir
 *      la fin du fichier ;
 *   3. le corps se dechiffre en AES-256-CBC(`encryption_key`, `iv`) ;
 *   4. `sha256(clair)` doit valoir `plaintext_hash`.
 *
 * **Chaque etape echoue FERME** : un fichier qu'on ne peut pas authentifier
 * n'entre pas dans le pipeline d'images — rendre `null` coute une photo,
 * dechiffrer sans verifier ferait entrer des octets fabriques. La fonction
 * est PURE (octets vers octets) : elle se teste sans reseau, en chiffrant
 * soi-meme un clair connu.
 */

const LONGUEUR_HMAC_TRONQUE = 10;

const deB64 = (s: string): Buffer | null => {
  try {
    const b = Buffer.from(s, "base64");
    return b.length > 0 ? b : null;
  } catch {
    return null;
  }
};

const memesOctets = (a: Buffer, b: Buffer): boolean => a.length === b.length && a.equals(b);

export function dechiffrerMediaCdn(fichier: Uint8Array, meta: PhotoCdnChiffree): Uint8Array | null {
  const cle = deB64(meta.encryptionKey);
  const cleHmac = deB64(meta.hmacKey);
  const iv = deB64(meta.iv);
  const hashChiffre = deB64(meta.encryptedHash);
  const hashClair = deB64(meta.plaintextHash);
  if (!cle || cle.length !== 32) return null;
  if (!cleHmac || !iv || iv.length !== 16) return null;
  if (!hashChiffre || !hashClair) return null;

  const tout = Buffer.from(fichier);
  if (tout.length <= LONGUEUR_HMAC_TRONQUE) return null;

  /* 1. l'empreinte du fichier ENTIER, HMAC compris. */
  if (!memesOctets(createHash("sha256").update(tout).digest(), hashChiffre)) return null;

  /* 2. le HMAC tronque authentifie iv ‖ chiffre. */
  const chiffre = tout.subarray(0, tout.length - LONGUEUR_HMAC_TRONQUE);
  const hmacRecu = tout.subarray(tout.length - LONGUEUR_HMAC_TRONQUE);
  const hmacCalcule = createHmac("sha256", cleHmac)
    .update(iv)
    .update(chiffre)
    .digest()
    .subarray(0, LONGUEUR_HMAC_TRONQUE);
  if (!memesOctets(Buffer.from(hmacRecu), hmacCalcule)) return null;

  /* 3. AES-256-CBC. Une taille non alignee ou un rembourrage invalide levent :
     c'est un fichier corrompu, et il echoue ferme. */
  let clair: Buffer;
  try {
    const d = createDecipheriv("aes-256-cbc", cle, iv);
    clair = Buffer.concat([d.update(chiffre), d.final()]);
  } catch {
    return null;
  }

  /* 4. l'empreinte du clair — la derniere porte. */
  if (!memesOctets(createHash("sha256").update(clair).digest(), hashClair)) return null;

  return new Uint8Array(clair);
}
