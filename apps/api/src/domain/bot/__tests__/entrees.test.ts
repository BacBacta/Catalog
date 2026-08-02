import { describe, expect, it } from "vitest";
import { lireEntreesBot } from "../entrees.ts";

/**
 * Le parseur des entrees du bot — ADR 0031.
 *
 * Contrairement au parseur des defis de connexion (ADR 0027), qui ne lit que
 * le texte, celui-ci comprend les REPONSES INTERACTIVES : l'appui sur un
 * bouton et le choix dans une liste, qui portent l'identifiant pose a l'envoi.
 * C'est cet identifiant qui route la conversation — pas le libelle, qui peut
 * etre tronque ou traduit.
 */

const enveloppe = (messages: unknown[]) => ({
  entry: [{ changes: [{ value: { messages } }] }],
});

describe("lireEntreesBot", () => {
  it("lit un message texte", () => {
    const e = lireEntreesBot(
      enveloppe([{ from: "237690112233", type: "text", text: { body: "solde" } }]),
    );
    expect(e).toEqual([{ de: "237690112233", genre: "texte", texte: "solde" }]);
  });

  it("lit un appui de bouton par son identifiant", () => {
    const e = lireEntreesBot(
      enveloppe([
        {
          from: "237690112233",
          type: "interactive",
          interactive: {
            type: "button_reply",
            button_reply: { id: "cmd:art-1", title: "Commander" },
          },
        },
      ]),
    );
    expect(e).toEqual([{ de: "237690112233", genre: "bouton", id: "cmd:art-1" }]);
  });

  it("lit un choix de liste par son identifiant", () => {
    const e = lireEntreesBot(
      enveloppe([
        {
          from: "237690112233",
          type: "interactive",
          interactive: { type: "list_reply", list_reply: { id: "art:art-2", title: "Pagne" } },
        },
      ]),
    );
    expect(e).toEqual([{ de: "237690112233", genre: "liste", id: "art:art-2" }]);
  });

  it("lit une photo par son identifiant de media, legende comprise", () => {
    const e = lireEntreesBot(
      enveloppe([
        { from: "237690112233", type: "image", image: { id: "m1", caption: "Pagne wax" } },
        { from: "237690112233", type: "image", image: { id: "m2" } },
      ]),
    );
    expect(e).toEqual([
      { de: "237690112233", genre: "image", mediaId: "m1", legende: "Pagne wax" },
      { de: "237690112233", genre: "image", mediaId: "m2" },
    ]);
  });

  it("ignore sans lever ce qu'il ne connait pas — stickers, accuses, images sans id", () => {
    const e = lireEntreesBot(
      enveloppe([
        { from: "2376", type: "image", image: {} },
        { from: "2376", type: "sticker" },
        { pas: "un message" },
        null,
      ]),
    );
    expect(e).toEqual([]);
  });

  it("lit la forme PLATE v1 du sandbox 360dialog — messages a la racine", () => {
    const e = lireEntreesBot({
      contacts: [{ wa_id: "237690112233" }],
      messages: [{ from: "237690112233", type: "text", text: { body: "boutique chez-amina" } }],
    });
    expect(e).toEqual([{ de: "237690112233", genre: "texte", texte: "boutique chez-amina" }]);
  });

  it("rend une liste vide sur un corps difforme, jamais une levee", () => {
    for (const corps of [null, {}, { entry: "x" }, { entry: [{}] }, 42]) {
      expect(lireEntreesBot(corps)).toEqual([]);
    }
  });
});
