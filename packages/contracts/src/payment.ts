import { z } from "zod";

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  VOCABULAIRE D'AGREGATEUR — EN DORMANCE (ADR 0009).                      │
 * │                                                                          │
 * │  La v1 de Catalog n'a pas d'agregateur : elle constate un paiement par    │
 * │  la preuve, pas par le statut d'un tiers. Le vocabulaire de la v1 vit     │
 * │  dans `proof.ts` (`ProofState`) et `order.ts` (`PayMode`, `OrderStep`).   │
 * │                                                                          │
 * │  Ce fichier reste parce que l'adaptateur CamPay dormant en depend et      │
 * │  doit rester COMPILABLE (AGENTS.md §5). Aucune table ni aucun schema Zod  │
 * │  de la v1 ne l'utilise. Ne pas l'etendre.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Statut renvoye par un agregateur. `waiting_customer` n'est PAS un echec :
 * c'est la payeuse qui n'a pas encore saisi son code secret.
 */
export const paymentStatusSchema = z.enum([
  "initiated",
  "waiting_customer",
  "paid",
  "partial",
  "failed",
  "expired",
  "disputed",
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const TERMINAL_STATUSES: readonly PaymentStatus[] = ["paid", "failed", "expired"];

const ALLOWED: Record<PaymentStatus, readonly PaymentStatus[]> = {
  initiated: ["waiting_customer", "paid", "partial", "failed", "expired"],
  waiting_customer: ["paid", "partial", "failed", "expired"],
  partial: ["paid", "disputed", "expired"],
  paid: ["disputed"],
  failed: [],
  expired: ["disputed"],
  disputed: ["paid", "failed"],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED[from].includes(to);
}
