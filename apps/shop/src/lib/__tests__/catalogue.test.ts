import { describe, expect, it } from "vitest";
import {
  type BoutiqueBrute,
  imagePublique,
  noteMoyenne,
  slugArticle,
  variantes,
  versBoutiquePublique,
} from "../catalogue.ts";

/**
 * La mise en forme du catalogue public.
 *
 * Ces fonctions sont pures : elles transforment un instantane en donnees
 * d'affichage, sans base ni fichier. C'est ce qui permet de tester les cas qu'on
 * ne rencontre pas dans le seed — une note absente, une variante malformee, une
 * image sans dimensions.
 */

const BRUTE: BoutiqueBrute = {
  slug: "chez-tantine",
  nom: "Chez Tantine",
  ville: "Douala",
  quartier: "Bonapriso",
  pointDeRetrait: "Carrefour Elf",
  whatsapp: "+237677123456",
  reversementVerifie: true,
  notes: [5, 4, 5],
  articles: [
    {
      id: "019fb22b-571a-77b8-86be-f263b6b86399",
      nom: "Pagne wax 6 yards",
      prixXaf: 15000,
      stock: 3,
      variantes: ["Rouge", "Bleu"],
      imageCle: "img/ab/0123456789abcdef0123456789abcdef",
      imageLargeur: 640,
      imageHauteur: 480,
    },
  ],
};

describe("slugArticle", () => {
  it("retire les diacritiques — une URL avec « é » se partage mal dans WhatsApp", () => {
    expect(slugArticle("Robe wax première qualité", "abc123456")).toBe(
      "robe-wax-premiere-qualite-123456",
    );
  });

  it("suffixe par l'identifiant : deux « pagne wax » cohabitent", () => {
    const a = slugArticle("Pagne wax", "aaaaaa111111");
    const b = slugArticle("Pagne wax", "bbbbbb222222");
    expect(a).not.toBe(b);
    expect(a.startsWith("pagne-wax-")).toBe(true);
  });

  it("ne rend jamais un identifiant vide, meme sur un nom en emoji", () => {
    expect(slugArticle("🌸🌸", "zzzzzz999999")).toBe("article-999999");
  });

  it("borne la longueur", () => {
    const long = slugArticle("a".repeat(200), "abcdef123456");
    expect(long.length).toBeLessThanOrEqual(48 + 7);
  });
});

describe("imagePublique", () => {
  it("compose les deux declinaisons depuis la cle de base", () => {
    expect(imagePublique("img/ab/cd", 640, 480, "https://media.exemple")).toEqual({
      avif: "https://media.exemple/img/ab/cd.avif",
      webp: "https://media.exemple/img/ab/cd.webp",
      largeur: 640,
      hauteur: 480,
    });
  });

  it("rend null SANS DIMENSIONS — un <img> sans largeur fait sauter la page", () => {
    // Le budget de decalage visuel est de 0,1 : un cadre vide vaut mieux qu'une
    // page qui bouge quand la photo arrive.
    expect(imagePublique("img/ab/cd", null, 480)).toBeNull();
    expect(imagePublique("img/ab/cd", 640, null)).toBeNull();
    expect(imagePublique("img/ab/cd", 0, 480)).toBeNull();
    expect(imagePublique(null, 640, 480)).toBeNull();
  });
});

describe("noteMoyenne", () => {
  it("arrondit au dixieme", () => {
    expect(noteMoyenne([5, 4, 5])).toEqual({ moyenne: 4.7, nombre: 3 });
    expect(noteMoyenne([4, 5])).toEqual({ moyenne: 4.5, nombre: 2 });
  });

  it("rend null sans avis — une boutique neuve n'est pas mal notee", () => {
    // Afficher « 0 sur 5 » a une vendeuse qui commence la condamnerait.
    expect(noteMoyenne([])).toBeNull();
  });

  it("ignore les valeurs hors de l'echelle plutot que de les moyenner", () => {
    expect(noteMoyenne([5, 0, 9, Number.NaN, 4])).toEqual({ moyenne: 4.5, nombre: 2 });
  });
});

describe("variantes", () => {
  it("garde les chaines non vides", () => {
    expect(variantes(["Rouge", "Bleu"])).toEqual(["Rouge", "Bleu"]);
  });

  it("IGNORE une forme inattendue plutot que de la deviner", () => {
    for (const valeur of [null, undefined, "Rouge", 42, { a: 1 }]) {
      expect(variantes(valeur), String(valeur)).toEqual([]);
    }
    expect(variantes(["Rouge", 42, null, "  ", "Bleu"])).toEqual(["Rouge", "Bleu"]);
  });
});

describe("versBoutiquePublique", () => {
  const b = versBoutiquePublique(BRUTE, "https://media.exemple");

  it("expose le numero de CONNEXION comme WhatsApp, jamais le reversement", () => {
    // Le reversement ne se publie jamais : c'est le champ qu'un attaquant vise.
    expect(b.whatsapp).toBe("+237677123456");
    expect(JSON.stringify(b)).not.toContain("payout");
  });

  it("le badge suit la verification du reversement, pas une opinion", () => {
    expect(b.verifiee).toBe(true);
    expect(versBoutiquePublique({ ...BRUTE, reversementVerifie: false }).verifiee).toBe(false);
  });

  it("un stock a zero devient null — ce n'est pas la meme chose", () => {
    // Beaucoup de vendeuses ne tiennent pas de stock : zero en base veut dire
    // « non suivi », et l'afficher comme rupture ferait perdre des ventes.
    const sans = versBoutiquePublique({
      ...BRUTE,
      articles: [{ ...(BRUTE.articles[0] as never), stock: 0 }],
    });
    expect(sans.articles[0]?.stock).toBeNull();
    expect(b.articles[0]?.stock).toBe(3);
  });

  it("survit a des tableaux absents", () => {
    const nu = versBoutiquePublique({
      ...BRUTE,
      notes: undefined as never,
      articles: undefined as never,
    });
    expect(nu.note).toBeNull();
    expect(nu.articles).toEqual([]);
  });
});
