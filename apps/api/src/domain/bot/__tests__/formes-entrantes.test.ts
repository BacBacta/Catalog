import { describe, expect, it } from "vitest";
import { reagirAcheteuse } from "../conversation.ts";
import { lireEntreesBot } from "../entrees.ts";
import { reagirInscription } from "../inscription.ts";
import { accuseLecture, type MessageBoutons, type MessageTexte } from "../messages.ts";
import { TEXTES } from "../textes.ts";

/**
 * Les formes entrantes que le bot ne savait pas lire — ADR 0049.
 *
 * Le defaut, mesure le 07/08/2026 : `lireEntreesBot` ne poussait que `text`,
 * `image` et `interactive`. Un VOCAL — le geste le plus naturel d'une vendeuse
 * de 42 ans qui tape lentement — ne produisait AUCUNE entree, donc aucun
 * message sortant, aucun accuse, pas meme une coche bleue. Sur un canal ou
 * l'absence de reponse veut dire panne, c'est la pire sortie du produit.
 */

const VERS = "237690112233";
const corps = (m: unknown): string =>
  (m as MessageTexte).text?.body ?? (m as MessageBoutons).interactive?.body?.text ?? "";

const livraison = (message: Record<string, unknown>) => ({
  messages: [{ from: "237690112233", id: "wamid.1", ...message }],
});

describe("le parseur lit les formes qu'il ne sait pas traiter", () => {
  const FORMES: Array<[string, Record<string, unknown>, string]> = [
    ["audio", { type: "audio", audio: { id: "m1", voice: true } }, "vocal"],
    ["video", { type: "video", video: { id: "m2" } }, "video"],
    ["document", { type: "document", document: { id: "m3" } }, "document"],
    ["sticker", { type: "sticker", sticker: { id: "m4" } }, "sticker"],
    [
      "location",
      { type: "location", location: { latitude: 4.05, longitude: 9.7 } },
      "localisation",
    ],
    ["contacts", { type: "contacts", contacts: [{ name: { first_name: "A" } }] }, "contact"],
  ];

  for (const [type, message, forme] of FORMES) {
    it(`« ${type} » produit une entree de genre « autre », forme « ${forme} »`, () => {
      const lues = lireEntreesBot(livraison(message));
      expect(lues).toHaveLength(1);
      expect(lues[0]).toMatchObject({ genre: "autre", forme, messageId: "wamid.1" });
    });
  }

  it("une forme inconnue de demain est lue quand meme — jamais un silence", () => {
    /* `unsupported` est ce que Meta envoie pour un type qu'il ne sait pas
       livrer ; un type inedit de demain suit le meme chemin. */
    const lues = lireEntreesBot(livraison({ type: "unsupported" }));
    expect(lues[0]).toMatchObject({ genre: "autre", forme: "inconnue" });
  });

  it("une REACTION reste ignoree — reagir n'est pas poser une question", () => {
    /* Repondre « je ne sais pas lire ca » a un 👍 est PIRE que le silence :
       c'est un reproche adresse a quelqu'un qui vient d'approuver. Meme regle
       pour les accuses de livraison, qui ne sont pas des messages. */
    expect(lireEntreesBot(livraison({ type: "reaction", reaction: { emoji: "👍" } }))).toEqual([]);
  });

  it("le texte, l'image et les reponses interactives ne changent pas", () => {
    expect(lireEntreesBot(livraison({ type: "text", text: { body: "Bonjour" } }))[0]).toMatchObject(
      {
        genre: "texte",
        texte: "Bonjour",
      },
    );
    expect(lireEntreesBot(livraison({ type: "image", image: { id: "m9" } }))[0]).toMatchObject({
      genre: "image",
      mediaId: "m9",
    });
  });
});

describe("le fil ACHETEUSE repond a une forme non lue, sans perdre l'etat", () => {
  const ETAT = { nom: "details", slug: "chez-amina", panier: [], mode: "livraison" } as never;

  it("un vocal recoit une explication, et l'etat NE BOUGE PAS", () => {
    const r = reagirAcheteuse(ETAT, { genre: "autre", forme: "vocal" } as const, {
      vers: VERS,
      boutique: null,
    });
    expect(r.messages.length).toBeGreaterThan(0);
    expect(corps(r.messages[0])).toBe(TEXTES.fr.formeNonLue("vocal"));
    expect(r.etat).toEqual(ETAT);
  });

  it("chaque forme a sa propre phrase — on ne dit pas « vocal » pour un document", () => {
    const vus = new Set<string>();
    for (const forme of ["vocal", "video", "document", "localisation", "contact", "sticker"]) {
      const r = reagirAcheteuse(ETAT, { genre: "autre", forme } as never, {
        vers: VERS,
        boutique: null,
      });
      vus.add(corps(r.messages[0]));
    }
    expect(vus.size).toBe(6);
  });

  it("l'anglais est complet — la parite n'est pas qu'une promesse de typage", () => {
    const r = reagirAcheteuse(ETAT, { genre: "autre", forme: "vocal" } as const, {
      vers: VERS,
      boutique: null,
      langue: "en",
    });
    expect(corps(r.messages[0])).toBe(TEXTES.en.formeNonLue("vocal"));
    expect(corps(r.messages[0])).not.toBe(TEXTES.fr.formeNonLue("vocal"));
  });
});

describe("le fil VENDEUSE repond ET redonne la question en cours", () => {
  it("un vocal pendant la saisie du prix : explication PUIS la question", () => {
    const etat = { nom: "article_prix", nomArticle: "Pagne wax" } as const;
    const r = reagirInscription(etat, { genre: "autre", forme: "vocal" } as const, VERS);
    expect(r.etat).toEqual(etat);
    expect(corps(r.messages[0])).toBe(TEXTES.fr.formeNonLue("vocal"));
    /* La question de l'etat repart : sans elle, la personne reste devant une
       explication et ne sait pas ce qu'on attend d'elle. */
    expect(corps(r.messages[1])).toContain("prix");
  });

  it("la relance porte la sortie de secours, dans les SIX etats", () => {
    const etats = [
      { nom: "inscription_nom" },
      { nom: "inscription_ville", nomBoutique: "Chez Awa" },
      { nom: "article_nom" },
      { nom: "article_prix", nomArticle: "Pagne" },
      { nom: "article_photo", nomArticle: "Pagne", prixXaf: 15000 },
      { nom: "article_confirme", nomArticle: "Pagne", prixXaf: 15000, mediaId: "m1" },
    ] as const;
    for (const etat of etats) {
      const r = reagirInscription(etat, { genre: "autre", forme: "document" } as const, VERS);
      expect(r.etat).toEqual(etat);
      expect(r.messages.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("l'accuse de lecture et l'indicateur de frappe", () => {
  it("l'accuse seul est la forme minimale", () => {
    expect(accuseLecture("wamid.7")).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.7",
    });
  });

  it("avec la frappe, l'indicateur voyage DANS le meme envoi", () => {
    expect(accuseLecture("wamid.7", { frappe: true })).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.7",
      typing_indicator: { type: "text" },
    });
  });

  it("sans identifiant, aucun accuse — on ne fabrique pas une cible", () => {
    expect(() => accuseLecture("")).toThrowError(/identifiant/);
  });
});

/**
 * La ville de livraison n'est plus injectee en silence — ADR 0050.
 *
 * Elle etait prise sur la BOUTIQUE : une boutique de Douala qui livrait a
 * Yaounde enregistrait « Douala ». La ville de la boutique dit ou est la
 * VENDEUSE ; la ville de livraison dit ou va le COLIS. Deux choses.
 */
describe("la ville de livraison vient de l'acheteuse", () => {
  const BOUTIQUE = {
    slug: "chez-amina",
    nom: "Chez Amina",
    ville: "Douala",
    articles: [{ id: "a1", nom: "Robe wax", prixXaf: 15000, stock: null }],
  } as never;
  const ctx = { vers: VERS, boutique: BOUTIQUE };
  const PANIER = [{ articleId: "a1", quantite: 1 }];

  it("choisir « Livraison » demande la ville AVANT les details", () => {
    const r = reagirAcheteuse(
      { nom: "mode", slug: "chez-amina", panier: PANIER } as never,
      { genre: "bouton", id: "mode:livraison" },
      ctx,
    );
    expect((r.etat as { nom: string }).nom).toBe("ville");
    expect(corps(r.messages[0])).toContain("Douala");
  });

  it("le RETRAIT ne demande aucune ville — le point de rendez-vous porte le lieu", () => {
    const r = reagirAcheteuse(
      { nom: "mode", slug: "chez-amina", panier: PANIER } as never,
      { genre: "bouton", id: "mode:retrait" },
      ctx,
    );
    expect(r.etat).toMatchObject({ nom: "details", mode: "retrait" });
  });

  it("un appui sur la ville de la boutique la retient — une frappe, cas majoritaire", () => {
    const r = reagirAcheteuse(
      { nom: "ville", slug: "chez-amina", panier: PANIER } as never,
      { genre: "bouton", id: "ville:boutique" },
      ctx,
    );
    expect(r.etat).toMatchObject({ nom: "details", mode: "livraison", ville: "Douala" });
  });

  it("LE cas du 07/08/2026 : une acheteuse ailleurs ECRIT sa ville, et ca marche", () => {
    for (const ville of ["Bafoussam", "Yaoundé", "Buea", "Nanga-Eboko"]) {
      const r = reagirAcheteuse(
        { nom: "ville", slug: "chez-amina", panier: PANIER } as never,
        { genre: "texte", texte: ville },
        ctx,
      );
      expect(r.etat).toMatchObject({ nom: "details", mode: "livraison", ville });
    }
  });

  it("une ville illisible re-pose la question au lieu de deviner", () => {
    const r = reagirAcheteuse(
      { nom: "ville", slug: "chez-amina", panier: PANIER } as never,
      { genre: "texte", texte: "x" },
      ctx,
    );
    expect((r.etat as { nom: string }).nom).toBe("ville");
    expect(corps(r.messages[0])).toContain("ville");
  });

  it("la ville CHOISIE, et non celle de la boutique, entre dans la commande", () => {
    const apresVille = reagirAcheteuse(
      { nom: "ville", slug: "chez-amina", panier: PANIER } as never,
      { genre: "texte", texte: "Bafoussam" },
      ctx,
    );
    const r = reagirAcheteuse(
      apresVille.etat as never,
      { genre: "texte", texte: "Banengo, en face du marché A, 690 11 22 33" },
      ctx,
    );
    const etat = r.etat as { nom: string; livraison?: { city?: string } };
    expect(etat.nom).toBe("recap");
    expect(etat.livraison?.city).toBe("Bafoussam");
    /* Et elle se VOIT : le recapitulatif est le seul garde-fou du produit. */
    expect(corps(r.messages[0])).toContain("Bafoussam");
  });
});

/**
 * Les mots du tunnel — ADR 0051.
 *
 * « Confirmer » est le libelle du bouton du recapitulatif. Le mot tape etait
 * intercepte AVANT le switch et route vers la contre-signature : le panier,
 * le mode et la livraison disparaissaient — et avec une commande anterieure
 * dans le fil, c'est la MAUVAISE commande qui etait contre-signee.
 */
describe("« confirmer » tape confirme la commande, et rien d'autre", () => {
  const BOUTIQUE = {
    slug: "chez-amina",
    nom: "Chez Amina",
    ville: "Douala",
    articles: [{ id: "a1", nom: "Robe wax", prixXaf: 15000, stock: null }],
  } as never;
  const RECAP = {
    nom: "recap",
    slug: "chez-amina",
    panier: [{ articleId: "a1", quantite: 1 }],
    mode: "livraison",
    livraison: {
      mode: "livraison",
      city: "Bafoussam",
      quartier: "Banengo",
      landmark: "en face du marché A",
      phone: "+237690112233",
    },
  } as never;

  it("LE defaut : le mot tape cree la commande au lieu de detruire le panier", () => {
    const r = reagirAcheteuse(
      RECAP,
      { genre: "texte", texte: "confirmer" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
      },
    );
    expect(r.effet?.type).toBe("creer_commande");
  });

  it("il ne contre-signe PAS une commande anterieure du fil", () => {
    const r = reagirAcheteuse(
      RECAP,
      { genre: "texte", texte: "confirmer" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
        derniereCommande: { reference: "CT-111111", etat: "livree" } as never,
      },
    );
    expect(r.effet?.type).toBe("creer_commande");
    expect(r.effet?.type).not.toBe("contresigner");
  });

  it("l'anglaise a enfin un chemin tape — « confirm » marche", () => {
    const r = reagirAcheteuse(
      RECAP,
      { genre: "texte", texte: "Confirm" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
        langue: "en",
      },
    );
    expect(r.effet?.type).toBe("creer_commande");
  });

  it("correspondance EXACTE : une phrase qui CONTIENT le mot ne confirme rien", () => {
    const r = reagirAcheteuse(
      RECAP,
      { genre: "texte", texte: "je ne veux pas confirmer" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
      },
    );
    expect(r.effet).toBeUndefined();
  });

  it("« corriger » tape marche aussi — le mot est sur un bouton, lui aussi", () => {
    const r = reagirAcheteuse(
      RECAP,
      { genre: "texte", texte: "corriger" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
      },
    );
    expect((r.etat as { nom: string }).nom).toBe("ajout");
  });

  it("dans le tunnel, « avis » et « noter » sont inertes", () => {
    const enDetails = {
      nom: "details",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 1 }],
      mode: "livraison",
      ville: "Douala",
    } as never;
    for (const mot of ["avis", "noter", "review"]) {
      const r = reagirAcheteuse(
        enDetails,
        { genre: "texte", texte: mot },
        {
          vers: VERS,
          boutique: BOUTIQUE,
          derniereCommande: { reference: "CT-111111", etat: "livree" } as never,
        },
      );
      expect((r.etat as { nom: string }).nom).toBe("details");
    }
  });
});
