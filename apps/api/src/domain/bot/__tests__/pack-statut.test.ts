import { formatXaf } from "@catalog/contracts/money";
import { slugArticle } from "@catalog/contracts/slug";
import { describe, expect, it } from "vitest";
import { lireEntreeBoutique } from "../entree-boutique.ts";
import { consigneDuPack, packStatut } from "../pack-statut.ts";

/**
 * Le pack statut — ADR 0061, rang 3a.
 *
 * Le principe qui gouverne tout le rang : **Catalog fabrique, la vendeuse
 * poste.** Aucun outil legitime ne publie un Statut a sa place. Tout ce qu'on
 * peut faire est rendre le geste si court qu'elle le fasse.
 */

const ARTICLE = { nom: "Robe wax grande taille", prixXaf: 18_500, slugArticle: "robe-wax-a1b2c3" };

describe("la legende", () => {
  const pack = packStatut({
    nomBoutique: "Chez Bea",
    slug: "chez-bea",
    article: ARTICLE,
    lien: "https://wa.me/237690000000?text=boutique%20chez-bea%20statut",
  });

  it("porte l'article, le prix et la boutique", () => {
    expect(pack.legende).toContain("Robe wax grande taille");
    expect(pack.legende).toContain(formatXaf(18_500));
    expect(pack.legende).toContain("Chez Bea");
  });

  /**
   * **Ni rarete, ni urgence, ni gratuite.** Le stock ne se decompte pas tout
   * seul (ADR 0038) et le transfert hors reseau coute 2,22 % (AGENTS.md §2).
   * Une legende qui mentirait la-dessus se retournerait contre la vendeuse,
   * devant ses propres clientes.
   */
  it("ne promet ni rarete, ni urgence, ni gratuite", () => {
    for (const interdit of [
      "plus que",
      "dernier",
      "derniers",
      "aujourd'hui seulement",
      "vite",
      "gratuit",
      "offert",
      "promo",
    ]) {
      expect(pack.legende.toLowerCase()).not.toContain(interdit);
    }
  });

  /**
   * Le lien est un CONFORT : certains forfaits font echouer les liens externes
   * (AGENTS.md §2). Sans lui, la legende reste commandable.
   */
  it("reste autosuffisante sans lien : le mot-cle prend le relais", () => {
    const sans = packStatut({
      nomBoutique: "Chez Bea",
      slug: "chez-bea",
      article: ARTICLE,
      lien: null,
    });
    expect(sans.legende).toContain(sans.motCle);
    expect(sans.legende).toContain("Robe wax grande taille");
    expect(sans.legende).toContain(formatXaf(18_500));
  });
});

describe("le mot-cle", () => {
  const pack = packStatut({
    nomBoutique: "Chez Bea",
    slug: "chez-bea",
    article: ARTICLE,
    lien: null,
  });

  /**
   * **C'est le canal qui rend le rang 3 mesurable.** Sans marque `statut`, une
   * commande nee d'un Statut serait indistinguable des autres, et la vendeuse
   * ne saurait jamais lequel de ses gestes rapporte.
   */
  it("porte le canal statut, et se relit tel quel", () => {
    expect(pack.motCle).toContain("statut");
    const lu = lireEntreeBoutique(pack.motCle);
    expect(lu?.slug).toBe("chez-bea");
    expect(lu?.canal).toBe("statut");
  });
});

describe("la consigne et la legende ne se melangent pas", () => {
  /**
   * La consigne reste entre nous, la legende part chez les clientes. Les
   * confondre ferait poster a la vendeuse une phrase qui lui etait destinee.
   */
  it("la consigne parle a la vendeuse, la legende a ses clientes", () => {
    const c = consigneDuPack();
    expect(c).toContain("Statut");
    const pack = packStatut({
      nomBoutique: "Chez Bea",
      slug: "chez-bea",
      article: ARTICLE,
      lien: null,
    });
    expect(pack.legende).not.toContain("Transférez");
    expect(pack.legende).not.toContain("légende");
    expect(c).not.toContain(ARTICLE.nom);
  });
});

/**
 * ── Le slug est ecrit UNE fois, et ce test dit pourquoi il compte ────────
 *
 * La boutique publique en fait ses URL, le bot en fait ses liens marques. Une
 * divergence entre les deux ferait mener un lien de Statut vers une page 404 —
 * silencieusement, et seulement chez les acheteuses. La regle vit donc dans
 * `@catalog/contracts/slug`, que les deux ont le droit de lire (ADR 0073) ;
 * ce qui suit verifie qu'elle tient sur les entrees qui font mal.
 */
describe("le slug d'article", () => {
  it("survit aux accents, a la ponctuation, au vide et aux noms trop longs", () => {
    expect(slugArticle("Robe wax grande taille", "clx0000000000000000a1b2c3")).toBe(
      "robe-wax-grande-taille-a1b2c3",
    );
    expect(slugArticle("Éau, pétillante & fraîche !", "clx0000000000000000ffffff")).toBe(
      "eau-petillante-fraiche-ffffff",
    );
    /* Un nom sans aucun caractere exploitable ne produit PAS un slug commencant
       par un tiret : le repli « article » prend la place. */
    expect(slugArticle("   ", "clx0000000000000000abcdef")).toBe("article-abcdef");
    expect(slugArticle("—–—", "clx0000000000000000123456")).toBe("article-123456");
    expect(slugArticle("a".repeat(120), "clx0000000000000000zzzzzz")).toBe(
      `${"a".repeat(48)}-zzzzzz`,
    );
  });

  /** Deux articles de meme nom chez la meme vendeuse : le suffixe les separe. */
  it("distingue deux articles de meme nom", () => {
    const a = slugArticle("Pagne", "clx0000000000000000aaaaaa");
    const b = slugArticle("Pagne", "clx0000000000000000bbbbbb");
    expect(a).not.toBe(b);
  });
});
