import { describe, expect, it } from "vitest";
import { corpsNouvelleCommande } from "../notifications.ts";

/**
 * Le rappel de reversement DANS la notification de commande — retour du banc
 * du 10/08/2026. La vendeuse sans numero pose vendait « sans prepaiement »
 * sans comprendre pourquoi ; la relance de l'ADR 0035 arrivait ~20 h plus
 * tard. Le moment ou ca coute est le moment ou on le dit.
 */
const BASE = {
  reference: "CT-476313",
  lignes: [{ nom: "Robe wax", quantite: 2 }],
  totalXaf: 30000,
  telephoneLivraison: "690 11 22 33",
};

describe("la vente partie sans acompte le dit, avec le lien", () => {
  it("sans reversement : le rappel et le lien apparaissent", () => {
    const corps = corpsNouvelleCommande({
      ...BASE,
      duAvantXaf: 0,
      lienReversement: "https://app.test/reversement",
    });
    expect(corps).toContain("sans acompte");
    expect(corps).toContain("https://app.test/reversement");
    expect(corps).toContain("Sans prépaiement");
  });

  it("avec acompte attendu : PAS de rappel — le probleme n'existe pas", () => {
    const corps = corpsNouvelleCommande({
      ...BASE,
      duAvantXaf: 15000,
      lienReversement: "https://app.test/reversement",
    });
    expect(corps).not.toContain("sans acompte");
    expect(corps).toContain("Acompte attendu");
  });

  it("sans lien d'app : rien — on ne renvoie jamais vers une URL absente", () => {
    const corps = corpsNouvelleCommande({ ...BASE, duAvantXaf: 0, lienReversement: null });
    expect(corps).not.toContain("sans acompte");
  });
});
