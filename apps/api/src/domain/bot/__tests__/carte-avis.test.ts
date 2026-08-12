import { describe, expect, it } from "vitest";
import { composerCarteAvis } from "../carte-avis.ts";
import { CARTE_HAUTEUR, CARTE_LARGEUR } from "../carte-vitrine.ts";

/**
 * La carte d'avis verifie — ADR 0061, rang 3c.
 *
 * N'importe quelle vendeuse peut poster « mes clientes sont contentes ». Aucune
 * ne peut le prouver. Celle-ci le peut — et c'est pour cela que la regle « rien
 * pour un avis non verifie » ne se negocie pas : la carte tire sa valeur du
 * fait qu'elle ne peut pas mentir.
 */

const BASE = {
  nomBoutique: "Chez Bea",
  note: 5,
  nbVerifies: 12,
  lienAffiche: "wa.me/237690000000",
  motCle: "boutique chez-bea chaine",
};

describe("la carte", () => {
  it("garde le gabarit du Statut", () => {
    const svg = composerCarteAvis(BASE);
    expect(svg).toContain(`width="${CARTE_LARGEUR}"`);
    expect(svg).toContain(`height="${CARTE_HAUTEUR}"`);
  });

  it("dessine autant d'etoiles pleines que la note, et cinq en tout", () => {
    for (const note of [1, 3, 5]) {
      const svg = composerCarteAvis({ ...BASE, note });
      const pleines = (svg.match(/★/g) ?? []).length;
      const vides = (svg.match(/☆/g) ?? []).length;
      expect(pleines).toBe(note);
      expect(pleines + vides).toBe(5);
    }
  });

  /** Une note fabriquee ne doit pas produire une carte fabriquee. */
  it("borne une note aberrante au lieu de la dessiner", () => {
    for (const [note, attendu] of [
      [0, 1],
      [9, 5],
      [-3, 1],
      [4.6, 5],
    ] as const) {
      const svg = composerCarteAvis({ ...BASE, note });
      expect((svg.match(/★/g) ?? []).length).toBe(attendu);
    }
  });

  /**
   * Le mot est FACULTATIF partout dans le produit. Sans lui, la carte tient
   * debout sur ses etoiles : la note est le fait, le mot est le confort.
   */
  it("se compose sans le mot de l'acheteuse", () => {
    const svg = composerCarteAvis(BASE);
    expect(svg).toContain("★");
    expect(svg).toContain("Avis vérifié par paiement");
  });

  it("coupe un mot trop long au lieu de deborder la carte", () => {
    const svg = composerCarteAvis({ ...BASE, mot: "très bien ".repeat(60) });
    expect(svg).toContain("…");
    /* Trois lignes au maximum : au-dela, ce n'est plus lisible en vignette. */
    expect((svg.match(/font-size="58"/g) ?? []).length).toBeLessThanOrEqual(3);
  });

  /**
   * Un nom de boutique est saisi par une vendeuse : une esperluette suffirait
   * a produire un SVG invalide, donc une carte vide sans message d'erreur.
   */
  it("echappe le XML du nom et du mot", () => {
    const svg = composerCarteAvis({
      ...BASE,
      nomBoutique: 'Bea & <Co> "la"',
      mot: "super & <parfait>",
    });
    expect(svg).not.toMatch(/<Co>/);
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&lt;");
  });

  it("accorde le singulier sur le compteur", () => {
    expect(composerCarteAvis({ ...BASE, nbVerifies: 1 })).toContain("1 avis vérifié sur");
    expect(composerCarteAvis({ ...BASE, nbVerifies: 2 })).toContain("2 avis vérifiés sur");
  });

  /**
   * La carte porte le mot-cle marque : une commande nee d'un repost se compte
   * comme telle (vocabulaire des canaux, rang 0).
   */
  it("porte le mot-cle a envoyer", () => {
    expect(composerCarteAvis(BASE)).toContain("boutique chez-bea chaine");
  });
});
