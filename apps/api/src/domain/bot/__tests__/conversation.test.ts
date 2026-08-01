import { formatXaf } from "@catalog/contracts/money";
import { describe, expect, it } from "vitest";
import type { BoutiqueBot, EtatConv } from "../conversation.ts";
import {
  confirmationCommande,
  ETAT_INITIAL,
  extraireSlugBoutique,
  lireDetailsLivraison,
  messageVerdict,
  reagirAcheteuse,
  reagirVendeuse,
} from "../conversation.ts";
import type { MessageBoutons, MessageListe, MessageTexte } from "../messages.ts";

/**
 * La machine de conversation — ADR 0031. Chaque test est un echange : etat +
 * entree → messages + etat suivant. Pas de simulacre : la machine est pure.
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
  it("le lien d'entree ouvre la boutique avec ses boutons", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "texte", texte: "Voir la boutique chez-amina" },
      VERS,
      BOUTIQUE,
    );
    expect(r.etat).toEqual({ nom: "catalogue", slug: "chez-amina", page: 0 });
    const m = r.messages[0] as MessageBoutons;
    expect(m.interactive.body.text).toContain("Chez Amina");
    expect(m.interactive.action.buttons.map((b) => b.reply.id)).toEqual(["catalogue", "vendeuse"]);
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

  it("la quantite s'accepte au bouton comme en chiffres tapes", () => {
    const etat: EtatConv = { nom: "quantite", slug: "chez-amina", articleId: "a1" };
    const bouton = reagirAcheteuse(etat, { genre: "bouton", id: "qte:2" }, VERS, BOUTIQUE);
    expect(bouton.etat).toMatchObject({ nom: "mode", quantite: 2 });

    const autre = reagirAcheteuse(etat, { genre: "bouton", id: "qte:autre" }, VERS, BOUTIQUE);
    expect(autre.etat).toEqual(etat); // on attend le nombre
    const tape = reagirAcheteuse(etat, { genre: "texte", texte: " 3 " }, VERS, BOUTIQUE);
    expect(tape.etat).toMatchObject({ nom: "mode", quantite: 3 });

    const rate = reagirAcheteuse(etat, { genre: "texte", texte: "trois" }, VERS, BOUTIQUE);
    expect(rate.etat).toEqual(etat);
    expect(corpsTexte(rate.messages[0])).toMatch(/chiffres/);
  });

  it("le mode puis les details menent a l'effet de creation", () => {
    const mode = reagirAcheteuse(
      { nom: "mode", slug: "chez-amina", articleId: "a1", quantite: 1 },
      { genre: "bouton", id: "mode:livraison" },
      VERS,
      BOUTIQUE,
    );
    expect(mode.etat).toMatchObject({ nom: "details", mode: "livraison" });

    const details = reagirAcheteuse(
      mode.etat,
      { genre: "texte", texte: "Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33" },
      VERS,
      BOUTIQUE,
    );
    expect(details.effet).toMatchObject({
      type: "creer_commande",
      brouillon: {
        slug: "chez-amina",
        articleId: "a1",
        quantite: 1,
        livraison: {
          mode: "livraison",
          city: "Douala",
          quartier: "Bonapriso",
          landmark: "en face de la pharmacie du Rond-Point",
          phone: "+237690112233",
        },
      },
    });
    expect(details.etat).toEqual(ETAT_INITIAL);
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
    expect(corpsTexte(sansTel.messages[0])).toMatch(/numero/);

    const sansRepere = reagirAcheteuse(
      etat,
      { genre: "texte", texte: "Bonapriso 690112233" },
      VERS,
      BOUTIQUE,
    );
    expect(sansRepere.etat).toEqual(etat);
    expect(corpsTexte(sansRepere.messages[0])).toMatch(/repere/);
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
    expect(corpsTexte(r.messages[0])).toMatch(/soldees/);
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
  it("la confirmation porte le contenu canonique, acompte compris", () => {
    const messages = confirmationCommande(VERS, {
      reference: "CT-1043",
      codeVerification: "ACDE-4679",
      boutique: "Chez Amina",
      articleNom: "Pagne wax 6 yards",
      quantite: 1,
      prixUnitaireXaf: 15000,
      totalXaf: 15000,
      duAvantXaf: 7500,
      lienPaiement: "https://exemple.test/payer?c=ACDE-4679",
    });
    const corps = corpsTexte(messages[0]);
    for (const attendu of [
      "CT-1043",
      "Chez Amina",
      "Pagne wax",
      formatXaf(15000),
      formatXaf(7500),
      "ACDE-4679",
    ]) {
      expect(corps).toContain(attendu);
    }
    expect(corpsTexte(messages[1])).toMatch(/code secret/i);
  });

  it("sans lien de paiement, un seul message, sans invention", () => {
    const messages = confirmationCommande(VERS, {
      reference: "CT-1",
      codeVerification: "ACDE-4679",
      boutique: "B",
      articleNom: "A",
      quantite: 1,
      prixUnitaireXaf: 100,
      totalXaf: 100,
      duAvantXaf: 0,
      lienPaiement: null,
    });
    expect(messages).toHaveLength(1);
  });

  it("le verdict se dit en langue simple, refus compris", () => {
    expect(
      corpsTexte(messageVerdict(VERS, { verdict: "accepte", reference: "CT-1043" })),
    ).toContain("CT-1043");
    expect(corpsTexte(messageVerdict(VERS, { verdict: "refuse", reference: null }))).toMatch(
      /controles/,
    );
    expect(
      corpsTexte(messageVerdict(VERS, { verdict: "accepte_sous_reserve", reference: null })),
    ).toMatch(/reserve/);
  });
});
