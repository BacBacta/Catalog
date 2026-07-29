import { CODE_ALPHABET, verificationCodeSchema } from "@swap/contracts";
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

  it("ne se repete pas sur 2 000 tirages", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateVerificationCode(rnd));
    expect(seen.size).toBe(2000);
  });
});
