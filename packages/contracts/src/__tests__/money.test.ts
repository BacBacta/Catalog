import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertXaf, formatXaf, MoneyError, splitDeposit } from "../money.ts";

describe("assertXaf", () => {
  it("rejette les flottants — le FCFA n'a pas de sous-unite", () => {
    expect(() => assertXaf(3750.5)).toThrow(MoneyError);
  });
  it("rejette les montants negatifs", () => {
    expect(() => assertXaf(-1)).toThrow(MoneyError);
  });
  it("accepte zero", () => {
    expect(() => assertXaf(0)).not.toThrow();
  });
});

describe("splitDeposit", () => {
  it("arrondit l'acompte au franc inferieur, le solde absorbe le reste", () => {
    expect(splitDeposit(7501, 50)).toEqual({ deposit: 3750, balance: 3751 });
  });

  it("cas simple", () => {
    expect(splitDeposit(15000, 50)).toEqual({ deposit: 7500, balance: 7500 });
  });

  it("rejette un pourcentage hors bornes", () => {
    expect(() => splitDeposit(1000, 0)).toThrow(MoneyError);
    expect(() => splitDeposit(1000, 100)).toThrow(MoneyError);
  });

  it("INVARIANT : deposit + balance === total, sur 10 000 cas", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.integer({ min: 1, max: 99 }),
        (total, pct) => {
          const { deposit, balance } = splitDeposit(total, pct);
          expect(Number.isInteger(deposit)).toBe(true);
          expect(Number.isInteger(balance)).toBe(true);
          expect(deposit).toBeGreaterThanOrEqual(0);
          expect(balance).toBeGreaterThanOrEqual(0);
          expect(deposit + balance).toBe(total);
        },
      ),
      { numRuns: 10_000 },
    );
  });
});

describe("formatXaf", () => {
  it("groupe les milliers avec une espace insecable", () => {
    expect(formatXaf(15000)).toBe("15 000 FCFA");
  });
  it("peut omettre le suffixe", () => {
    expect(formatXaf(7500, { suffix: false })).toBe("7 500");
  });
});
