import { describe, expect, it } from "vitest";
import { lireNumerosBanc, numeroDuBancParmi } from "../banc-essai.ts";

/**
 * Les numeros du banc d'essai — ADR 0058.
 *
 * La propriete qui compte : SANS la variable, l'ensemble est vide et rien ne
 * change nulle part. Et un +237 n'y entre jamais — il passe par la vraie
 * porte, l'y lister masquerait une regression du chemin normal.
 */
describe("la liste des numeros du banc", () => {
  it("absente ou vide : personne", () => {
    expect(lireNumerosBanc(undefined).size).toBe(0);
    expect(lireNumerosBanc("").size).toBe(0);
    expect(lireNumerosBanc(" , ,").size).toBe(0);
  });

  it("tolere les ecritures humaines — espaces, points, plus", () => {
    const l = lireNumerosBanc("+32 466 45.72.81, 32484651049");
    expect(l.has("+32466457281")).toBe(true);
    expect(l.has("+32484651049")).toBe(true);
    expect(l.size).toBe(2);
  });

  it("REFUSE un +237 : le chemin normal ne se court-circuite pas", () => {
    expect(lireNumerosBanc("+237690112233").size).toBe(0);
  });

  it("refuse les miettes qui ne sont pas un numero", () => {
    expect(lireNumerosBanc("bonjour,123").size).toBe(0);
  });
});

describe("l'appartenance au banc", () => {
  const liste = lireNumerosBanc("+32466457281");

  it("reconnait le numero sous toutes ses ecritures", () => {
    for (const forme of ["+32466457281", "32466457281", "32 466 45 72 81"]) {
      expect(numeroDuBancParmi(forme, liste), forme).toBe("+32466457281");
    }
  });

  it("rend null pour tout autre numero — y compris camerounais", () => {
    expect(numeroDuBancParmi("+32484651049", liste)).toBeNull();
    expect(numeroDuBancParmi("+237690112233", liste)).toBeNull();
    expect(numeroDuBancParmi("", liste)).toBeNull();
  });
});
