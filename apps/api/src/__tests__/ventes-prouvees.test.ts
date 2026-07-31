import type { ProofState } from "@catalog/contracts";
import { describe, expect, it } from "vitest";
import { pourcentProuve, repartirVentes } from "../domain/stats/ventes-prouvees.ts";

/**
 * La part des ventes prouvees — l'indicateur le plus important du produit.
 *
 * C'est la mesure du CONTOURNEMENT, donc du modele lui-meme : Catalog ne vaut
 * que si les vendeuses collent leurs SMS. Ces tests fixent ce que le chiffre
 * compte, et surtout ce qu'il refuse de compter.
 */

describe("repartition en trois familles", () => {
  it("distingue prouve, contresigne et non trace", () => {
    const etats: ProofState[] = ["prouve", "prouve", "contresigne", "declare_non_trace"];
    expect(repartirVentes(etats)).toEqual({
      prouve: 2,
      contresigne: 1,
      nonTrace: 1,
      total: 4,
    });
  });

  /**
   * Trois familles et non deux : la contre-signature porte DEUX voix
   * independantes sur le meme identifiant, c'est la preuve la plus forte du
   * produit. La fondre dans « prouve » effacerait ce qu'elle apporte.
   */
  it("ne fond PAS la contre-signature dans « prouve »", () => {
    const r = repartirVentes(["contresigne", "contresigne"]);
    expect(r.contresigne).toBe(2);
    expect(r.prouve).toBe(0);
  });

  /**
   * Une commande contestee est un litige ouvert, pas un contournement ; une
   * commande en attente n'a pas encore de reponse. Les compter comme des echecs
   * de preuve accuserait la vendeuse d'un fait non etabli — et ferait plonger
   * l'indicateur a chaque nouvelle commande de la journee.
   */
  it("EXCLUT du denominateur ce qui n'est pas tranche", () => {
    const r = repartirVentes(["prouve", "attendu", "conteste"]);
    expect(r.total).toBe(1);
    expect(r.nonTrace).toBe(0);
  });

  it("sur une liste vide, tout est a zero", () => {
    expect(repartirVentes([])).toEqual({ prouve: 0, contresigne: 0, nonTrace: 0, total: 0 });
  });
});

describe("pourcentage prouve", () => {
  it("compte la contre-signature COMME prouvee : elle est plus forte, pas differente", () => {
    expect(pourcentProuve({ prouve: 1, contresigne: 1, nonTrace: 0, total: 2 })).toBe(100);
  });

  it("mesure bien le contournement", () => {
    expect(pourcentProuve({ prouve: 3, contresigne: 0, nonTrace: 1, total: 4 })).toBe(75);
    expect(pourcentProuve({ prouve: 0, contresigne: 0, nonTrace: 5, total: 5 })).toBe(0);
  });

  /**
   * Meme regle que la note du lot 12 : zero se lirait « aucune vendeuse ne
   * colle ses SMS », alors que la verite est « on n'a encore rien a mesurer ».
   * Un chiffre par defaut est un mensonge par defaut.
   */
  it("vaut NULL et non zero quand il n'y a rien a mesurer", () => {
    expect(pourcentProuve({ prouve: 0, contresigne: 0, nonTrace: 0, total: 0 })).toBeNull();
  });

  it("rend un entier, jamais un flottant a afficher", () => {
    const p = pourcentProuve({ prouve: 1, contresigne: 0, nonTrace: 2, total: 3 });
    expect(Number.isInteger(p)).toBe(true);
    expect(p).toBe(33);
  });
});
