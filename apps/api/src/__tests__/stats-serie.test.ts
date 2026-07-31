import { describe, expect, it } from "vitest";
import { etapesEntonnoir, serieContinue } from "../domain/stats/serie.ts";

/**
 * Series et entonnoir de l'ecran statistiques.
 *
 * Les deux regles que ces tests fixent ne sont pas des details de presentation :
 * elles decident de ce qu'une vendeuse CROIT en regardant son ecran.
 */

describe("serie continue", () => {
  /**
   * Un jour sans vue est un jour a ZERO, pas un jour absent. Une courbe qui
   * saute les jours creux relie le lundi au jeudi par une droite et raconte une
   * frequentation qui n'a pas eu lieu.
   */
  it("comble les trous a zero", () => {
    const s = serieContinue([{ jour: "2026-07-03", valeur: 5 }], "2026-07-01", "2026-07-04");
    expect(s).toEqual([
      { jour: "2026-07-01", valeur: 0 },
      { jour: "2026-07-02", valeur: 0 },
      { jour: "2026-07-03", valeur: 5 },
      { jour: "2026-07-04", valeur: 0 },
    ]);
  });

  it("additionne plusieurs points du meme jour", () => {
    const s = serieContinue(
      [
        { jour: "2026-07-01", valeur: 2 },
        { jour: "2026-07-01", valeur: 3 },
      ],
      "2026-07-01",
      "2026-07-01",
    );
    expect(s).toEqual([{ jour: "2026-07-01", valeur: 5 }]);
  });

  it("ignore ce qui est hors bornes plutot que d'etendre la periode", () => {
    const s = serieContinue(
      [
        { jour: "2026-06-30", valeur: 9 },
        { jour: "2026-07-02", valeur: 9 },
        { jour: "2026-07-01", valeur: 1 },
      ],
      "2026-07-01",
      "2026-07-01",
    );
    expect(s).toEqual([{ jour: "2026-07-01", valeur: 1 }]);
  });

  /** Un mois de trente et un jours, franchi sans trou ni doublon. */
  it("franchit une fin de mois", () => {
    const s = serieContinue([], "2026-07-30", "2026-08-02");
    expect(s.map((p) => p.jour)).toEqual(["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
  });

  it("refuse des bornes inversees ou malformees", () => {
    expect(() => serieContinue([], "2026-07-04", "2026-07-01")).toThrow(/inversees/i);
    expect(() => serieContinue([], "04/07/2026", "2026-07-01")).toThrow(/invalides/i);
  });

  it("refuse une valeur negative ou fractionnaire", () => {
    expect(() =>
      serieContinue([{ jour: "2026-07-01", valeur: -1 }], "2026-07-01", "2026-07-01"),
    ).toThrow();
    expect(() =>
      serieContinue([{ jour: "2026-07-01", valeur: 1.5 }], "2026-07-01", "2026-07-01"),
    ).toThrow();
  });
});

describe("entonnoir", () => {
  /**
   * Le taux se calcule sur l'etape PRECEDENTE, pas sur le sommet. Rapporte au
   * sommet, tout ressemble a une hemorragie et on ne voit plus OU ca fuit.
   */
  it("rapporte chaque etape a la precedente", () => {
    const e = etapesEntonnoir({ vues: 1000, commandes: 100, payees: 50, prouvees: 40 });
    expect(e.map((x) => x.pourcentPrecedent)).toEqual([null, 10, 50, 80]);
  });

  it("nomme chaque etape en toutes lettres", () => {
    const e = etapesEntonnoir({ vues: 10, commandes: 5, payees: 2, prouvees: 1 });
    expect(e.map((x) => x.cle)).toEqual(["vues", "commandes", "payees", "prouvees"]);
    expect(e[3]?.libelle).toMatch(/prouv/i);
  });

  /**
   * Un entonnoir qui grossit est un defaut de COMPTAGE. Le corriger en silence
   * le rendrait introuvable : on rend la valeur telle quelle, et le pourcentage
   * depasse cent.
   */
  it("ne masque PAS une etape qui remonte", () => {
    const e = etapesEntonnoir({ vues: 10, commandes: 20, payees: 20, prouvees: 20 });
    expect(e[1]?.pourcentPrecedent).toBe(200);
  });

  it("ne divise pas par zero", () => {
    const e = etapesEntonnoir({ vues: 0, commandes: 0, payees: 0, prouvees: 0 });
    expect(e.map((x) => x.pourcentPrecedent)).toEqual([null, 0, 0, 0]);
  });

  it("refuse une valeur negative ou fractionnaire", () => {
    expect(() => etapesEntonnoir({ vues: -1, commandes: 0, payees: 0, prouvees: 0 })).toThrow();
    expect(() => etapesEntonnoir({ vues: 1.5, commandes: 0, payees: 0, prouvees: 0 })).toThrow();
  });
});
