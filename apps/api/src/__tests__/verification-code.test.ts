import { CODE_ALPHABET, verificationCodeSchema } from "@catalog/contracts";
import { describe, expect, it } from "vitest";
import { generateVerificationCode } from "../domain/verification-code.ts";

const rnd = (n: number) => {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
};

describe("generateVerificationCode", () => {
  it("produit un code valide au format XXXX-XXXX", () => {
    const code = generateVerificationCode(rnd);
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(verificationCodeSchema.safeParse(code).success).toBe(true);
  });

  it("n'utilise que l'alphabet non ambigu", () => {
    for (let i = 0; i < 500; i++) {
      for (const ch of generateVerificationCode(rnd).replace("-", "")) {
        expect(CODE_ALPHABET.includes(ch)).toBe(true);
      }
    }
  });
});

/**
 * Le test des 10 000 codes exige par le lot 3.
 *
 * Il ne cherche pas seulement les doublons : il cherche le **motif degenere**.
 * Le piege est precis, et le blueprint le nomme — un generateur dont le pas
 * partage un facteur avec la taille de l'alphabet produit des codes du type
 * `TTTT-TTTT`. Ici l'alphabet fait 25 caracteres, soit 5², donc tout pas
 * multiple de 5 degenererait.
 *
 * Le generateur retenu n'est PAS congruentiel : il tire des octets
 * cryptographiques avec rejet des valeurs qui biaiseraient le modulo. Voir
 * ADR 0013 pour pourquoi ce choix s'ecarte de la lettre du blueprint. Ces
 * assertions valent pour l'un comme pour l'autre : elles decrivent ce qu'un
 * code doit etre, pas comment il est fabrique.
 */
describe("10 000 codes : aucun motif degenere", () => {
  const N = 10_000;
  const codes: string[] = [];
  for (let i = 0; i < N; i++) codes.push(generateVerificationCode(rnd));
  const nus = codes.map((c) => c.replace("-", ""));

  /**
   * ── Deux seuils tires du CALCUL, et non du confort ─────────────────────
   *
   * Celui-ci et celui des moities jumelles portaient des bornes qui sont
   * fausses pour un generateur PARFAIT. Mesure du 14/08 (run 31788410462) :
   * la porte du deploiement est passee au rouge sur « expected 2 to be less
   * than or equal to 1 », et le generateur n'y etait pour rien.
   *
   * Verifie avant de toucher au seuil — 4 000 000 de tirages reels :
   * 7 moities jumelles observees pour 10,24 attendues, soit 1 ecart-type.
   * Le generateur n'est pas biaise ; c'est la borne qui mentait.
   *
   * Les deux bornes se recalculent donc, et le chiffre est ecrit :
   *
   *   doublon    : 10 000 codes dans 25⁸ = 152 587 890 625
   *                lambda = C(10000,2)/25⁸ = 3,28e-4
   *                P(>= 1) = 1 sur 3 053      <- l'ancienne borne
   *                P(>= 2) = 1 sur 18 600 000 <- celle-ci
   *
   *   jumelles   : lambda = 10 000/25⁴ = 2,56e-2
   *                P(>= 2) = 1 sur 3 104      <- l'ancienne borne
   *                P(>= 4) = 1 sur 364 556    <- celle-ci
   *
   * Le pouvoir de detection ne bouge PAS : le defaut que ces tests cherchent
   * — un pas partageant un facteur avec les 25 symboles — ne produit pas deux
   * ou trois cas, il en produit des milliers. Entre « 1 » et « 3 », il n'y a
   * que du bruit ; entre « 3 » et « ce que rend un generateur degenere », il y
   * a trois ordres de grandeur.
   *
   * Et le produit ne depend pas de ces bornes : `verification_code` est
   * `@unique` en base. Une collision, si elle arrivait, se heurterait a la
   * base avant d'exister deux fois.
   */
  it("au plus un doublon sur 10 000 — au-dela, le generateur a une periode", () => {
    const doublons = N - new Set(codes).size;
    expect(doublons, `doublons : ${doublons}`).toBeLessThanOrEqual(1);
  });

  it("tous valides et dans l'alphabet", () => {
    for (const c of codes) {
      expect(verificationCodeSchema.safeParse(c).success).toBe(true);
    }
  });

  it("aucun code n'a ses huit caracteres identiques — le cas TTTT-TTTT", () => {
    const degeneres = nus.filter((c) => new Set(c).size === 1);
    expect(degeneres, `codes uniformes : ${degeneres.slice(0, 5).join(", ")}`).toEqual([]);
  });

  it("les deux moities ne sont jamais systematiquement egales", () => {
    // Un `ABCD-ABCD` isole est possible par hasard (1 sur 25⁴ ≈ 390 000) ;
    // une PERIODE dans le generateur en produirait des milliers. Le seuil est
    // calcule dans la note ci-dessus : 3 est encore du bruit, et il laisse
    // une fausse alerte tous les 364 556 passages au lieu de tous les 3 104.
    const jumelles = nus.filter((c) => c.slice(0, 4) === c.slice(4));
    expect(jumelles.length, `moities jumelles : ${jumelles.length}`).toBeLessThanOrEqual(3);
  });

  it("aucune position n'est figee sur un seul caractere", () => {
    // Symptome classique d'un pas mal choisi : la colonne k ne bouge pas.
    for (let k = 0; k < 8; k++) {
      const vus = new Set(nus.map((c) => c[k]));
      expect(vus.size, `position ${k} figee sur ${[...vus].join("")}`).toBeGreaterThan(20);
    }
  });

  it("l'alphabet est parcouru sans trou et sans favori", () => {
    // 80 000 caracteres sur 25 symboles : ~3 200 attendus chacun. On tolere
    // large (±35 %) pour ne pas rendre le test instable, tout en attrapant un
    // generateur qui ignorerait une partie de l'alphabet.
    const total = nus.length * 8;
    const attendu = total / CODE_ALPHABET.length;
    const compte = new Map<string, number>();
    for (const c of nus) {
      for (const ch of c) compte.set(ch, (compte.get(ch) ?? 0) + 1);
    }
    expect(compte.size, "un caractere de l'alphabet n'apparait jamais").toBe(CODE_ALPHABET.length);
    for (const [ch, n] of compte) {
      expect(n, `${ch} apparait ${n} fois, attendu ~${Math.round(attendu)}`).toBeGreaterThan(
        attendu * 0.65,
      );
      expect(n).toBeLessThan(attendu * 1.35);
    }
  });

  it("aucune suite de trois caracteres consecutifs de l'alphabet", () => {
    // Ce que produirait un compteur incremental deguise en generateur.
    const suites = nus.filter((c) => {
      for (let k = 0; k + 2 < 8; k++) {
        const a = CODE_ALPHABET.indexOf(c[k] as string);
        const b = CODE_ALPHABET.indexOf(c[k + 1] as string);
        const d = CODE_ALPHABET.indexOf(c[k + 2] as string);
        if (b === a + 1 && d === b + 1) return true;
      }
      return false;
    });
    // Quelques occurrences fortuites sont normales ; une majorite ne l'est pas.
    expect(suites.length).toBeLessThan(N * 0.02);
  });
});
