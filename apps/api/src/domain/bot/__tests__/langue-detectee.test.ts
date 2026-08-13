import { describe, expect, it } from "vitest";
import type { BoutiqueBot, ContexteAcheteuse } from "../conversation.ts";
import { ETAT_INITIAL, reagirAcheteuse } from "../conversation.ts";
import { langueDetectee } from "../textes.ts";

/**
 * La langue s'adapte au message — ADR 0084, banc du 12/08/2026.
 *
 * « Pour la langue c'est muet, l'utilisateur doit deviner. Cela doit etre
 * automatique. » Le mot-cle demeure ; la detection passive s'y ajoute, et
 * elle ne bascule que sur un signal NET.
 */

const BOUTIQUE: BoutiqueBot = {
  id: "b1",
  reversementPose: true,
  nom: "Chez Amina",
  slug: "chez-amina",
  ville: "Douala",
  enConges: false,
  whatsappVendeuse: "+237677123456",
  articles: [{ id: "a1", nom: "Pagne wax", prixXaf: 15000, stock: null }],
};

const ctx = (surcharge: Partial<ContexteAcheteuse> = {}): ContexteAcheteuse => ({
  vers: "237690112233",
  boutique: BOUTIQUE,
  ...surcharge,
});

const corps = (m: unknown): string =>
  (m as { text?: { body?: string }; interactive?: { body?: { text?: string } } }).text?.body ??
  (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ??
  "";

describe("langueDetectee — des signaux nets, jamais une devinette", () => {
  it("lit l'anglais du commerce quotidien", () => {
    expect(langueDetectee("Hello, how much is the dress?")).toBe("en");
    expect(langueDetectee("Good morning, do you have this in blue?")).toBe("en");
    expect(langueDetectee("PLEASE I WANT TWO")).toBe("en");
  });

  it("lit le francais du commerce quotidien, accents compris", () => {
    expect(langueDetectee("Bonjour, c'est combien ?")).toBe("fr");
    expect(langueDetectee("Je voudrais acheter le pagne, merci")).toBe("fr");
  });

  it("se tait sur l'ambigu — chiffres, noms, egalite", () => {
    expect(langueDetectee("2")).toBeNull();
    expect(langueDetectee("Bonapriso, pharmacie du Rond-Point, 690 11 22 33")).toBeNull();
    expect(langueDetectee("ok")).toBeNull();
    /* Un signal de chaque cote : egalite, on ne bouge pas. */
    expect(langueDetectee("hello combien")).toBeNull();
    expect(langueDetectee("")).toBeNull();
  });

  it("la frontiere de mot tient : « prix » ne se lit pas dans un autre mot", () => {
    expect(langueDetectee("surprixe")).toBeNull();
    expect(langueDetectee("chichi")).toBeNull();
  });

  it("ne rend JAMAIS le pidgin — non servi (ADR 0034) ; l'anglais est la langue la plus proche", () => {
    expect(langueDetectee("how much e dey?")).toBe("en");
    expect(langueDetectee("abeg wetin dey")).toBeNull();
  });
});

describe("la conversation bascule sur le message, et la reponse part deja dans la langue", () => {
  it("un fil francais qui recoit de l'anglais repond en anglais ET persiste", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "texte", texte: "Hello, how much is the wax?" },
      ctx(),
    );
    expect(r.langue).toBe("en");
    /* La FAQ prix, en anglais, sur CE message — pas au suivant. */
    expect(corps(r.messages[0])).toMatch(/price|item/i);
    expect(corps(r.messages[0])).not.toMatch(/article|liste/i);
  });

  it("un fil anglais qui recoit du francais revient au francais", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "texte", texte: "Bonjour, c'est combien le pagne ?" },
      ctx({ langue: "en" }),
    );
    expect(r.langue).toBe("fr");
  });

  it("dans la saisie de LIVRAISON, l'anglais d'une adresse ne bascule rien", () => {
    const r = reagirAcheteuse(
      {
        nom: "details",
        slug: "chez-amina",
        panier: [{ articleId: "a1", quantite: 1 }],
        mode: "livraison",
        ville: "Douala",
      },
      { genre: "texte", texte: "Bonapriso, near the pharmacy please, 690 11 22 33" },
      ctx(),
    );
    expect(r.langue).toBeUndefined();
  });

  it("le mot-cle explicite garde sa primaute et son annonce", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "texte", texte: "english" },
      ctx(),
    );
    expect(r.langue).toBe("en");
    expect(corps(r.messages[0])).toMatch(/english|francais/i);
  });

  it("un appui de bouton ne porte aucune langue — rien ne bouge", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "catalogue" },
      ctx(),
    );
    expect(r.langue).toBeUndefined();
  });
});
