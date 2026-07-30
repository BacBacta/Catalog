import { describe, expect, it } from "vitest";
import { formatPhone } from "../phone.ts";

/**
 * `normalizePhone` est deja couvert par `delivery.test.ts`, qui l'exerce a
 * travers le schema de livraison. Ce fichier ne couvre que la mise en forme
 * LISIBLE, arrivee avec la rampe de paiement (lot 9).
 */
describe("formatPhone", () => {
  it("groupe les chiffres comme on dicte un numero au Cameroun", () => {
    for (const saisie of ["677123456", "+237677123456", "237 677 12 34 56"]) {
      expect(formatPhone(saisie), saisie).toBe("6 77 12 34 56");
    }
  });

  it("rend une saisie non reconnue telle quelle", () => {
    // Mieux vaut afficher ce qu'on a recu que de le mettre en forme de travers :
    // un numero decoupe au mauvais endroit se recopie faux.
    expect(formatPhone("0612345678")).toBe("0612345678");
    expect(formatPhone("")).toBe("");
  });
});
