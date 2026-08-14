import { canIssueReceipt, type OperatorKey, type ProofState } from "@catalog/contracts";
import type { MarcheAsuivre, Recu, RefusRecu } from "@catalog/contracts/recu";
import type { OperateurRampe } from "@catalog/contracts/ussd";

/**
 * Le recu — la valeur numero un du produit.
 *
 * **Catalog n'atteste rien de lui-meme. Il rend la verification POSSIBLE par
 * n'importe qui.** C'est la phrase a relire quand une decision de conception
 * hesite dans ce fichier.
 *
 * Ce que porte un recu n'est pas une signature cryptographique et ne doit jamais
 * en avoir l'air : c'est un **identifiant de transaction d'operateur**, apporte
 * par la personne dont l'argent est en jeu, que l'operateur peut confirmer et
 * que l'autre partie peut contresigner. Les mots « garanti » et « certifie »
 * sont proscrits ; un test les cherche dans tout ce que ce module produit.
 *
 * Module PUR : ni base, ni reseau, ni horloge implicite.
 */

/* ─────────────────────────── ce qui entre ─────────────────────────── */

export interface PreuvePourRecu {
  operator: OperatorKey;
  /** L'identifiant de l'operateur, en majuscules. C'est le coeur du recu. */
  operatorTxId: string;
  amountXaf: number;
  /** Date lue dans le SMS. `null` quand un identifiant Orange s'auto-invalide. */
  occurredAt: Date | null;
  /**
   * MEME POLARITE que le drapeau du motif. `true` = le motif est reconstitue,
   * donc le recu le dit. Ne jamais l'inverser en « confirme ».
   */
  patternAConfirmer: boolean;
  countersignedAt: Date | null;
  createdAt: Date;
}

export interface CommandePourRecu {
  ref: string;
  /** Code dictable au telephone. C'est la cle de la page publique. */
  verificationCode: string;
  boutique: string;
  totalXaf: number;
  amountPaidXaf: number;
  proofState: ProofState;
}

/* ─────────────────────────── ce qui sort ─────────────────────────── */

/**
 * La forme du recu vit dans `@catalog/contracts/recu` : la boutique publique la
 * lit aussi, et une declaration de chaque cote de la frontiere finirait par
 * diverger.
 */
export type { MarcheAsuivre, Recu, RefusRecu };

export type ResultatRecu = { recu: Recu } | { refus: RefusRecu };

/**
 * Emet le recu, ou dit pourquoi il n'y en a pas.
 *
 * L'ordre des refus compte : `conteste` passe AVANT l'etat de la preuve, parce
 * qu'une contestation ne fait pas reculer la preuve — elle retire le recu sans
 * effacer ce qui a ete apporte.
 */
export function emettreRecu(
  commande: CommandePourRecu,
  preuve: PreuvePourRecu | null,
  operateur: OperateurRampe | null,
): ResultatRecu {
  if (commande.proofState === "conteste") return { refus: "conteste" };
  if (commande.proofState === "declare_non_trace") return { refus: "declare_non_trace" };
  if (!canIssueReceipt(commande.proofState) || !preuve) return { refus: "preuve_absente" };

  return {
    recu: {
      reference: commande.ref,
      code: commande.verificationCode,
      boutique: commande.boutique,
      operateur: {
        cle: preuve.operator,
        /**
         * Le nom vient de la configuration quand elle connait cet operateur.
         * A defaut, la CLE brute : inventer « MTN MoMo » a partir de « mtn »
         * serait une constante d'affichage de plus, et elle divergerait.
         */
        nom: operateur?.nom ?? preuve.operator,
      },
      operatorTxId: preuve.operatorTxId,
      montantXaf: preuve.amountXaf,
      totalXaf: commande.totalXaf,
      resteXaf: Math.max(0, commande.totalXaf - commande.amountPaidXaf),
      survenuA: preuve.occurredAt,
      constateA: preuve.createdAt,
      contresigneA: preuve.countersignedAt,
      etat: commande.proofState,
      aConfirmer: preuve.patternAConfirmer,
      marcheAsuivre: marcheAsuivre(operateur),
    },
  };
}

/**
 * La marche a suivre, lue dans la configuration de la rampe.
 *
 * Sans operateur configure, on n'invente NI code NI etapes : le recu renvoie
 * alors a l'agence, qui est le recours qui ne depend d'aucune configuration.
 */
export function marcheAsuivre(operateur: OperateurRampe | null): MarcheAsuivre {
  if (!operateur) {
    return {
      codeOperateur: "",
      codeVerifie: false,
      etapes: ["Presentez cet identifiant en agence : l'operateur seul fait foi."],
      etapesAConfirmer: false,
    };
  }
  return {
    codeOperateur: operateur.codeEntree.modele,
    codeVerifie: operateur.codeEntree.verifie,
    etapes: operateur.etapesVerification,
    etapesAConfirmer: operateur.etapesAConfirmer,
  };
}

/**
 * Ce qu'un recu vaut, en une phrase, en langue simple.
 *
 * Elle est ICI et pas dans un composant : trois ecrans l'affichent — la page
 * publique, le suivi de l'acheteuse, l'ecran de verification de la vendeuse —
 * et trois formulations differentes du meme fait seraient trois occasions d'en
 * affaiblir une.
 */
export function porteeDuRecu(recu: Recu): string {
  const base =
    "Ce reçu n'est pas une preuve informatique : c'est un identifiant de transaction que " +
    "l'opérateur peut confirmer, apporté par la personne dont l'argent est en jeu.";
  const contresigne =
    recu.etat === "contresigne"
      ? " L'acheteur/se l'a confirmé de son côté : deux parties indépendantes portent le même identifiant."
      : " L'acheteur/se ne l'a pas encore confirmé de son côté.";
  const reserve = recu.aConfirmer
    ? " Le format de ce SMS d'opérateur n'a pas encore été confronté à un message réel : à contrôler auprès de l'opérateur."
    : "";
  return base + contresigne + reserve;
}
