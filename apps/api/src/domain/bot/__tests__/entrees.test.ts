import { describe, expect, it } from "vitest";
import { lireEntreesBot, lireStatutsEnvoi } from "../entrees.ts";

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

  /**
   * Le panier du catalogue natif — ADR 0108. Il arrivait sous `order` et
   * etait TU (liste SANS_REPONSE) : un panier envoye ne recevait rien du
   * tout, la pire des reponses sur ce canal.
   */
  it("lit un panier de catalogue natif : references et quantites, JAMAIS les prix", () => {
    const e = lireEntreesBot(
      enveloppe([
        {
          from: "237690112233",
          id: "wamid.cmd",
          type: "order",
          order: {
            catalog_id: "cat-1",
            product_items: [
              { product_retailer_id: "a2", quantity: 2, item_price: 999999, currency: "XAF" },
              { product_retailer_id: "a3", quantity: 1, item_price: 1, currency: "XAF" },
            ],
          },
        },
      ]),
    );
    /* `item_price` n'est pas relu : un catalogue en retard d'une
       synchronisation ne fixe pas le prix d'une commande — la base fait foi. */
    expect(e).toEqual([
      {
        de: "237690112233",
        genre: "commande",
        lignes: [
          { articleId: "a2", quantite: 2 },
          { articleId: "a3", quantite: 1 },
        ],
        messageId: "wamid.cmd",
      },
    ]);
  });

  it("un panier illisible ne se tait pas : il retombe en forme non lue", () => {
    const e = lireEntreesBot(
      enveloppe([
        {
          from: "237690112233",
          type: "order",
          /* Quantite absente, quantite nulle, reference vide : rien de lisible.
             Une quantite absente ne devient JAMAIS 1. */
          order: {
            product_items: [
              { product_retailer_id: "a2" },
              { product_retailer_id: "a3", quantity: 0 },
              { product_retailer_id: "", quantity: 2 },
            ],
          },
        },
      ]),
    );
    expect(e).toEqual([{ de: "237690112233", genre: "autre", forme: "inconnue" }]);
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

describe("lireStatutsEnvoi (ADR 0091)", () => {
  /**
   * Non-retour du constat B4 de l'audit 2026-08 : `value.statuses` n'etait
   * cueilli nulle part — un envoi accepte en HTTP 200 puis refuse apres coup
   * (numero bloque, fenetre fermee, code 131047) etait invisible.
   */
  it("lit l'enveloppe Cloud API — entry[].changes[].value.statuses[]", () => {
    const s = lireStatutsEnvoi({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: "wamid.s1", status: "sent", timestamp: "1723700000" },
                  { id: "wamid.s2", status: "delivered" },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(s).toEqual([
      { messageId: "wamid.s1", statut: "sent", codes: [] },
      { messageId: "wamid.s2", statut: "delivered", codes: [] },
    ]);
  });

  it("lit la forme PLATE du sandbox — statuses a la racine, par parite avec les messages", () => {
    const s = lireStatutsEnvoi({ statuses: [{ id: "wamid.s3", status: "read" }] });
    expect(s).toEqual([{ messageId: "wamid.s3", statut: "read", codes: [] }]);
  });

  it("extrait les codes ENTIERS d'un failed — le code 131047 est la fenetre fermee", () => {
    const s = lireStatutsEnvoi({
      statuses: [
        {
          id: "wamid.s4",
          status: "failed",
          errors: [
            { code: 131047, title: "Re-engagement message" },
            { code: "pas-un-entier" },
            { code: 1.5 },
            null,
          ],
        },
      ],
    });
    expect(s).toEqual([{ messageId: "wamid.s4", statut: "failed", codes: [131047] }]);
  });

  it("un statut inconnu de Meta est ignore — les etiquettes de mesure restent fermees", () => {
    const s = lireStatutsEnvoi({
      statuses: [
        { id: "wamid.s5", status: "warmed_up" },
        { id: "wamid.s6", status: "failed" },
      ],
    });
    expect(s).toEqual([{ messageId: "wamid.s6", statut: "failed", codes: [] }]);
  });

  it("rend une liste vide sur un corps difforme, jamais une levee", () => {
    for (const corps of [null, {}, { statuses: "x" }, { entry: [{}] }, { statuses: [null] }, 42]) {
      expect(lireStatutsEnvoi(corps)).toEqual([]);
    }
  });

  it("une livraison de MESSAGES ne produit aucun statut, et inversement", () => {
    const livraisonMessage = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "237", type: "text", text: { body: "menu" } }],
              },
            },
          ],
        },
      ],
    };
    expect(lireStatutsEnvoi(livraisonMessage)).toEqual([]);
    const livraisonStatut = { statuses: [{ id: "wamid.s7", status: "sent" }] };
    expect(lireEntreesBot(livraisonStatut)).toEqual([]);
  });
});
