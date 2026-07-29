import { z } from "zod";

/**
 * Vocabulaire de la PREUVE de paiement. **FIGE ICI** (lot 3).
 *
 * Catalog n'opere aucun paiement : il en constate un, apres coup, sur la foi du
 * SMS que la vendeuse a recu de son operateur. Ce que le systeme enregistre
 * n'est donc pas une transaction mais une **preuve apportee** — d'ou le nom des
 * etats ci-dessous, qui decrivent la solidite de cette preuve et non l'avancee
 * d'un transfert.
 *
 * Ne pas confondre avec `PaymentStatus` de `payment.ts`, qui est le vocabulaire
 * d'un AGREGATEUR et dort avec l'adaptateur CamPay (ADR 0009).
 */

/**
 * Cle d'operateur PERSISTEE. C'est `operatorKey` du motif de SMS, jamais le
 * libelle d'affichage « MTN MoMo » : cette valeur compose la contrainte
 * UNIQUE(operator, operator_tx_id) du controle n° 5, et un libelle qui change
 * la casserait en silence.
 */
export const operatorKeySchema = z.enum(["mtn", "orange"]);
export type OperatorKey = z.infer<typeof operatorKeySchema>;

/**
 * Etat de la preuve.
 *
 * - `attendu` — la commande existe, rien n'est encore apporte.
 * - `declare_non_trace` — la vendeuse affirme avoir recu l'argent, sans SMS.
 *   La commande avance, mais **pas de recu et pas d'avis verifie**. Ce cas
 *   existera toujours : on ne le bloque pas, on le distingue.
 * - `prouve` — SMS analyse, controles passes.
 * - `contresigne` — l'acheteuse a confirme depuis son lien de suivi. C'est le
 *   seul etat a deux voix, et le plus fort.
 * - `conteste` — une partie dement. N'efface rien.
 */
export const proofStateSchema = z.enum([
  "attendu",
  "declare_non_trace",
  "prouve",
  "contresigne",
  "conteste",
]);
export type ProofState = z.infer<typeof proofStateSchema>;

/**
 * Un recu n'est emis que sur une preuve reelle. Un depot declare a la main
 * n'y ouvre pas droit — c'est ce qui donne sa valeur au recu.
 */
export function canIssueReceipt(state: ProofState): boolean {
  return state === "prouve" || state === "contresigne";
}

/** Un avis « achat verifie » suit la meme regle que le recu. */
export function countsAsVerifiedPurchase(state: ProofState): boolean {
  return canIssueReceipt(state);
}

/**
 * Verdict d'une soumission de SMS. « accepte sous reserve » n'est pas une
 * politesse : c'est ce que produit un motif marque `aConfirmer`, ou un message
 * de sens `sortant` — le SMS d'emission de l'acheteuse corrobore, il ne prouve
 * pas.
 */
export const verdictSchema = z.enum(["accepte", "accepte_sous_reserve", "refuse"]);
export type Verdict = z.infer<typeof verdictSchema>;

/** Resultat d'un des sept controles. `pending` = le domaine ne peut pas savoir. */
export const checkStateSchema = z.enum(["pass", "fail", "warn", "pending"]);
export type CheckState = z.infer<typeof checkStateSchema>;

export const checkResultSchema = z.object({
  /** 1 a 7. La numerotation est canonique — ADR 0009. */
  n: z.number().int().min(1).max(7),
  id: z.string().min(1),
  state: checkStateSchema,
  /** Explication en langue simple, destinee a la vendeuse. */
  explanation: z.string().min(1),
});
export type CheckResult = z.infer<typeof checkResultSchema>;

/**
 * Une preuve enregistree.
 *
 * Deux absences sont VOULUES et ne doivent jamais etre comblees :
 *
 * 1. **Aucune colonne de solde.** Le SMS porte le solde du compte de la
 *    vendeuse. Il ne se persiste pas, ne se journalise pas, ne se trace pas.
 * 2. **Aucune reference de prestataire.** Il n'y a pas d'agregateur : la seule
 *    reference qui compte est celle de l'operateur, telle qu'elle figure dans
 *    le SMS.
 */
export const paymentProofSchema = z.object({
  orderId: z.string().min(1),
  operator: operatorKeySchema,
  /** Identifiant de l'operateur, stocke en MAJUSCULES. Voir la contrainte en base. */
  operatorTxId: z
    .string()
    .min(4)
    .transform((s) => s.trim().toUpperCase()),
  amountXaf: z.number().int().nonnegative(),
  /** 9 chiffres normalises, ou null : un numero absent est un avertissement. */
  counterpartyPhone: z
    .string()
    .regex(/^[62]\d{8}$/)
    .nullable(),
  counterpartyName: z.string().nullable(),
  /** null quand un identifiant Orange s'auto-invalide : pas de date exploitable. */
  occurredAt: z.date().nullable(),
  patternId: z.string().min(1),
  /**
   * MEME NOM et MEME POLARITE que le drapeau `aConfirmer` du motif.
   * Ne jamais l'inverser en « confirmed » : la double negation est le piege,
   * et un motif reconstitue passerait alors pour valide.
   */
  patternAConfirmer: z.boolean(),
  rawSms: z.string().min(1),
  checks: z.array(checkResultSchema),
  verdict: verdictSchema,
  countersignedAt: z.date().nullable(),
});
export type PaymentProof = z.infer<typeof paymentProofSchema>;
