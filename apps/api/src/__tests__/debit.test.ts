import { describe, expect, it } from "vitest";
import {
  elaguer,
  type Passage,
  REGLES_PAR_DEFAUT,
  reglesDepuisEnv,
  secondesAvantReprise,
  verifierDebit,
} from "../domain/securite/debit.ts";

/**
 * La limitation de debit generale, sur ses proprietes plutot que sur ses
 * chiffres.
 *
 * Un test qui verifie « 120 » se casse le jour ou l'on regle la valeur avec des
 * donnees de terrain — et c'est justement ce qu'on veut pouvoir faire sans
 * redeployer. Ce qui est verifie ici, c'est ce qui ne doit pas changer : la
 * fenetre GLISSE, les cles ne se melangent pas, et un refus annonce toujours un
 * delai non nul.
 */

const T = (iso: string): Date => new Date(iso);
const regle = { max: 3, fenetreMs: 60_000 };

const passages = (cle: string, ...isos: string[]): Passage[] =>
  isos.map((iso) => ({ cle, at: T(iso) }));

describe("verifierDebit", () => {
  it("laisse passer tant que la fenetre n'est pas pleine", () => {
    const d = verifierDebit(
      passages("a", "2026-08-01T10:00:00Z"),
      {
        cle: "a",
        now: T("2026-08-01T10:00:30Z"),
      },
      regle,
    );
    expect(d.autorise).toBe(true);
    // Trois autorises, un consomme, un en cours : il en reste un.
    if (d.autorise) expect(d.restant).toBe(1);
  });

  it("refuse a partir du maximum", () => {
    const d = verifierDebit(
      passages("a", "2026-08-01T10:00:00Z", "2026-08-01T10:00:10Z", "2026-08-01T10:00:20Z"),
      { cle: "a", now: T("2026-08-01T10:00:30Z") },
      regle,
    );
    expect(d.autorise).toBe(false);
  });

  /**
   * **La propriete qui justifie une fenetre glissante.** Avec une fenetre fixe,
   * les trois passages d'une minute et les trois de la suivante peuvent tomber a
   * deux secondes d'intervalle : six requetes en deux secondes, soit exactement
   * le pic que la limitation existe pour empecher.
   */
  it("la fenetre glisse : le plus ancien passage sort et libere une place", () => {
    const trois = passages(
      "a",
      "2026-08-01T10:00:00Z",
      "2026-08-01T10:00:10Z",
      "2026-08-01T10:00:20Z",
    );
    expect(verifierDebit(trois, { cle: "a", now: T("2026-08-01T10:00:59Z") }, regle).autorise).toBe(
      false,
    );
    // Une seconde plus tard, le passage de 10:00:00 est sorti de la fenetre.
    expect(verifierDebit(trois, { cle: "a", now: T("2026-08-01T10:01:01Z") }, regle).autorise).toBe(
      true,
    );
  });

  it("ne melange pas deux cles : une adresse saturee n'enferme pas l'autre", () => {
    const saturee = passages(
      "a",
      "2026-08-01T10:00:00Z",
      "2026-08-01T10:00:01Z",
      "2026-08-01T10:00:02Z",
    );
    const d = verifierDebit(saturee, { cle: "b", now: T("2026-08-01T10:00:03Z") }, regle);
    expect(d.autorise).toBe(true);
  });

  it("annonce le delai jusqu'a la sortie du plus ancien passage", () => {
    const d = verifierDebit(
      passages("a", "2026-08-01T10:00:00Z", "2026-08-01T10:00:10Z", "2026-08-01T10:00:20Z"),
      { cle: "a", now: T("2026-08-01T10:00:30Z") },
      regle,
    );
    expect(d.autorise).toBe(false);
    if (!d.autorise) expect(d.reessayerDansMs).toBe(30_000);
  });

  /**
   * `Retry-After: 0` invite le client a reessayer immediatement, donc a boucler.
   * Le plancher d'une seconde n'est pas une coquetterie.
   */
  it("Retry-After n'est jamais nul sur un refus", () => {
    const d = verifierDebit(
      passages("a", "2026-08-01T10:00:00Z", "2026-08-01T10:00:00Z", "2026-08-01T10:00:00Z"),
      { cle: "a", now: T("2026-08-01T10:00:59.999Z") },
      regle,
    );
    expect(secondesAvantReprise(d)).toBeGreaterThanOrEqual(1);
  });

  it("un passage autorise annonce zero seconde d'attente", () => {
    expect(secondesAvantReprise({ autorise: true, restant: 5 })).toBe(0);
  });
});

describe("reglesDepuisEnv", () => {
  it("rend les defauts sur un environnement vide", () => {
    expect(reglesDepuisEnv({})).toEqual(REGLES_PAR_DEFAUT);
  });

  it("lit les trois familles", () => {
    const r = reglesDepuisEnv({
      DEBIT_LECTURE_MAX: "300",
      DEBIT_ECRITURE_MAX: "25",
      DEBIT_PREUVE_MAX: "60",
      DEBIT_PREUVE_FENETRE_MS: "30000",
    });
    expect(r.lecture.max).toBe(300);
    expect(r.ecriture.max).toBe(25);
    expect(r.preuve).toEqual({ max: 60, fenetreMs: 30_000 });
  });

  /**
   * **Une faute de frappe ne doit pas ouvrir la vanne.** C'est la meme regle que
   * pour les plafonds d'OTP du lot 4 : `DEBIT_LECTURE_MAX="cent"` retombe sur le
   * defaut, il ne rend pas la limite infinie.
   */
  it("ignore une valeur non numerique, negative ou nulle", () => {
    const r = reglesDepuisEnv({
      DEBIT_LECTURE_MAX: "cent-vingt",
      DEBIT_ECRITURE_MAX: "-4",
      DEBIT_PREUVE_MAX: "0",
    });
    expect(r.lecture.max).toBe(REGLES_PAR_DEFAUT.lecture.max);
    expect(r.ecriture.max).toBe(REGLES_PAR_DEFAUT.ecriture.max);
    expect(r.preuve.max).toBe(REGLES_PAR_DEFAUT.preuve.max);
  });

  it("les gestes uniques sont plus serres que les lectures", () => {
    // Contre-signer, contester, deposer un avis : une fois par commande. Lire son
    // suivi : autant de fois qu'on veut.
    expect(REGLES_PAR_DEFAUT.ecriture.max).toBeLessThan(REGLES_PAR_DEFAUT.lecture.max);
  });
});

describe("elaguer", () => {
  it("retire ce qui est sorti de la fenetre et garde le reste", () => {
    const p = passages("a", "2026-08-01T10:00:00Z", "2026-08-01T10:05:00Z");
    expect(elaguer(p, T("2026-08-01T10:02:00Z"))).toHaveLength(1);
  });

  /**
   * Sans elagage, la memoire du processus croit avec le trafic et ne redescend
   * jamais. La fuite ne se declare pas en developpement — elle se declare le jour
   * de pic, c'est-a-dire le seul jour ou elle coute quelque chose.
   */
  it("rend une liste vide quand tout est perime", () => {
    const p = passages("a", "2026-08-01T10:00:00Z", "2026-08-01T10:00:30Z");
    expect(elaguer(p, T("2026-08-01T11:00:00Z"))).toEqual([]);
  });
});
