/**
 * Le franc CFA (XAF) n'a PAS de sous-unite.
 * Tous les montants du produit sont des entiers. Aucun flottant, jamais.
 * Voir docs/adr/0004-montants-en-entiers-xaf.md
 */

/** Montant en francs CFA. Toujours un entier >= 0. */
export type Xaf = number;

export class MoneyError extends Error {}

export function assertXaf(value: number, label = "montant"): asserts value is Xaf {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} doit etre un entier XAF, recu ${value}`);
  }
  if (value < 0) throw new MoneyError(`${label} ne peut pas etre negatif, recu ${value}`);
  if (!Number.isSafeInteger(value)) throw new MoneyError(`${label} hors plage sure`);
}

/**
 * Repartit un total entre l'acompte et le solde.
 * L'acompte est arrondi au franc INFERIEUR, le solde absorbe le reste :
 * un acompte de 50 % sur 7 501 F donne 3 750 F d'acompte et 3 751 F de solde.
 * L'invariant deposit + balance === total est garanti par construction.
 */
export function splitDeposit(total: Xaf, percent: number): { deposit: Xaf; balance: Xaf } {
  assertXaf(total, "total");
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
    throw new MoneyError(`pourcentage d'acompte invalide: ${percent}`);
  }
  const deposit = Math.floor((total * percent) / 100);
  return { deposit, balance: total - deposit };
}

const NBSP = " "; // espace fine insecable

/** Formate un montant pour l'affichage : « 15 000 FCFA ». */
export function formatXaf(amount: Xaf, opts: { suffix?: boolean } = {}): string {
  assertXaf(amount);
  const grouped = amount.toLocaleString("fr-FR").replace(/\s/g, NBSP);
  return opts.suffix === false ? grouped : `${grouped}${NBSP}FCFA`;
}
