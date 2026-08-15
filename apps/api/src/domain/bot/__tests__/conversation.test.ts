import { formatXaf } from "@catalog/contracts/money";
import { describe, expect, it } from "vitest";
import type { ArticleVendeuse, BoutiqueBot, ContexteAcheteuse, EtatConv } from "../conversation.ts";
import {
  confirmationCommande,
  ETAT_INITIAL,
  etatApresInactivite,
  extraireSlugBoutique,
  ficheArticleVendeuse,
  INACTIVITE_MAX_MS,
  lireDetailsLivraison,
  listeArticlesVendeuse,
  messageVerdict,
  normaliserEtat,
  RAFALE_MAX,
  reagirAcheteuse,
  reagirVendeuse,
} from "../conversation.ts";
import { demandeMesArticles } from "../inscription.ts";
import type { MessageBoutons, MessageListe, MessageTexte } from "../messages.ts";
import { TEXTES } from "../textes.ts";

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
/* La quantite est passee du bouton a la LISTE (ADR 0053) : meme corps, autre
   action. */
const corpsListe = (m: unknown) => (m as MessageListe).interactive.body.text;
const lignesListe = (m: unknown) =>
  (m as MessageListe).interactive.action.sections.flatMap((sec) => sec.rows.map((r) => r.id));
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
    expect(idsBoutons(r.messages[0])).toEqual(["commander", "catalogue", "vendeuse"]);
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
    expect(corps).toContain("690 11 22 33");
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

  it("« Corriger » rouvre la SAISIE de livraison, pas l'etape panier — ADR 0053", () => {
    /* Avant l'ADR 0053, corriger un chiffre de la ligne de livraison
       renvoyait a l'etape panier : il fallait re-traverser mode, ville ET
       details. On rouvre desormais la saisie, la ou l'erreur a ete faite. */
    const r = reagirAcheteuse(RECAP, { genre: "bouton", id: "corriger" }, ctx());
    expect(r.etat).toMatchObject({
      nom: "details",
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
    /* La quantite est une LISTE depuis l'ADR 0053 : le stock la borne, et
       « un autre nombre » disparait quand il n'y a rien au-dela. La derniere
       ligne est une sortie — jamais un cul-de-sac. */
    expect(corpsListe(r.messages[0])).toContain("(2 en stock)");
    expect(lignesListe(r.messages[0])).toEqual(["qte:1", "qte:2", "vendeuse"]);
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
    expect(idsBoutons(r.messages[0])).toEqual(["commander", "catalogue", "vendeuse"]);
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

describe("le mode congés — la boutique reste une vitrine (ADR 0039)", () => {
  const FERMEE: BoutiqueBot = { ...BOUTIQUE, enConges: true };
  const ctxF = (s: Partial<ContexteAcheteuse> = {}): ContexteAcheteuse => ({
    vers: VERS,
    boutique: FERMEE,
    ...s,
  });

  it("le dit A L'ACCUEIL, avant qu'on ait choisi quoi que ce soit", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "Voir la boutique chez-amina" },
      ctxF(),
    );
    const corps = corpsBoutons(r.messages[0]);
    expect(corps).toMatch(/nouvelle commande/);
    /* La vitrine reste entière : catalogue, photos, vendeuse. */
    expect(idsBoutons(r.messages[0])).toContain("catalogue");
    expect(idsBoutons(r.messages[0])).toContain("vendeuse");
  });

  it("la fiche n'offre PAS « Commander » — elle offre la vendeuse", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "liste", id: "art:a1" },
      ctxF(),
    );
    const ids = idsBoutons(r.messages.at(-1));
    expect(ids).not.toContain("cmd:a1");
    expect(ids).toEqual(["vendeuse", "cat:0"]);
  });

  it("refuse les TROIS gestes qui mènent à une commande, sans rien créer", () => {
    /* Un fil ouvert avant le départ porte encore ses anciens boutons, et
       WhatsApp laisse les appuyer. « confirmer » est le dernier verrou. */
    for (const id of ["cmd:a1", "commander", "confirmer"]) {
      const r = reagirAcheteuse(RECAP, { genre: "bouton", id }, ctxF());
      expect(r.effet, id).toBeUndefined();
      expect(corpsBoutons(r.messages[0]), id).toMatch(/nouvelle commande/);
      /* L'état ne bouge pas : le panier survit, la commande n'existe pas. */
      expect(r.etat, id).toEqual(RECAP);
    }
  });

  it("laisse tout le reste marcher — catalogue, panier, suivi", () => {
    const catalogue = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "catalogue" },
      ctxF(),
    );
    expect(
      (catalogue.messages[0] as MessageListe).interactive.action.sections[0]?.rows.length,
    ).toBe(2);

    const panier = reagirAcheteuse(
      { nom: "ajout", slug: "chez-amina", panier: [{ articleId: "a1", quantite: 2 }] },
      { genre: "texte", texte: "panier" },
      ctxF(),
    );
    expect(corpsBoutons(panier.messages[0])).toContain("Pagne wax 6 yards × 2");
  });

  it("ouverte, rien ne change : « Commander » est là et la commande passe", () => {
    const fiche = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "liste", id: "art:a1" },
      ctx(),
    );
    expect(idsBoutons(fiche.messages.at(-1))).toContain("cmd:a1");

    const creation = reagirAcheteuse(RECAP, { genre: "bouton", id: "confirmer" }, ctx());
    expect(creation.effet?.type).toBe("creer_commande");
  });
});

describe("le fil vendeuse en congés (ADR 0039)", () => {
  const vendeuse = (enConges: boolean, entree: Parameters<typeof reagirVendeuse>[0]) =>
    reagirVendeuse(entree, VERS, {
      smsReconnu: false,
      commandesOuvertes: [{ id: "o1", reference: "CT-104312", resteXaf: 7500 }],
      soldesXaf: 7500,
      boutique: {
        nom: "Chez Amina",
        nbArticles: 3,
        lienBoutique: "https://wa.me/237600000000?text=boutique%20chez-amina",
        lienEspace: "https://app.test",
        ...(enConges ? { enConges: true } : {}),
      },
    });

  it("« congés » ferme, « je reprends » rouvre — deux gestes symétriques", () => {
    expect(vendeuse(false, { genre: "texte", texte: "Congés" }).effet).toEqual({
      type: "basculer_conges",
      fermer: true,
    });
    expect(vendeuse(true, { genre: "bouton", id: "rouvrir" }).effet).toEqual({
      type: "basculer_conges",
      fermer: false,
    });
    expect(vendeuse(true, { genre: "texte", texte: "je reprends" }).effet).toEqual({
      type: "basculer_conges",
      fermer: false,
    });
  });

  it("le menu dit l'état, et propose le geste inverse", () => {
    const ouverte = vendeuse(false, { genre: "texte", texte: "ma boutique" });
    expect(corpsBoutons(ouverte.messages[0])).toMatch(/Écrivez « congés »/);
    expect(idsBoutons(ouverte.messages[0])).not.toContain("rouvrir");

    const fermee = vendeuse(true, { genre: "texte", texte: "ma boutique" });
    expect(corpsBoutons(fermee.messages[0])).toMatch(/En congés/);
    /* Trois boutons au maximum : la carte à partager cède la place. */
    const ids = idsBoutons(fermee.messages[0]);
    expect(ids).toEqual(["rouvrir", "article", "solde"]);
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
    /* Depuis l'ADR 0050, un `details` de livraison SANS ville retourne
       demander la ville : elle etait injectee depuis la boutique, et on ne
       la devine plus. Le panier est intact — rien n'est perdu. */
    expect(
      normaliserEtat({
        nom: "details",
        slug: "chez-amina",
        articleId: "a1",
        quantite: 2,
        mode: "livraison",
      }),
    ).toEqual({
      nom: "ville",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 2 }],
    });
  });

  it("un `details` de RETRAIT se relit tel quel — le retrait n'a pas de ville", () => {
    expect(
      normaliserEtat({
        nom: "details",
        slug: "chez-amina",
        panier: [{ articleId: "a1", quantite: 2 }],
        mode: "retrait",
      }),
    ).toEqual({
      nom: "details",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 2 }],
      mode: "retrait",
    });
  });

  it("un `details` de livraison AVEC ville se relit tel quel", () => {
    expect(
      normaliserEtat({
        nom: "details",
        slug: "chez-amina",
        panier: [{ articleId: "a1", quantite: 1 }],
        mode: "livraison",
        ville: "Bafoussam",
      }),
    ).toEqual({
      nom: "details",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 1 }],
      mode: "livraison",
      ville: "Bafoussam",
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

  /**
   * Le defaut mesure en preproduction le 15/08/2026 au soir — ADR 0105.
   *
   * Une boutique de HUIT articles dont seuls les DERNIERS sont illustres
   * (un article neuf prend `position = max + 1`, donc il arrive en fin de
   * liste) : l'acheteuse touchait « Voir les photos » et lisait « cette
   * boutique n'a pas encore de photos », alors que le stockage les avait.
   *
   * Deux tranches qui ne parlaient pas de la meme chose. Le service enrichit
   * les articles ILLUSTRES (`illustres.slice(0, RAFALE_MAX)`), le rendu
   * prenait les PREMIERS (`articles.slice(0, RAFALE_MAX)`). Au-dela de six
   * articles, les deux ensembles cessent de se recouvrir, et la rafale se
   * vide alors meme que le service a fait son travail.
   *
   * Trois articles ne pouvaient pas l'attraper : la tranche ne mord qu'a
   * partir du septieme.
   */
  it("la rafale suit les articles ILLUSTRES, meme places apres la tranche", () => {
    const NEUF_DONT_DEUX_ILLUSTRES = {
      ...AVEC_PHOTOS,
      articles: [
        ...Array.from({ length: 7 }, (_, i) => ({
          id: `vieux${i}`,
          nom: `Ancien ${i}`,
          prixXaf: 1000,
          stock: null,
        })),
        { id: "neuf1", nom: "Sac neuf", prixXaf: 2000, stock: 1, imageUrl: "https://o/neuf1.jpg" },
        {
          id: "neuf2",
          nom: "Pagne neuf",
          prixXaf: 3000,
          stock: 1,
          imageUrl: "https://o/neuf2.jpg",
        },
      ],
    };
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "photos" },
      ctx({ boutique: NEUF_DONT_DEUX_ILLUSTRES }),
    );
    const images = r.messages.filter((m) => (m as { type?: string }).type === "image");
    expect(images).toHaveLength(2);
    expect((images[0] as { image: { link: string } }).image.link).toBe("https://o/neuf1.jpg");
    /* Image d'ABORD, et surtout PAS le repli « aucune photo » : il mentait a
       l'acheteuse pendant que le stockage tenait ses deux objets. */
    expect((r.messages[0] as { type?: string }).type).toBe("image");
    expect(JSON.stringify(r.messages)).not.toMatch(TEXTES.fr.rafaleAucunePhoto);
  });

  it("la rafale reste bornee a RAFALE_MAX, meme si tout est illustre", () => {
    const TOUT_ILLUSTRE = {
      ...AVEC_PHOTOS,
      articles: Array.from({ length: 10 }, (_, i) => ({
        id: `a${i}`,
        nom: `Article ${i}`,
        prixXaf: 1000,
        stock: null,
        imageUrl: `https://o/${i}.jpg`,
      })),
    };
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "photos" },
      ctx({ boutique: TOUT_ILLUSTRE }),
    );
    const images = r.messages.filter((m) => (m as { type?: string }).type === "image");
    expect(images).toHaveLength(RAFALE_MAX);
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
    /**
     * DEUX messages, jamais quatre — banc du 12/08/2026. Le premier est le
     * document (commande + comment payer), le second le carnet d'adresses
     * (suivi + vendeuse). La salve de quatre noyait le geste attendu.
     */
    expect(messages).toHaveLength(2);
    const document = corpsTexte(messages[0]);
    expect(document).toContain("CT-1050");
    expect(document).toContain(formatXaf(8000));
    expect(document).toContain("6 56 74 62 15");
    expect(document).toContain("Orange Money");
    expect(document).toContain("#150*50#");
    expect(document).toMatch(/code secret/i);
    expect(document).toContain("/payer?");
    /* Le lien de suivi redevient ce qu'il est : le suivi et le recu. */
    const carnet = corpsTexte(messages[1]);
    expect(carnet).toContain("suivi?j=abc");
    expect(carnet).toContain("https://wa.me/237677123456");
  });

  it("le carnet distribue la page de verification — /v/?c=, la forme sans reecriture", () => {
    const avec = (lienVerification: string | null, duAvantXaf: number) =>
      confirmationCommande(VERS, {
        reference: "CT-1052",
        codeVerification: "ACDE-4679",
        boutique: "Chez Amina",
        lignes: [{ nom: "Sac", quantite: 1, prixUnitaireXaf: 8000 }],
        totalXaf: 8000,
        duAvantXaf,
        livraison: LIVRAISON,
        lienSuivi: "https://exemple.test/suivi?j=abc",
        lienVerification,
      });
    /* Avec acompte : la ligne part, sous la forme portable. */
    const carnet = corpsTexte(avec("https://exemple.test/v/?c=ACDE-4679", 4000)[1]);
    expect(carnet).toContain("/v/?c=ACDE-4679");
    expect(carnet).toMatch(/n'importe qui peut contrôler/i);
    /* Sans prepaiement : pas de recu a promettre, pas de ligne. */
    expect(corpsTexte(avec("https://exemple.test/v/?c=ACDE-4679", 0)[1])).not.toContain("/v/?c=");
    /* Sans base publique : rien, jamais une URL fausse. */
    expect(corpsTexte(avec(null, 4000)[1])).not.toContain("/v/");
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

  it("« suivi » redit l'ETAT — chemin complet, reste, preuve — sans jamais le jeton", () => {
    /**
     * Banc du 12/08/2026 : la reponse se limitait a l'etape courante et a
     * « votre lien est plus haut dans ce fil » — une fouille archeologique.
     * L'etat n'est pas un secret ; le jeton, si. On dit tout l'un, jamais
     * l'autre.
     */
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "suivi" },
      ctx({
        derniereCommande: {
          reference: "CT-522801",
          boutique: "Chez Amina",
          libelle: "Préparée.",
          resteXaf: 16800,
          etapes: [
            { libelle: "Commande reçue", faite: true, courante: false },
            { libelle: "Préparée", faite: true, courante: true },
            { libelle: "Chez le livreur", faite: false, courante: false },
            { libelle: "Livrée", faite: false, courante: false },
          ],
          preuve: "prouve",
        },
      }),
    );
    const corps = corpsTexte(r.messages[0]);
    expect(corps).toContain("✓ Commande reçue");
    expect(corps).toContain("➔ Préparée");
    expect(corps).toContain("○ Livrée");
    expect(corps).toContain(formatXaf(16800));
    expect(corps).toMatch(/reçu vérifiable est émis/);
    expect(corps).not.toMatch(/https?:\/\//);
  });

  it("une preuve contestee ou non tracee se dit ; une preuve attendue se tait", () => {
    const statut = (preuve: "conteste" | "non_trace" | null) =>
      corpsTexte(
        reagirAcheteuse(
          ETAT_INITIAL,
          { genre: "texte", texte: "suivi" },
          ctx({
            derniereCommande: {
              reference: "CT-1",
              boutique: "B",
              libelle: "Commande reçue.",
              resteXaf: 0,
              preuve,
            },
          }),
        ).messages[0],
      );
    expect(statut("conteste")).toMatch(/gelée/);
    expect(statut("non_trace")).toMatch(/non tracé/);
    /* attendu (null) : le reste a payer dit deja tout — pas de ligne en plus. */
    expect(statut(null)).not.toMatch(/prouvé|gelée|non tracé/);
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

/**
 * Le catalogue de la VENDEUSE — ADR 0107.
 *
 * Le besoin, dit le 15/08/2026 : « la boutique n'a pas de catalogue WhatsApp
 * où [la vendeuse] peut consulter ses articles listés et voir les stocks ».
 * Le menu annonçait « 8 articles en ligne » et s'arrêtait là.
 */
describe("le catalogue vendeuse (ADR 0107)", () => {
  const CTX_VENDEUSE: Parameters<typeof reagirVendeuse>[2] = {
    smsReconnu: false,
    commandesOuvertes: [],
    soldesXaf: 0,
    boutique: {
      nom: "Chez Béa",
      nbArticles: 4,
      lienBoutique: "https://b.test/chez-bea",
      lienEspace: null,
    },
  };
  const ART = (n: number, sur: Partial<ArticleVendeuse> = {}): ArticleVendeuse => ({
    id: `p${n}`,
    nom: `Article ${n}`,
    prixXaf: 1000 * n,
    stock: null,
    avecPhoto: true,
    ...sur,
  });
  const lignesDe = (m: unknown) =>
    (m as MessageListe).interactive.action.sections[0]?.rows ??
    ([] as Array<{ id: string; title: string; description?: string }>);

  it("le mot se reconnait sous ses formes, accents et pluriels compris", () => {
    for (const m of ["mes articles", "Mon catalogue", "STOCK", "mes stocks", "inventaire"]) {
      expect(demandeMesArticles(m)).toBe(true);
    }
    /* Et pas ce qui n'est pas une demande : « stock épuisé » est une phrase. */
    for (const m of ["stock épuisé", "ajouter", "combien de stock ?", ""]) {
      expect(demandeMesArticles(m)).toBe(false);
    }
  });

  it("chaque ligne porte le prix ET le stock — c'est tout l'objet du geste", () => {
    const r = listeArticlesVendeuse("237600", {
      nom: "Chez Béa",
      articles: [
        ART(1, { stock: 3 }),
        ART(2, { stock: null }),
        ART(3, { stock: 0 }),
        ART(4, { avecPhoto: false }),
      ],
    });
    const rows = lignesDe(r[0]);
    expect(rows.map((l) => l.description)).toEqual([
      `${formatXaf(1000)} · 3 en stock`,
      `${formatXaf(2000)} · stock non suivi`,
      `${formatXaf(3000)} · épuisé`,
      `${formatXaf(4000)} · stock non suivi · pas de photo`,
    ]);
    expect(rows.map((l) => l.id)).toEqual(["vart:p1", "vart:p2", "vart:p3", "vart:p4"]);
  });

  it("dit que le stock ne se décompte pas — jamais une rareté qu'on ne tient pas", () => {
    const r = listeArticlesVendeuse("237600", {
      nom: "Chez Béa",
      articles: [ART(1, { stock: 2 })],
    });
    expect(corpsListe(r[0])).toMatch(/ne se décomptent pas/i);
  });

  it("pagine au-delà de neuf, et la suite reprend là où on s'est arrêté", () => {
    const boutique = {
      nom: "Chez Béa",
      articles: Array.from({ length: 14 }, (_, i) => ART(i + 1)),
    };
    const page0 = lignesDe(listeArticlesVendeuse("237600", boutique)[0]);
    expect(page0).toHaveLength(10);
    expect(page0.at(-1)).toMatchObject({ id: "varts:1", title: "Voir la suite" });

    const page1 = lignesDe(listeArticlesVendeuse("237600", boutique, 1)[0]);
    expect(page1).toHaveLength(5);
    expect(page1[0]?.id).toBe("vart:p10");
    expect(page1.some((l) => l.id.startsWith("varts:"))).toBe(false);
  });

  it("sans aucun article, invite à en ajouter au lieu de rendre une liste vide", () => {
    const r = listeArticlesVendeuse("237600", { nom: "Chez Béa", articles: [] });
    expect(corpsBoutons(r[0])).toMatch(/aucun article/i);
    expect((r[0] as MessageBoutons).interactive.action.buttons[0]?.reply.id).toBe("article");
  });

  it("la fiche met la PHOTO devant — c'est ce qu'elle vient vérifier", () => {
    const r = ficheArticleVendeuse("237600", {
      ...ART(1, { stock: 5 }),
      imageUrl: "https://o/p1.jpg",
    });
    expect((r[0] as { type?: string }).type).toBe("image");
    expect((r[0] as { image: { link: string } }).image.link).toBe("https://o/p1.jpg");
    expect(corpsBoutons(r[1])).toContain("5 en stock");
  });

  it("sans photo, la fiche le dit et explique comment en mettre une", () => {
    const r = ficheArticleVendeuse("237600", ART(1, { avecPhoto: false }));
    expect(r).toHaveLength(1);
    expect(corpsBoutons(r[0])).toMatch(/n'a pas de photo/i);
    expect(corpsBoutons(r[0])).toMatch(/envoyez-la/i);
  });

  it("« mes articles » et une ligne rendent des EFFETS, jamais des messages devinés", () => {
    const menu = reagirVendeuse({ genre: "texte", texte: "mes articles" }, "237600", CTX_VENDEUSE);
    expect(menu.effet).toEqual({ type: "lister_articles", page: 0 });
    expect(menu.messages).toEqual([]);

    const suite = reagirVendeuse({ genre: "liste", id: "varts:2" }, "237600", CTX_VENDEUSE);
    expect(suite.effet).toEqual({ type: "lister_articles", page: 2 });

    const fiche = reagirVendeuse({ genre: "liste", id: "vart:abc" }, "237600", CTX_VENDEUSE);
    expect(fiche.effet).toEqual({ type: "montrer_article", articleId: "abc" });
  });

  it("le menu ANNONCE le mot : un geste que personne ne connaît n'existe pas", () => {
    const r = reagirVendeuse({ genre: "texte", texte: "ma boutique" }, "237600", {
      ...CTX_VENDEUSE,
      boutique: {
        nom: "Chez Béa",
        nbArticles: 8,
        lienBoutique: "https://b.test/chez-bea",
        lienEspace: null,
      },
    });
    expect(corpsBoutons(r.messages[0])).toMatch(/« mes articles »/);
  });
});
