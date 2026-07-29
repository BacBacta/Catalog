import { z } from "zod";

export const payModeSchema = z.enum(["full", "deposit", "cod"]);
export type PayMode = z.infer<typeof payModeSchema>;

/**
 * Un paiement ne recule JAMAIS. Toute transition arriere est journalisee
 * puis ignoree. `waiting_customer` n'est PAS un echec : c'est l'acheteuse
 * qui n'a pas encore saisi son code secret (30 s a 3 min, parfois plus).
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

/**
 * Alphabet sans caracteres ambigus : ni O/0, ni I/1/L, ni B/8, ni S/5, ni Z/2.
 * Un code se lit au telephone et se recopie a la main.
 */
export const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";

export function formatVerificationCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 8) throw new Error("un code de verification fait 8 caracteres");
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

export const verificationCodeSchema = z
  .string()
  .transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ""))
  .refine((s) => s.length === 8 && [...s].every((c) => CODE_ALPHABET.includes(c)), {
    message: "code de verification invalide",
  });
