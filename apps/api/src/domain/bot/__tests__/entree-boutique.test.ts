import { describe, expect, it } from "vitest";
import { CANAUX, lireEntreeBoutique } from "../entree-boutique.ts";

/**
 * Le lien d'entree dans une boutique — ADR 0066, rang 0 de l'ADR 0061.
 *
 * Un seul texte porte trois choses : QUELLE boutique, PAR OU on arrive, et
 * — quand on vient d'une fiche produit — QUEL article. Il est pre-rempli dans
 * un lien `wa.me`, donc l'acheteuse le VOIT avant de l'envoyer : il doit se
 * lire comme une phrase, pas comme un identifiant technique.
 */

describe("la boutique", () => {
  it("se lit avec le mot-cle, comme avant", () => {
    expect(lireEntreeBoutique("boutique chez-ngo")?.slug).toBe("chez-ngo");
  });

  it("se lit aussi nue — pour qui la retape de memoire", () => {
    expect(lireEntreeBoutique("chez-ngo")?.slug).toBe("chez-ngo");
  });

  it("absente, rien n'est lu — on n'invente pas de boutique", () => {
    expect(lireEntreeBoutique("bonjour")).toBeNull();
  });
});

describe("le canal — d'ou vient l'acheteuse", () => {
  it("se lit apres le slug", () => {
    expect(lireEntreeBoutique("boutique chez-ngo web")?.canal).toBe("web");
    expect(lireEntreeBoutique("boutique chez-ngo statut")?.canal).toBe("statut");
  });

  it("la liste est FERMEE : un mot inconnu n'est pas un canal", () => {
    /* Sans quoi le premier mot venu deviendrait une source de trafic, et les
       statistiques diraient n'importe quoi avec aplomb. */
    expect(lireEntreeBoutique("boutique chez-ngo facebook")?.canal).toBeUndefined();
  });

  it("les cinq canaux sont lus", () => {
    for (const c of CANAUX) {
      expect(lireEntreeBoutique(`boutique chez-ngo ${c}`)?.canal, c).toBe(c);
    }
  });

  it("absent, le canal reste ABSENT — jamais un defaut invente", () => {
    /* « direct » est un canal, pas un fourre-tout : une entree sans marque ne
       doit pas etre comptee comme venant d'un endroit precis. */
    expect(lireEntreeBoutique("boutique chez-ngo")?.canal).toBeUndefined();
  });
});

describe("l'article — la fiche produit ne se perd pas en route", () => {
  it("rend le suffixe d'identifiant porte par le slug d'article", () => {
    /* `slugArticle` ecrit « robe-wax-a1b2c3 » : le nom pour l'humaine, les six
       derniers caracteres de l'identifiant pour la machine. */
    expect(lireEntreeBoutique("boutique chez-ngo web robe-wax-a1b2c3")?.articleSuffixe).toBe(
      "a1b2c3",
    );
  });

  it("marche avec un nom d'article a tirets", () => {
    expect(lireEntreeBoutique("boutique chez-ngo web pagne-super-wax-xyz789")?.articleSuffixe).toBe(
      "xyz789",
    );
  });

  it("un slug sans suffixe exploitable ne devient PAS un article", () => {
    expect(lireEntreeBoutique("boutique chez-ngo web robewax")?.articleSuffixe).toBeUndefined();
  });

  it("le canal reste lisible meme quand l'article suit", () => {
    const lu = lireEntreeBoutique("boutique chez-ngo web robe-wax-a1b2c3");
    expect(lu?.canal).toBe("web");
    expect(lu?.slug).toBe("chez-ngo");
  });

  it("l'article seul, sans canal, se lit aussi", () => {
    const lu = lireEntreeBoutique("boutique chez-ngo robe-wax-a1b2c3");
    expect(lu?.articleSuffixe).toBe("a1b2c3");
    expect(lu?.canal).toBeUndefined();
  });
});

describe("ce que le lien ne porte jamais", () => {
  it("aucun secret : ni jeton, ni numero", () => {
    /* Ce texte est pre-rempli dans un lien public, visible dans une barre
       d'adresse et transferable. Il ne porte que des identifiants publics. */
    const lu = lireEntreeBoutique("boutique chez-ngo web robe-wax-a1b2c3");
    expect(JSON.stringify(lu)).not.toMatch(/\+237|token|jeton/i);
  });
});

/* ────────────────────────────────────────────────────────────────────────
   Dans la machine : l'article ouvre SA fiche, pas le catalogue entier.
   ──────────────────────────────────────────────────────────────────────── */

const VERS = "237690112233";
const BOUTIQUE = {
  slug: "chez-ngo",
  nom: "Chez Ngo",
  ville: "Douala",
  articles: [
    { id: "clx000000000a1b2c3", nom: "Robe wax", prixXaf: 15000, stock: null },
    { id: "clx000000000xyz789", nom: "Pagne", prixXaf: 8000, stock: null },
  ],
} as never;

const dit = (messages: unknown[]) => JSON.stringify(messages);

describe("arriver par une fiche produit", () => {
  it("ouvre la fiche de CET article, pas le catalogue", async () => {
    const { reagirAcheteuse } = await import("../conversation.ts");
    const r = reagirAcheteuse(
      { nom: "accueil" } as never,
      { genre: "texte", texte: "boutique chez-ngo web robe-wax-a1b2c3" },
      { vers: VERS, boutique: BOUTIQUE } as never,
    );
    expect(dit(r.messages)).toContain("Robe wax");
    expect(dit(r.messages)).not.toContain("Pagne");
  });

  it("un suffixe qui ne correspond a RIEN retombe sur l'accueil, sans mentir", async () => {
    /* On n'ouvre jamais « un » article au hasard parce que le lien etait
       abime : l'acheteuse verrait un prix qui n'est pas celui qu'elle a vu. */
    const { reagirAcheteuse } = await import("../conversation.ts");
    const r = reagirAcheteuse(
      { nom: "accueil" } as never,
      { genre: "texte", texte: "boutique chez-ngo web robe-wax-zzzzzz" },
      { vers: VERS, boutique: BOUTIQUE } as never,
    );
    expect(dit(r.messages)).not.toContain("15 000");
  });

  it("sans article, le comportement est EXACTEMENT celui d'avant", async () => {
    const { reagirAcheteuse } = await import("../conversation.ts");
    const avant = reagirAcheteuse(
      { nom: "accueil" } as never,
      { genre: "texte", texte: "boutique chez-ngo" },
      { vers: VERS, boutique: BOUTIQUE } as never,
    );
    const avecCanal = reagirAcheteuse(
      { nom: "accueil" } as never,
      { genre: "texte", texte: "boutique chez-ngo web" },
      { vers: VERS, boutique: BOUTIQUE } as never,
    );
    /* Le canal ne change RIEN a ce que l'acheteuse voit : il se compte, il ne
       se raconte pas. */
    expect(dit(avecCanal.messages)).toBe(dit(avant.messages));
  });
});
