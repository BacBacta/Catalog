import { formatXaf } from "@catalog/contracts/money";
import { describe, expect, it } from "vitest";
import type { BoutiqueBot, EtatConv } from "../conversation.ts";
import {
  confirmationCommande,
  ETAT_INITIAL,
  etatApresInactivite,
  extraireSlugBoutique,
  INACTIVITE_MAX_MS,
  lireDetailsLivraison,
  messageVerdict,
  reagirAcheteuse,
  reagirVendeuse,
} from "../conversation.ts";
import type { MessageBoutons, MessageListe, MessageTexte } from "../messages.ts";

/**
 * La machine de conversation — ADR 0031, revisee ADR 0032. Chaque test est un
 * echange : etat + entree → messages + etat suivant. Pas de simulacre : la
 * machine est pure.
 */

const BOUTIQUE: BoutiqueBot = {
  id: "s1",
  slug: "chez-amina",
  nom: "Chez Amina",
  ville: "Douala",
  whatsappVendeuse: "+237677123456",
  reversementPose: true,
  articles: [
    { id: "a1", nom: "Pagne wax 6 yards", prixXaf: 15000 },
    { id: "a2", nom: "Sac en raphia", prixXaf: 8000 },
  ],
};

const VERS = "237690112233";
const corpsTexte = (m: unknown) => (m as MessageTexte).text.body;
const corpsBoutons = (m: unknown) => (m as MessageBoutons).interactive.body.text;
const idsBoutons = (m: unknown) =>
  (m as MessageBoutons).interactive.action.buttons.map((b) => b.reply.id);

const RECAP: EtatConv = {
  nom: "recap",
  slug: "chez-amina",
  articleId: "a1",
  quantite: 2,
  mode: "livraison",
  livraison: {
    mode: "livraison",
    city: "Douala",
    quartier: "Bonapriso",
    landmark: "en face de la pharmacie du Rond-Point",
    phone: "+237690112233",
  },
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
      VERS,
      BOUTIQUE,
    );
    expect(r.etat).toEqual({ nom: "catalogue", slug: "chez-amina", page: 0 });
    const m = r.messages[0] as MessageBoutons;
    expect(m.interactive.body.text).toContain("Chez Amina");
    expect(m.interactive.body.text).toContain("reçu vérifiable");
    expect(idsBoutons(m)).toEqual(["catalogue", "vendeuse"]);
  });

  it("la reputation du lot 12 se dit a l'accueil — et jamais « 0 vente »", () => {
    const avecAvis: BoutiqueBot = {
      ...BOUTIQUE,
      reputation: { note: 4.8, nbVerifies: 12 },
    };
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "chez-amina" },
      VERS,
      avecAvis,
    );
    expect(corpsBoutons(r.messages[0])).toContain("★ 4,8 · 12 ventes prouvées");

    const sansAvis: BoutiqueBot = { ...BOUTIQUE, reputation: { note: null, nbVerifies: 0 } };
    const r0 = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "chez-amina" },
      VERS,
      sansAvis,
    );
    expect(corpsBoutons(r0.messages[0])).not.toContain("0 vente");
  });

  it("l'accueil porte l'image de la boutique quand une declinaison existe", () => {
    const avecImage: BoutiqueBot = {
      ...BOUTIQUE,
      articles: [
        { id: "a1", nom: "Pagne wax 6 yards", prixXaf: 15000, imageUrl: "https://o.test/img.jpg" },
      ],
    };
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "chez-amina" },
      VERS,
      avecImage,
    );
    const m = r.messages[0] as MessageBoutons;
    expect(m.interactive.header).toEqual({
      type: "image",
      image: { link: "https://o.test/img.jpg" },
    });
  });

  it("une boutique introuvable le DIT, sans inventer", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "boutique inconnue-du-registre" },
      VERS,
      null,
    );
    expect(corpsTexte(r.messages[0])).toMatch(/introuvable/);
  });

  it("sans boutique en contexte, un bavardage recoit l'aide", () => {
    const r = reagirAcheteuse(ETAT_INITIAL, { genre: "texte", texte: "bonjour" }, VERS, null);
    expect(corpsTexte(r.messages[0])).toMatch(/boutique/);
  });

  it("« Parler a la vendeuse » donne le wa.me du numero personnel", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "vendeuse" },
      VERS,
      BOUTIQUE,
    );
    expect(corpsTexte(r.messages[0])).toContain("https://wa.me/237677123456");
    expect(r.etat).toEqual({ nom: "catalogue", slug: "chez-amina", page: 0 });
  });

  it("sans numero personnel, le bouton vendeuse ne s'affiche pas", () => {
    const sans: BoutiqueBot = { ...BOUTIQUE, whatsappVendeuse: null };
    const r = reagirAcheteuse(ETAT_INITIAL, { genre: "texte", texte: "chez-amina" }, VERS, sans);
    expect(idsBoutons(r.messages[0])).toEqual(["catalogue"]);
  });

  it("le catalogue est une liste avec prix, paginee au-dela de huit", () => {
    const beaucoup: BoutiqueBot = {
      ...BOUTIQUE,
      articles: Array.from({ length: 12 }, (_, i) => ({
        id: `a${i}`,
        nom: `Article ${i}`,
        prixXaf: 1000 + i,
      })),
    };
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "catalogue" },
      VERS,
      beaucoup,
    );
    const m = r.messages[0] as MessageListe;
    const lignes = m.interactive.action.sections[0]?.rows ?? [];
    expect(lignes).toHaveLength(9); // 8 articles + « voir la suite »
    expect(lignes.at(-1)?.id).toBe("cat:1");
    expect(lignes[0]?.description).toContain("FCFA");
  });

  it("une boutique vide n'est pas un cul-de-sac : un bouton de sortie reste", () => {
    const vide: BoutiqueBot = { ...BOUTIQUE, articles: [] };
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "catalogue" },
      VERS,
      vide,
    );
    expect(idsBoutons(r.messages[0])).toEqual(["vendeuse"]);

    const videSansTel: BoutiqueBot = { ...vide, whatsappVendeuse: null };
    const r2 = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "bouton", id: "catalogue" },
      VERS,
      videSansTel,
    );
    expect(idsBoutons(r2.messages[0])).toEqual(["menu"]);
  });

  it("choisir un article montre sa fiche, commander demande la quantite", () => {
    const fiche = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "liste", id: "art:a1" },
      VERS,
      BOUTIQUE,
    );
    const mf = fiche.messages[0] as MessageBoutons;
    expect(mf.interactive.body.text).toContain("Pagne wax");
    expect(mf.interactive.action.buttons[0]?.reply.id).toBe("cmd:a1");

    const qte = reagirAcheteuse(fiche.etat, { genre: "bouton", id: "cmd:a1" }, VERS, BOUTIQUE);
    expect(qte.etat).toEqual({ nom: "quantite", slug: "chez-amina", articleId: "a1" });
  });

  it("la fiche garde la page courante — le retour ne renvoie pas page 0", () => {
    const fiche = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 1 },
      { genre: "liste", id: "art:a1" },
      VERS,
      BOUTIQUE,
    );
    expect(fiche.etat).toEqual({ nom: "catalogue", slug: "chez-amina", page: 1 });
    expect(idsBoutons(fiche.messages[0])).toEqual(["cmd:a1", "cat:1"]);
  });

  it("la fiche porte l'image de l'article quand elle existe", () => {
    const avecImage: BoutiqueBot = {
      ...BOUTIQUE,
      articles: [{ id: "a1", nom: "Pagne", prixXaf: 15000, imageUrl: "https://o.test/p.jpg" }],
    };
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "liste", id: "art:a1" },
      VERS,
      avecImage,
    );
    const m = r.messages[0] as MessageBoutons;
    expect(m.interactive.header?.image.link).toBe("https://o.test/p.jpg");
  });

  it("la quantite s'accepte au bouton comme en chiffres tapes, avec le sous-total", () => {
    const etat: EtatConv = { nom: "quantite", slug: "chez-amina", articleId: "a1" };
    const bouton = reagirAcheteuse(etat, { genre: "bouton", id: "qte:2" }, VERS, BOUTIQUE);
    expect(bouton.etat).toMatchObject({ nom: "mode", quantite: 2 });
    expect(corpsBoutons(bouton.messages[0])).toContain(formatXaf(30000));

    const autre = reagirAcheteuse(etat, { genre: "bouton", id: "qte:autre" }, VERS, BOUTIQUE);
    expect(autre.etat).toEqual(etat); // on attend le nombre
    const tape = reagirAcheteuse(etat, { genre: "texte", texte: " 3 " }, VERS, BOUTIQUE);
    expect(tape.etat).toMatchObject({ nom: "mode", quantite: 3 });

    const rate = reagirAcheteuse(etat, { genre: "texte", texte: "trois" }, VERS, BOUTIQUE);
    expect(rate.etat).toEqual(etat);
    expect(corpsTexte(rate.messages[0])).toMatch(/chiffres/);
    expect(corpsTexte(rate.messages[0])).toMatch(/annuler/);
  });

  it("le mode s'accepte au bouton comme au mot tape", () => {
    const etat: EtatConv = { nom: "mode", slug: "chez-amina", articleId: "a1", quantite: 1 };
    const bouton = reagirAcheteuse(etat, { genre: "bouton", id: "mode:livraison" }, VERS, BOUTIQUE);
    expect(bouton.etat).toMatchObject({ nom: "details", mode: "livraison" });

    const tape = reagirAcheteuse(etat, { genre: "texte", texte: "Retrait" }, VERS, BOUTIQUE);
    expect(tape.etat).toMatchObject({ nom: "details", mode: "retrait" });
  });

  it("les details valides menent au RECAP, jamais directement a la creation", () => {
    const details = reagirAcheteuse(
      { nom: "details", slug: "chez-amina", articleId: "a1", quantite: 2, mode: "livraison" },
      { genre: "texte", texte: "Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33" },
      VERS,
      BOUTIQUE,
    );
    expect(details.effet).toBeUndefined();
    expect(details.etat).toMatchObject({ nom: "recap", quantite: 2 });
    const corps = corpsBoutons(details.messages[0]);
    // La livraison RELUE, l'acompte calcule par la meme regle que la creation.
    expect(corps).toContain("Bonapriso, en face de la pharmacie du Rond-Point");
    expect(corps).toContain("6 90 11 22 33");
    expect(corps).toContain(formatXaf(30000));
    expect(corps).toContain(formatXaf(15000)); // acompte 50 %
    expect(corps).toContain("Rien n'est encore commandé");
    expect(idsBoutons(details.messages[0])).toEqual(["confirmer", "corriger", "annuler"]);
  });

  it("sans reversement pose, le recap n'annonce aucun acompte", () => {
    const sansRamp: BoutiqueBot = { ...BOUTIQUE, reversementPose: false };
    const r = reagirAcheteuse(
      { nom: "details", slug: "chez-amina", articleId: "a1", quantite: 1, mode: "retrait" },
      { genre: "texte", texte: "Marché central, entrée B, 690 11 22 33" },
      VERS,
      sansRamp,
    );
    expect(corpsBoutons(r.messages[0])).not.toContain("Acompte");
  });

  it("« Confirmer » depuis le recap produit l'effet de creation, et garde la boutique", () => {
    const r = reagirAcheteuse(RECAP, { genre: "bouton", id: "confirmer" }, VERS, BOUTIQUE);
    expect(r.effet).toMatchObject({
      type: "creer_commande",
      brouillon: {
        slug: "chez-amina",
        articleId: "a1",
        quantite: 2,
        livraison: { mode: "livraison", quartier: "Bonapriso", phone: "+237690112233" },
      },
    });
    expect(r.etat).toEqual({ nom: "catalogue", slug: "chez-amina", page: 0 });
    expect(r.messages).toEqual([]); // la confirmation part apres la creation
  });

  it("« Corriger » repart de la quantite ; un texte hors boutons re-propose les trois", () => {
    const corriger = reagirAcheteuse(RECAP, { genre: "bouton", id: "corriger" }, VERS, BOUTIQUE);
    expect(corriger.etat).toEqual({ nom: "quantite", slug: "chez-amina", articleId: "a1" });
    expect(corriger.effet).toBeUndefined();

    const bavard = reagirAcheteuse(RECAP, { genre: "texte", texte: "oui" }, VERS, BOUTIQUE);
    expect(bavard.etat).toEqual(RECAP);
    expect(idsBoutons(bavard.messages[0])).toEqual(["confirmer", "corriger", "annuler"]);
  });

  it("des details incomplets recoivent une aide et l'etat ne bouge pas", () => {
    const etat: EtatConv = {
      nom: "details",
      slug: "chez-amina",
      articleId: "a1",
      quantite: 1,
      mode: "livraison",
    };
    const sansTel = reagirAcheteuse(
      etat,
      { genre: "texte", texte: "Bonapriso, pharmacie" },
      VERS,
      BOUTIQUE,
    );
    expect(sansTel.etat).toEqual(etat);
    expect(corpsTexte(sansTel.messages[0])).toMatch(/numéro/);

    const sansRepere = reagirAcheteuse(
      etat,
      { genre: "texte", texte: "Bonapriso 690112233" },
      VERS,
      BOUTIQUE,
    );
    expect(sansRepere.etat).toEqual(etat);
    expect(corpsTexte(sansRepere.messages[0])).toMatch(/repère/);
  });
});

describe("aucun etat n'est un piege — mots-cles globaux", () => {
  it("« annuler » tape en pleine quantite abandonne et revient a l'accueil", () => {
    const r = reagirAcheteuse(
      { nom: "quantite", slug: "chez-amina", articleId: "a1" },
      { genre: "texte", texte: "Annuler" },
      VERS,
      BOUTIQUE,
    );
    expect(corpsTexte(r.messages[0])).toMatch(/annulé/);
    expect(r.etat).toEqual({ nom: "catalogue", slug: "chez-amina", page: 0 });
    expect(r.messages).toHaveLength(2); // l'annulation, puis l'accueil
  });

  it("« menu » tape en plein recap revient a l'accueil sans rien creer", () => {
    const r = reagirAcheteuse(RECAP, { genre: "texte", texte: "menu" }, VERS, BOUTIQUE);
    expect(r.effet).toBeUndefined();
    expect(r.etat).toEqual({ nom: "catalogue", slug: "chez-amina", page: 0 });
  });

  it("« aide » repond les gestes disponibles sans perdre l'etat", () => {
    const etat: EtatConv = { nom: "mode", slug: "chez-amina", articleId: "a1", quantite: 2 };
    const r = reagirAcheteuse(etat, { genre: "texte", texte: "aide" }, VERS, BOUTIQUE);
    expect(r.etat).toEqual(etat);
    expect(corpsTexte(r.messages[0])).toMatch(/annuler/);
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
      VERS,
      BOUTIQUE,
      STATUT,
    );
    const corps = corpsTexte(r.messages[0]);
    expect(corps).toContain("CT-104312");
    expect(corps).toContain(formatXaf(7500));
    expect(corps).toContain("confirmation");
  });

  it("repond aussi sans boutique en contexte", () => {
    const r = reagirAcheteuse(ETAT_INITIAL, { genre: "texte", texte: "suivi" }, VERS, null, STATUT);
    expect(corpsTexte(r.messages[0])).toContain("CT-104312");
  });

  it("sans commande connue, le dit sans inventer", () => {
    const r = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 },
      { genre: "texte", texte: "suivi" },
      VERS,
      BOUTIQUE,
      null,
    );
    expect(corpsTexte(r.messages[0])).toMatch(/Aucune commande/);
  });

  it("en plein flux, « livraison » n'est PAS une question de statut", () => {
    const r = reagirAcheteuse(
      { nom: "mode", slug: "chez-amina", articleId: "a1", quantite: 1 },
      { genre: "texte", texte: "livraison" },
      VERS,
      BOUTIQUE,
      STATUT,
    );
    expect(r.etat).toMatchObject({ nom: "details", mode: "livraison" });
  });
});

describe("etatApresInactivite", () => {
  it("un flux de commande perime retombe sur le catalogue de la meme boutique", () => {
    const etat: EtatConv = {
      nom: "details",
      slug: "chez-amina",
      articleId: "a1",
      quantite: 1,
      mode: "livraison",
    };
    expect(etatApresInactivite(etat, INACTIVITE_MAX_MS)).toEqual({
      nom: "catalogue",
      slug: "chez-amina",
      page: 0,
    });
    expect(etatApresInactivite(etat, INACTIVITE_MAX_MS - 1)).toEqual(etat);
  });

  it("l'accueil et le catalogue ne periment pas", () => {
    const cat: EtatConv = { nom: "catalogue", slug: "chez-amina", page: 2 };
    expect(etatApresInactivite(cat, INACTIVITE_MAX_MS * 30)).toEqual(cat);
    expect(etatApresInactivite(ETAT_INITIAL, INACTIVITE_MAX_MS * 30)).toEqual(ETAT_INITIAL);
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

  it("« solde » sans commande ouverte le dit simplement", () => {
    const r = reagirVendeuse({ genre: "texte", texte: "solde" }, VERS, {
      smsReconnu: false,
      commandesOuvertes: [],
      soldesXaf: 0,
    });
    expect(corpsTexte(r.messages[0])).toMatch(/soldées/);
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
  const LIVRAISON = {
    mode: "livraison" as const,
    city: "Douala",
    quartier: "Bonapriso",
    landmark: "en face de la pharmacie",
    phone: "+237690112233",
  };

  it("la confirmation porte le contenu canonique, livraison relue comprise", () => {
    const messages = confirmationCommande(VERS, {
      reference: "CT-1043",
      codeVerification: "ACDE-4679",
      boutique: "Chez Amina",
      articleNom: "Pagne wax 6 yards",
      quantite: 1,
      prixUnitaireXaf: 15000,
      totalXaf: 15000,
      duAvantXaf: 7500,
      livraison: LIVRAISON,
      lienSuivi: "https://exemple.test/suivi?j=abc",
    });
    const corps = corpsTexte(messages[0]);
    for (const attendu of [
      "CT-1043",
      "Chez Amina",
      "Pagne wax",
      formatXaf(15000),
      formatXaf(7500),
      "Bonapriso, en face de la pharmacie",
      "6 90 11 22 33",
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
      articleNom: "A",
      quantite: 1,
      prixUnitaireXaf: 100,
      totalXaf: 100,
      duAvantXaf: 0,
      livraison: { mode: "retrait", pickupPoint: "Marché central", phone: "+237690112233" },
      lienSuivi: "https://exemple.test/suivi?j=abc",
    });
    const suite = corpsTexte(messages[1]);
    expect(suite).not.toMatch(/pour payer/i);
    expect(suite).toMatch(/payez à la réception/i);
    expect(suite).toContain("https://exemple.test/suivi?j=abc");
  });

  it("sans lien de suivi, un seul message, sans invention", () => {
    const messages = confirmationCommande(VERS, {
      reference: "CT-1",
      codeVerification: "ACDE-4679",
      boutique: "B",
      articleNom: "A",
      quantite: 1,
      prixUnitaireXaf: 100,
      totalXaf: 100,
      duAvantXaf: 0,
      livraison: { mode: "retrait", pickupPoint: "Marché central", phone: "+237690112233" },
      lienSuivi: null,
    });
    expect(messages).toHaveLength(1);
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
