import { describe, expect, it } from "vitest";
import {
  avancerComptoir,
  COMPTOIR_DEPART,
  demandeComptoir,
  type EtatComptoir,
} from "../comptoir-vendeuse.ts";

/**
 * Le comptoir vendeuse — rang 1 de l'ADR 0061.
 *
 * La vendeuse declare dans son fil ce qu'elle vient de vendre ; le moteur cree
 * la commande AU PRIX CONVENU et lui rend un message autosuffisant qu'elle
 * TRANSFERE a sa cliente. La transaction ne change pas de mains, elle change de
 * piece : la relation reste dans le fil humain, l'argent et la preuve passent
 * par le moteur.
 *
 * Ce fichier ne teste que le domaine : pas de base, pas de reseau, pas
 * d'horloge implicite.
 */

const repondre = (etat: EtatComptoir, texte: string) => avancerComptoir(etat, { texte });

/** Le parcours nominal, joue jusqu'au recapitulatif. */
function jusquAuRecap(): EtatComptoir {
  let r = repondre(COMPTOIR_DEPART, "Robe wax grande taille");
  r = repondre(r.etat, "12 500");
  r = repondre(r.etat, "677 00 11 22");
  r = repondre(r.etat, "Carrefour Warda, devant la pharmacie");
  return r.etat;
}

describe("l'entree dans le comptoir", () => {
  it("reconnait la declaration de vente, accents et casse compris", () => {
    for (const mot of ["vendu", "VENDU", "j'ai vendu", "  Vente  ", "jai vendu"]) {
      expect(demandeComptoir(mot), mot).toBe(true);
    }
  });

  it("ne confond pas avec une phrase qui parle de vente sans la declarer", () => {
    /* Le fil vendeuse porte aussi des questions. « comment vendre ? » n'ouvre
       pas un comptoir : ouvrir une saisie a tort coute plus cher que de ne pas
       l'ouvrir, parce qu'elle capture les messages suivants. */
    for (const mot of ["comment vendre", "je veux vendre plus", "vendeuse"]) {
      expect(demandeComptoir(mot), mot).toBe(false);
    }
  });
});

describe("les quatre faits, et rien de plus", () => {
  it("les demande dans l'ordre : article, prix, cliente, remise", () => {
    let r = repondre(COMPTOIR_DEPART, "Robe wax");
    expect(r.etat.pas).toBe("prix");
    r = repondre(r.etat, "12 500");
    expect(r.etat.pas).toBe("cliente");
    r = repondre(r.etat, "677001122");
    expect(r.etat.pas).toBe("remise");
    r = repondre(r.etat, "Carrefour Warda");
    expect(r.etat.pas).toBe("recap");
  });

  it("le prix est le PRIX CONVENU, entier, jamais celui du catalogue", () => {
    /* C'est la raison d'etre de ce comptoir : le catalogue affiche un prix de
       depart, la vente se conclut a un autre. Le moteur enregistre celui-la. */
    const r = repondre({ pas: "prix", article: "Robe wax" }, "12 500 F");
    expect(r.etat).toMatchObject({ pas: "cliente", prixXaf: 12500 });
  });

  it("refuse un prix nul, negatif ou illisible — sans en inventer un", () => {
    for (const mauvais of ["0", "zero", "gratuit", "-500", ""]) {
      const r = repondre({ pas: "prix", article: "Robe wax" }, mauvais);
      expect(r.type, mauvais).toBe("refus");
      expect(r.etat.pas, mauvais).toBe("prix");
    }
  });

  it("le montant reste un ENTIER : un prix a virgule est ramene, pas arrondi au hasard", () => {
    /* AGENTS.md : le franc CFA n'a pas de sous-unite. « 12.500 » est un
       separateur de milliers camerounais, pas une decimale. */
    const r = repondre({ pas: "prix", article: "x" }, "12.500");
    expect(r.etat).toMatchObject({ prixXaf: 12500 });
    expect(Number.isInteger((r.etat as { prixXaf: number }).prixXaf)).toBe(true);
  });

  it("normalise le numero de la cliente, et refuse celui qui n'en est pas un", () => {
    const bon = repondre({ pas: "cliente", article: "x", prixXaf: 1000 }, "677 00 11 22");
    expect(bon.etat).toMatchObject({ cliente: "+237677001122" });

    for (const mauvais of ["12", "abcdefghi", "+33612345678"]) {
      const r = repondre({ pas: "cliente", article: "x", prixXaf: 1000 }, mauvais);
      expect(r.type, mauvais).toBe("refus");
    }
  });

  it("le point de remise est un mode de livraison de plein droit — ADR 0005", () => {
    /* Pas un cas degrade : c'est LA forme normale au Cameroun, ou aucune
       adresse postale n'existe. */
    const etat = jusquAuRecap();
    expect(etat).toMatchObject({ remise: "Carrefour Warda, devant la pharmacie" });
  });

  it("refuse un point de remise trop court pour dire quoi que ce soit", () => {
    const r = repondre(
      { pas: "remise", article: "x", prixXaf: 1000, cliente: "+237677001122" },
      "la",
    );
    expect(r.type).toBe("refus");
  });
});

describe("le recapitulatif, avant toute creation", () => {
  it("rien n'est cree tant qu'elle n'a pas confirme", () => {
    /* La lecon de l'ADR 0032 : un recapitulatif qui se saute cree des commandes
       fantomes que personne n'assume. */
    const etat = jusquAuRecap();
    expect(etat.pas).toBe("recap");
    const r = avancerComptoir(etat, { texte: "confirmer" });
    expect(r.type).toBe("creer");
  });

  it("« corriger » revient au debut, sans perdre la conversation", () => {
    const r = avancerComptoir(jusquAuRecap(), { texte: "corriger" });
    expect(r.etat.pas).toBe("article");
    expect(r.type).not.toBe("creer");
  });

  it("« annuler » ferme le comptoir, et ne cree rien", () => {
    const r = avancerComptoir(jusquAuRecap(), { texte: "annuler" });
    expect(r.type).toBe("abandon");
  });

  it("la vente remise au moteur porte les quatre faits, et le prix convenu", () => {
    const r = avancerComptoir(jusquAuRecap(), { texte: "confirmer" });
    expect(r.type).toBe("creer");
    expect(r.vente).toEqual({
      article: "Robe wax grande taille",
      prixXaf: 12500,
      cliente: "+237677001122",
      pointRemise: "Carrefour Warda, devant la pharmacie",
    });
  });
});

describe("ce que le comptoir ne fait PAS", () => {
  it("il ne demande jamais le code secret mobile money", () => {
    /* Interdit d'AGENTS.md §8, et le comptoir est justement l'endroit ou l'on
       serait tente de « simplifier » en le demandant. */
    const questions = [
      COMPTOIR_DEPART,
      { pas: "prix", article: "x" },
      { pas: "cliente", article: "x", prixXaf: 1 },
      { pas: "remise", article: "x", prixXaf: 1, cliente: "+237677001122" },
    ] as EtatComptoir[];
    for (const etat of questions) {
      const r = repondre(etat, "peu importe");
      expect(JSON.stringify(r)).not.toMatch(/code secret|mot de passe|pin\b/i);
    }
  });

  it("il ne s'ouvre pas sur un troisieme comptoir : une seule vente a la fois", () => {
    /* « Jamais de troisieme comptoir » (ADR 0061). Redeclarer une vente en
       cours de saisie ne l'empile pas — elle repond a la question posee. */
    const r = repondre({ pas: "prix", article: "Robe wax" }, "vendu");
    expect(r.type).toBe("refus");
    expect(r.etat.pas).toBe("prix");
  });
});
