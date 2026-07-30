import { describe, expect, it } from "vitest";
import {
  avancerEtape,
  type CommandePourCycle,
  etapesPour,
  peutDeposerAvisVerifie,
  soldeAEncaisser,
} from "../domain/order/cycle.ts";

/**
 * Le cycle de vie d'une commande, du cote LIVRAISON.
 *
 * La preuve a sa propre machine (`domain/proof/machine.ts`) et ce module ne la
 * duplique pas : il la consulte. Les deux avancent separement — une commande
 * peut etre livree sans etre prouvee, et prouvee sans etre livree.
 */

const BASE: CommandePourCycle = {
  etape: "recue",
  modeLivraison: "livraison",
  totalXaf: 10_000,
  amountPaidXaf: 5_000,
  balanceXaf: 5_000,
  etatPreuve: "prouve",
  annuleeA: null,
};

const T = new Date("2026-07-30T10:00:00+01:00");

describe("etapes selon le mode de livraison", () => {
  it("une livraison passe par le livreur", () => {
    expect(etapesPour("livraison")).toEqual(["recue", "preparee", "chez_le_livreur", "livree"]);
  });

  /**
   * Le point de retrait est un mode de plein droit (ADR 0005), pas un cas
   * degrade. Il n'a pas de livreur : lui imposer l'etape « chez le livreur »
   * obligerait la vendeuse a mentir pour avancer sa commande.
   */
  it("un retrait n'a pas d'etape « chez le livreur »", () => {
    expect(etapesPour("retrait")).toEqual(["recue", "preparee", "livree"]);
  });
});

describe("avancer d'une etape", () => {
  it("avance et journalise", () => {
    const r = avancerEtape(BASE, "preparee", T);
    expect(r.ok).toBe(true);
    expect(r.etape).toBe("preparee");
    expect(r.journal.kind).toBe("etape_avancee");
    expect(r.journal.de).toBe("recue");
    expect(r.journal.vers).toBe("preparee");
  });

  /**
   * Meme contrat que la machine de preuve : le refus produit une entree de
   * journal aussi solide qu'une acceptation. Un recul silencieux serait une
   * anomalie invisible.
   */
  it("un recul est journalise PUIS ignore", () => {
    const r = avancerEtape({ ...BASE, etape: "chez_le_livreur" }, "preparee", T);
    expect(r).toMatchObject({
      ok: false,
      etape: "chez_le_livreur",
      raison: "recul_ignore",
      journal: { kind: "etape_refusee" },
    });
  });

  it("rester sur place est un recul, pas une avance", () => {
    const r = avancerEtape({ ...BASE, etape: "preparee" }, "preparee", T);
    expect(r).toMatchObject({ ok: false, raison: "recul_ignore" });
  });

  it("une etape absente du mode est refusee", () => {
    const r = avancerEtape({ ...BASE, modeLivraison: "retrait" }, "chez_le_livreur", T);
    expect(r).toMatchObject({ ok: false, raison: "etape_hors_mode" });
  });

  it("un retrait peut passer de preparee a livree", () => {
    const r = avancerEtape(
      {
        ...BASE,
        modeLivraison: "retrait",
        etape: "preparee",
        balanceXaf: 0,
        amountPaidXaf: 10_000,
      },
      "livree",
      T,
    );
    expect(r.ok).toBe(true);
  });

  it("une commande annulee n'avance plus", () => {
    const r = avancerEtape({ ...BASE, annuleeA: T }, "preparee", T);
    expect(r).toMatchObject({ ok: false, raison: "commande_annulee" });
  });
});

describe("le solde barre la remise", () => {
  /**
   * C'est la regle d'argent du lot : on ne marque pas « livree » en laissant un
   * solde ouvert. Sans elle, l'acompte disparait du suivi — la commande parait
   * terminee alors que la vendeuse attend encore la moitie de son argent.
   */
  it("livree est refusee tant que le solde n'est pas encaisse", () => {
    const r = avancerEtape({ ...BASE, etape: "chez_le_livreur" }, "livree", T);
    expect(r).toMatchObject({ ok: false, raison: "solde_ouvert" });
  });

  it("livree passe quand le solde est a zero", () => {
    const r = avancerEtape(
      { ...BASE, etape: "chez_le_livreur", amountPaidXaf: 10_000, balanceXaf: 0 },
      "livree",
      T,
    );
    expect(r.ok).toBe(true);
    expect(r.etape).toBe("livree");
  });

  /** Les etapes intermediaires, elles, n'ont rien a voir avec l'argent. */
  it("le solde n'empeche pas de preparer ni de confier au livreur", () => {
    expect(avancerEtape(BASE, "preparee", T).ok).toBe(true);
    expect(avancerEtape({ ...BASE, etape: "preparee" }, "chez_le_livreur", T).ok).toBe(true);
  });
});

describe("solde a encaisser", () => {
  it("vaut le solde restant d'une commande vivante", () => {
    expect(soldeAEncaisser(BASE)).toBe(5_000);
  });

  it("vaut zero sur une commande annulee", () => {
    expect(soldeAEncaisser({ ...BASE, annuleeA: T })).toBe(0);
  });

  it("vaut zero quand tout est paye", () => {
    expect(soldeAEncaisser({ ...BASE, amountPaidXaf: 10_000, balanceXaf: 0 })).toBe(0);
  });
});

describe("avis verifie", () => {
  const livree: CommandePourCycle = {
    ...BASE,
    etape: "livree",
    amountPaidXaf: 10_000,
    balanceXaf: 0,
  };

  it("une commande livree et prouvee y donne droit", () => {
    expect(peutDeposerAvisVerifie(livree)).toBe(true);
  });

  it("une commande livree et contresignee y donne droit", () => {
    expect(peutDeposerAvisVerifie({ ...livree, etatPreuve: "contresigne" })).toBe(true);
  });

  /**
   * LA regle du lot, et elle est dans la definition de terminé : un depot
   * direct declare a la main fait avancer la commande, mais n'ouvre droit ni au
   * recu ni a l'avis verifie. On ne le bloque pas, on le distingue.
   */
  it("un paiement declare a la main n'y donne PAS droit", () => {
    expect(peutDeposerAvisVerifie({ ...livree, etatPreuve: "declare_non_trace" })).toBe(false);
  });

  it("une commande prouvee mais non livree n'y donne pas encore droit", () => {
    expect(peutDeposerAvisVerifie({ ...BASE, etatPreuve: "prouve" })).toBe(false);
  });

  it("une commande contestee n'y donne pas droit", () => {
    expect(peutDeposerAvisVerifie({ ...livree, etatPreuve: "conteste" })).toBe(false);
  });
});
