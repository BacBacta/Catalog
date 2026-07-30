import { IMAGE_TAILLE_MAX_OCTETS } from "@catalog/contracts";
import { describe, expect, it } from "vitest";
import { detecterTypeImage, validerImage } from "../domain/image.ts";
import { cleOpaque, declinaisons } from "../domain/storage.ts";

/**
 * La reconnaissance d'image, sur des octets construits a la main.
 *
 * Ce qui compte n'est pas qu'un JPEG passe : c'est qu'un fichier qui *dit* etre
 * un JPEG et n'en est pas soit refuse. C'est le vecteur habituel — un script
 * televerse sous un nom d'image, puis servi depuis notre domaine.
 */

const octets = (...v: number[]) => new Uint8Array(v);
const avecTexte = (t: string, decalage: number, longueurTotale = 32) => {
  const a = new Uint8Array(longueurTotale);
  for (let i = 0; i < t.length; i++) a[decalage + i] = t.charCodeAt(i);
  return a;
};

describe("detecterTypeImage", () => {
  it("reconnait le JPEG", () => {
    expect(detecterTypeImage(octets(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe("image/jpeg");
  });

  it("reconnait le PNG sur ses huit octets de signature", () => {
    expect(detecterTypeImage(octets(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe(
      "image/png",
    );
    // Sept octets justes et le huitieme faux : ce n'est pas un PNG.
    expect(detecterTypeImage(octets(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0xff))).toBeNull();
  });

  it("reconnait le WebP par son SOUS-TYPE RIFF, pas par RIFF seul", () => {
    const webp = avecTexte("WEBP", 8);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    expect(detecterTypeImage(webp)).toBe("image/webp");

    // RIFF….WAVE est un son. Sans le controle du sous-type, il passerait.
    const wave = avecTexte("WAVE", 8);
    wave.set([0x52, 0x49, 0x46, 0x46], 0);
    expect(detecterTypeImage(wave)).toBeNull();
  });

  it("distingue AVIF de HEIC — ils partagent le meme conteneur", () => {
    const boite = (marque: string) => {
      const a = avecTexte("ftyp", 4);
      for (let i = 0; i < 4; i++) a[8 + i] = marque.charCodeAt(i);
      return a;
    };
    expect(detecterTypeImage(boite("avif"))).toBe("image/avif");
    // Un iPhone televerse du HEIC : aucun navigateur Android ne l'affichera.
    expect(detecterTypeImage(boite("heic"))).toBe("image/heic");
    expect(detecterTypeImage(boite("mif1"))).toBe("image/heic");
  });

  it("reconnait les formats a refuser, pour pouvoir les nommer", () => {
    expect(detecterTypeImage(octets(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif");
    expect(detecterTypeImage(octets(0x42, 0x4d, 0, 0))).toBe("image/bmp");
    expect(detecterTypeImage(octets(0x49, 0x49, 0x2a, 0x00))).toBe("image/tiff");
  });

  it("ne reconnait RIEN dans un script, une archive ou du texte", () => {
    const cas: Array<[string, Uint8Array]> = [
      ["shebang", new TextEncoder().encode("#!/bin/sh\nrm -rf /\n")],
      ["HTML", new TextEncoder().encode("<html><script>alert(1)</script>")],
      ["PDF", new TextEncoder().encode("%PDF-1.7\n")],
      ["ZIP", octets(0x50, 0x4b, 0x03, 0x04)],
      ["ELF", octets(0x7f, 0x45, 0x4c, 0x46)],
      ["vide", new Uint8Array(0)],
    ];
    for (const [nom, o] of cas) {
      expect(detecterTypeImage(o), nom).toBeNull();
    }
  });

  it("ne deborde pas sur un fichier plus court que la signature", () => {
    for (let n = 0; n < 12; n++) {
      expect(() => detecterTypeImage(new Uint8Array(n))).not.toThrow();
    }
  });
});

describe("validerImage", () => {
  const jpeg = (n: number) => {
    const a = new Uint8Array(n);
    a.set([0xff, 0xd8, 0xff], 0);
    return a;
  };

  it("accepte un JPEG de taille raisonnable", () => {
    expect(validerImage(jpeg(50_000))).toEqual({ ok: true, type: "image/jpeg" });
  });

  it("refuse un fichier vide", () => {
    expect(validerImage(new Uint8Array(0))).toMatchObject({ raison: "fichier_vide" });
  });

  it("contrôle la TAILLE avant le format — analyser 30 Mo pour les refuser est du travail offert", () => {
    // Le contenu est un JPEG parfaitement valide : seule la taille le disqualifie.
    const trop = jpeg(IMAGE_TAILLE_MAX_OCTETS + 1);
    expect(validerImage(trop)).toMatchObject({ raison: "fichier_trop_gros" });
  });

  it("refuse un fichier qui n'est pas une image, quel que soit son nom", () => {
    const script = new TextEncoder().encode("#!/bin/sh\necho pwn\n");
    expect(validerImage(script)).toMatchObject({ raison: "format_non_reconnu" });
  });

  it("NOMME le format quand il le reconnait mais ne l'accepte pas", () => {
    const gif = octets(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0);
    expect(validerImage(gif)).toMatchObject({
      ok: false,
      raison: "format_non_accepte",
      detecte: "image/gif",
    });
  });

  it("refuse le HEIC d'iPhone en le nommant", () => {
    const heic = avecTexte("ftyp", 4);
    for (const [i, c] of [..."heic"].entries()) heic[8 + i] = c.charCodeAt(0);
    expect(validerImage(heic)).toMatchObject({ detecte: "image/heic" });
  });
});

describe("cleOpaque", () => {
  const alea = (n: number) => {
    const a = new Uint8Array(n);
    globalThis.crypto.getRandomValues(a);
    return a;
  };

  it("ne contient ni identifiant, ni nom de fichier", () => {
    const cle = cleOpaque(alea);
    expect(cle).toMatch(/^img\/[0-9a-f]{2}\/[0-9a-f]{32}$/);
  });

  it("le prefixe a deux caracteres reprend les deux premiers de la cle", () => {
    const cle = cleOpaque(() => new Uint8Array(16).fill(0xab));
    expect(cle).toBe(`img/ab/${"ab".repeat(16)}`);
  });

  it("ne se repete pas sur dix mille tirages", () => {
    const vues = new Set<string>();
    for (let i = 0; i < 10_000; i++) vues.add(cleOpaque(alea));
    expect(vues.size).toBe(10_000);
  });
});

describe("declinaisons", () => {
  it("derive AVIF et WebP de la meme cle de base", () => {
    expect(declinaisons("img/ab/cd")).toEqual({ avif: "img/ab/cd.avif", webp: "img/ab/cd.webp" });
  });
});
