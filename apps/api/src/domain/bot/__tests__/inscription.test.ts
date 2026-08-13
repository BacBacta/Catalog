import { formatXaf } from "@catalog/contracts/money";
import { describe, expect, it } from "vitest";
import { INACTIVITE_MAX_MS } from "../conversation.ts";
import {
  demandeAjoutArticle,
  demandeEspaceVendeuse,
  demandeInscription,
  type EtatVendeuse,
  etatVendeuseApresInactivite,
  lireLegendeArticle,
  lirePrix,
  messageArticlePublie,
  messageBoutiqueCreee,
  normaliserEtatVendeuse,
  reagirInscription,
} from "../inscription.ts";
import type { MessageBoutons, MessageListe, MessageTexte } from "../messages.ts";

/**
 * L'inscription dans le fil — ADR 0034. Chaque test est un echange, comme
 * pour la machine acheteuse : la boutique et l'article naissent d'un effet,
 * jamais d'un message.
 */

const VERS = "237690112233";
const corps = (m: unknown) =>
  (m as MessageTexte).text?.body ?? (m as MessageBoutons).interactive.body.text;
const idsBoutons = (m: unknown) =>
  (m as MessageBoutons).interactive.action.buttons.map((b) => b.reply.id);
const idsListe = (m: unknown) =>
  ((m as MessageListe).interactive.action.sections[0]?.rows ?? []).map((r) => r.id);

describe("les mots d'entree", () => {
  it("« vendre » sous ses formes, parrainage compris", () => {
    expect(demandeInscription("vendre")).toEqual({});
    expect(demandeInscription("Je veux vendre")).toEqual({});
    expect(demandeInscription("Ouvrir ma boutique")).toEqual({});
    expect(demandeInscription("vendre avec chez-amina")).toEqual({ parrain: "chez-amina" });
    expect(demandeInscription("bonjour")).toBeNull();
    // Un slug de boutique nu n'est PAS une demande d'inscription.
    expect(demandeInscription("chez-amina")).toBeNull();
  });

  it("« ajouter » et « ma boutique » se distinguent", () => {
    expect(demandeAjoutArticle("ajouter un article")).toBe(true);
    expect(demandeAjoutArticle("Ajouter")).toBe(true);
    expect(demandeAjoutArticle("ajouter du sucre")).toBe(false);
    expect(demandeEspaceVendeuse("Ma boutique")).toBe(true);
    expect(demandeEspaceVendeuse("ma boutique preferee")).toBe(false);
  });
});

describe("lirePrix — le franc n'a pas de sous-unite", () => {
  it("accepte les separateurs, la devise et les espaces", () => {
    expect(lirePrix("15000")).toBe(15000);
    expect(lirePrix("15 000")).toBe(15000);
    expect(lirePrix("15.000")).toBe(15000);
    expect(lirePrix("15000 FCFA")).toBe(15000);
    expect(lirePrix(" 15000f ")).toBe(15000);
  });
  it("refuse ce qui n'est pas un prix", () => {
    for (const brut of ["", "gratuit", "zero", "0", "abc"]) {
      expect(lirePrix(brut), brut).toBeNull();
    }
    expect(lirePrix("999999999999")).toBeNull();
  });
});

describe("l'inscription, etat par etat", () => {
  it("le nom puis la ville menent a l'effet de creation, parrain conserve", () => {
    const nom = reagirInscription(
      { nom: "inscription_nom", parrain: "chez-amina" },
      { genre: "texte", texte: "  Chez Bea  " },
      VERS,
    );
    expect(nom.etat).toEqual({
      nom: "inscription_ville",
      nomBoutique: "Chez Bea",
      parrain: "chez-amina",
    });
    expect(corps(nom.messages[0])).toContain("ville");

    const ville = reagirInscription(
      nom.etat as EtatVendeuse,
      { genre: "texte", texte: "Douala" },
      VERS,
    );
    expect(ville.effet).toEqual({
      type: "creer_boutique",
      nomBoutique: "Chez Bea",
      ville: "Douala",
      parrain: "chez-amina",
    });
    // Rien n'est dit ici : le slug n'existe pas encore, et il ne s'invente pas.
    expect(ville.messages).toEqual([]);
    expect(ville.etat).toBeNull();
  });

  it("un nom ou une ville vides redemandent, sans avancer", () => {
    const etat: EtatVendeuse = { nom: "inscription_nom" };
    const vide = reagirInscription(etat, { genre: "texte", texte: " " }, VERS);
    expect(vide.etat).toEqual(etat);
    const image = reagirInscription(etat, { genre: "image", mediaId: "m1" }, VERS);
    expect(image.etat).toEqual(etat);

    const ville: EtatVendeuse = { nom: "inscription_ville", nomBoutique: "B" };
    expect(reagirInscription(ville, { genre: "texte", texte: "" }, VERS).etat).toEqual(ville);
  });

  it("« annuler » sort du fil a n'importe quelle etape", () => {
    for (const etat of [
      { nom: "inscription_nom" },
      { nom: "inscription_ville", nomBoutique: "B" },
      { nom: "article_prix", nomArticle: "A" },
    ] as EtatVendeuse[]) {
      const r = reagirInscription(etat, { genre: "texte", texte: "annuler" }, VERS);
      expect(r.etat).toBeNull();
      expect(r.effet).toBeUndefined();
      expect(corps(r.messages[0])).toMatch(/annulé/);
    }
  });
});

describe("l'ajout d'article, photo comprise", () => {
  it("nom, prix, photo — l'effet porte le media", () => {
    const nom = reagirInscription(
      { nom: "article_nom" },
      { genre: "texte", texte: "Pagne wax" },
      VERS,
    );
    expect(nom.etat).toEqual({ nom: "article_prix", nomArticle: "Pagne wax" });

    const prix = reagirInscription(
      nom.etat as EtatVendeuse,
      { genre: "texte", texte: "15 000 F" },
      VERS,
    );
    expect(prix.etat).toEqual({ nom: "article_photo", nomArticle: "Pagne wax", prixXaf: 15000 });
    expect(corps(prix.messages[0])).toContain(formatXaf(15000));
    expect(idsBoutons(prix.messages[0])).toEqual(["sans_photo"]);

    const photo = reagirInscription(
      prix.etat as EtatVendeuse,
      { genre: "image", mediaId: "MEDIA-9" },
      VERS,
    );
    expect(photo.effet).toEqual({
      type: "creer_article",
      nom: "Pagne wax",
      prixXaf: 15000,
      mediaId: "MEDIA-9",
    });
    expect(photo.etat).toBeNull();
  });

  it("« Sans photo » publie quand meme — un article sans photo vaut mieux qu'aucun", () => {
    const r = reagirInscription(
      { nom: "article_photo", nomArticle: "Savon", prixXaf: 1500 },
      { genre: "bouton", id: "sans_photo" },
      VERS,
    );
    expect(r.effet).toEqual({ type: "creer_article", nom: "Savon", prixXaf: 1500 });
  });

  it("un prix incomprehensible redemande, et un texte a la place d'une photo aussi", () => {
    const prix: EtatVendeuse = { nom: "article_prix", nomArticle: "A" };
    const rate = reagirInscription(prix, { genre: "texte", texte: "cher" }, VERS);
    expect(rate.etat).toEqual(prix);
    expect(corps(rate.messages[0])).toMatch(/chiffres/);

    const photo: EtatVendeuse = { nom: "article_photo", nomArticle: "A", prixXaf: 100 };
    const bavard = reagirInscription(photo, { genre: "texte", texte: "elle arrive" }, VERS);
    expect(bavard.etat).toEqual(photo);
    expect(idsBoutons(bavard.messages[0])).toEqual(["sans_photo"]);
  });
});

describe("les messages de publication", () => {
  const MESSAGERIE = {
    nom: "Chez Bea",
    lienBoutique: "https://wa.me/237600?text=boutique%20chez-bea",
    lienParrainage: "https://wa.me/237600?text=vendre%20avec%20chez-bea",
    lienEspace: null,
  };

  it("la boutique creee porte SES deux liens et enchaine sur l'article", () => {
    const messages = messageBoutiqueCreee(VERS, MESSAGERIE);
    /**
     * UN SEUL message — banc du 13/08/2026. L'ouverture en produisait cinq
     * d'affilee : « une serie de liens, de messages apparaissent, ce qui
     * noie l'essentiel ». Ce qui reste est ce dont elle a besoin dans la
     * minute — son lien, et le geste suivant.
     */
    expect(messages).toHaveLength(1);
    expect(corps(messages[0])).toContain("Chez Bea");
    expect(corps(messages[0])).toContain("boutique%20chez-bea");
    /* Le menu est une LISTE, pas des boutons — ADR 0088. Trois boutons ne
       tenaient pas tout ce qu'une vendeuse neuve peut vouloir faire, et le
       reste retombait en texte : c'est ce qui produisait le mur. */
    expect(idsListe(messages[0])).toEqual(["article", "carte", "ma_boutique"]);
    /* Le reversement et le parrainage sont SERVIS AILLEURS — relance a
       ~20 h, notification de premiere commande, menu « ma boutique » —, et
       surtout pas dans la salve d'ouverture. */
    expect(corps(messages[0])).not.toContain("vendre%20avec%20chez-bea");
    expect(corps(messages[0])).not.toMatch(/vérification/);
  });

  /**
   * Le formulaire d'ouverture rend la boutique ET l'article — ADR 0088. Deux
   * bulles pour un seul formulaire rempli, c'etait deja du bruit : la
   * capture du 13/08 en montrait quatre.
   */
  it("l'ouverture fusionne l'article du second ecran dans SA bulle", () => {
    const messages = messageBoutiqueCreee(VERS, MESSAGERIE, {
      nom: "Chaussures",
      prixXaf: 1000,
      avecPhoto: false,
    });
    expect(messages).toHaveLength(1);
    expect(corps(messages[0])).toContain("Chez Bea");
    expect(corps(messages[0])).toContain("Chaussures");
    expect(corps(messages[0])).toContain(formatXaf(1000));
    expect(corps(messages[0])).toMatch(/sans photo/i);
  });

  /**
   * Le lien de boutique reste du TEXTE, meme si `cta_url` est accepte depuis
   * la mesure du 13/08 (ADR 0087). Elle doit le COPIER pour son Statut : un
   * bouton l'ouvrirait au lieu de le donner.
   */
  it("le lien a partager est dans le corps, copiable, jamais derriere un bouton", () => {
    const messages = messageBoutiqueCreee(VERS, MESSAGERIE);
    expect(corps(messages[0])).toContain(MESSAGERIE.lienBoutique);
  });

  it("l'article publie dit le prix, et le manque de photo sans le reprocher", () => {
    const avec = messageArticlePublie(VERS, { nom: "Pagne", prixXaf: 15000, avecPhoto: true });
    expect(corps(avec)).toContain(formatXaf(15000));
    expect(corps(avec)).not.toMatch(/sans photo/i);
    const sans = messageArticlePublie(VERS, { nom: "Pagne", prixXaf: 15000, avecPhoto: false });
    expect(corps(sans)).toMatch(/Sans photo/);
    /* « Ma carte » a pris la place de « Ma boutique » : le pack statut ne
       part plus tout seul, il s'obtient d'un appui (banc du 13/08). */
    expect(idsBoutons(sans)).toEqual(["article", "carte"]);
  });
});

describe("normaliserEtatVendeuse", () => {
  it("relit ce qui est complet, refuse le reste", () => {
    expect(normaliserEtatVendeuse({ nom: "inscription_nom", parrain: "x" })).toEqual({
      nom: "inscription_nom",
      parrain: "x",
    });
    expect(
      normaliserEtatVendeuse({ nom: "article_photo", nomArticle: "A", prixXaf: 100.9 }),
    ).toEqual({
      nom: "article_photo",
      nomArticle: "A",
      prixXaf: 100,
    });
    for (const brut of [
      null,
      42,
      { nom: "catalogue", slug: "s" },
      { nom: "inscription_ville" },
      { nom: "article_prix" },
      { nom: "article_photo", nomArticle: "A", prixXaf: 0 },
    ]) {
      expect(normaliserEtatVendeuse(brut)).toBeNull();
    }
  });
});

/**
 * ADR 0035 — la photo legendee devient un article, apres CONFIRMATION :
 * on confirme l'extrait, on ne devine jamais en silence (§7.7).
 */
describe("la photo legendee (ADR 0035)", () => {
  it("lireLegendeArticle separe le nom du prix final, devise compris", () => {
    expect(lireLegendeArticle("Pagne wax 6 yards 15 000")).toEqual({
      nom: "Pagne wax 6 yards",
      prixXaf: 15000,
    });
    expect(lireLegendeArticle("Robe — 10.000 FCFA")).toEqual({ nom: "Robe", prixXaf: 10000 });
    expect(lireLegendeArticle("Sac 8000 F")).toEqual({ nom: "Sac", prixXaf: 8000 });
    expect(lireLegendeArticle("juste du texte")).toBeNull();
    expect(lireLegendeArticle("15000")).toBeNull();
    expect(lireLegendeArticle("")).toBeNull();
  });

  it("au nom d'article, la photo legendee saute les questions : reaction, citation, confirmation", () => {
    const r = reagirInscription(
      { nom: "article_nom" },
      { genre: "image", mediaId: "m-1", legende: "Pagne wax 15 000", messageId: "wamid.abc" },
      VERS,
    );
    expect(r.etat).toEqual({
      nom: "article_confirme",
      nomArticle: "Pagne wax",
      prixXaf: 15000,
      mediaId: "m-1",
    });
    expect(r.effet).toBeUndefined();
    /* La reaction 👍 posee sur la photo, puis la question qui la CITE. */
    const premiere = r.messages[0] as { type?: string; reaction?: { message_id: string } };
    expect(premiere.type).toBe("reaction");
    expect(premiere.reaction?.message_id).toBe("wamid.abc");
    const question = r.messages[1] as MessageBoutons;
    expect(question.context?.message_id).toBe("wamid.abc");
    expect(idsBoutons(question)).toEqual(["publier", "corriger"]);
    expect(corps(question)).toContain("Pagne wax");
  });

  it("« Publier » cree l'article avec SA photo ; « Corriger » repart aux questions", () => {
    const attente: EtatVendeuse = {
      nom: "article_confirme",
      nomArticle: "Pagne wax",
      prixXaf: 15000,
      mediaId: "m-1",
    };
    const publie = reagirInscription(attente, { genre: "bouton", id: "publier" }, VERS);
    expect(publie.effet).toEqual({
      type: "creer_article",
      nom: "Pagne wax",
      prixXaf: 15000,
      mediaId: "m-1",
    });
    expect(publie.etat).toBeNull();

    const corrige = reagirInscription(attente, { genre: "bouton", id: "corriger" }, VERS);
    expect(corrige.etat).toEqual({ nom: "article_nom" });
    expect(corrige.effet).toBeUndefined();
  });

  it("une nouvelle photo legendee REMPLACE la proposition en attente", () => {
    const attente: EtatVendeuse = {
      nom: "article_confirme",
      nomArticle: "Pagne wax",
      prixXaf: 15000,
      mediaId: "m-1",
    };
    const r = reagirInscription(
      attente,
      { genre: "image", mediaId: "m-2", legende: "Sac raphia 8000" },
      VERS,
    );
    expect(r.etat).toEqual({
      nom: "article_confirme",
      nomArticle: "Sac raphia",
      prixXaf: 8000,
      mediaId: "m-2",
    });
  });

  it("un bavardage en attente de confirmation repropose les deux boutons", () => {
    const attente: EtatVendeuse = {
      nom: "article_confirme",
      nomArticle: "Pagne wax",
      prixXaf: 15000,
      mediaId: "m-1",
    };
    const r = reagirInscription(attente, { genre: "texte", texte: "oui vas-y" }, VERS);
    expect(r.etat).toEqual(attente);
    expect(idsBoutons(r.messages[0])).toEqual(["publier", "corriger"]);
  });

  it("l'etat article_confirme se relit, et un etat ampute retombe a null", () => {
    expect(
      normaliserEtatVendeuse({
        nom: "article_confirme",
        nomArticle: "Pagne",
        prixXaf: 15000,
        mediaId: "m-1",
      }),
    ).toEqual({ nom: "article_confirme", nomArticle: "Pagne", prixXaf: 15000, mediaId: "m-1" });
    expect(
      normaliserEtatVendeuse({ nom: "article_confirme", nomArticle: "Pagne", prixXaf: 15000 }),
    ).toBeNull();
  });
});

/**
 * Un flux vendeuse abandonne PERIME — ADR 0048.
 *
 * Constate en preproduction le 07/08/2026 : un « Hi » recu sur un fil dont
 * l'etat `article_nom` datait d'une session precedente s'est vu repondre
 * « *Hi* — son prix, en francs ? ». Le fil ACHETEUSE perimait deja depuis
 * l'ADR 0032 ; le fil vendeuse, lui, ne perimait pas — et la regle 1 de
 * l'aiguillage (« l'inscription en cours prime sur tout ») lui faisait donc
 * avaler tout message ulterieur, indefiniment.
 */
describe("peremption d'un flux vendeuse abandonne", () => {
  const EN_COURS: EtatVendeuse = { nom: "article_nom" };

  it("garde l'etat tant que le flux est vivant", () => {
    expect(etatVendeuseApresInactivite(EN_COURS, 0)).toEqual(EN_COURS);
    expect(etatVendeuseApresInactivite(EN_COURS, INACTIVITE_MAX_MS - 1)).toEqual(EN_COURS);
  });

  it("l'abandonne au-dela du delai — c'est le defaut du 07/08/2026", () => {
    expect(etatVendeuseApresInactivite(EN_COURS, INACTIVITE_MAX_MS)).toBeNull();
    expect(etatVendeuseApresInactivite(EN_COURS, 30 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it("perime AUSSI l'inscription et l'article a moitie saisi", () => {
    const etats: EtatVendeuse[] = [
      { nom: "inscription_nom" },
      { nom: "inscription_ville", nomBoutique: "Chez Awa" },
      { nom: "article_prix", nomArticle: "Pagne wax" },
      { nom: "article_photo", nomArticle: "Pagne wax", prixXaf: 15000 },
      { nom: "article_confirme", nomArticle: "Pagne", prixXaf: 15000, mediaId: "m-1" },
    ];
    for (const e of etats) {
      expect(etatVendeuseApresInactivite(e, INACTIVITE_MAX_MS)).toBeNull();
    }
  });
});

/**
 * Le piege du 07/08/2026 : « Bonjour » repond a une demande de prix, le bot
 * dit « Je n'ai pas compris le prix », et RIEN n'indique comment sortir. Le
 * mot `annuler` existait depuis l'ADR 0034 — il n'etait simplement annonce
 * nulle part au moment ou on en a besoin.
 */
describe("la sortie de secours s'annonce quand la reponse ne passe pas", () => {
  it("le prix incompris rappelle « annuler »", () => {
    const r = reagirInscription(
      { nom: "article_prix", nomArticle: "Hi" },
      { genre: "texte", texte: "Bonjour" },
      VERS,
    );
    expect(corps(r.messages[0])).toContain("annuler");
  });

  it("le nom d'article refuse rappelle « annuler »", () => {
    const r = reagirInscription({ nom: "article_nom" }, { genre: "texte", texte: "x" }, VERS);
    expect(corps(r.messages[0])).toContain("annuler");
  });

  it("le nom de boutique refuse rappelle « annuler »", () => {
    const r = reagirInscription({ nom: "inscription_nom" }, { genre: "texte", texte: "x" }, VERS);
    expect(corps(r.messages[0])).toContain("annuler");
  });
});

/**
 * Le vocabulaire commun aux trois fils — ADR 0051.
 *
 * « menu », « aide » et « panier » ne vivaient que dans le fil acheteuse.
 * Une vendeuse coincee dans un formulaire n'avait qu'un mot pour sortir,
 * « annuler », et il n'etait annonce que dans une partie des messages.
 */
describe("les mots communs marchent aussi dans l'inscription", () => {
  const ETATS: EtatVendeuse[] = [
    { nom: "inscription_nom" },
    { nom: "inscription_ville", nomBoutique: "Chez Awa" },
    { nom: "article_nom" },
    { nom: "article_prix", nomArticle: "Pagne" },
    { nom: "article_photo", nomArticle: "Pagne", prixXaf: 15000 },
  ];

  it("« aide » dit OU on en est, puis repose la question — l'etat ne bouge pas", () => {
    for (const etat of ETATS) {
      const r = reagirInscription(etat, { genre: "texte", texte: "aide" }, VERS);
      expect(r.etat).toEqual(etat);
      expect(r.messages.length).toBeGreaterThanOrEqual(2);
      expect(corps(r.messages[0])).toContain("annuler");
    }
  });

  it("« help » marche aussi — le mot anglais est deja dans le vocabulaire", () => {
    const r = reagirInscription({ nom: "article_nom" }, { genre: "texte", texte: "help" }, VERS);
    expect(r.etat).toEqual({ nom: "article_nom" });
  });

  it("« menu » sort du formulaire — personne ne devine que c'est « annuler »", () => {
    for (const etat of ETATS) {
      const r = reagirInscription(etat, { genre: "texte", texte: "menu" }, VERS);
      expect(r.etat).toBeNull();
    }
  });

  it("« aide » ne devient PAS un nom d'article — le mot prime sur la saisie", () => {
    const r = reagirInscription({ nom: "article_nom" }, { genre: "texte", texte: "aide" }, VERS);
    expect(r.etat).toEqual({ nom: "article_nom" });
    expect(r.effet).toBeUndefined();
  });
});

/**
 * « En ligne » ne doit pas mentir sur la PAGE WEB — ADR 0065.
 *
 * L'article entre en base tout de suite ; la boutique publique, elle, lit un
 * instantane pris a la construction. Mesure du 11/08/2026 : `chez-bea-test`
 * repondait 404 alors que le bot avait dit « en ligne ». Le mot etait vrai
 * pour le catalogue du fil, faux pour le web — et c'est le web que la
 * vendeuse va montrer.
 */
describe("l'article publie dit quand la page web arrive", () => {
  const article = { nom: "Robe wax", prixXaf: 15000, avecPhoto: true };
  const corps = (m: unknown) =>
    (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ?? "";

  it("annonce l'attente quand une reconstruction vient d'etre demandee", () => {
    const m = messageArticlePublie(VERS, article, false, 15);
    expect(corps(m)).toMatch(/15 minutes/);
  });

  it("SANS reconstruction, aucune promesse n'est faite", () => {
    /* Sans crochet configure, la page n'arrivera pas d'elle-meme : annoncer un
       delai serait une promesse qu'on ne tient pas. */
    const m = messageArticlePublie(VERS, article, false, null);
    expect(corps(m)).not.toMatch(/minute/);
  });

  it("le rappel de conges survit a l'ajout", () => {
    const m = messageArticlePublie(VERS, article, true, 15);
    expect(corps(m)).toContain("congés");
    expect(corps(m)).toMatch(/15 minutes/);
  });
});

/**
 * L'echec de photo se DIT — ADR 0089.
 *
 * Banc du 13/08/2026 : une vendeuse remplit le formulaire d'article AVEC une
 * photo, et le bot repond « Sans photo pour l'instant ». La meme phrase
 * servait a qui n'avait rien envoye. Deux situations opposees, une seule
 * phrase : impossible de savoir qu'il fallait recommencer.
 *
 * La chaine qui perd la photo est faite de portes qui rendent `null` sans
 * rien journaliser (`media-cdn.ts`, `whatsapp-media.ts`). On ne peut pas
 * garantir qu'elle n'echouera jamais ; on peut garantir qu'elle le DIRA.
 */
describe("la photo perdue", () => {
  it("se distingue de la photo jamais envoyee, et donne le geste suivant", () => {
    const jamais = messageArticlePublie(VERS, {
      nom: "Pagne",
      prixXaf: 15000,
      avecPhoto: false,
    });
    const perdue = messageArticlePublie(VERS, {
      nom: "Pagne",
      prixXaf: 15000,
      avecPhoto: false,
      photoPerdue: true,
    });

    /* Le cas « jamais envoyee » ne doit pas alarmer : c'est un etat normal. */
    expect(corps(jamais)).toMatch(/sans photo/i);
    expect(corps(jamais)).not.toMatch(/pas parvenue/i);

    /* Le cas « perdue » doit alarmer, ET dire quoi faire — une phrase qui
       constate sans donner le geste suivant laisse aussi bloquee. */
    expect(corps(perdue)).toMatch(/pas parvenue/i);
    expect(corps(perdue)).toMatch(/renvoyez/i);
    /* L'article EXISTE : ne pas laisser croire que tout est a refaire. */
    expect(corps(perdue)).toMatch(/bien créé/i);
  });

  it("ne dit rien de la photo quand elle est bien la", () => {
    const avec = messageArticlePublie(VERS, { nom: "Pagne", prixXaf: 15000, avecPhoto: true });
    expect(corps(avec)).not.toMatch(/sans photo/i);
    expect(corps(avec)).not.toMatch(/pas parvenue/i);
  });
});
