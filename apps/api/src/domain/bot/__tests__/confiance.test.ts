import { describe, expect, it } from "vitest";
import { confianceAuPaiement } from "../confiance.ts";
import { confirmationCommande } from "../conversation.ts";
import { TEXTES } from "../textes.ts";

/**
 * La confiance dite au moment du doute — ADR 0061, rang 2a.
 *
 * Ce que ces tests tiennent, dans l'ordre :
 *
 * 1. **le zero ne se tait pas.** Devant une vitrine, une boutique sans avis
 *    reste muette — on ne fait pas dire « 0 vente » a une debutante. Devant un
 *    acompte, ce silence se lit « boutique etablie », et c'est faux. Les deux
 *    regles coexistent parce que les deux moments ne posent pas la meme
 *    question ;
 * 2. **la ligne porte un NOMBRE, jamais un jugement.** Aucun « fiable », aucun
 *    « recommande » : le produit ne demande pas qu'on le croie ;
 * 3. **elle n'apparait QUE s'il y a un acompte a payer.** Sans paiement
 *    attendu, il n'y a pas de doute a lever.
 */

describe("verdict de confiance", () => {
  it("un seul paiement prouve suffit a dire ce qui est prouve", () => {
    expect(confianceAuPaiement({ paiementsProuves: 1, avisVerifies: 0 })).toEqual({
      forme: "etablie",
      paiementsProuves: 1,
      avisVerifies: 0,
    });
  });

  it("aucun paiement prouve : la boutique DEBUTE, elle n'est pas muette", () => {
    expect(confianceAuPaiement({ paiementsProuves: 0, avisVerifies: 0 })).toEqual({
      forme: "debutante",
    });
  });

  /**
   * Des avis sans paiement prouve ne peuvent pas exister (un avis verifie
   * s'adosse a un paiement), mais si la base mentait, on ne la relaierait pas :
   * c'est le paiement qui decide de la forme.
   */
  it("des avis sans paiement prouve ne rendent pas la boutique etablie", () => {
    expect(confianceAuPaiement({ paiementsProuves: 0, avisVerifies: 9 })).toEqual({
      forme: "debutante",
    });
  });

  it("les valeurs aberrantes retombent a zero plutot que de s'afficher", () => {
    expect(confianceAuPaiement({ paiementsProuves: -3, avisVerifies: 2 })).toEqual({
      forme: "debutante",
    });
    expect(confianceAuPaiement({ paiementsProuves: 2.7, avisVerifies: Number.NaN })).toEqual({
      forme: "etablie",
      paiementsProuves: 2,
      avisVerifies: 0,
    });
  });
});

describe("la ligne servie a l'acheteuse", () => {
  const lien = "https://boutique.test/chez-bea";

  it("porte le nombre, le lien de verification, et aucun jugement", () => {
    const l = TEXTES.fr.ligneConfiance(
      { forme: "etablie", paiementsProuves: 47, avisVerifies: 12 },
      lien,
    );
    expect(l).toContain("47 paiements prouvés");
    expect(l).toContain("12 avis vérifiés");
    expect(l).toContain(lien);
    for (const jugement of ["fiable", "recommand", "sûre", "sérieuse", "confiance"]) {
      expect(l.toLowerCase()).not.toContain(jugement.toLowerCase());
    }
  });

  it("accorde le singulier — « 1 paiement prouvé », pas « 1 paiements »", () => {
    const l = TEXTES.fr.ligneConfiance(
      { forme: "etablie", paiementsProuves: 1, avisVerifies: 1 },
      null,
    );
    expect(l).toContain("1 paiement prouvé");
    expect(l).not.toContain("paiements");
    expect(l).toContain("1 avis vérifié");
  });

  it("tait les avis quand il n'y en a pas, sans ecrire « 0 avis »", () => {
    const l = TEXTES.fr.ligneConfiance(
      { forme: "etablie", paiementsProuves: 5, avisVerifies: 0 },
      null,
    );
    expect(l).toContain("5 paiements prouvés");
    expect(l).not.toContain("avis");
    expect(l).not.toContain("0");
  });

  it("dit la debutante SANS ecrire un zero", () => {
    for (const langue of ["fr", "en"] as const) {
      const l = TEXTES[langue].ligneConfiance({ forme: "debutante" }, lien);
      expect(l).not.toContain("0");
      expect(l.length).toBeGreaterThan(20);
    }
    expect(TEXTES.fr.ligneConfiance({ forme: "debutante" }, lien)).toContain("débute");
    expect(TEXTES.en.ligneConfiance({ forme: "debutante" }, lien)).toContain("new");
  });
});

describe("dans la confirmation de commande", () => {
  const base = {
    reference: "CMD-1",
    codeVerification: "ABCD23",
    boutique: "Chez Bea",
    lignes: [{ nom: "Robe", quantite: 1, prixUnitaireXaf: 10_000 }],
    totalXaf: 10_000,
    livraison: {
      mode: "retrait" as const,
      pickupPoint: "Marché Mokolo, face pharmacie",
      phone: "+237690000000",
    },
    lienSuivi: null,
  };
  const paiement = {
    montantXaf: 5_000,
    numeroAffiche: "690 00 00 00",
    operateurNom: "MTN MoMo",
    codeEntree: "*126#",
    lienPayer: null,
    lienBoutique: "https://boutique.test/chez-bea",
  };

  it("l'insere dans le bloc paiement quand un acompte est attendu", () => {
    const m = confirmationCommande("237690000001", {
      ...base,
      duAvantXaf: 5_000,
      paiement: {
        ...paiement,
        confiance: { forme: "etablie", paiementsProuves: 47, avisVerifies: 12 },
      },
    });
    const tout = m.map((x) => ("text" in x ? x.text.body : "")).join("\n");
    expect(tout).toContain("47 paiement");
    expect(tout).toContain("https://boutique.test/chez-bea");
  });

  /**
   * **Sans acompte, pas de doute a lever.** La ligne n'a rien a faire dans une
   * commande payee a la livraison : elle n'y repond a aucune question, et une
   * information servie hors de son moment est du bruit.
   */
  it("ne la sert PAS quand rien n'est du d'avance", () => {
    const m = confirmationCommande("237690000001", {
      ...base,
      duAvantXaf: 0,
      paiement: {
        ...paiement,
        confiance: { forme: "etablie", paiementsProuves: 47, avisVerifies: 12 },
      },
    });
    const tout = m.map((x) => ("text" in x ? x.text.body : "")).join("\n");
    expect(tout).not.toContain("47 paiement");
  });

  /** Un service qui ne la fournit pas ne casse rien : le bloc reste celui d'avant. */
  it("reste le bloc historique quand la confiance est absente", () => {
    const m = confirmationCommande("237690000001", {
      ...base,
      duAvantXaf: 5_000,
      paiement: { ...paiement, confiance: null },
    });
    const tout = m.map((x) => ("text" in x ? x.text.body : "")).join("\n");
    expect(tout).toContain("À payer maintenant");
    expect(tout).not.toContain("prouvé");
  });
});
