import { describe, expect, it } from "vitest";
import { aiguiller } from "../aiguillage.ts";

/**
 * Les gestes de vendeuse pendant un ACHAT en cours — retour du banc du
 * 10/08/2026, dans la lignee de l'ADR 0052.
 *
 * Une vendeuse qui vient de parcourir sa propre boutique — ou d'y acheter —
 * garde un etat d'achat ouvert (`catalogue`). Ses mots de comptoir tapes a ce
 * moment-la partaient au fil acheteuse, qui ne les connait pas : « solde »
 * juste apres une commande — l'instant precis ou on le tape — repondait le
 * catalogue. Vu au banc, coche « echec », corrige ici.
 */
describe("les mots de comptoir traversent un achat en cours", () => {
  const VENDEUSE_EN_ACHAT = {
    estVendeuse: true,
    etatVendeuseEnCours: false,
    smsReconnu: false,
    achatEnCours: true,
  };

  it.each(["solde", "soldes", "Solde"])("« %s » part au fil vendeuse", (mot) => {
    expect(aiguiller({ genre: "texte", texte: mot }, VENDEUSE_EN_ACHAT)).toBe("vendeuse");
  });

  it.each(["ma carte", "carte", "vitrine"])("« %s » part au fil vendeuse", (mot) => {
    expect(aiguiller({ genre: "texte", texte: mot }, VENDEUSE_EN_ACHAT)).toBe("vendeuse");
  });

  it("chez une NON-vendeuse, ces mots restent a l'acheteuse", () => {
    const prospect = { ...VENDEUSE_EN_ACHAT, estVendeuse: false };
    expect(aiguiller({ genre: "texte", texte: "solde" }, prospect)).toBe("acheteuse");
    expect(aiguiller({ genre: "texte", texte: "ma carte" }, prospect)).toBe("acheteuse");
  });

  it("un mot qui CONTIENT solde ne detourne pas l'achat", () => {
    /* « le solde du pantalon » est une phrase d'acheteuse ; seule l'egalite
       stricte route — la meme regle que tous les mots-cles du produit. */
    expect(aiguiller({ genre: "texte", texte: "le solde du pantalon" }, VENDEUSE_EN_ACHAT)).toBe(
      "acheteuse",
    );
  });
});
