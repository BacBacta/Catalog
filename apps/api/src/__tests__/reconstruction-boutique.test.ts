import { describe, expect, it } from "vitest";
import {
  ATTENTE_ANNONCEE_MIN,
  ATTENTE_SANS_REGROUPEMENT_MIN,
  decisionReconstruction,
} from "../domain/deploiement/reconstruction-boutique.ts";

/**
 * ── La naissance ne se regroupe pas — 12/08/2026 ─────────────────────────
 *
 * Constate en conditions reelles : une boutique creee dans le fil pouvait
 * attendre derriere la fenetre de regroupement d'une AUTRE vendeuse, soit
 * jusqu'a dix minutes avant meme que la construction commence — et quinze
 * minutes annoncees. Du point de vue de celle qui vient de s'inscrire, « ma
 * page n'existe pas » et « ma page arrive dans quinze minutes » se
 * ressemblent beaucoup trop.
 */
describe("la naissance d'une boutique saute le regroupement", () => {
  const maintenant = new Date("2026-08-12T08:00:00+01:00");
  const ilYAUneMinute = new Date(maintenant.getTime() - 60_000);

  it("passe meme quand une reconstruction vient d'etre demandee", () => {
    const d = decisionReconstruction({
      motif: "boutique_creee",
      derniereDemandeA: ilYAUneMinute,
      maintenant,
    });
    expect(d.reconstruire).toBe(true);
  });

  it("annonce un delai plus court, parce qu'il est vrai", () => {
    const d = decisionReconstruction({
      motif: "boutique_creee",
      derniereDemandeA: null,
      maintenant,
    });
    expect(d.reconstruire && d.attenteAnnonceeMinutes).toBe(ATTENTE_SANS_REGROUPEMENT_MIN);
    expect(ATTENTE_SANS_REGROUPEMENT_MIN).toBeLessThan(ATTENTE_ANNONCEE_MIN);
  });

  /**
   * L'exemption est ETROITE. Une publication d'article est exactement le cas
   * que le regroupement protege — une vendeuse qui poste sa collection.
   */
  it("ne s'etend PAS a la publication d'article", () => {
    const d = decisionReconstruction({
      motif: "article_publie",
      derniereDemandeA: ilYAUneMinute,
      maintenant,
    });
    expect(d).toEqual({ reconstruire: false, raison: "deja_demandee" });
  });

  it("ne s'etend ni aux conges ni a la modification de boutique", () => {
    for (const motif of ["conges_bascules", "boutique_modifiee"] as const) {
      expect(
        decisionReconstruction({ motif, derniereDemandeA: ilYAUneMinute, maintenant }).reconstruire,
      ).toBe(false);
    }
  });
});
