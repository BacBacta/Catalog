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

  it("un message sans expediteur reste ignore — il n'y a personne a qui repondre", () => {
    const e = lireEntreesBot(enveloppe([{ pas: "un message" }, null, { type: "text" }]));
    expect(e).toEqual([]);
  });

  it("ce qu'il ne sait pas TRAITER, il le NOMME desormais — ADR 0049", () => {
    /* Avant le 07/08/2026, ces formes rendaient une liste vide : le bot ne
       repondait rien, et un silence sur WhatsApp veut dire panne. Elles
       produisent maintenant une entree `autre`, que chaque fil sait traiter.
       Une image dont l'identifiant manque suit le meme chemin : la personne a
       envoye une photo, elle merite mieux que rien. */
    const e = lireEntreesBot(
      enveloppe([
        { from: "2376", type: "image", image: {} },
        { from: "2376", type: "sticker" },
      ]),
    );
    expect(e).toEqual([
      { de: "2376", genre: "autre", forme: "inconnue" },
      { de: "2376", genre: "autre", forme: "sticker" },
    ]);
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

describe("le wamid entrant (ADR 0035)", () => {
  it("est capture sur toutes les formes — et son absence ne casse rien", () => {
    const [avecId] = lireEntreesBot({
      messages: [{ from: "237", id: "wamid.abc", type: "text", text: { body: "menu" } }],
    });
    expect(avecId).toMatchObject({ genre: "texte", messageId: "wamid.abc" });

    const [sansId] = lireEntreesBot({
      messages: [{ from: "237", type: "text", text: { body: "menu" } }],
    });
    expect(sansId).toMatchObject({ genre: "texte" });
    expect((sansId as { messageId?: string }).messageId).toBeUndefined();

    const [imageAvec] = lireEntreesBot({
      messages: [
        { from: "237", id: "wamid.img", type: "image", image: { id: "m1", caption: "Pagne 5000" } },
      ],
    });
    expect(imageAvec).toMatchObject({
      genre: "image",
      mediaId: "m1",
      legende: "Pagne 5000",
      messageId: "wamid.img",
    });
  });
});
