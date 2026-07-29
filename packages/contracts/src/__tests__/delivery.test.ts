import { describe, expect, it } from "vitest";
import { deliverySchema, normalizePhone } from "../delivery.ts";

describe("normalizePhone", () => {
  const cases: Array<[string, string | null]> = [
    ["677123456", "+237677123456"],
    ["6 77 12 34 56", "+237677123456"],
    ["+237 677 12 34 56", "+237677123456"],
    ["237677123456", "+237677123456"],
    ["677-12-34-56", "+237677123456"],
    ["222123456", "+237222123456"],
    ["12345", null],
    ["777123456", null],
  ];
  for (const [input, expected] of cases) {
    it(`« ${input} » -> ${expected ?? "null"}`, () => {
      expect(normalizePhone(input)).toBe(expected);
    });
  }
});

describe("deliverySchema", () => {
  it("exige un point de repere en mode livraison", () => {
    const r = deliverySchema.safeParse({
      mode: "livraison",
      city: "Douala",
      quartier: "Akwa",
      landmark: "",
      phone: "+237677123456",
    });
    expect(r.success).toBe(false);
  });

  it("accepte une livraison complete", () => {
    const r = deliverySchema.safeParse({
      mode: "livraison",
      city: "Douala",
      quartier: "Akwa",
      landmark: "en face de la pharmacie du carrefour",
      phone: "+237677123456",
    });
    expect(r.success).toBe(true);
  });

  it("accepte un retrait sans quartier ni repere", () => {
    const r = deliverySchema.safeParse({
      mode: "retrait",
      pickupPoint: "Marche Akwa, devant la boutique CICAM",
      phone: "+237677123456",
    });
    expect(r.success).toBe(true);
  });

  it("n'accepte AUCUN champ address", () => {
    const parsed = deliverySchema.parse({
      mode: "livraison",
      city: "Douala",
      quartier: "Akwa",
      landmark: "derriere le marche",
      phone: "+237677123456",
      address: "12 rue de la Paix",
    });
    expect("address" in parsed).toBe(false);
  });
});
