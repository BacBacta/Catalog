import { describe, expect, it } from "vitest";
import { aiguiller, type ContexteAiguillage } from "../aiguillage.ts";
import { type EtatVendeuse, normaliserEtatVendeuse, reagirInscription } from "../inscription.ts";
import type { MessageBoutons, MessageTexte } from "../messages.ts";

/**
 * L'aiguillage arbitre au lieu d'avaler — ADR 0052.
 *
 * La regle 1 (« une inscription commencee se termine, rien ne la detourne »)
 * a une bonne raison d'exister : un nom de boutique qui ressemble a un slug
 * ne doit pas ejecter la vendeuse au milieu de son inscription.
 *
 * Mais elle etait ABSOLUE, et elle avalait donc aussi :
 *  - `boutique chez-amina`, le geste d'achat le plus fondamental du produit ;
 *  - un SMS d'operateur colle — la VALEUR N°1 du produit ;
 *  - `livree CT-522801`, qui publiait un article a 522 801 F.
 *
 * Constate en production le 07/08/2026 : un fil en `article_prix` repondait
 * « Je n'ai pas compris le prix » a tout, indefiniment.
 */

const VERS = "237690112233";
const corps = (m: unknown): string =>
  (m as MessageTexte).text?.body ?? (m as MessageBoutons).interactive?.body?.text ?? "";
const idsBoutons = (m: unknown) =>
  (m as MessageBoutons).interactive.action.buttons.map((b) => b.reply.id);

const EN_COURS: ContexteAiguillage = {
  estVendeuse: true,
  etatVendeuseEnCours: true,
  smsReconnu: false,
  achatEnCours: false,
};

describe("les gestes NON AMBIGUS traversent un formulaire en cours", () => {
  it("un SMS d'operateur part au fil vendeuse — c'est la preuve, elle prime sur tout", () => {
    expect(
      aiguiller(
        { genre: "texte", texte: "vous avez recu 15000" },
        { ...EN_COURS, smsReconnu: true },
      ),
    ).toBe("vendeuse");
  });

  it("« livree CT-522801 » ne devient plus un prix de 522 801 F", () => {
    expect(aiguiller({ genre: "texte", texte: "livree CT-522801" }, EN_COURS)).toBe("vendeuse");
    expect(aiguiller({ genre: "texte", texte: "livrée ct-522801" }, EN_COURS)).toBe("vendeuse");
    expect(aiguiller({ genre: "texte", texte: "livree 522801" }, EN_COURS)).toBe("vendeuse");
  });

  it("le formulaire garde tout le reste — la regle 1 fait toujours son travail", () => {
    for (const texte of ["Pagne wax 6 yards", "15000", "Chez Amina", "Douala"]) {
      expect(aiguiller({ genre: "texte", texte }, EN_COURS)).toBe("inscription");
    }
  });

  it("un lien de boutique reste au fil inscription — c'est la MACHINE qui arbitre", () => {
    /* Le routage ne tranche pas : seule la machine sait ce qui est en cours,
       et donc quoi proposer. Elle repond par une question, pas par un choix
       fait a la place de la personne. */
    expect(aiguiller({ genre: "texte", texte: "boutique chez-amina" }, EN_COURS)).toBe(
      "inscription",
    );
  });
});

describe("la machine met le formulaire en PAUSE au lieu de le detruire", () => {
  const ETAT = { nom: "article_prix", nomArticle: "Pagne wax 6 yards" } as const;

  it("LE defaut du 07/08/2026 : un lien de boutique ne devient plus un prix", () => {
    const r = reagirInscription(ETAT, { genre: "texte", texte: "boutique chez-amina" }, VERS);
    expect(corps(r.messages[0])).not.toContain("pas compris le prix");
    expect(idsBoutons(r.messages[0])).toEqual(["pause:finir", "pause:aller"]);
  });

  it("la question NOMME ce qui est en cours et la boutique visee", () => {
    const r = reagirInscription(ETAT, { genre: "texte", texte: "boutique chez-amina" }, VERS);
    expect(corps(r.messages[0])).toContain("Pagne wax 6 yards");
    expect(corps(r.messages[0])).toContain("chez-amina");
  });

  it("rien n'est perdu : l'etat est GARDE, avec le geste en attente", () => {
    const r = reagirInscription(ETAT, { genre: "texte", texte: "boutique chez-amina" }, VERS);
    expect(r.etat).toEqual({ ...ETAT, enPause: { slug: "chez-amina" } });
  });

  it("« Finir » reprend exactement ou on en etait", () => {
    const enPause = { ...ETAT, enPause: { slug: "chez-amina" } } as const;
    const r = reagirInscription(enPause, { genre: "bouton", id: "pause:finir" }, VERS);
    expect(r.etat).toEqual(ETAT);
    expect(corps(r.messages[0])).toContain("prix");
  });

  it("« Voir la boutique » libere le fil, et rend le slug au service", () => {
    const enPause = { ...ETAT, enPause: { slug: "chez-amina" } } as const;
    const r = reagirInscription(enPause, { genre: "bouton", id: "pause:aller" }, VERS);
    expect(r.etat).toBeNull();
    expect(r.effet).toEqual({ type: "aller_boutique", slug: "chez-amina" });
  });

  it("en pause, tout autre message re-pose la question — jamais de silence", () => {
    const enPause = { ...ETAT, enPause: { slug: "chez-amina" } } as const;
    const r = reagirInscription(enPause, { genre: "texte", texte: "euh" }, VERS);
    expect(r.etat).toEqual(enPause);
    expect(idsBoutons(r.messages[0])).toEqual(["pause:finir", "pause:aller"]);
  });

  it("« annuler » sort de la pause comme de partout ailleurs", () => {
    const enPause = { ...ETAT, enPause: { slug: "chez-amina" } } as const;
    const r = reagirInscription(enPause, { genre: "texte", texte: "annuler" }, VERS);
    expect(r.etat).toBeNull();
  });
});

/**
 * La pause survit a l'aller-retour en base — ADR 0052.
 *
 * Ce test n'existe pas par gout de la completude : sans lui, la question
 * d'arbitrage partait, l'etat etait sauve SANS la pause, et le message
 * suivant re-arbitrait indefiniment. Un defaut qui ne se voit qu'en
 * production, parce qu'il exige un passage par le stockage.
 */
describe("la pause se relit", () => {
  it("l'etat traverse le stockage sans perdre le geste en attente", () => {
    const etats: EtatVendeuse[] = [
      { nom: "inscription_nom", enPause: { slug: "chez-amina" } },
      { nom: "inscription_ville", nomBoutique: "Chez Awa", enPause: { slug: "chez-amina" } },
      { nom: "article_nom", enPause: { slug: "chez-amina" } },
      { nom: "article_prix", nomArticle: "Pagne", enPause: { slug: "chez-amina" } },
      {
        nom: "article_photo",
        nomArticle: "Pagne",
        prixXaf: 15000,
        enPause: { slug: "chez-amina" },
      },
      {
        nom: "article_confirme",
        nomArticle: "Pagne",
        prixXaf: 15000,
        mediaId: "m1",
        enPause: { slug: "chez-amina" },
      },
    ];
    for (const etat of etats) {
      expect(normaliserEtatVendeuse(JSON.parse(JSON.stringify(etat)))).toEqual(etat);
    }
  });

  it("une pause amputee de son slug est ignoree, pas devinee", () => {
    expect(normaliserEtatVendeuse({ nom: "article_nom", enPause: {} })).toEqual({
      nom: "article_nom",
    });
  });
});
