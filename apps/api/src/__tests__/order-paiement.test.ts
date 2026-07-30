import { splitDeposit } from "@catalog/contracts/money";
import { describe, expect, it } from "vitest";
import {
  appliquerVersement,
  comparerMontant,
  type EtatArgent,
  planDePaiement,
} from "../domain/order/paiement.ts";

/**
 * Les trois modes de paiement, et ce qui arrive quand le montant ne correspond
 * pas.
 *
 * L'invariant qui traverse tout ce fichier :
 * **`amountPaidXaf + balanceXaf = totalXaf`, exactement, toujours.** Il est aussi
 * garanti par une contrainte de base (lot 3) ; ces tests sont ce qui evite d'y
 * arriver en erreur.
 */

const neuf = (totalXaf: number): EtatArgent => ({
  totalXaf,
  amountPaidXaf: 0,
  balanceXaf: totalXaf,
});

describe("planDePaiement", () => {
  it("integral : tout est du avant, rien au solde", () => {
    expect(planDePaiement(15000, "integral")).toEqual({
      mode: "integral",
      totalXaf: 15000,
      duAvantXaf: 15000,
      soldeXaf: 0,
    });
  });

  it("sans_prepaiement : rien avant, tout au solde — et ce n'est pas un cas degrade", () => {
    // Beaucoup de ventes se concluent contre-remboursement a la remise. Bloquer
    // ce mode ferait sortir la vendeuse du systeme.
    expect(planDePaiement(15000, "sans_prepaiement")).toEqual({
      mode: "sans_prepaiement",
      totalXaf: 15000,
      duAvantXaf: 0,
      soldeXaf: 15000,
    });
  });

  it("acompte : delegue a splitDeposit, sans le reimplementer", () => {
    // Le cas du blueprint : 50 % de 7 501 F vaut 3 750 F d'acompte et 3 751 F de
    // solde. `floor` sur l'acompte, le reste au solde.
    const plan = planDePaiement(7501, "acompte");
    expect(plan.duAvantXaf).toBe(3750);
    expect(plan.soldeXaf).toBe(3751);
    // Et c'est bien la meme fonction : si un jour quelqu'un recopie la regle ici,
    // ce test le verra.
    const { deposit, balance } = splitDeposit(7501, 50);
    expect([plan.duAvantXaf, plan.soldeXaf]).toEqual([deposit, balance]);
  });

  it("l'acompte accepte un autre pourcentage", () => {
    expect(planDePaiement(10000, "acompte", 30)).toMatchObject({
      duAvantXaf: 3000,
      soldeXaf: 7000,
    });
  });

  it("le total est preserve EXACTEMENT sur dix mille montants", () => {
    // Le franc perdu a l'arrondi n'existe pas. C'est la propriete qui compte, et
    // elle vaut pour les trois modes.
    for (let total = 1; total <= 10_000; total++) {
      for (const mode of ["integral", "acompte", "sans_prepaiement"] as const) {
        const p = planDePaiement(total, mode);
        expect(p.duAvantXaf + p.soldeXaf, `${mode} ${total}`).toBe(total);
        expect(Number.isInteger(p.duAvantXaf), `${mode} ${total}`).toBe(true);
        expect(Number.isInteger(p.soldeXaf), `${mode} ${total}`).toBe(true);
      }
    }
  });

  it("leve sur un total non entier ou nul plutot que d'arrondir", () => {
    for (const total of [0, -1, 1500.5, Number.NaN]) {
      expect(() => planDePaiement(total, "integral"), String(total)).toThrow();
    }
  });
});

describe("comparerMontant", () => {
  it("conforme quand les montants sont egaux", () => {
    expect(comparerMontant(15000, 15000)).toEqual({ etat: "conforme", ecartXaf: 0 });
  });

  it("nomme le sous-paiement et son ecart", () => {
    expect(comparerMontant(15000, 14000)).toEqual({ etat: "sous_paiement", ecartXaf: 1000 });
  });

  it("nomme le sur-paiement et son ecart", () => {
    expect(comparerMontant(15000, 16000)).toEqual({ etat: "sur_paiement", ecartXaf: 1000 });
  });

  it("un ecart d'UN franc est un ecart — la tolerance par defaut est zero", () => {
    // Ce n'est pas un defaut paresseux : on n'a pas encore observe assez de
    // versements reels pour savoir si des ecarts de quelques francs existent, et
    // on ne fabrique pas une tolerance plausible.
    expect(comparerMontant(15000, 14999).etat).toBe("sous_paiement");
    expect(comparerMontant(15000, 15001).etat).toBe("sur_paiement");
  });

  it("la tolerance est un parametre, pas une constante", () => {
    expect(comparerMontant(15000, 14995, 5).etat).toBe("conforme");
    expect(comparerMontant(15000, 14994, 5).etat).toBe("sous_paiement");
  });

  it("leve sur des montants non entiers", () => {
    expect(() => comparerMontant(15000, 14999.5)).toThrow();
  });
});

describe("appliquerVersement", () => {
  it("un versement conforme regle le solde", () => {
    const r = appliquerVersement(neuf(15000), 15000);
    expect(r.etat).toEqual({ totalXaf: 15000, amountPaidXaf: 15000, balanceXaf: 0 });
    expect(r.conformite.etat).toBe("conforme");
    expect(r.soldeRegle).toBe(true);
    expect(r.aRendreXaf).toBe(0);
  });

  it("un SOUS-PAIEMENT fait avancer la commande et laisse le solde ouvert", () => {
    // Jamais un rejet : la vendeuse a l'argent sur son telephone. Un refus
    // laisserait une acheteuse qui a paye devant un systeme qui dit non.
    const r = appliquerVersement(neuf(15000), 12000);
    expect(r.etat).toEqual({ totalXaf: 15000, amountPaidXaf: 12000, balanceXaf: 3000 });
    expect(r.conformite).toEqual({ etat: "sous_paiement", ecartXaf: 3000 });
    expect(r.soldeRegle).toBe(false);
    expect(r.aRendreXaf).toBe(0);
  });

  it("un SUR-PAIEMENT plafonne le paye et sort l'excedent en monnaie a rendre", () => {
    // L'excedent n'entre PAS dans `amountPaidXaf` : la contrainte de base
    // `paid + balance = total` l'interdit, et surtout ce serait faux — on doit de
    // la monnaie, l'acheteuse n'a pas achete davantage.
    const r = appliquerVersement(neuf(15000), 20000);
    expect(r.etat).toEqual({ totalXaf: 15000, amountPaidXaf: 15000, balanceXaf: 0 });
    expect(r.conformite).toEqual({ etat: "sur_paiement", ecartXaf: 5000 });
    expect(r.aRendreXaf).toBe(5000);
    expect(r.soldeRegle).toBe(true);
  });

  it("l'invariant paye + solde = total tient sur tous les cas", () => {
    for (const total of [1, 7501, 15000, 100_000]) {
      // Un versement doit rester strictement positif : `total - 1` vaut zero
      // quand le total vaut un franc, et zero n'est pas un versement.
      const versements = [1, 100, total - 1, total, total + 1, total * 3].filter((v) => v > 0);
      for (const versement of versements) {
        const r = appliquerVersement(neuf(total), versement);
        expect(r.etat.amountPaidXaf + r.etat.balanceXaf, `${total}/${versement}`).toBe(total);
        expect(r.etat.amountPaidXaf).toBeLessThanOrEqual(total);
        expect(r.etat.balanceXaf).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("enchaine acompte puis solde sans perdre un franc", () => {
    const plan = planDePaiement(7501, "acompte");
    const apresAcompte = appliquerVersement(neuf(7501), plan.duAvantXaf, plan.duAvantXaf);
    expect(apresAcompte.conformite.etat).toBe("conforme");
    expect(apresAcompte.etat.balanceXaf).toBe(3751);
    expect(apresAcompte.soldeRegle).toBe(false);

    const apresSolde = appliquerVersement(apresAcompte.etat, 3751);
    expect(apresSolde.conformite.etat).toBe("conforme");
    expect(apresSolde.etat).toEqual({ totalXaf: 7501, amountPaidXaf: 7501, balanceXaf: 0 });
    expect(apresSolde.soldeRegle).toBe(true);
  });

  it("compare au SOLDE restant par defaut, pas au total", () => {
    // Apres un acompte, verser le solde exact est conforme — le comparer au total
    // le classerait en sous-paiement et alarmerait pour rien.
    const apres = appliquerVersement(neuf(10000), 5000, 5000);
    const solde = appliquerVersement(apres.etat, 5000);
    expect(solde.conformite.etat).toBe("conforme");
  });

  it("REFUSE de travailler sur un etat deja incoherent", () => {
    // Le corriger en silence masquerait le vrai defaut.
    expect(() =>
      appliquerVersement({ totalXaf: 10000, amountPaidXaf: 3000, balanceXaf: 5000 }, 1000),
    ).toThrow(/incoherent/);
  });

  it("leve sur un versement nul, negatif ou fractionnaire", () => {
    for (const v of [0, -100, 1500.5]) {
      expect(() => appliquerVersement(neuf(15000), v), String(v)).toThrow();
    }
  });

  it("un versement sur une commande deja soldee sort entierement en monnaie", () => {
    const soldee: EtatArgent = { totalXaf: 15000, amountPaidXaf: 15000, balanceXaf: 0 };
    const r = appliquerVersement(soldee, 5000);
    expect(r.etat).toEqual(soldee);
    expect(r.aRendreXaf).toBe(5000);
    expect(r.conformite).toEqual({ etat: "sur_paiement", ecartXaf: 5000 });
  });
});

describe("aucun calcul de commission", () => {
  it("le module n'expose rien qui ressemble a une commission", () => {
    // Catalog ne peut pas prelever sur un flux qu'il ne detient pas. Le revenu
    // vient de l'abonnement — c'est une consequence structurelle, pas un argument
    // commercial. Un test le dit, parce que c'est le genre de champ qu'on ajoute
    // « juste pour voir ».
    const total = 15000;
    const r = appliquerVersement(neuf(total), total);
    const serialise = JSON.stringify(r);
    expect(serialise).not.toMatch(/commission|fee|frais|prelev/i);
    // Et la somme rendue a la vendeuse est le montant entier.
    expect(r.etat.amountPaidXaf).toBe(total);
  });
});
