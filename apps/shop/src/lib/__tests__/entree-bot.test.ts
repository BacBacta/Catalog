import { describe, expect, it } from "vitest";
import { lienCommanderAuBot, NUMERO_BOT } from "../entree-bot.ts";

/**
 * Le bouton « Commander » de la fiche produit — ADR 0066.
 *
 * Il pointait `wa.me/<numero personnel de la vendeuse>` : l'acheteuse
 * atterrissait dans une conversation humaine, aucune commande n'etait creee,
 * ni rampe, ni preuve, ni recu, ni statistique. C'etait LA fuite du rang 0 de
 * l'ADR 0061.
 */

const ARTICLE = { slug: "robe-wax-a1b2c3", nom: "Robe wax" };

describe("le lien de commande", () => {
  it("mene au BOT, pas au numero de la vendeuse", () => {
    const l = lienCommanderAuBot("237690000001", "chez-ngo", ARTICLE.slug);
    expect(l).toContain(NUMERO_BOT.replace(/\D/g, ""));
    expect(l).not.toContain("237690000001");
  });

  it("porte la boutique, le canal web et l'article", () => {
    const l = decodeURIComponent(lienCommanderAuBot("237690000001", "chez-ngo", ARTICLE.slug));
    expect(l).toContain("boutique chez-ngo web robe-wax-a1b2c3");
  });

  it("sans article — depuis la page boutique — le lien reste valable", () => {
    const l = decodeURIComponent(lienCommanderAuBot("237690000001", "chez-ngo"));
    expect(l).toContain("boutique chez-ngo web");
    expect(l).not.toContain("undefined");
  });

  it("le texte est LISIBLE : pas d'identifiant technique sous les yeux de l'acheteuse", () => {
    /* Elle voit ce texte dans son champ de saisie avant de l'envoyer. Un cuid
       de vingt-cinq caracteres la ferait hesiter, ou effacer. */
    const l = decodeURIComponent(lienCommanderAuBot("237690000001", "chez-ngo", ARTICLE.slug));
    expect(l).not.toMatch(/[a-z0-9]{20,}/);
  });
});
