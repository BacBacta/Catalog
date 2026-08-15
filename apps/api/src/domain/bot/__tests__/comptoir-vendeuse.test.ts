import { describe, expect, it } from "vitest";
import {
  avancerComptoir,
  COMPTOIR_DEPART,
  demandeComptoir,
  type EtatComptoir,
  messageATransferer,
} from "../comptoir-vendeuse.ts";
import {
  type EtatVendeuse,
  etatVendeuseApresInactivite,
  normaliserEtatVendeuse,
  reagirInscription,
} from "../inscription.ts";

/**
 * Le comptoir vendeuse — rang 1 de l'ADR 0061.
 *
 * La vendeuse declare dans son fil ce qu'elle vient de vendre ; le moteur cree
 * la commande AU PRIX CONVENU et lui rend un message autosuffisant qu'elle
 * TRANSFERE a sa cliente. La transaction ne change pas de mains, elle change de
 * piece : la relation reste dans le fil humain, l'argent et la preuve passent
 * par le moteur.
 *
 * Ce fichier ne teste que le domaine : pas de base, pas de reseau, pas
 * d'horloge implicite.
 */

const repondre = (etat: EtatComptoir, texte: string) => avancerComptoir(etat, { texte });

/** Le parcours nominal, joue jusqu'au recapitulatif. */
function jusquAuRecap(): EtatComptoir {
  let r = repondre(COMPTOIR_DEPART, "Robe wax grande taille");
  r = repondre(r.etat, "12 500");
  r = repondre(r.etat, "677 00 11 22");
  r = repondre(r.etat, "Carrefour Warda, devant la pharmacie");
  return r.etat;
}

describe("l'entree dans le comptoir", () => {
  it("reconnait la declaration de vente, accents et casse compris", () => {
    for (const mot of ["vendu", "VENDU", "j'ai vendu", "  Vente  ", "jai vendu"]) {
      expect(demandeComptoir(mot), mot).toBe(true);
    }
  });

  it("ne confond pas avec une phrase qui parle de vente sans la declarer", () => {
    /* Le fil vendeuse porte aussi des questions. « comment vendre ? » n'ouvre
       pas un comptoir : ouvrir une saisie a tort coute plus cher que de ne pas
       l'ouvrir, parce qu'elle capture les messages suivants. */
    for (const mot of ["comment vendre", "je veux vendre plus", "vendeuse"]) {
      expect(demandeComptoir(mot), mot).toBe(false);
    }
  });
});

describe("les quatre faits, et rien de plus", () => {
  it("les demande dans l'ordre : article, prix, cliente, remise", () => {
    let r = repondre(COMPTOIR_DEPART, "Robe wax");
    expect(r.etat.pas).toBe("prix");
    r = repondre(r.etat, "12 500");
    expect(r.etat.pas).toBe("cliente");
    r = repondre(r.etat, "677001122");
    expect(r.etat.pas).toBe("remise");
    r = repondre(r.etat, "Carrefour Warda");
    expect(r.etat.pas).toBe("recap");
  });

  it("le prix est le PRIX CONVENU, entier, jamais celui du catalogue", () => {
    /* C'est la raison d'etre de ce comptoir : le catalogue affiche un prix de
       depart, la vente se conclut a un autre. Le moteur enregistre celui-la. */
    const r = repondre({ pas: "prix", article: "Robe wax" }, "12 500 F");
    expect(r.etat).toMatchObject({ pas: "cliente", prixXaf: 12500 });
  });

  it("refuse un prix nul, negatif ou illisible — sans en inventer un", () => {
    for (const mauvais of ["0", "zero", "gratuit", "-500", ""]) {
      const r = repondre({ pas: "prix", article: "Robe wax" }, mauvais);
      expect(r.type, mauvais).toBe("refus");
      expect(r.etat.pas, mauvais).toBe("prix");
    }
  });

  it("le montant reste un ENTIER : un prix a virgule est ramene, pas arrondi au hasard", () => {
    /* AGENTS.md : le franc CFA n'a pas de sous-unite. « 12.500 » est un
       separateur de milliers camerounais, pas une decimale. */
    const r = repondre({ pas: "prix", article: "x" }, "12.500");
    expect(r.etat).toMatchObject({ prixXaf: 12500 });
    expect(Number.isInteger((r.etat as { prixXaf: number }).prixXaf)).toBe(true);
  });

  it("normalise le numero de la cliente, et refuse celui qui n'en est pas un", () => {
    const bon = repondre({ pas: "cliente", article: "x", prixXaf: 1000 }, "677 00 11 22");
    expect(bon.etat).toMatchObject({ cliente: "+237677001122" });

    for (const mauvais of ["12", "abcdefghi", "+33612345678"]) {
      const r = repondre({ pas: "cliente", article: "x", prixXaf: 1000 }, mauvais);
      expect(r.type, mauvais).toBe("refus");
    }
  });

  it("le point de remise est un mode de livraison de plein droit — ADR 0005", () => {
    /* Pas un cas degrade : c'est LA forme normale au Cameroun, ou aucune
       adresse postale n'existe. */
    const etat = jusquAuRecap();
    expect(etat).toMatchObject({ remise: "Carrefour Warda, devant la pharmacie" });
  });

  it("refuse un point de remise trop court pour dire quoi que ce soit", () => {
    const r = repondre(
      { pas: "remise", article: "x", prixXaf: 1000, cliente: "+237677001122" },
      "la",
    );
    expect(r.type).toBe("refus");
  });
});

describe("le recapitulatif, avant toute creation", () => {
  it("rien n'est cree tant qu'elle n'a pas confirme", () => {
    /* La lecon de l'ADR 0032 : un recapitulatif qui se saute cree des commandes
       fantomes que personne n'assume. */
    const etat = jusquAuRecap();
    expect(etat.pas).toBe("recap");
    const r = avancerComptoir(etat, { texte: "confirmer" });
    expect(r.type).toBe("creer");
  });

  it("« corriger » GARDE les quatre faits et demande LEQUEL corriger (non-retour C-04)", () => {
    /* Avant l'audit 2026-08, « corriger » repartait de COMPTOIR_DEPART :
       article, prix, cliente, remise — tout etait a retaper. Le defaut que
       l'ADR 0053 avait corrige cote acheteuse subsistait ici. */
    const r = avancerComptoir(jusquAuRecap(), { texte: "corriger" });
    expect(r.type).not.toBe("creer");
    expect(r.etat).toMatchObject({
      pas: "choix",
      article: "Robe wax grande taille",
      prixXaf: 12500,
    });
  });

  it("la correction est CIBLEE : le fait choisi se retape, les trois autres restent", () => {
    const choix = avancerComptoir(jusquAuRecap(), { texte: "corriger" }).etat;
    /* Le mot tape vaut l'appui — « numero » vise la cliente. */
    const correction = avancerComptoir(choix, { texte: "numéro" }).etat;
    expect(correction).toMatchObject({ pas: "correction", cible: "cliente" });
    const retour = avancerComptoir(correction, { texte: "699 88 77 66" });
    expect(retour.type).toBe("recap");
    expect(retour.etat).toMatchObject({
      pas: "recap",
      article: "Robe wax grande taille",
      prixXaf: 12500,
      cliente: "+237699887766",
    });
    /* Corrigee, la vente se cree avec le fait NOUVEAU et les trois anciens. */
    const creer = avancerComptoir(retour.etat, { texte: "confirmer" });
    expect(creer.vente).toMatchObject({ cliente: "+237699887766", prixXaf: 12500 });
  });

  it("une correction refusee re-explique, et le fait d'origine n'est pas perdu", () => {
    const choix = avancerComptoir(jusquAuRecap(), { texte: "corriger" }).etat;
    const correction = avancerComptoir(choix, { id: "corr:prix", texte: "" }).etat;
    const refus = avancerComptoir(correction, { texte: "gratuit" });
    expect(refus).toMatchObject({ type: "refus", motif: "prix_illisible" });
    expect(refus.etat).toMatchObject({ pas: "correction", cible: "prix", prixXaf: 12500 });
  });

  it("« retour » au choix re-montre le recapitulatif, rien n'a bouge", () => {
    const choix = avancerComptoir(jusquAuRecap(), { texte: "corriger" }).etat;
    const r = avancerComptoir(choix, { texte: "retour" });
    expect(r.type).toBe("recap");
    expect(r.etat).toMatchObject({ pas: "recap", article: "Robe wax grande taille" });
  });

  it("« annuler » ferme le comptoir, et ne cree rien", () => {
    const r = avancerComptoir(jusquAuRecap(), { texte: "annuler" });
    expect(r.type).toBe("abandon");
  });

  it("la vente remise au moteur porte les quatre faits, et le prix convenu", () => {
    const r = avancerComptoir(jusquAuRecap(), { texte: "confirmer" });
    expect(r.type).toBe("creer");
    expect(r.vente).toEqual({
      article: "Robe wax grande taille",
      prixXaf: 12500,
      cliente: "+237677001122",
      pointRemise: "Carrefour Warda, devant la pharmacie",
    });
  });
});

describe("ce que le comptoir ne fait PAS", () => {
  it("il ne demande jamais le code secret mobile money", () => {
    /* Interdit d'AGENTS.md §8, et le comptoir est justement l'endroit ou l'on
       serait tente de « simplifier » en le demandant. */
    const questions = [
      COMPTOIR_DEPART,
      { pas: "prix", article: "x" },
      { pas: "cliente", article: "x", prixXaf: 1 },
      { pas: "remise", article: "x", prixXaf: 1, cliente: "+237677001122" },
    ] as EtatComptoir[];
    for (const etat of questions) {
      const r = repondre(etat, "peu importe");
      expect(JSON.stringify(r)).not.toMatch(/code secret|mot de passe|pin\b/i);
    }
  });

  it("il ne s'ouvre pas sur un troisieme comptoir : une seule vente a la fois", () => {
    /* « Jamais de troisieme comptoir » (ADR 0061). Redeclarer une vente en
       cours de saisie ne l'empile pas — elle repond a la question posee. */
    const r = repondre({ pas: "prix", article: "Robe wax" }, "vendu");
    expect(r.type).toBe("refus");
    expect(r.etat.pas).toBe("prix");
  });
});

describe("le message que la vendeuse TRANSFERE a sa cliente", () => {
  const faits = {
    boutique: "Chez Maman Jeanne",
    article: "Robe wax grande taille",
    prixXaf: 12500,
    reference: "CT-481902",
    codeVerification: "ACDE-4679",
    aPayerXaf: 6250,
    resteXaf: 6250,
    numeroReversement: "+237677001188",
    operateurNom: "MTN MoMo",
    codeEntree: "*126#",
  };

  it("porte les cinq informations canoniques, plus la reference et le code", () => {
    /* AGENTS.md §2 : « article, quantite, prix unitaire, total, nom de la
       boutique — et, des qu'une commande existe, reference et code de
       verification ». Elle en existe une : les sept sont dus. */
    const m = messageATransferer(faits);
    expect(m).toContain("Robe wax grande taille");
    expect(m).toContain("Chez Maman Jeanne");
    expect(m).toContain("CT-481902");
    expect(m).toContain("ACDE-4679");
    expect(m).toMatch(/12\D?500/);
  });

  it("est autosuffisant en TEXTE BRUT : aucun lien n'en porte le sens", () => {
    /* « Jamais un parcours qui exige un lien externe » (ADR 0061). Le forfait
       « WhatsApp seul » est la norme : privee de tout lien, l'acheteuse doit
       pouvoir payer. */
    const sansLiens = messageATransferer(faits).replace(/https?:\/\/\S+/g, "");
    expect(sansLiens).toContain("CT-481902");
    expect(sansLiens).toMatch(/6\D?250/);
    expect(sansLiens).toContain("+237677001188");
    expect(sansLiens).toContain("*126#");
  });

  it("ne porte JAMAIS le jeton de suivi — le contrôle n° 7 en depend", () => {
    /* Le defaut que ce test existe pour empecher : ce message passe par les
       mains de la VENDEUSE. Le jeton autorise la contre-signature de
       l'acheteuse ; le lui donner reviendrait a laisser la vendeuse se
       contre-signer elle-meme, et le controle n° 7 — celui qui attrape « la
       collusion a une seule voix » — s'annulerait tout seul.
       Le lien de suivi arrive a l'acheteuse dans SON fil, jamais ici. */
    const m = messageATransferer({ ...faits, jetonInterdit: "JETON-SECRET-42" } as never);
    expect(m).not.toContain("JETON-SECRET-42");
    expect(m).not.toMatch(/\/suivi\//);
  });

  it("ne demande jamais le code secret, et le dit", () => {
    /* Le code secret se tape dans la session de l'operateur. Le message le
       RAPPELLE : c'est la ou une arnaque au faux support se glisserait. */
    const m = messageATransferer(faits);
    expect(m).toMatch(/code secret/i);
    expect(m).toMatch(/jamais/i);
  });

  it("dit ce qui reste du, sans le confondre avec ce qui est du maintenant", () => {
    const m = messageATransferer(faits);
    expect(m).toMatch(/6\D?250/);
    const solde = messageATransferer({ ...faits, aPayerXaf: 12500, resteXaf: 0 });
    expect(solde).not.toMatch(/reste/i);
  });
});

describe("le comptoir dans la machine vendeuse — une seule persistance", () => {
  /* Le comptoir n'est PAS une seconde machine avec sa propre table et sa
     propre horloge : c'est un ETAT de la machine vendeuse. « Deux horloges
     pour une seule notion d'abandon se contrediraient un jour » (ADR 0048) —
     la regle vaut pour les persistances aussi. */
  const VERS = "+237699000001";
  const auPrix: EtatVendeuse = {
    nom: "comptoir",
    comptoir: { pas: "prix", article: "Robe wax" },
  };

  it("un etat comptoir persiste se relit, un difforme vaut null", () => {
    expect(normaliserEtatVendeuse(JSON.parse(JSON.stringify(auPrix)))).toEqual(auPrix);
    expect(normaliserEtatVendeuse({ nom: "comptoir", comptoir: { pas: "n'importe" } })).toBeNull();
    expect(normaliserEtatVendeuse({ nom: "comptoir" })).toBeNull();
  });

  it("la machine vendeuse fait avancer le comptoir, pas d'ajout d'article", () => {
    const r = reagirInscription(auPrix, { genre: "texte", texte: "12 500" }, VERS);
    expect(r.etat).toMatchObject({ nom: "comptoir", comptoir: { pas: "cliente" } });
    expect(r.effet).toBeUndefined();
  });

  it("« confirmer » au recapitulatif produit l'effet creer_vente, et ferme", () => {
    const recap: EtatVendeuse = {
      nom: "comptoir",
      comptoir: {
        pas: "recap",
        article: "Robe wax",
        prixXaf: 12500,
        cliente: "+237677001122",
        remise: "Carrefour Warda",
      },
    };
    const r = reagirInscription(recap, { genre: "bouton", id: "confirmer" }, VERS);
    expect(r.effet).toEqual({
      type: "creer_vente",
      vente: {
        article: "Robe wax",
        prixXaf: 12500,
        cliente: "+237677001122",
        pointRemise: "Carrefour Warda",
      },
    });
    expect(r.etat).toBeNull();
  });

  it("un SMS d'operateur colle en plein comptoir N'EST PAS un prix — ADR 0052", () => {
    /* Le garde existant refuse un texte sans chiffres ; un SMS MTN est PLEIN de
       chiffres, et « lirePrix colle tous les chiffres du message ». C'est
       l'aiguillage (regle 0) qui le detourne AVANT la machine — ce test fixe la
       frontiere cote machine : elle n'a pas a le reconnaitre, on ne doit
       simplement jamais le lui donner. Le test d'aiguillage tient l'autre
       moitie. */
    const sms = "Vous avez recu 12500 FCFA de 677001122. ID: 17600446889.";
    const r = reagirInscription(auPrix, { genre: "texte", texte: sms }, VERS);
    /* Si on le lui donne quand meme, le pire serait un article a 1 250 067 F :
       le plafond de lirePrix l'attrape, mais on verifie surtout qu'AUCUNE vente
       ne se cree d'un SMS. */
    expect(r.effet).toBeUndefined();
  });

  it("« annuler » sort du comptoir sans rien creer, comme partout", () => {
    const r = reagirInscription(auPrix, { genre: "texte", texte: "annuler" }, VERS);
    expect(r.etat).toBeNull();
    expect(r.effet).toBeUndefined();
  });

  it("le comptoir perime comme le reste — meme horloge", () => {
    expect(etatVendeuseApresInactivite(auPrix, 1000)).toEqual(auPrix);
    expect(etatVendeuseApresInactivite(auPrix, 48 * 3600_000)).toBeNull();
  });
});

describe("le message a transferer, SANS reversement pose", () => {
  it("ne reclame rien d'avance, et ne montre jamais « 0 F a payer »", () => {
    /* Meme regle que le comptoir acheteuse : sans numero de reversement,
       exiger un prepaiement enverrait la cliente payer vers nulle part. */
    const m = messageATransferer({
      boutique: "Chez Maman Jeanne",
      article: "Robe wax",
      prixXaf: 12500,
      reference: "CT-481902",
      codeVerification: "ACDE-4679",
      aPayerXaf: 0,
      resteXaf: 12500,
      numeroReversement: "",
      operateurNom: null,
      codeEntree: null,
    });
    expect(m).toContain("CT-481902");
    expect(m).toMatch(/se règle à la remise/);
    expect(m).not.toMatch(/payer maintenant/i);
    expect(m).not.toMatch(/:\s*$/m);
  });
});
