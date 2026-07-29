import { z } from "zod";

/**
 * Vocabulaires de la commande. **FIGES ICI** (lot 3) : les lots 7 et 11 les
 * consomment, ils ne les redefinissent pas. C'est la source de verite unique
 * des deux cotes de la frontiere HTTP.
 */

/**
 * Trois facons de payer, et la troisieme n'est pas une facon degradee :
 * beaucoup de ventes se concluent sans prepaiement, contre-remboursement a la
 * remise. La bloquer ferait sortir la vendeuse du systeme.
 */
export const payModeSchema = z.enum(["integral", "acompte", "sans_prepaiement"]);
export type PayMode = z.infer<typeof payModeSchema>;

/**
 * Etape de livraison. Quatre valeurs, pas cinq : « annulee » et « expiree »
 * n'en sont pas — ce ne sont pas des etapes de livraison mais des sorties de
 * parcours, portees par `cancelledAt` et `expiresAt` sur la commande. Le lot 7,
 * qui possede la machine a etats et la regle des 48 h, tranchera s'il lui faut
 * davantage ; il n'aura pas a renommer ces quatre-la.
 */
export const orderStepSchema = z.enum(["recue", "preparee", "chez_le_livreur", "livree"]);
export type OrderStep = z.infer<typeof orderStepSchema>;

/** Progression : une commande ne recule jamais d'etape. */
const STEP_ORDER: readonly OrderStep[] = ["recue", "preparee", "chez_le_livreur", "livree"];

/** Rang d'une etape, pour comparer deux etapes sans les coder en dur ailleurs. */
export function stepRank(step: OrderStep): number {
  return STEP_ORDER.indexOf(step);
}

/* ────────────────────────── reference de commande ────────────────────────── */

/**
 * Prefixe `CT-` depuis l'ADR 0010 (le produit s'appelait Swap, prefixe `SW-`).
 * La reference voyage dans le message WhatsApp : elle doit rester courte et
 * dictable au telephone.
 */
export const orderRefSchema = z
  .string()
  .regex(/^CT-\d{3,8}$/, "reference attendue au format CT-1043");

/* ────────────────────────── code de verification ────────────────────────── */

/**
 * Alphabet sans caracteres ambigus : ni O/0, ni I/1/L, ni B/8, ni S/5, ni Z/2.
 * Un code se lit au telephone et se recopie a la main.
 *
 * Sa taille est de 25 caracteres, et ce n'est pas anodin : 25 = 5², donc tout
 * generateur dont le pas partage un facteur avec 25 produit des codes
 * degeneres du type `TTTT-TTTT`. C'est la raison pour laquelle le generateur
 * n'est PAS congruentiel — voir ADR 0013 — et pourquoi un test parcourt
 * 10 000 codes a la recherche de motifs.
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

/* ────────────────────────── lignes de commande ────────────────────────── */

/**
 * Une ligne de commande est FIGEE au moment de la commande : le nom et le prix
 * unitaire sont recopies, ils ne pointent pas vers le produit. Sans cela, une
 * vendeuse qui change son prix reecrit l'historique de ses ventes.
 */
export const orderItemSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  unitPriceXaf: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  variant: z.string().optional(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderItemsSchema = z.array(orderItemSchema).min(1);

/** Total recalcule depuis les lignes. Entier, jamais un flottant. */
export function itemsTotalXaf(items: OrderItem[]): number {
  return items.reduce((sum, i) => sum + i.unitPriceXaf * i.quantity, 0);
}
