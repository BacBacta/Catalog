import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  canTransition,
  formatVerificationCode,
  verificationCodeSchema,
} from "../payment.js";

describe("machine a etats", () => {
  it("waiting_customer n'est PAS un echec : il mene a paid", () => {
    expect(canTransition("waiting_customer", "paid")).toBe(true);
  });

  it("un paiement ne recule jamais", () => {
    expect(canTransition("paid", "waiting_customer")).toBe(false);
    expect(canTransition("paid", "initiated")).toBe(false);
    expect(canTransition("waiting_customer", "initiated")).toBe(false);
  });

  it("failed est definitif", () => {
    expect(canTransition("failed", "paid")).toBe(false);
  });

  it("un paiement paye peut etre conteste", () => {
    expect(canTransition("paid", "disputed")).toBe(true);
  });
});

describe("code de verification", () => {
  it("l'alphabet exclut les caracteres ambigus", () => {
    for (const c of ["O", "0", "I", "1", "L", "B", "8", "S", "5", "Z", "2"]) {
      expect(CODE_ALPHABET.includes(c)).toBe(false);
    }
  });

  it("formate en deux groupes de quatre", () => {
    expect(formatVerificationCode("azsy79dv")).toBe("AZSY-79DV");
  });

  it("valide un code correct et rejette un code ambigu", () => {
    expect(verificationCodeSchema.safeParse("ACDE-4679").success).toBe(true);
    expect(verificationCodeSchema.safeParse("AB0I-1234").success).toBe(false);
  });
});
