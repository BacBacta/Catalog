import { formatXaf } from "@catalog/contracts/money";
import { describe, expect, it } from "vitest";
import {
  demandeAjoutArticle,
  demandeEspaceVendeuse,
  demandeInscription,
  type EtatVendeuse,
  lireLegendeArticle,
  lirePrix,
  messageArticlePublie,
  messageBoutiqueCreee,
  normaliserEtatVendeuse,
  reagirInscription,
} from "../inscription.ts";
import type { MessageBoutons, MessageTexte } from "../messages.ts";

/**
 * L'inscription dans le fil — ADR 0047. Chaque test est un echange, comme
 * pour la machine acheteuse : la boutique et l'article naissent d'un effet,
 * jamais d'un message.
 */

const VERS = "237690112233";
const corps = (m: unknown) =>
  (m as MessageTexte).text?.body ?? (m as MessageBoutons).interactive.body.text;
const idsBoutons = (m: unknown) =>
  (m as MessageBoutons).interactive.action.buttons.map((b) => b.reply.id);

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
  it("la boutique creee porte SES deux liens et enchaine sur l'article", () => {
    const messages = messageBoutiqueCreee(VERS, {
      nom: "Chez Bea",
      lienBoutique: "https://wa.me/237600?text=boutique%20chez-bea",
      lienParrainage: "https://wa.me/237600?text=vendre%20avec%20chez-bea",
      lienEspace: null,
    });
    expect(corps(messages[0])).toContain("Chez Bea");
    expect(corps(messages[0])).toContain("boutique%20chez-bea");
    // Le reversement est NOMME mais jamais demande ici (AGENTS.md §2).
    expect(corps(messages[1])).toMatch(/vérification/);
    expect(corps(messages[1])).toContain("vendre%20avec%20chez-bea");
    expect(idsBoutons(messages[2])).toEqual(["article", "plus_tard"]);
  });

  it("l'article publie dit le prix, et le manque de photo sans le reprocher", () => {
    const avec = messageArticlePublie(VERS, { nom: "Pagne", prixXaf: 15000, avecPhoto: true });
    expect(corps(avec)).toContain(formatXaf(15000));
    expect(corps(avec)).not.toMatch(/sans photo/i);
    const sans = messageArticlePublie(VERS, { nom: "Pagne", prixXaf: 15000, avecPhoto: false });
    expect(corps(sans)).toMatch(/Sans photo/);
    expect(idsBoutons(sans)).toEqual(["article", "ma_boutique"]);
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
