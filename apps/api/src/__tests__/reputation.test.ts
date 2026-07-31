import { describe, expect, it } from "vitest";
import type { CommandePourCycle } from "../domain/order/cycle.ts";
import { type AvisPourNote, droitAuDepot, reputation } from "../domain/review/reputation.ts";

/**
 * La reputation — l'actif de verrouillage du produit.
 *
 * Une reputation ne se transporte pas ailleurs : c'est ce qui rend le depart
 * couteux, la ou le catalogue et la rampe se recopient en une apres-midi. Sa
 * regle centrale est donc une regle d'HONNETETE, pas de calcul : la note ne
 * doit refleter que des achats dont l'argent a laisse une trace.
 */

const LIVREE: CommandePourCycle = {
  etape: "livree",
  modeLivraison: "livraison",
  totalXaf: 10_000,
  amountPaidXaf: 10_000,
  balanceXaf: 0,
  etatPreuve: "prouve",
  annuleeA: null,
};

describe("droit a deposer un avis", () => {
  it("une commande livree et prouvee : avis VERIFIE", () => {
    expect(droitAuDepot(LIVREE)).toEqual({ possible: true, verifie: true });
  });

  it("une commande livree et contresignee : avis VERIFIE", () => {
    expect(droitAuDepot({ ...LIVREE, etatPreuve: "contresigne" })).toEqual({
      possible: true,
      verifie: true,
    });
  });

  /**
   * Le point du lot. Le depot direct non trace n'est pas BLOQUE — l'acheteuse
   * a bien recu sa commande et a le droit d'en parler — mais son avis ne porte
   * pas le label et n'entre pas dans la note. On ne l'empeche pas, on le
   * distingue.
   */
  it("un paiement declare a la main : avis POSSIBLE mais NON verifie", () => {
    expect(droitAuDepot({ ...LIVREE, etatPreuve: "declare_non_trace" })).toEqual({
      possible: true,
      verifie: false,
    });
  });

  it("une commande non livree : aucun avis", () => {
    expect(droitAuDepot({ ...LIVREE, etape: "chez_le_livreur" })).toEqual({
      possible: false,
      verifie: false,
    });
  });

  it("une commande annulee : aucun avis", () => {
    expect(droitAuDepot({ ...LIVREE, annuleeA: new Date("2026-07-30T10:00:00+01:00") })).toEqual({
      possible: false,
      verifie: false,
    });
  });
});

describe("note de la boutique", () => {
  const a = (note: number, verifie: boolean): AvisPourNote => ({ note, verifie });

  it("ne compte QUE les avis verifies", () => {
    const r = reputation([a(5, true), a(5, true), a(1, false)]);
    expect(r.note).toBe(5);
    expect(r.nbVerifies).toBe(2);
    expect(r.nbTotal).toBe(3);
  });

  /**
   * La propriete qui donne son sens au label : ajouter des avis NON verifies ne
   * doit jamais bouger la note, dans un sens ni dans l'autre. Sans cela, il
   * suffirait de declarer des paiements a la main pour se fabriquer une
   * reputation.
   */
  it("ajouter des avis non verifies ne bouge PAS la note", () => {
    const verifies = [a(4, true), a(5, true)];
    const avant = reputation(verifies).note;
    for (const bruit of [a(1, false), a(5, false), a(3, false)]) {
      expect(reputation([...verifies, bruit]).note).toBe(avant);
    }
  });

  it("sans aucun avis verifie, la note est NULLE et non zero", () => {
    // Zero se lirait « tres mauvaise boutique ». L'absence de note se dit.
    expect(reputation([a(5, false)]).note).toBeNull();
    expect(reputation([]).note).toBeNull();
  });

  /**
   * Arrondi au dixieme, et calcule en ENTIERS jusqu'au dernier moment. La note
   * n'est pas de l'argent, mais la meme discipline evite qu'un 4,999999
   * s'affiche « 5,0 » chez l'un et « 4,9 » chez l'autre.
   */
  it("arrondit au dixieme, de facon deterministe", () => {
    expect(reputation([a(4, true), a(5, true), a(5, true)]).note).toBe(4.7);
    expect(reputation([a(4, true), a(5, true)]).note).toBe(4.5);
    expect(reputation([a(1, true), a(2, true), a(2, true)]).note).toBe(1.7);
  });

  it("compte les ventes verifiees, qui sont ce qu'une acheteuse regarde", () => {
    const r = reputation([a(5, true), a(4, true), a(2, false)]);
    expect(r.nbVerifies).toBe(2);
  });

  it("refuse une note hors de l'echelle plutot que de la ranger en silence", () => {
    expect(() => reputation([a(6, true)])).toThrow(/note/i);
    expect(() => reputation([a(0, true)])).toThrow(/note/i);
    expect(() => reputation([a(4.5, true)])).toThrow(/note/i);
  });
});
