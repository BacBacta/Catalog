import { describe, expect, it } from "vitest";
import { aiguiller } from "../aiguillage.ts";
import { avancerComptoir, COMPTOIR_DEPART, demandeComptoir } from "../comptoir-vendeuse.ts";
import { motCleGlobal } from "../conversation.ts";
import { motDeGeste } from "../geste.ts";
import { demandeAjoutArticle, demandeInscription } from "../inscription.ts";

/**
 * Les commandes du menu « / » de WhatsApp — ADR 0104.
 *
 * Quatre commandes sont posees sur le NUMERO (`/vendre`, `/boutique`,
 * `/suivi`, `/aide`). Elles s'affichent dans n'importe quelle conversation,
 * contrairement aux amorces qui exigent un fil vide : c'est la moitie de
 * l'accueil qui est joignable tout le temps.
 *
 * Rien ne retirait la barre. L'echec etait SILENCIEUX — la personne recevait
 * l'accueil a trois portes, qui est une reponse utile —, et c'est ce qui l'a
 * rendu durable : un menu qui annonce « Ouvrir ma boutique en deux minutes » et
 * rend un accueil generique ment sur ce qu'il fait, sans jamais rougir.
 */

const PROSPECT = {
  estVendeuse: false,
  etatVendeuseEnCours: false,
  achatEnCours: false,
  smsReconnu: false,
  formulaireVendeuse: false,
};
const VENDEUSE = { ...PROSPECT, estVendeuse: true };
const texte = (t: string) => ({ genre: "texte" as const, texte: t, de: "237690112233" });

describe("une commande du menu vaut le mot qu'elle porte", () => {
  it("« /vendre » ouvre l'inscription, comme « vendre »", () => {
    expect(aiguiller(texte("/vendre"), PROSPECT)).toBe("inscription");
    expect(demandeInscription("/vendre")).toEqual({});
  });

  it("« /vendu » ouvre le comptoir d'une vendeuse installée", () => {
    /* Mesure du 14/08 : il partait au fil vendeuse au lieu du comptoir. */
    expect(aiguiller(texte("/vendu"), VENDEUSE)).toBe("inscription");
    expect(demandeComptoir("/vendu")).toBe(true);
  });

  it("« /ajouter » ouvre la création d'article", () => {
    expect(aiguiller(texte("/ajouter"), VENDEUSE)).toBe("inscription");
    expect(demandeAjoutArticle("/ajouter")).toBe(true);
  });

  it("« /aide » vaut le mot-clé global, pas rien", () => {
    expect(motCleGlobal("/aide")).toBe("aide");
    expect(motCleGlobal("/annuler")).toBe("annuler");
    expect(motCleGlobal("/panier")).toBe("panier");
  });

  it("le parrainage survit à la barre — c'est le seul porteur de l'attribution", () => {
    expect(demandeInscription("/vendre avec chez-amina")).toEqual({ parrain: "chez-amina" });
  });

  it("deux barres, ou une barre et une espace, valent une barre", () => {
    /* Le menu produit UNE forme ; la frappe a la main en produit d'autres, et
       aucune ne merite un cul-de-sac. */
    for (const forme of ["/vendre", "//vendre", "/ vendre", "  /vendre  ", "/VENDRE"]) {
      expect(demandeInscription(forme), forme).toEqual({});
    }
  });
});

describe("une VALEUR garde sa barre — la règle vaut dans les deux sens", () => {
  it("un article nommé « /vendu » reste un nom d'article", () => {
    /**
     * ADR 0102 : « une valeur n'est pas un geste ». Le corollaire est ici — un
     * geste n'est pas une valeur non plus. Si `motDeGeste` servait AUSSI a
     * fabriquer les valeurs, la vendeuse qui declare un article dont le nom
     * commence par une barre le verrait ampute en base, et personne ne le
     * saurait avant de lire le recu.
     */
    const r = avancerComptoir(COMPTOIR_DEPART, { texte: "/vendu" });
    expect(r.type).toBe("question");
    if (r.type !== "question") return;
    expect(r.etat).toEqual({ pas: "prix", article: "/vendu" });
  });

  it("« annuler » DANS le comptoir garde son sens, barre ou pas", () => {
    /* Le geste d'abandon vit dans la machine, avec sa normalisation a elle :
       ce test dit que la separation n'a rien casse. */
    expect(avancerComptoir(COMPTOIR_DEPART, { texte: "annuler" }).type).toBe("abandon");
  });
});

describe("motDeGeste — ce qu'il fait, et ce qu'il ne fait pas", () => {
  it("retire la barre de TÊTE, jamais celle du milieu", () => {
    expect(motDeGeste("/vendre")).toBe("vendre");
    expect(motDeGeste("robe 6/8 ans")).toBe("robe 6/8 ans");
    expect(motDeGeste("carrefour warda / pharmacie")).toBe("carrefour warda / pharmacie");
  });

  it("normalise accents et casse, comme avant", () => {
    expect(motDeGeste("  CONGÉS ")).toBe("conges");
  });
});
