import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dechiffrerMediaCdn } from "../adapters/media-cdn.ts";
import type { PhotoCdnChiffree } from "../domain/bot/media.ts";

/**
 * Le dechiffrement CDN des Flows — tache #72.
 *
 * La fonction est pure : on chiffre soi-meme un clair connu, exactement
 * comme le protocole le decrit (AES-256-CBC, HMAC-SHA256 tronque a 10
 * octets sur iv ‖ chiffre, empreintes des deux cotes), et on verifie
 * qu'elle rend le clair — puis qu'EACH porte echoue FERME quand on
 * trafique une piece.
 */

function chiffrer(clair: Buffer): { fichier: Buffer; meta: PhotoCdnChiffree } {
  const cle = randomBytes(32);
  const cleHmac = randomBytes(32);
  const iv = randomBytes(16);
  const c = createCipheriv("aes-256-cbc", cle, iv);
  const chiffre = Buffer.concat([c.update(clair), c.final()]);
  const hmac = createHmac("sha256", cleHmac).update(iv).update(chiffre).digest().subarray(0, 10);
  const fichier = Buffer.concat([chiffre, hmac]);
  return {
    fichier,
    meta: {
      url: "https://mmg.whatsapp.net/fichier",
      encryptionKey: cle.toString("base64"),
      hmacKey: cleHmac.toString("base64"),
      iv: iv.toString("base64"),
      plaintextHash: createHash("sha256").update(clair).digest("base64"),
      encryptedHash: createHash("sha256").update(fichier).digest("base64"),
    },
  };
}

const CLAIR = Buffer.from("une photo JPEG imaginaire, assez longue pour plusieurs blocs AES !");

describe("dechiffrerMediaCdn — chaque porte echoue ferme", () => {
  it("rend le clair quand tout est authentique", () => {
    const { fichier, meta } = chiffrer(CLAIR);
    const clair = dechiffrerMediaCdn(new Uint8Array(fichier), meta);
    expect(clair).not.toBeNull();
    expect(Buffer.from(clair as Uint8Array).equals(CLAIR)).toBe(true);
  });

  it("un octet du chiffre retouche : refuse (empreinte du fichier)", () => {
    const { fichier, meta } = chiffrer(CLAIR);
    const trafique = Buffer.from(fichier);
    trafique[3] = (trafique[3] as number) ^ 0xff;
    expect(dechiffrerMediaCdn(new Uint8Array(trafique), meta)).toBeNull();
  });

  it("une empreinte de fichier qui ment : refuse (HMAC ne couvre pas le mensonge)", () => {
    const { fichier, meta } = chiffrer(CLAIR);
    const trafique = Buffer.from(fichier);
    trafique[3] = (trafique[3] as number) ^ 0xff;
    /* L'attaquant recalcule l'empreinte du fichier trafique — le HMAC, lui,
       exige la cle qu'il n'a pas. */
    const metaMenteur = {
      ...meta,
      encryptedHash: createHash("sha256").update(trafique).digest("base64"),
    };
    expect(dechiffrerMediaCdn(new Uint8Array(trafique), metaMenteur)).toBeNull();
  });

  it("une mauvaise cle de dechiffrement : refuse (empreinte du clair)", () => {
    const { fichier, meta } = chiffrer(CLAIR);
    expect(
      dechiffrerMediaCdn(new Uint8Array(fichier), {
        ...meta,
        encryptionKey: randomBytes(32).toString("base64"),
      }),
    ).toBeNull();
  });

  it("du materiel invalide : refuse sans lever", () => {
    const { fichier, meta } = chiffrer(CLAIR);
    expect(dechiffrerMediaCdn(new Uint8Array(fichier), { ...meta, iv: "court" })).toBeNull();
    expect(
      dechiffrerMediaCdn(new Uint8Array(fichier), { ...meta, encryptionKey: "%%%pas-du-b64%%%" }),
    ).toBeNull();
    expect(dechiffrerMediaCdn(new Uint8Array(0), meta)).toBeNull();
    expect(dechiffrerMediaCdn(new Uint8Array([1, 2, 3]), meta)).toBeNull();
  });
});
