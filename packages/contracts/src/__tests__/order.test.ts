import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  formatVerificationCode,
  itemsTotalXaf,
  orderItemsSchema,
  orderRefSchema,
  orderStepSchema,
  payModeSchema,
  stepRank,
  verificationCodeSchema,
} from "../order.ts";

describe("vocabulaires figes au lot 3", () => {
  it("les trois modes de paiement, et pas d'autres", () => {
    expect(payModeSchema.options).toEqual(["integral", "acompte", "sans_prepaiement"]);
  });

  it("les quatre etapes de livraison, dans l'ordre du terrain", () => {
    expect(orderStepSchema.options).toEqual(["recue", "preparee", "chez_le_livreur", "livree"]);
  });

  it("« sans_prepaiement » est un mode de plein droit, pas un cas degrade", () => {
    expect(payModeSchema.safeParse("sans_prepaiement").success).toBe(true);
  });

  it("le vocabulaire anglais de l'ancien schema est refuse", () => {
    // Garde-fou : si quelqu'un remet full/deposit/cod, la CI le dit.
    for (const v of ["full", "deposit", "cod"]) {
      expect(payModeSchema.safeParse(v).success).toBe(false);
    }
    for (const v of ["received", "prepared", "handed_to_courier", "delivered"]) {
      expect(orderStepSchema.safeParse(v).success).toBe(false);
    }
  });

  it("les etapes se comparent par rang, sans etre codees en dur ailleurs", () => {
    expect(stepRank("recue")).toBeLessThan(stepRank("livree"));
    expect(stepRank("preparee")).toBeLessThan(stepRank("chez_le_livreur"));
  });
});

describe("reference de commande", () => {
  it("porte le prefixe CT- de l'ADR 0010", () => {
    expect(orderRefSchema.safeParse("CT-1043").success).toBe(true);
  });

  it("refuse l'ancien prefixe SW-", () => {
    expect(orderRefSchema.safeParse("SW-1043").success).toBe(false);
  });
});

describe("code de verification", () => {
  it("l'alphabet exclut les caracteres ambigus", () => {
    for (const c of ["O", "0", "I", "1", "L", "B", "8", "S", "5", "Z", "2"]) {
      expect(CODE_ALPHABET.includes(c)).toBe(false);
    }
  });

  it("l'alphabet fait 25 caracteres — la taille dont depend l'ADR 0013", () => {
    expect(CODE_ALPHABET.length).toBe(25);
    expect(new Set(CODE_ALPHABET).size).toBe(25); // aucun doublon
  });

  it("formate en deux groupes de quatre", () => {
    // Le formatage ne valide pas l'alphabet : c'est le role du schema.
    expect(formatVerificationCode("azsy79dv")).toBe("AZSY-79DV");
  });

  it("valide un code correct et rejette un code ambigu", () => {
    expect(verificationCodeSchema.safeParse("ACDE-4679").success).toBe(true);
    expect(verificationCodeSchema.safeParse("AB0I-1234").success).toBe(false);
  });
});

describe("lignes de commande", () => {
  const items = [
    { productId: "p1", name: "Robe wax", unitPriceXaf: 8500, quantity: 2 },
    { productId: "p2", name: "Foulard", unitPriceXaf: 0, quantity: 1 },
  ];

  it("le total se recalcule depuis les lignes, en entiers", () => {
    expect(itemsTotalXaf(items)).toBe(17000);
    expect(Number.isInteger(itemsTotalXaf(items))).toBe(true);
  });

  it("refuse une quantite nulle ou un prix flottant", () => {
    expect(orderItemsSchema.safeParse([{ ...items[0], quantity: 0 }]).success).toBe(false);
    expect(orderItemsSchema.safeParse([{ ...items[0], unitPriceXaf: 8500.5 }]).success).toBe(false);
  });

  it("refuse une commande sans ligne", () => {
    expect(orderItemsSchema.safeParse([]).success).toBe(false);
  });
});
