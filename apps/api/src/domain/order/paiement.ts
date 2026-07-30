import type { PayMode } from "@catalog/contracts";
import { splitDeposit } from "@catalog/contracts/money";

/**
 * Ce qu'une commande attend comme argent, et ce qui arrive vraiment.
 *
 * Module PUR : pas de base, pas de reseau, pas d'horloge. Le temps et l'alea
 * arrivent en parametres quand il en faut.
 *
 * **Catalog n'encaisse rien et ne prelevé rien.** Il n'y a donc ici aucun calcul
 * de commission, et il ne doit jamais y en avoir : le revenu vient de
 * l'abonnement (AGENTS.md §2). Ce fichier repartit un montant entre acompte et
 * solde, il ne fabrique pas d'argent.
 */

/** Pourcentage d'acompte par defaut. Reglable par commande, pas code en dur. */
export const POURCENT_ACOMPTE_DEFAUT = 50;

export interface PlanDePaiement {
  mode: PayMode;
  totalXaf: number;
  /**
   * Ce qui est attendu AVANT que la vendeuse prepare la commande.
   * Zero en `sans_prepaiement` — et ce n'est pas un cas degrade : beaucoup de
   * ventes se concluent contre-remboursement a la remise.
   */
  duAvantXaf: number;
  /** Ce qui reste a encaisser a la remise. */
  soldeXaf: number;
}

/**
 * Repartit un total selon le mode de paiement.
 *
 * L'acompte delegue a `splitDeposit` de `packages/contracts` — **on ne
 * reimplemente pas la regle**. Elle applique `floor` sur l'acompte et met le
 * reste au solde : 50 % de 7 501 F vaut 3 750 F d'acompte et 3 751 F de solde.
 * Le total est preserve exactement, et le franc perdu a l'arrondi n'existe pas.
 * Un test de propriete sur 10 000 montants la couvre deja dans `contracts` ;
 * ici on verifie qu'on l'appelle bien plutot que de la refaire.
 */
export function planDePaiement(
  totalXaf: number,
  mode: PayMode,
  pourcentAcompte: number = POURCENT_ACOMPTE_DEFAUT,
): PlanDePaiement {
  if (!Number.isInteger(totalXaf) || totalXaf <= 0) {
    throw new Error(`total invalide : ${totalXaf}`);
  }

  switch (mode) {
    case "integral":
      return { mode, totalXaf, duAvantXaf: totalXaf, soldeXaf: 0 };
    case "acompte": {
      const { deposit, balance } = splitDeposit(totalXaf, pourcentAcompte);
      return { mode, totalXaf, duAvantXaf: deposit, soldeXaf: balance };
    }
    case "sans_prepaiement":
      return { mode, totalXaf, duAvantXaf: 0, soldeXaf: totalXaf };
  }
}

/* ────────────────────────── conformite d'un versement ────────────────────────── */

/**
 * Ecart entre ce qui etait attendu et ce qui est arrive.
 *
 * **Ni le sous-paiement ni le sur-paiement ne sont un rejet.** Un rejet
 * silencieux laisserait la vendeuse avec de l'argent sur son telephone et une
 * commande qui n'avance pas — c'est-a-dire avec une acheteuse qui a payé et un
 * systeme qui dit non. On classe, on documente, et l'interface explique.
 */
export type Conformite =
  | { etat: "conforme"; ecartXaf: 0 }
  /** Il manque `ecartXaf` francs. La commande avance, le solde reste ouvert. */
  | { etat: "sous_paiement"; ecartXaf: number }
  /** `ecartXaf` francs en trop. La vendeuse doit rendre la difference. */
  | { etat: "sur_paiement"; ecartXaf: number };

/**
 * Tolerance en francs. **Zero par defaut, et ce n'est pas un choix par defaut
 * paresseux : c'est une question ouverte.**
 *
 * Les frais hors reseau (2,22 % mesure) sont a la charge de l'emetteur, donc le
 * montant recu devrait etre exact. Mais on n'a pas encore observe assez de
 * versements reels pour savoir si des ecarts de quelques francs apparaissent —
 * arrondis d'operateur, promotions. Tant qu'on ne l'a pas mesure, on ne fabrique
 * pas une tolerance plausible : un ecart d'un franc est classe comme un ecart, et
 * c'est l'interface qui decide s'il vaut la peine d'etre montre.
 */
export const TOLERANCE_XAF_DEFAUT = 0;

export function comparerMontant(
  attenduXaf: number,
  recuXaf: number,
  toleranceXaf: number = TOLERANCE_XAF_DEFAUT,
): Conformite {
  if (!Number.isInteger(attenduXaf) || !Number.isInteger(recuXaf)) {
    throw new Error(`montants non entiers : attendu ${attenduXaf}, recu ${recuXaf}`);
  }
  const ecart = recuXaf - attenduXaf;
  if (Math.abs(ecart) <= toleranceXaf) return { etat: "conforme", ecartXaf: 0 };
  if (ecart < 0) return { etat: "sous_paiement", ecartXaf: -ecart };
  return { etat: "sur_paiement", ecartXaf: ecart };
}

/* ────────────────────────── application d'un versement ────────────────────────── */

export interface EtatArgent {
  totalXaf: number;
  amountPaidXaf: number;
  balanceXaf: number;
}

export interface ResultatVersement {
  etat: EtatArgent;
  conformite: Conformite;
  /**
   * Excedent que la vendeuse doit rendre, en francs. Il n'entre PAS dans
   * `amountPaidXaf` : l'invariant de base est
   * `amount_paid_xaf + balance_xaf = total_xaf`, garanti par une contrainte SQL.
   * Un excedent range dans `amountPaidXaf` la violerait — et surtout, il
   * pretendrait que l'acheteuse a paye plus que ce qu'elle devait, ce qui n'est
   * pas la meme chose que « on lui doit de la monnaie ».
   */
  aRendreXaf: number;
  /** Vrai quand le total attendu est entierement couvert. */
  soldeRegle: boolean;
}

/**
 * Applique un versement a l'etat d'argent d'une commande.
 *
 * L'invariant `amountPaidXaf + balanceXaf = totalXaf` est preserve a chaque
 * appel, y compris en sur-paiement. Il est aussi verifie par une contrainte de
 * base (lot 3) : ce module est ce qui evite d'y arriver en erreur.
 */
export function appliquerVersement(
  etat: EtatArgent,
  versementXaf: number,
  attenduXaf: number = etat.balanceXaf,
  toleranceXaf: number = TOLERANCE_XAF_DEFAUT,
): ResultatVersement {
  if (!Number.isInteger(versementXaf) || versementXaf <= 0) {
    throw new Error(`versement invalide : ${versementXaf}`);
  }
  if (etat.amountPaidXaf + etat.balanceXaf !== etat.totalXaf) {
    // On refuse de travailler sur un etat deja incoherent : le corriger en
    // silence masquerait le vrai defaut.
    throw new Error(
      `etat incoherent : ${etat.amountPaidXaf} + ${etat.balanceXaf} != ${etat.totalXaf}`,
    );
  }

  const conformite = comparerMontant(attenduXaf, versementXaf, toleranceXaf);

  // Le paiement ne depasse jamais le total : le surplus devient de la monnaie a
  // rendre, pas un montant paye.
  const retenu = Math.min(versementXaf, etat.totalXaf - etat.amountPaidXaf);
  const aRendreXaf = versementXaf - retenu;

  const amountPaidXaf = etat.amountPaidXaf + retenu;
  return {
    etat: { totalXaf: etat.totalXaf, amountPaidXaf, balanceXaf: etat.totalXaf - amountPaidXaf },
    conformite,
    aRendreXaf,
    soldeRegle: amountPaidXaf === etat.totalXaf,
  };
}
