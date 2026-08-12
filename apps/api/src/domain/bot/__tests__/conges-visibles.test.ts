import { describe, expect, it } from "vitest";
import { messageArticlePublie, rappelConges } from "../inscription.ts";
import type { MessageBoutons, MessageTexte } from "../messages.ts";

/**
 * Les congés se disent AU MOMENT OU ils contredisent le geste — ADR 0057.
 *
 * Le fil annonçait déjà l'état dans « ma boutique », un écran qu'on ouvre
 * quand on cherche quelque chose. Or une boutique fermée n'est pas quelque
 * chose qu'on cherche : c'est quelque chose qu'on OUBLIE — et l'oubli ne
 * coûte que dans un sens. Rouvrir ne se rappelle à personne, et les ventes
 * s'arrêtent sans un signe.
 *
 * Ce fichier tient les deux moments où le silence serait un mensonge :
 * publier un article, et demander sa carte à partager.
 */

const VERS = "237690112233";
const corps = (m: unknown): string =>
  (m as MessageTexte).text?.body ?? (m as MessageBoutons).interactive?.body?.text ?? "";

describe("publier un article pendant les congés", () => {
  const ARTICLE = { nom: "Robe wax", prixXaf: 15000, avecPhoto: true };

  it("boutique OUVERTE : le message ne change pas d'un mot", () => {
    const dit = corps(messageArticlePublie(VERS, ARTICLE));
    expect(dit).toContain("Robe wax");
    expect(dit).not.toMatch(/congé|commande/i);
  });

  it("boutique FERMÉE : « en ligne » ne peut pas rester seul", () => {
    /* « ✅ Robe wax est en ligne » sur une boutique qui refuse toute commande
       est vrai et trompeur à la fois. C'est LE moment où elle range son
       stock : c'est là qu'il faut le dire. */
    const dit = corps(messageArticlePublie(VERS, ARTICLE, true));
    expect(dit).toContain("Robe wax");
    expect(dit).toMatch(/congé/i);
    expect(dit).toMatch(/commande/i);
  });

  it("le prix et le nom restent intacts dans les deux cas", () => {
    for (const ferme of [false, true]) {
      expect(corps(messageArticlePublie(VERS, ARTICLE, ferme))).toMatch(/15\s?000/);
    }
  });
});

describe("le rappel qui accompagne un geste de vente", () => {
  it("porte le geste de retour, pas un renvoi vers un écran", () => {
    /* Un rappel qui demande d'aller chercher le bouton ailleurs se remet à
       plus tard — et « plus tard » est le mode d'échec qu'on corrige. */
    const m = rappelConges(VERS) as MessageBoutons;
    const ids = m.interactive.action.buttons.map((b) => b.reply.id);
    expect(ids).toContain("rouvrir");
  });

  it("dit ce qui est fermé ET ce qui reste ouvert", () => {
    /* Sans la seconde moitié, elle peut croire que sa boutique a disparu. */
    const dit = corps(rappelConges(VERS));
    expect(dit).toMatch(/commande/i);
    expect(dit).toMatch(/en ligne|visible|écrire/i);
  });

  it("ne dramatise pas : rien n'est cassé, rien n'est perdu", () => {
    expect(corps(rappelConges(VERS))).not.toMatch(/erreur|problème|attention/i);
  });
});
