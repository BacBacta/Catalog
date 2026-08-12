import { describe, expect, it } from "vitest";
import { formatPhone } from "../phone.ts";

/**
 * `normalizePhone` est deja couvert par `delivery.test.ts`, qui l'exerce a
 * travers le schema de livraison. Ce fichier ne couvre que la mise en forme
 * LISIBLE, arrivee avec la rampe de paiement (lot 9).
 */
describe("formatPhone", () => {
  it("groupe les trois chiffres qui nomment l'OPERATEUR — ADR 0051", () => {
    /* `677 12 34 56`, pas `6 77 12 34 56`. Les trois premiers chiffres
       identifient l'operateur (69x Orange, 67x/68x MTN, 62x Nexttel), et
       l'operateur decide de tout ici : le code USSD, les frais hors reseau,
       quel SMS fera preuve.
       Cette assertion disait auparavant « comme on dicte un numero au
       Cameroun » SANS source — ni ADR, ni note de terrain —, alors que les
       douze exemples des copies du bot ecrivent « 690 11 22 33 » et que
       l'entree de ce test lui-meme s'ecrivait « 237 677 12 34 56 ».
       Si le terrain dit l'inverse, c'est une ligne a rendre. */
    for (const saisie of ["677123456", "+237677123456", "237 677 12 34 56"]) {
      expect(formatPhone(saisie), saisie).toBe("677 12 34 56");
    }
  });

  it("rend une saisie non reconnue telle quelle", () => {
    // Mieux vaut afficher ce qu'on a recu que de le mettre en forme de travers :
    // un numero decoupe au mauvais endroit se recopie faux.
    expect(formatPhone("0612345678")).toBe("0612345678");
    expect(formatPhone("")).toBe("");
  });
});
