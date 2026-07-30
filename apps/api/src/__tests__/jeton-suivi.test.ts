import { describe, expect, it } from "vitest";
import {
  genererJetonSuivi,
  jetonBienForme,
  LONGUEUR_JETON,
  lienDeSuivi,
  lienDeVerification,
} from "../domain/receipt/jeton.ts";

/**
 * Le jeton du lien de suivi.
 *
 * Ce qui se joue ici : **il autorise, la ou le code de verification identifie**.
 * Un jeton devinable rendrait la contre-signature sans valeur — il suffirait
 * d'essayer des liens pour valider le paiement d'autrui.
 */

/** Alea de test : deterministe, donc les assertions le sont aussi. */
const octets =
  (depart: number) =>
  (n: number): Uint8Array =>
    Uint8Array.from({ length: n }, (_, i) => (depart + i * 7) % 256);

describe("genererJetonSuivi", () => {
  it("rend la longueur annoncee", () => {
    expect(genererJetonSuivi(octets(0))).toHaveLength(LONGUEUR_JETON);
  });

  it("n'utilise que des caracteres valides dans une URL", () => {
    // Sans quoi le jeton se ferait encoder au passage et ne correspondrait plus
    // a la valeur en base.
    for (let d = 0; d < 32; d++) {
      const j = genererJetonSuivi(octets(d));
      expect(j, j).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(j), j).toBe(j);
    }
  });

  it("change avec l'alea", () => {
    expect(genererJetonSuivi(octets(0))).not.toBe(genererJetonSuivi(octets(1)));
  });

  it("consomme TOUT l'octet sans rejet ni modulo biaise", () => {
    // L'alphabet fait exactement 64 caracteres : six bits par octet, et chaque
    // caractere sort avec la meme probabilite. Un alphabet de taille non
    // puissance de deux imposerait un rejet, comme pour le code de verification.
    const vus = new Set<string>();
    for (let d = 0; d < 64; d++) for (const c of genererJetonSuivi(octets(d))) vus.add(c);
    expect(vus.size).toBe(64);
  });

  it("respecte une longueur demandee", () => {
    expect(genererJetonSuivi(octets(3), 8)).toHaveLength(8);
  });

  it("porte au moins 128 bits d'entropie", () => {
    // 32 caracteres de base64url = 192 bits. C'est le seul secret du parcours
    // acheteuse : il n'a pas de second facteur et il ne coute rien a rallonger.
    expect(LONGUEUR_JETON * 6).toBeGreaterThanOrEqual(128);
  });
});

describe("jetonBienForme", () => {
  it("accepte un jeton produit par le generateur", () => {
    expect(jetonBienForme(genererJetonSuivi(octets(11)))).toBe(true);
  });

  it("refuse ce qui ne peut correspondre a rien", () => {
    for (const mauvais of ["", "trop-court", `${"a".repeat(LONGUEUR_JETON)}b`, "a".repeat(31)]) {
      expect(jetonBienForme(mauvais), mauvais).toBe(false);
    }
  });

  it("refuse les caracteres hors alphabet", () => {
    // Une saisie fantaisiste ne doit pas atteindre la couche de donnees.
    expect(jetonBienForme(`${"a".repeat(LONGUEUR_JETON - 2)}'; --`)).toBe(false);
    expect(jetonBienForme("a".repeat(LONGUEUR_JETON - 1) + "/")).toBe(false);
  });

  it("ne remplace PAS l'authentification", () => {
    // Un jeton bien forme mais inexistant reste refuse — par la base, sur une
    // colonne UNIQUE. Ce controle n'ecarte que l'absurde.
    expect(jetonBienForme("Z".repeat(LONGUEUR_JETON))).toBe(true);
  });
});

describe("les liens", () => {
  it("le lien de suivi porte le jeton", () => {
    expect(lienDeSuivi("https://catalog.cm", "abc")).toBe("https://catalog.cm/suivi/abc");
  });

  it("le lien de verification porte le code, qui est public", () => {
    expect(lienDeVerification("https://catalog.cm", "ACDE-4679")).toBe(
      "https://catalog.cm/v/ACDE-4679",
    );
  });

  it("tolere une base avec barre oblique finale", () => {
    expect(lienDeSuivi("https://catalog.cm/", "abc")).toBe("https://catalog.cm/suivi/abc");
  });

  it("les deux liens sont DISTINCTS — c'est tout l'enjeu", () => {
    // Le meme lien pour les deux ferait de quiconque a vu un recu un
    // contre-signataire.
    const jeton = genererJetonSuivi(octets(5));
    expect(lienDeSuivi("https://catalog.cm", jeton)).not.toBe(
      lienDeVerification("https://catalog.cm", "ACDE-4679"),
    );
  });
});
