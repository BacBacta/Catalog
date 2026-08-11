import { formatXaf } from "@catalog/contracts/money";
import { describe, expect, it } from "vitest";
import {
  ARTICLES_MAX,
  CARTE_HAUTEUR,
  CARTE_LARGEUR,
  composerCarte,
  type DonneesCarte,
  EMPLACEMENTS_PHOTOS,
} from "../carte-vitrine.ts";

/**
 * La composition de la carte-vitrine — ADR 0037. Pure : on lit le SVG produit,
 * sans rendre une seule image. Ce qui se verifie ici est ce qui casse en vrai :
 * l'echappement XML, le debordement des noms longs, et le fait que la carte
 * tienne sans photo comme sans reputation.
 */

const BASE: DonneesCarte = {
  nomBoutique: "Chez Béa",
  ville: "Yaoundé",
  lien: "https://wa.me/237600000000?text=boutique%20chez-bea",
  lienAffiche: "wa.me/237600000000",
  motCle: "boutique chez-bea",
  articles: [{ nom: "Pagne wax 6 yards", prixXaf: 15000, avecPhoto: true }],
};

describe("composerCarte", () => {
  it("rend un SVG au gabarit du Statut, avec le nom, la ville et ce qui se tape", () => {
    const svg = composerCarte(BASE);
    expect(svg).toContain(`width="${CARTE_LARGEUR}"`);
    expect(svg).toContain(`height="${CARTE_HAUTEUR}"`);
    expect(svg).toContain("Chez Béa");
    expect(svg).toContain("Yaoundé");
    /* Ce qui est ECRIT est saisissable ; le lien encode reste au QR. */
    expect(svg).toContain("wa.me/237600000000");
    expect(svg).toContain("boutique chez-bea");
    expect(svg).not.toContain("%20");
  });

  it("ECHAPPE le XML — un nom de boutique est saisi par une vendeuse", () => {
    const svg = composerCarte({ ...BASE, nomBoutique: `Chez "A" & <B>` });
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&lt;B&gt;");
    /* Le nom brut ne doit PAS apparaitre : il casserait le SVG, donc la carte. */
    expect(svg).not.toContain(`Chez "A" & <B>`);
  });

  it("affiche la reputation quand elle existe, l'argument de confiance sinon", () => {
    const avec = composerCarte({ ...BASE, reputation: { note: 4.8, nbVerifies: 12 } });
    expect(avec).toContain("4,8"); // virgule francaise, pas un point
    expect(avec).toContain("12 ventes prouvées");

    const sans = composerCarte({ ...BASE, reputation: { note: null, nbVerifies: 0 } });
    expect(sans).not.toContain("0 vente");
    expect(sans).toContain("reçu vérifiable");
  });

  it("pose l'initiale sur un article sans photo, et rien par-dessus une photo", () => {
    const sansPhoto = composerCarte({
      ...BASE,
      articles: [{ nom: "huile de coco", prixXaf: 3500, avecPhoto: false }],
    });
    expect(sansPhoto).toContain(">H<");

    const avecPhoto = composerCarte(BASE);
    expect(avecPhoto).not.toContain(">P<");
    /* L'aplat est TOUJOURS dessine : il sert de fond, et de secours si la
       photo se revele illisible au moment de composer. */
    const e = EMPLACEMENTS_PHOTOS[0];
    expect(avecPhoto).toContain(`x="${e?.x}" y="${e?.y}"`);
  });

  it("coupe les noms trop longs plutot que de deborder", () => {
    const svg = composerCarte({
      ...BASE,
      nomBoutique: "Boutique aux mille et un pagnes de Douala et environs",
      articles: [
        { nom: "Ensemble complet en pagne wax premium six yards", prixXaf: 15000, avecPhoto: true },
      ],
    });
    expect(svg).toContain("…");
    expect(svg).not.toContain("et environs");
  });

  it("ne montre jamais plus de trois articles, et tient sans aucun", () => {
    const beaucoup = composerCarte({
      ...BASE,
      articles: Array.from({ length: 8 }, (_, i) => ({
        nom: `Article ${i}`,
        prixXaf: 1000 + i,
        avecPhoto: false,
      })),
    });
    for (let i = 0; i < ARTICLES_MAX; i++) expect(beaucoup).toContain(`Article ${i}`);
    expect(beaucoup).not.toContain("Article 3");

    const vide = composerCarte({ ...BASE, articles: [] });
    expect(vide).toContain("Chez Béa");
    expect(vide).toContain("</svg>");
  });

  it("affiche les prix formatés en francs, jamais un nombre nu", () => {
    const svg = composerCarte(BASE);
    expect(svg).toContain(formatXaf(15000));
  });

  it("met le QR a l'echelle de SA grille, et s'en passe sans casser", () => {
    const avec = composerCarte({ ...BASE, qrChemin: "M0 0h1v1h-1z", qrTaille: 29 });
    expect(avec).toContain("M0 0h1v1h-1z");
    expect(avec).toMatch(/scale\(\d+\.\d+\)/);

    const sans = composerCarte(BASE);
    expect(sans).not.toContain("scale(");
    expect(sans).toContain("</svg>");
  });
});
