import { formatXaf } from "@catalog/contracts/money";
import { describe, expect, it } from "vitest";
import type { BoutiqueBot, ContexteAcheteuse, EtatConv } from "../conversation.ts";
import {
  confirmationCommande,
  ETAT_INITIAL,
  etatApresInactivite,
  extraireSlugBoutique,
  INACTIVITE_MAX_MS,
  lireDetailsLivraison,
  messageVerdict,
  normaliserEtat,
  reagirAcheteuse,
  reagirVendeuse,
} from "../conversation.ts";
import type { MessageBoutons, MessageListe, MessageTexte } from "../messages.ts";

/**
 * La machine de conversation — ADR 0031, revisee ADR 0032 et 0033. Chaque test
 * est un echange : etat + entree → messages + etat suivant. Pas de simulacre :
 * la machine est pure.
 */

const BOUTIQUE: BoutiqueBot = {
  id: "s1",
  slug: "chez-amina",
  nom: "Chez Amina",
  ville: "Douala",
  whatsappVendeuse: "+237677123456",
  reversementPose: true,
  articles: [
    { id: "a1", nom: "Pagne wax 6 yards", prixXaf: 15000, stock: null },
    { id: "a2", nom: "Sac en raphia", prixXaf: 8000, stock: 2 },
  ],
};

const VERS = "237690112233";
const ctx = (surcharge: Partial<ContexteAcheteuse> = {}): ContexteAcheteuse => ({
  vers: VERS,
  boutique: BOUTIQUE,
  ...surcharge,
});
const corpsTexte = (m: unknown) => (m as MessageTexte).text.body;
const corpsBoutons = (m: unknown) => (m as MessageBoutons).interactive.body.text;
const idsBoutons = (m: unknown) =>
  (m as MessageBoutons).interactive.action.buttons.map((b) => b.reply.id);

const LIVRAISON = {
  mode: "livraison" as const,
  city: "Douala",
  quartier: "Bonapriso",
  landmark: "en face de la pharmacie du Rond-Point",
  phone: "+237690112233",
};

const RECAP: EtatConv = {
  nom: "recap",
  slug: "chez-amina",
  panier: [{ articleId: "a1", quantite: 2 }],
  mode: "livraison",
  livraison: LIVRAISON,
};

describe("extraireSlugBoutique", () => {
  it("lit le message pre-rempli du lien wa.me", () => {
    expect(extraireSlugBoutique("Voir la boutique chez-amina")).toBe("chez-amina");
  });
  it("accepte le slug nu, refuse le bavardage", () => {
    expect(extraireSlugBoutique("chez-amina")).toBe("chez-amina");
    expect(extraireSlugBoutique("bonjour !")).toBeNull();
    expect(extraireSlugBoutique("")).toBeNull();
  });
});

describe("fil acheteuse — du lien a la commande", () => {
  it("le lien d'entree ouvre la boutique avec ses boutons et son argument de confiance", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "Voir la boutique chez-amina" },
      ctx(),
    );
    expect(r.etat).toEqual({ nom: "catalogue", slug: "chez-amina", page: 0 });
    const m = r.messages[0] as MessageBoutons;
    expect(m.interactive.body.text).toContain("Chez Amina");
    expect(m.interactive.body.text).toContain("reçu vérifiable");
    expect(idsBoutons(m)).toEqual(["catalogue", "vendeuse"]);
  });

  it("la reputation du lot 12 se dit a l'accueil — et jamais « 0 vente »", () => {
    const avecAvis = ctx({
      boutique: { ...BOUTIQUE, reputation: { note: 4.8, nbVerifies: 12 } },
    });
    const r = reagirAcheteuse(ETAT_INITIAL, { genre: "texte", texte: "chez-amina" }, avecAvis);
    expect(corpsBoutons(r.messages[0])).toContain("★ 4,8 · 12 ventes prouvées");

    const sansAvis = ctx({
      boutique: { ...BOUTIQUE, reputation: { note: null, nbVerifies: 0 } },
    });
    const r0 = reagirAcheteuse(ETAT_INITIAL, { genre: "texte", texte: "chez-amina" }, sansAvis);
    expect(corpsBoutons(r0.messages[0])).not.toContain("0 vente");
  });

  it("une boutique introuvable le DIT, sans inventer", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "boutique inconnue-du-registre" },
      ctx({ boutique: null }),
    );
    expect(corpsTexte(r.messages[0])).toMatch(/introuvable/);
  });

  it("« Parler a la vendeuse » donne le wa.me du numero personnel, panier garde", () => {
    const r = reagirAcheteuse(
      { nom: "ajout", slug: "chez-amina", panier: [{ articleId: "a1", quantite: 1 }] },
      { genre: "bouton", id: "vendeuse" },
      ctx(),
    );
    expect(corpsTexte(r.messages[0])).toContain("https://wa.me/237677123456");
    expect(r.etat).toMatchObject({
      nom: "catalogue",
      panier: [{ articleId: "a1", quantite: 1 }],
    });
  });

  it("la fiche montre stock et description quand ils existent", () => {
    const b: BoutiqueBot = {
      ...BOUTIQUE,
      articles: [
        {
          id: "a2",
          nom: "Sac en raphia",
          prixXaf: 8000,
          stock: 2,
          description: "Tressé main, anses en cuir, 40 cm.",
        },
      ],
    };
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "liste", id: "art:a2" },
      ctx({ boutique: b }),
    );
    const corps = corpsBoutons(r.messages[0]);
    /* Factuel, sans rareté fabriquée : le nombre ne se décompte pas tout seul
       (ADR 0038). */
    expect(corps).toContain("Plus que 2 disponibles");
    expect(corps).toContain("Tressé main");
  });

  it("le catalogue est une liste avec prix, paginee au-dela de huit", () => {
    const beaucoup: BoutiqueBot = {
      ...BOUTIQUE,
      articles: Array.from({ length: 12 }, (_, i) => ({
        id: `a${i}`,
        nom: `Article ${i}`,
        prixXaf: 1000 + i,
        stock: null,
      })),
    };
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "catalogue" },
      ctx({ boutique: beaucoup }),
    );
    const m = r.messages[0] as MessageListe;
    const lignes = m.interactive.action.sections[0]?.rows ?? [];
    expect(lignes).toHaveLength(9); // 8 articles + « voir la suite »
    expect(lignes.at(-1)?.id).toBe("cat:1");
    expect(lignes[0]?.description).toContain("FCFA");
  });

  it("une boutique vide n'est pas un cul-de-sac : un bouton de sortie reste", () => {
    const vide = ctx({ boutique: { ...BOUTIQUE, articles: [] } });
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "catalogue" },
      vide,
    );
    expect(idsBoutons(r.messages[0])).toEqual(["vendeuse"]);
  });
});

describe("le panier — plusieurs articles, une seule commande", () => {
  it("la quantite validee met l'article au panier et propose la suite", () => {
    const r = reagirAcheteuse(
      { nom: "quantite", slug: "chez-amina", articleId: "a1", panier: [] },
      { genre: "bouton", id: "qte:2" },
      ctx(),
    );
    expect(r.etat).toEqual({
      nom: "ajout",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 2 }],
    });
    const corps = corpsBoutons(r.messages[0]);
    expect(corps).toContain("Ajouté : Pagne wax 6 yards × 2");
    expect(corps).toContain(formatXaf(30000));
    expect(idsBoutons(r.messages[0])).toEqual(["commander", "catalogue", "annuler"]);
  });

  it("l'ajout MONTRE les lignes, pas seulement le total", () => {
    const r = reagirAcheteuse(
      {
        nom: "quantite",
        slug: "chez-amina",
        articleId: "a2",
        panier: [{ articleId: "a1", quantite: 2 }],
      },
      { genre: "bouton", id: "qte:1" },
      ctx(),
    );
    const corps = corpsBoutons(r.messages[0]);
    /* L'accuse de reception de ce qui vient d'entrer… */
    expect(corps).toContain("Ajouté : Sac en raphia × 1");
    /* …et le panier ENTIER, l'article precedent compris. */
    expect(corps).toContain("Pagne wax 6 yards × 2");
    expect(corps).toContain("Sac en raphia × 1");
    expect(corps).toContain(formatXaf(38000));
  });

  it("« Autre article » ramene au catalogue SANS perdre le panier", () => {
    const r = reagirAcheteuse(
      { nom: "ajout", slug: "chez-amina", panier: [{ articleId: "a1", quantite: 2 }] },
      { genre: "bouton", id: "catalogue" },
      ctx(),
    );
    expect(r.etat).toMatchObject({
      nom: "catalogue",
      panier: [{ articleId: "a1", quantite: 2 }],
    });
  });

  it("un deuxieme article s'ajoute, et le meme article fusionne ses quantites", () => {
    const deuxieme = reagirAcheteuse(
      {
        nom: "quantite",
        slug: "chez-amina",
        articleId: "a2",
        panier: [{ articleId: "a1", quantite: 2 }],
      },
      { genre: "texte", texte: "1" },
      ctx(),
    );
    expect(deuxieme.etat).toMatchObject({
      panier: [
        { articleId: "a1", quantite: 2 },
        { articleId: "a2", quantite: 1 },
      ],
    });
    expect(corpsBoutons(deuxieme.messages[0])).toContain(formatXaf(38000));

    const fusion = reagirAcheteuse(
      {
        nom: "quantite",
        slug: "chez-amina",
        articleId: "a1",
        panier: [{ articleId: "a1", quantite: 2 }],
      },
      { genre: "texte", texte: "1" },
      ctx(),
    );
    expect(fusion.etat).toMatchObject({ panier: [{ articleId: "a1", quantite: 3 }] });
  });

  it("« Passer commande » demande le mode, avec le total du panier", () => {
    const r = reagirAcheteuse(
      {
        nom: "ajout",
        slug: "chez-amina",
        panier: [
          { articleId: "a1", quantite: 2 },
          { articleId: "a2", quantite: 1 },
        ],
      },
      { genre: "bouton", id: "commander" },
      ctx(),
    );
    expect(r.etat).toMatchObject({ nom: "mode" });
    expect(corpsBoutons(r.messages[0])).toContain(formatXaf(38000));
  });

  it("le recap liste chaque ligne, le total, l'acompte et la livraison relue", () => {
    const details = reagirAcheteuse(
      {
        nom: "details",
        slug: "chez-amina",
        panier: [
          { articleId: "a1", quantite: 2 },
          { articleId: "a2", quantite: 1 },
        ],
        mode: "livraison",
      },
      { genre: "texte", texte: "Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33" },
      ctx(),
    );
    expect(details.effet).toBeUndefined();
    expect(details.etat).toMatchObject({ nom: "recap" });
    const corps = corpsBoutons(details.messages[0]);
    expect(corps).toContain("Pagne wax 6 yards × 2");
    expect(corps).toContain("Sac en raphia × 1");
    expect(corps).toContain(formatXaf(38000));
    expect(corps).toContain(formatXaf(19000)); // acompte 50 %
    expect(corps).toContain("Bonapriso, en face de la pharmacie du Rond-Point");
    expect(corps).toContain("6 90 11 22 33");
    expect(corps).toContain("Rien n'est encore commandé");
  });

  it("« Confirmer » produit l'effet avec TOUTES les lignes du panier", () => {
    const panier = [
      { articleId: "a1", quantite: 2 },
      { articleId: "a2", quantite: 1 },
    ];
    const r = reagirAcheteuse(
      { nom: "recap", slug: "chez-amina", panier, mode: "livraison", livraison: LIVRAISON },
      { genre: "bouton", id: "confirmer" },
      ctx(),
    );
    expect(r.effet).toMatchObject({
      type: "creer_commande",
      brouillon: { slug: "chez-amina", lignes: panier, livraison: LIVRAISON },
    });
    expect(r.etat).toEqual({ nom: "catalogue", slug: "chez-amina", page: 0 });
    expect(r.messages).toEqual([]); // la confirmation part apres la creation
  });

  it("« Corriger » revient a l'etape panier sans rien perdre", () => {
    const r = reagirAcheteuse(RECAP, { genre: "bouton", id: "corriger" }, ctx());
    expect(r.etat).toEqual({
      nom: "ajout",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 2 }],
    });
    expect(r.effet).toBeUndefined();
  });
});

describe("le stock suivi borne la quantite", () => {
  it("la question de quantite dit le stock et n'offre pas plus que lui", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "cmd:a2" },
      ctx(),
    );
    expect(corpsBoutons(r.messages[0])).toContain("(2 en stock)");
    // stock 2 : les boutons 1 et 2, et Annuler a la place d'« autre nombre ».
    expect(idsBoutons(r.messages[0])).toEqual(["qte:1", "qte:2", "annuler"]);
  });

  it("une quantite au-dela du stock recoit le maximum, l'etat ne bouge pas", () => {
    const etat: EtatConv = { nom: "quantite", slug: "chez-amina", articleId: "a2", panier: [] };
    const r = reagirAcheteuse(etat, { genre: "texte", texte: "5" }, ctx());
    expect(r.etat).toEqual(etat);
    /* Le plafond est ATTRIBUE a la vendeuse : c'est sa declaration, pas un
       inventaire que Catalog decompte (ADR 0038). */
    expect(corpsTexte(r.messages[0])).toContain("La vendeuse en annonce 2");
  });

  it("le panier compte dans la borne : 2 en stock, 2 au panier, plus rien a commander", () => {
    const r = reagirAcheteuse(
      { nom: "ajout", slug: "chez-amina", panier: [{ articleId: "a2", quantite: 2 }] },
      { genre: "bouton", id: "cmd:a2" },
      ctx(),
    );
    expect(r.etat).toMatchObject({ nom: "ajout" });
    expect(corpsTexte(r.messages[0])).toContain("plus d'exemplaire");
  });

  it("le stock non suivi (null) ne borne que par le plafond de 99", () => {
    const etat: EtatConv = { nom: "quantite", slug: "chez-amina", articleId: "a1", panier: [] };
    const ok = reagirAcheteuse(etat, { genre: "texte", texte: "42" }, ctx());
    expect(ok.etat).toMatchObject({ nom: "ajout" });
    const trop = reagirAcheteuse(etat, { genre: "texte", texte: "150" }, ctx());
    expect(trop.etat).toEqual(etat);
  });
});

describe("aucun etat n'est un piege — mots-cles globaux", () => {
  it("« annuler » tape en pleine quantite vide le panier et revient a l'accueil", () => {
    const r = reagirAcheteuse(
      {
        nom: "quantite",
        slug: "chez-amina",
        articleId: "a1",
        panier: [{ articleId: "a2", quantite: 1 }],
      },
      { genre: "texte", texte: "Annuler" },
      ctx(),
    );
    expect(corpsTexte(r.messages[0])).toMatch(/annulé/);
    expect(r.etat).toEqual({ nom: "catalogue", slug: "chez-amina", page: 0 });
  });

  it("« menu » tape en plein recap revient a l'accueil sans rien creer — et GARDE le panier", () => {
    /* ADR 0035 (T7) : seul « annuler » vide le panier, et il le dit. « menu »
       est une navigation, pas un abandon. */
    const r = reagirAcheteuse(RECAP, { genre: "texte", texte: "menu" }, ctx());
    expect(r.effet).toBeUndefined();
    expect(r.etat).toEqual({
      nom: "catalogue",
      slug: "chez-amina",
      page: 0,
      panier: [{ articleId: "a1", quantite: 2 }],
    });
  });

  it("« aide » repond les gestes disponibles sans perdre l'etat", () => {
    const etat: EtatConv = {
      nom: "mode",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 2 }],
    };
    const r = reagirAcheteuse(etat, { genre: "texte", texte: "aide" }, ctx());
    expect(r.etat).toEqual(etat);
    expect(corpsTexte(r.messages[0])).toMatch(/annuler/);
    /* Le quatrieme mot est ANNONCE : un geste que personne ne connait
       n'existe pas (tranche P1d). */
    expect(corpsTexte(r.messages[0])).toMatch(/panier/);
  });

  it("« panier » ramene au panier depuis N'IMPORTE quel etat, lignes comprises", () => {
    /* En plein flux de livraison — l'endroit ou l'on doute de ce qu'on a
       choisi, et ou il fallait jusqu'ici aller jusqu'au recapitulatif. */
    const r = reagirAcheteuse(
      {
        nom: "details",
        slug: "chez-amina",
        panier: [
          { articleId: "a1", quantite: 2 },
          { articleId: "a2", quantite: 1 },
        ],
        mode: "livraison",
      },
      { genre: "texte", texte: "Panier" },
      ctx(),
    );
    expect(r.etat).toEqual({
      nom: "ajout",
      slug: "chez-amina",
      panier: [
        { articleId: "a1", quantite: 2 },
        { articleId: "a2", quantite: 1 },
      ],
    });
    const corps = corpsBoutons(r.messages[0]);
    expect(corps).toContain("Pagne wax 6 yards × 2");
    expect(corps).toContain("Sac en raphia × 1");
    expect(corps).toContain(formatXaf(38000));
    /* Pas d'accuse de reception : rien n'a ete ajoute. */
    expect(corps).not.toContain("Ajouté");
    expect(idsBoutons(r.messages[0])).toEqual(["commander", "catalogue", "annuler"]);
  });

  it("« panier » vide le DIT, et ne fabrique pas un etat de commande", () => {
    const etat: EtatConv = { nom: "catalogue", slug: "chez-amina", page: 0 };
    const r = reagirAcheteuse(etat, { genre: "texte", texte: "mon panier" }, ctx());
    expect(r.etat).toEqual(etat);
    expect(corpsTexte(r.messages[0])).toMatch(/vide/);
  });

  it("le panier a une ligne EN TETE du catalogue, et un bouton sur la fiche", () => {
    const panier = [{ articleId: "a1", quantite: 2 }];
    const liste = reagirAcheteuse(
      { nom: "ajout", slug: "chez-amina", panier },
      { genre: "bouton", id: "catalogue" },
      ctx(),
    );
    const lignes = (liste.messages[0] as MessageListe).interactive.action.sections[0]?.rows;
    expect(lignes?.[0]).toMatchObject({ id: "panier", description: formatXaf(30000) });

    const fiche = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0, panier },
      { genre: "liste", id: "art:a2" },
      ctx(),
    );
    expect(idsBoutons(fiche.messages.at(-1))).toEqual(["cmd:a2", "cat:0", "panier"]);

    /* Panier vide : ni ligne ni bouton — un raccourci vers rien est du bruit. */
    const nu = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "liste", id: "art:a2" },
      ctx(),
    );
    expect(idsBoutons(nu.messages.at(-1))).toEqual(["cmd:a2", "cat:0"]);
  });
});

describe("la langue du fil", () => {
  it("« english » bascule le fil et re-ouvre l'accueil en anglais", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "texte", texte: "English" },
      ctx(),
    );
    expect(r.langue).toBe("en");
    expect(corpsTexte(r.messages[0])).toContain("English it is");
    expect(corpsBoutons(r.messages[1])).toContain("verifiable receipt");
  });

  it("le fil en anglais parle anglais — quantite, recap, annulation", () => {
    const en = ctx({ langue: "en" });
    const q = reagirAcheteuse(
      { nom: "quantite", slug: "chez-amina", articleId: "a1", panier: [] },
      { genre: "texte", texte: "nonsense" },
      en,
    );
    expect(corpsTexte(q.messages[0])).toContain("did not understand");

    const annule = reagirAcheteuse(RECAP, { genre: "texte", texte: "cancel" }, en);
    expect(corpsTexte(annule.messages[0])).toContain("Cancelled");
  });

  it("« français » ramene au francais", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "texte", texte: "français" },
      ctx({ langue: "en" }),
    );
    expect(r.langue).toBe("fr");
    expect(corpsTexte(r.messages[0])).toContain("on continue en français");
  });
});

describe("questions en langage libre", () => {
  it("« c'est combien ? » recoit la reponse prix avec les boutons de sortie", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "texte", texte: "c'est combien ?" },
      ctx(),
    );
    expect(corpsBoutons(r.messages[0])).toContain("prix");
    expect(idsBoutons(r.messages[0])).toEqual(["catalogue", "vendeuse"]);
  });

  it("« vous avez quelles tailles ? » oriente vers la vendeuse", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "texte", texte: "vous avez quelles tailles ?" },
      ctx(),
    );
    expect(corpsBoutons(r.messages[0])).toContain("vendeuse");
  });

  it("en plein flux, le langage libre n'est PAS une FAQ", () => {
    const etat: EtatConv = {
      nom: "details",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 1 }],
      mode: "livraison",
    };
    const r = reagirAcheteuse(etat, { genre: "texte", texte: "quel prix ?" }, ctx());
    expect(r.etat).toEqual(etat); // reste une aide de details, pas une FAQ
  });
});

describe("« ou est ma commande ? »", () => {
  const STATUT = {
    reference: "CT-104312",
    boutique: "Chez Amina",
    libelle: "Preparee, prete a partir",
    resteXaf: 7500,
  };

  it("repond l'etape et le reste a payer, hors flux de commande", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "texte", texte: "où est ma commande ?" },
      ctx({ derniereCommande: STATUT }),
    );
    const corps = corpsTexte(r.messages[0]);
    expect(corps).toContain("CT-104312");
    expect(corps).toContain(formatXaf(7500));
    expect(corps).toContain("confirmation");
  });

  it("repond aussi sans boutique en contexte, et en anglais", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "status" },
      ctx({ boutique: null, derniereCommande: STATUT, langue: "en" }),
    );
    expect(corpsTexte(r.messages[0])).toContain("CT-104312");
  });

  it("sans commande connue, le dit sans inventer", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "texte", texte: "suivi" },
      ctx({ derniereCommande: null }),
    );
    expect(corpsTexte(r.messages[0])).toMatch(/Aucune commande/);
  });
});

describe("normaliserEtat — les etats persistes de toutes generations", () => {
  it("relit un etat du sprint A (articleId/quantite) comme un panier d'une ligne", () => {
    expect(
      normaliserEtat({
        nom: "details",
        slug: "chez-amina",
        articleId: "a1",
        quantite: 2,
        mode: "livraison",
      }),
    ).toEqual({
      nom: "details",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 2 }],
      mode: "livraison",
    });
  });

  it("relit un etat courant tel quel, et l'illisible retombe a l'accueil", () => {
    const courant: EtatConv = {
      nom: "ajout",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 1 }],
    };
    expect(normaliserEtat(courant)).toEqual(courant);
    for (const brut of [null, 42, {}, { nom: "recap" }, { nom: "quantite", panier: [] }]) {
      expect(normaliserEtat(brut)).toEqual(ETAT_INITIAL);
    }
  });
});

describe("etatApresInactivite", () => {
  it("un flux de commande perime retombe sur le catalogue, panier vide", () => {
    const etat: EtatConv = {
      nom: "recap",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 1 }],
      mode: "livraison",
      livraison: LIVRAISON,
    };
    expect(etatApresInactivite(etat, INACTIVITE_MAX_MS)).toEqual({
      nom: "catalogue",
      slug: "chez-amina",
      page: 0,
    });
    expect(etatApresInactivite(etat, INACTIVITE_MAX_MS - 1)).toEqual(etat);
  });

  it("le catalogue perime perd son panier mais garde sa page", () => {
    const cat: EtatConv = {
      nom: "catalogue",
      slug: "chez-amina",
      page: 2,
      panier: [{ articleId: "a1", quantite: 1 }],
    };
    expect(etatApresInactivite(cat, INACTIVITE_MAX_MS * 30)).toEqual({
      nom: "catalogue",
      slug: "chez-amina",
      page: 2,
    });
  });
});

describe("lireDetailsLivraison", () => {
  it("retrait : le lieu et le telephone suffisent", () => {
    const r = lireDetailsLivraison("Marche central, entree B, 690 11 22 33", "retrait", "Douala");
    expect(r).toEqual({
      ok: true,
      livraison: {
        mode: "retrait",
        pickupPoint: "Marche central, entree B",
        phone: "+237690112233",
      },
    });
  });
  it("accepte le prefixe +237 deja tape", () => {
    const r = lireDetailsLivraison(
      "Akwa, pres du carrefour Douche, +237 655 00 11 22",
      "livraison",
      "Douala",
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.livraison.mode === "livraison") expect(r.livraison.phone).toBe("+237655001122");
  });
});

describe("fil vendeuse", () => {
  it("un SMS reconnu part en verification, sans etre garde dans l'etat", () => {
    const r = reagirVendeuse({ genre: "texte", texte: "Vous avez recu 7500 FCFA…" }, VERS, {
      smsReconnu: true,
      commandesOuvertes: [],
      soldesXaf: 0,
    });
    expect(r.effet).toMatchObject({ type: "verifier_sms" });
    expect(JSON.stringify(r.etat)).not.toContain("7500");
  });

  it("« solde » repond le total et le detail des commandes ouvertes", () => {
    const r = reagirVendeuse({ genre: "texte", texte: "Solde" }, VERS, {
      smsReconnu: false,
      commandesOuvertes: [
        { id: "c1", reference: "CT-1043", resteXaf: 7500 },
        { id: "c2", reference: "CT-1041", resteXaf: 24000 },
      ],
      soldesXaf: 31500,
    });
    const corps = corpsTexte(r.messages[0]);
    expect(corps).toContain(formatXaf(31500));
    expect(corps).toContain("CT-1043");
  });

  it("tout le reste recoit le mode d'emploi du fil", () => {
    const r = reagirVendeuse({ genre: "texte", texte: "bonjour" }, VERS, {
      smsReconnu: false,
      commandesOuvertes: [],
      soldesXaf: 0,
    });
    expect(corpsTexte(r.messages[0])).toMatch(/Collez/);
  });
});

describe("confirmation et verdict", () => {
  it("la confirmation porte le contenu canonique, toutes lignes et livraison relue", () => {
    const messages = confirmationCommande(VERS, {
      reference: "CT-1043",
      codeVerification: "ACDE-4679",
      boutique: "Chez Amina",
      lignes: [
        { nom: "Pagne wax 6 yards", quantite: 2, prixUnitaireXaf: 15000 },
        { nom: "Sac en raphia", quantite: 1, prixUnitaireXaf: 8000 },
      ],
      totalXaf: 38000,
      duAvantXaf: 19000,
      livraison: LIVRAISON,
      lienSuivi: "https://exemple.test/suivi?j=abc",
    });
    const corps = corpsTexte(messages[0]);
    for (const attendu of [
      "CT-1043",
      "Chez Amina",
      "Pagne wax 6 yards × 2",
      "Sac en raphia × 1",
      formatXaf(38000),
      formatXaf(19000),
      "Bonapriso",
      "ACDE-4679",
    ]) {
      expect(corps).toContain(attendu);
    }
    const suite = corpsTexte(messages[1]);
    expect(suite).toMatch(/payer l'acompte/i);
    expect(suite).toMatch(/code secret/i);
  });

  it("sans acompte attendu, la suite parle de SUIVI, jamais de payer", () => {
    const messages = confirmationCommande(VERS, {
      reference: "CT-1044",
      codeVerification: "ACDE-4679",
      boutique: "B",
      lignes: [{ nom: "A", quantite: 1, prixUnitaireXaf: 100 }],
      totalXaf: 100,
      duAvantXaf: 0,
      livraison: { mode: "retrait", pickupPoint: "Marché central", phone: "+237690112233" },
      lienSuivi: "https://exemple.test/suivi?j=abc",
    });
    const suite = corpsTexte(messages[1]);
    expect(suite).not.toMatch(/pour payer/i);
    expect(suite).toMatch(/payez à la réception/i);
  });

  it("la confirmation sait parler anglais", () => {
    const messages = confirmationCommande(
      VERS,
      {
        reference: "CT-1045",
        codeVerification: "ACDE-4679",
        boutique: "B",
        lignes: [{ nom: "A", quantite: 1, prixUnitaireXaf: 100 }],
        totalXaf: 100,
        duAvantXaf: 50,
        livraison: { mode: "retrait", pickupPoint: "Central market", phone: "+237690112233" },
        lienSuivi: "https://exemple.test/suivi?j=abc",
      },
      "en",
    );
    expect(corpsTexte(messages[0])).toContain("Verification code");
    expect(corpsTexte(messages[1])).toContain("deposit");
  });

  it("le verdict se dit en langue simple, refus compris", () => {
    expect(
      corpsTexte(messageVerdict(VERS, { verdict: "accepte", reference: "CT-1043" })),
    ).toContain("CT-1043");
    expect(corpsTexte(messageVerdict(VERS, { verdict: "refuse", reference: null }))).toMatch(
      /contrôles/,
    );
    expect(
      corpsTexte(messageVerdict(VERS, { verdict: "accepte_sous_reserve", reference: null })),
    ).toMatch(/réserve/);
  });
});

/**
 * ADR 0035 — le P0 de la cible premium : rafale d'images, fiche image
 * d'abord, panier qui survit a la navigation, bloc paiement dans le fil,
 * « livree » au mot-cle.
 */
describe("ADR 0035 — la cible premium, fenetre libre", () => {
  const AVEC_PHOTOS: BoutiqueBot = {
    ...BOUTIQUE,
    aDesPhotos: true,
    articles: [
      {
        id: "a1",
        nom: "Pagne wax 6 yards",
        prixXaf: 15000,
        stock: null,
        imageUrl: "https://o/p.jpg",
      },
      { id: "a2", nom: "Sac en raphia", prixXaf: 8000, stock: 2, imageUrl: "https://o/s.jpg" },
      { id: "a3", nom: "Huile de coco", prixXaf: 3500, stock: null },
    ],
  };

  it("l'accueil offre « Voir en photos » quand la boutique a des photos — jamais sinon", () => {
    const avec = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "boutique chez-amina" },
      ctx({ boutique: AVEC_PHOTOS }),
    );
    expect(idsBoutons(avec.messages[0])).toEqual(["catalogue", "photos", "vendeuse"]);

    const sans = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "boutique chez-amina" },
      ctx(),
    );
    expect(idsBoutons(sans.messages[0])).toEqual(["catalogue", "vendeuse"]);
  });

  it("la rafale envoie chaque article illustre en photo legendee, puis la liste", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "photos" },
      ctx({ boutique: AVEC_PHOTOS }),
    );
    const images = r.messages.filter((m) => (m as { type?: string }).type === "image");
    expect(images).toHaveLength(2);
    const premiere = images[0] as { image: { link: string; caption?: string } };
    expect(premiere.image.link).toBe("https://o/p.jpg");
    expect(premiere.image.caption).toBe(`Pagne wax 6 yards — ${formatXaf(15000)}`);
    /* La liste reprend la main derriere la rafale — jamais de cul-de-sac. */
    expect((r.messages.at(-1) as { type?: string }).type).toBe("interactive");
  });

  it("sans aucune photo enrichie, la rafale le dit au lieu de se taire", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "photos" },
      ctx(),
    );
    expect(corpsTexte(r.messages[0])).toMatch(/photo/i);
  });

  it("la fiche part image d'abord : la photo pleine largeur, puis les boutons", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "liste", id: "art:a2" },
      ctx({ boutique: AVEC_PHOTOS }),
    );
    expect(r.messages).toHaveLength(2);
    expect((r.messages[0] as { type?: string }).type).toBe("image");
    expect(idsBoutons(r.messages[1])).toEqual(["cmd:a2", "cat:0"]);
  });

  it("changer de boutique laisse le panier — et le DIT", () => {
    const autre: BoutiqueBot = { ...BOUTIQUE, slug: "chez-bea", nom: "Chez Bea" };
    const r = reagirAcheteuse(
      { nom: "ajout", slug: "chez-amina", panier: [{ articleId: "a1", quantite: 1 }] },
      { genre: "texte", texte: "boutique chez-bea" },
      ctx({ boutique: autre }),
    );
    expect(corpsTexte(r.messages[0])).toMatch(/panier/);
    expect(r.etat).toEqual({ nom: "catalogue", slug: "chez-bea", page: 0 });
  });

  it("revenir a la MEME boutique par son lien garde le panier, sans avertissement", () => {
    const r = reagirAcheteuse(
      { nom: "ajout", slug: "chez-amina", panier: [{ articleId: "a1", quantite: 1 }] },
      { genre: "texte", texte: "boutique chez-amina" },
      ctx(),
    );
    expect(r.etat).toEqual({
      nom: "catalogue",
      slug: "chez-amina",
      page: 0,
      panier: [{ articleId: "a1", quantite: 1 }],
    });
  });

  it("le recap en mode livraison dit « hors livraison » ; le retrait, non", () => {
    const livraison = reagirAcheteuse(
      {
        nom: "details",
        slug: "chez-amina",
        panier: [{ articleId: "a2", quantite: 1 }],
        mode: "livraison",
      },
      { genre: "texte", texte: "Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33" },
      ctx(),
    );
    expect(corpsBoutons(livraison.messages[0])).toMatch(/hors livraison/);

    const retrait = reagirAcheteuse(
      {
        nom: "details",
        slug: "chez-amina",
        panier: [{ articleId: "a2", quantite: 1 }],
        mode: "retrait",
      },
      { genre: "texte", texte: "Marche central, entree B, 690 11 22 33" },
      ctx(),
    );
    expect(corpsBoutons(retrait.messages[0])).not.toMatch(/hors livraison/);
  });

  it("la confirmation porte le bloc paiement en texte brut — code venu de la CONFIGURATION", () => {
    const messages = confirmationCommande(VERS, {
      reference: "CT-1050",
      codeVerification: "ACDE-4679",
      boutique: "Chez Amina",
      lignes: [{ nom: "Sac en raphia", quantite: 2, prixUnitaireXaf: 8000 }],
      totalXaf: 16000,
      duAvantXaf: 8000,
      livraison: LIVRAISON,
      lienSuivi: "https://exemple.test/suivi?j=abc",
      paiement: {
        montantXaf: 8000,
        numeroAffiche: "6 56 74 62 15",
        operateurNom: "Orange Money",
        codeEntree: "#150*50#",
        lienPayer: "https://exemple.test/payer?numero=%2B237656746215&montant=8000",
      },
      waVendeuse: "https://wa.me/237677123456",
    });
    expect(messages).toHaveLength(4);
    const bloc = corpsTexte(messages[1]);
    expect(bloc).toContain(formatXaf(8000));
    expect(bloc).toContain("6 56 74 62 15");
    expect(bloc).toContain("Orange Money");
    expect(bloc).toContain("#150*50#");
    expect(bloc).toMatch(/code secret/i);
    expect(bloc).toContain("/payer?");
    /* Le lien de suivi redevient ce qu'il est : le suivi et le recu. */
    expect(corpsTexte(messages[2])).toContain("suivi?j=abc");
    expect(corpsTexte(messages[3])).toContain("https://wa.me/237677123456");
  });

  it("sans reversement, pas de bloc paiement — la copie historique reprend", () => {
    const messages = confirmationCommande(VERS, {
      reference: "CT-1051",
      codeVerification: "ACDE-4679",
      boutique: "Chez Bea",
      lignes: [{ nom: "Pagne", quantite: 1, prixUnitaireXaf: 15000 }],
      totalXaf: 15000,
      duAvantXaf: 0,
      livraison: LIVRAISON,
      lienSuivi: "https://exemple.test/suivi?j=abc",
      paiement: null,
      waVendeuse: null,
    });
    expect(messages).toHaveLength(2);
    expect(corpsTexte(messages[1])).toMatch(/réception/);
  });

  it("« livrée CT-522801 » sort l'effet marquer_livree — accents et prefixe tolerants", () => {
    const contexte = { smsReconnu: false, commandesOuvertes: [], soldesXaf: 0 };
    const complet = reagirVendeuse({ genre: "texte", texte: "Livrée CT-522801" }, VERS, contexte);
    expect(complet.effet).toEqual({ type: "marquer_livree", reference: "CT-522801" });

    const nu = reagirVendeuse({ genre: "texte", texte: "livree 522801" }, VERS, contexte);
    expect(nu.effet).toEqual({ type: "marquer_livree", reference: "CT-522801" });

    const pasUneRef = reagirVendeuse({ genre: "texte", texte: "livree bientot" }, VERS, contexte);
    expect(pasUneRef.effet).toBeUndefined();
  });
});

describe("le fil vendeuse premium (ADR 0035)", () => {
  const CONTEXTE_NU = { smsReconnu: false, commandesOuvertes: [], soldesXaf: 0 };
  const MA_BOUTIQUE = {
    nom: "Chez Bea",
    nbArticles: 2,
    lienBoutique: "https://wa.me/237600?text=boutique%20chez-bea",
    lienEspace: "https://app.exemple.test",
  };

  it("le SMS reconnu recoit son accuse ✅ pose sur le message meme", () => {
    const r = reagirVendeuse(
      { genre: "texte", texte: "Vous avez recu 8000 XAF …", messageId: "wamid.sms" },
      VERS,
      { ...CONTEXTE_NU, smsReconnu: true },
    );
    expect(r.effet?.type).toBe("verifier_sms");
    const accuse = r.messages[0] as { type?: string; reaction?: { emoji: string } };
    expect(accuse.type).toBe("reaction");
    expect(accuse.reaction?.emoji).toBe("✅");
  });

  it("« ma boutique » est un menu : etat, liens, et les deux gestes qui comptent", () => {
    const r = reagirVendeuse({ genre: "texte", texte: "bonjour" }, VERS, {
      ...CONTEXTE_NU,
      soldesXaf: 8000,
      commandesOuvertes: [{ id: "o1", reference: "CT-100001", resteXaf: 8000 }],
      boutique: MA_BOUTIQUE,
    });
    const menu = corpsBoutons(r.messages[0]);
    expect(menu).toContain("Chez Bea");
    expect(menu).toContain("2 articles en ligne");
    expect(menu).toContain(formatXaf(8000));
    expect(menu).toContain("boutique%20chez-bea");
    expect(menu).toContain("https://app.exemple.test");
    /* La carte n'est proposee qu'avec au moins un article a montrer (ADR 0037). */
    expect(idsBoutons(r.messages[0])).toEqual(["article", "carte", "solde"]);

    const vide = reagirVendeuse({ genre: "texte", texte: "bonjour" }, VERS, {
      ...CONTEXTE_NU,
      boutique: { ...MA_BOUTIQUE, nbArticles: 0 },
    });
    expect(idsBoutons(vide.messages[0])).toEqual(["article", "solde"]);
  });

  it("« ma carte » demande la carte-vitrine, au mot comme au bouton (ADR 0037)", () => {
    for (const entree of [
      { genre: "texte" as const, texte: "ma carte" },
      { genre: "bouton" as const, id: "carte" },
    ]) {
      const r = reagirVendeuse(entree, VERS, { ...CONTEXTE_NU, boutique: MA_BOUTIQUE });
      expect(r.effet).toEqual({ type: "envoyer_carte" });
      /* La machine ne dessine pas : elle demande, le service fabrique. */
      expect(r.messages).toEqual([]);
    }
  });

  it("le bouton « Mes soldes » repond comme le mot « solde »", () => {
    const r = reagirVendeuse({ genre: "bouton", id: "solde" }, VERS, {
      ...CONTEXTE_NU,
      soldesXaf: 8000,
      commandesOuvertes: [{ id: "o1", reference: "CT-100001", resteXaf: 8000 }],
      boutique: MA_BOUTIQUE,
    });
    expect(corpsTexte(r.messages[0])).toContain("CT-100001");
  });

  it("sans boutique chargee, la copie de repli reste — jamais de silence", () => {
    const r = reagirVendeuse({ genre: "texte", texte: "bonjour" }, VERS, CONTEXTE_NU);
    expect(corpsTexte(r.messages[0])).toMatch(/SMS de votre opérateur/);
  });
});

/**
 * ADR 0036 — l'identité du fil : contre-signer et noter sans quitter WhatsApp.
 * L'autorisation vient de `derniereCommande`, jamais d'une référence tapée, et
 * la machine ne redit AUCUNE règle métier : elle propose ce que le service a
 * calculé avec les machines du lot 7 et du lot 12.
 */
describe("l'après-achat dans le fil (ADR 0036)", () => {
  const COMMANDE = {
    reference: "CT-522801",
    boutique: "Chez Amina",
    libelle: "Payée, en préparation.",
    resteXaf: 8000,
    contresignable: true,
    avisPossible: false,
    avisVerifie: false,
    avisDejaDepose: false,
  };
  const avecCommande = (surcharge: Partial<typeof COMMANDE> = {}) =>
    ctx({ derniereCommande: { ...COMMANDE, ...surcharge } });

  it("« Je confirme » contre-signe la commande du fil, et le dit", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "contresigner" },
      avecCommande(),
    );
    expect(r.effet).toEqual({ type: "contresigner" });
    expect(corpsTexte(r.messages[0])).toContain("CT-522801");
    expect(corpsTexte(r.messages[0])).toMatch(/deux voix/);
  });

  it("le mot « confirmer » fait la même chose que le bouton", () => {
    const r = reagirAcheteuse(ETAT_INITIAL, { genre: "texte", texte: "Confirmer" }, avecCommande());
    expect(r.effet).toEqual({ type: "contresigner" });
  });

  it("sans preuve préalable, la contre-signature n'a pas d'objet — et rien ne bouge", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "contresigner" },
      avecCommande({ contresignable: false }),
    );
    expect(r.effet).toBeUndefined();
    expect(corpsTexte(r.messages[0])).toMatch(/plus d'objet/);
  });

  it("SANS commande dans le fil, aucun geste n'est autorisé — on le dit", () => {
    for (const id of ["contresigner", "contester", "avis", "note:5"]) {
      const r = reagirAcheteuse(ETAT_INITIAL, { genre: "bouton", id }, ctx());
      expect(r.effet, id).toBeUndefined();
      expect(corpsTexte(r.messages[0]), id).toMatch(/Aucune commande/);
    }
  });

  it("la contestation se CONFIRME avant de geler quoi que ce soit", () => {
    const demande = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "contester" },
      avecCommande(),
    );
    expect(demande.effet).toBeUndefined();
    expect(corpsBoutons(demande.messages[0])).toMatch(/gèle la commande/);
    expect(idsBoutons(demande.messages[0])).toEqual(["contester:oui", "menu"]);

    const confirme = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "contester:oui" },
      avecCommande(),
    );
    expect(confirme.effet).toEqual({ type: "contester" });
  });

  it("l'avis n'ouvre qu'après livraison, et une seule fois", () => {
    const avant = reagirAcheteuse(ETAT_INITIAL, { genre: "bouton", id: "avis" }, avecCommande());
    expect(avant.effet).toBeUndefined();
    expect(corpsTexte(avant.messages[0])).toMatch(/livrée/);

    const deja = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "avis" },
      avecCommande({ avisPossible: true, avisDejaDepose: true }),
    );
    expect(deja.effet).toBeUndefined();
    expect(corpsTexte(deja.messages[0])).toMatch(/déjà donné/);
  });

  it("« Donner mon avis » propose les cinq notes, la plus haute d'abord", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "avis" },
      avecCommande({ avisPossible: true }),
    );
    const m = r.messages[0] as MessageListe;
    const lignes = m.interactive.action.sections[0]?.rows ?? [];
    expect(lignes.map((l) => l.id)).toEqual(["note:5", "note:4", "note:3", "note:2", "note:1"]);
    expect(lignes[0]?.title).toBe("⭐⭐⭐⭐⭐");
  });

  it("la note s'enregistre TOUT DE SUITE, le mot vient ensuite", () => {
    const note = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "liste", id: "note:5" },
      avecCommande({ avisPossible: true, avisVerifie: true }),
    );
    expect(note.effet).toEqual({ type: "deposer_avis", note: 5 });
    expect(note.etat).toEqual({ nom: "avis_mot" });
    expect(corpsBoutons(note.messages[0])).toMatch(/achat vérifié/);

    const mot = reagirAcheteuse(
      { nom: "avis_mot" },
      { genre: "texte", texte: "Le sac est magnifique" },
      avecCommande({ avisPossible: true }),
    );
    expect(mot.effet).toEqual({ type: "completer_avis", texte: "Le sac est magnifique" });
    expect(mot.etat).toEqual(ETAT_INITIAL);
  });

  it("un paiement sans preuve donne un avis publié mais NON vérifié — et le dit", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "liste", id: "note:4" },
      avecCommande({ avisPossible: true, avisVerifie: false }),
    );
    expect(corpsBoutons(r.messages[0])).toMatch(/pas marqué/);
  });

  it("« Sans commentaire » clôt sans effet, et l'attente périme sans rien perdre", () => {
    const sans = reagirAcheteuse(
      { nom: "avis_mot" },
      { genre: "bouton", id: "avis:sans_mot" },
      avecCommande({ avisPossible: true }),
    );
    expect(sans.effet).toBeUndefined();
    expect(sans.etat).toEqual(ETAT_INITIAL);
    /* La note est deja en base : l'expiration ne perd que le mot. */
    expect(etatApresInactivite({ nom: "avis_mot" }, INACTIVITE_MAX_MS)).toEqual(ETAT_INITIAL);
    expect(normaliserEtat({ nom: "avis_mot" })).toEqual({ nom: "avis_mot" });
  });

  it("une note hors échelle est refusée, jamais ramenée au bord", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "liste", id: "note:9" },
      avecCommande({ avisPossible: true }),
    );
    expect(r.effet).toBeUndefined();
  });
});
