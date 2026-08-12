import { describe, expect, it } from "vitest";
import {
  decisionReconstruction,
  MOTIFS_RECONSTRUCTION,
  type MotifReconstruction,
} from "../deploiement/reconstruction-boutique.ts";

/**
 * La boutique publique se reconstruit — ADR 0065.
 *
 * Elle lit un instantane JSON pris a la CONSTRUCTION et ne parle jamais a la
 * base (lot 6) : c'est ce qui tient les 30 Ko de JS. Consequence mesuree le
 * 11/08/2026 : `chez-bea-test` et `chez-oumar` repondaient 404. Une vendeuse
 * qui s'inscrit dans le fil n'avait aucune page web, et rien ne le lui disait.
 */

const T0 = new Date("2026-08-11T12:00:00.000Z");
const apres = (secondes: number) => new Date(T0.getTime() + secondes * 1000);

describe("ce qui rend la boutique perimee", () => {
  it("la liste est FERMEE — un evenement inconnu ne declenche rien", () => {
    /* Une reconstruction coute un deploiement. Elle ne part que sur un
       evenement qui change ce que l'acheteuse VOIT. */
    const d = decisionReconstruction({
      motif: "quelque_chose" as MotifReconstruction,
      derniereDemandeA: null,
      maintenant: T0,
    });
    expect(d.reconstruire).toBe(false);
  });

  it("une publication d'article la rend perimee", () => {
    const d = decisionReconstruction({
      motif: "article_publie",
      derniereDemandeA: null,
      maintenant: T0,
    });
    expect(d.reconstruire).toBe(true);
  });

  it("tous les motifs retenus declenchent", () => {
    for (const motif of MOTIFS_RECONSTRUCTION) {
      const d = decisionReconstruction({ motif, derniereDemandeA: null, maintenant: T0 });
      expect(d.reconstruire, motif).toBe(true);
    }
  });
});

describe("le regroupement : cinq articles ne font pas cinq deploiements", () => {
  it("une demande trop proche de la precedente est ABSORBEE", () => {
    /* Une vendeuse qui publie sa collection d'un coup declencherait sinon un
       deploiement par photo. */
    const d = decisionReconstruction({
      motif: "article_publie",
      derniereDemandeA: T0,
      maintenant: apres(30),
    });
    expect(d.reconstruire).toBe(false);
    if (!d.reconstruire) expect(d.raison).toBe("deja_demandee");
  });

  it("passe le delai de regroupement, une nouvelle demande repart", () => {
    const d = decisionReconstruction({
      motif: "article_publie",
      derniereDemandeA: T0,
      maintenant: apres(20 * 60),
    });
    expect(d.reconstruire).toBe(true);
  });

  it("le delai ANNONCE ne ment pas : il couvre le regroupement", () => {
    /* Ce qu'on dit a la vendeuse doit couvrir le temps qu'elle attendra
       reellement — sinon la promesse est fausse des la premiere fois. */
    const d = decisionReconstruction({
      motif: "article_publie",
      derniereDemandeA: null,
      maintenant: T0,
    });
    if (d.reconstruire) expect(d.attenteAnnonceeMinutes).toBeGreaterThanOrEqual(5);
  });
});

describe("ce que la decision ne fait pas", () => {
  it("elle est PURE : deux appels identiques rendent la meme chose", () => {
    const a = decisionReconstruction({
      motif: "boutique_creee",
      derniereDemandeA: T0,
      maintenant: apres(60),
    });
    const b = decisionReconstruction({
      motif: "boutique_creee",
      derniereDemandeA: T0,
      maintenant: apres(60),
    });
    expect(a).toEqual(b);
  });
});
