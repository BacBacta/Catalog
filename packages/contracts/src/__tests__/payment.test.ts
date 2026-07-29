import { describe, expect, it } from "vitest";
import { canTransition } from "../payment.ts";

/**
 * Vocabulaire d'agregateur, en dormance (ADR 0009). Ces tests restent en CI
 * pour la meme raison que l'adaptateur CamPay : garantir que l'ensemble sera
 * encore compilable et coherent le jour ou l'on rouvre la decision.
 */
describe("machine a etats d'agregateur (dormante)", () => {
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
