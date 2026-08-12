import { normalizePhone } from "@catalog/contracts";

/**
 * Le numero de reversement.
 *
 * C'est **le champ qu'un attaquant chercherait a detourner** : c'est la que
 * l'argent arrive. Il est distinct du numero de connexion — la double SIM est la
 * norme, une vendeuse se connecte avec sa puce MTN et veut etre payee sur son
 * Orange Money — et toute modification exige un OTP **envoye au nouveau
 * numero**, pas a l'ancien.
 *
 * Trois proprietes de ce module :
 *
 * 1. **Il est pur.** Le temps est un parametre, rien n'est lu en base, rien
 *    n'est ecrit. Il renvoie la decision ET l'entree de journal.
 * 2. **Il journalise TOUTE tentative**, refusee comme acceptee. Une tentative
 *    refusee qui ne laisse pas de trace, c'est une attaque invisible.
 * 3. **Il ne voit jamais le code.** L'OTP est verifie ailleurs ; ici on ne
 *    recoit que le fait « ce numero-la a ete verifie a telle heure ».
 */

/** Duree de validite d'une verification pour changer le reversement. */
export const FENETRE_VERIFICATION_MS = 15 * 60_000;

export interface SellerPayoutState {
  sellerId: string;
  /** Numero de CONNEXION. */
  loginPhone: string;
  /** Numero de REVERSEMENT actuel, ou null s'il n'a jamais ete pose. */
  payoutPhone: string | null;
  payoutPhoneVerifiedAt: Date | null;
}

export interface PayoutChangeRequest {
  nouveauNumero: string;
  /**
   * Preuve qu'un OTP a bien ete verifie, et POUR QUEL numero. `null` = aucune
   * verification : le cas que le contrat exige de refuser.
   */
  verification: { numero: string; verifieA: Date } | null;
  acteur: { role: "vendeuse" | "support" | "systeme"; ip?: string };
  now: Date;
}

export type RefusChangement =
  | "verification_absente"
  | "verification_dun_autre_numero"
  | "verification_perimee"
  | "numero_invalide"
  | "numero_inchange"
  /**
   * **Le reversement est gele** — ADR 0061, rang 2b. L'ancien numero a repondu
   * STOP a l'alerte de changement : un vol est signale. Aucun numero ne se
   * pose tant qu'un humain n'a pas tranche, meme avec un OTP valide — l'OTP
   * prouve qu'on tient une puce, pas qu'on est la proprietaire.
   */
  | "reversement_gele";

/** Entree de journal, en ajout seul. Ne contient jamais de code. */
export interface JournalReversement {
  sellerId: string;
  kind: "reversement_modifie" | "reversement_refuse";
  actor: PayoutChangeRequest["acteur"]["role"];
  at: Date;
  payload: {
    ancien: string | null;
    nouveau: string | null;
    raison?: RefusChangement;
    ip?: string;
  };
}

export type ResultatChangement =
  | {
      ok: true;
      changes: {
        payoutPhone: string;
        payoutOperator: "mtn" | "orange" | null;
        payoutPhoneVerifiedAt: Date;
      };
      journal: JournalReversement;
    }
  | { ok: false; raison: RefusChangement; journal: JournalReversement };

/**
 * Devine l'operateur d'apres le prefixe, et renvoie `null` quand ce n'est pas
 * concluant.
 *
 * Renvoyer `null` compte : deviner afficherait le mauvais logo a la vendeuse et,
 * bien plus grave, le mauvais code USSD sur la rampe de paiement. Prefixes
 * observes — MTN : 67, 650 a 654, 680 a 684. Orange : 69, 655 a 659, 685 a 689.
 * Un prefixe inconnu (Camtel, ou nouveau) n'est pas une erreur : il est juste
 * indetermine, et l'interface demandera a la vendeuse.
 */
export function operateurDuNumero(e164: string): "mtn" | "orange" | null {
  const n = normalizePhone(e164);
  if (!n) return null;
  const national = n.slice(4); // retire « +237 »
  if (/^6(7|8[0-4]|5[0-4])/.test(national)) return "mtn";
  if (/^6(9|8[5-9]|5[5-9])/.test(national)) return "orange";
  return null;
}

export function appliquerChangementReversement(
  etat: SellerPayoutState,
  demande: PayoutChangeRequest,
  /**
   * La regle de forme des numeros, INJECTEE comme le temps l'est deja : le
   * defaut est la regle du produit (+237, `packages/contracts`), et aucun
   * appelant de production ne passe autre chose. Le banc d'essai (ADR 0058)
   * passe une regle elargie a ses numeros nommes — la decision, elle, ne
   * change pas d'une ligne : verification du MEME numero, fenetre, journal.
   */
  normaliser: (brut: string) => string | null = normalizePhone,
): ResultatChangement {
  const normalise = normaliser(demande.nouveauNumero);

  const refus = (raison: RefusChangement): ResultatChangement => ({
    ok: false,
    raison,
    journal: {
      sellerId: etat.sellerId,
      kind: "reversement_refuse",
      actor: demande.acteur.role,
      at: demande.now,
      payload: {
        ancien: etat.payoutPhone,
        nouveau: normalise,
        raison,
        ...(demande.acteur.ip ? { ip: demande.acteur.ip } : {}),
      },
    },
  });

  if (!normalise) return refus("numero_invalide");
  if (normalise === etat.payoutPhone) return refus("numero_inchange");

  const v = demande.verification;
  if (!v) return refus("verification_absente");

  // La verification doit porter sur le NOUVEAU numero. Sans ce controle, il
  // suffirait de faire verifier un numero qu'on possede pour en pousser un autre.
  if (normaliser(v.numero) !== normalise) return refus("verification_dun_autre_numero");

  if (demande.now.getTime() - v.verifieA.getTime() > FENETRE_VERIFICATION_MS) {
    return refus("verification_perimee");
  }

  return {
    ok: true,
    changes: {
      payoutPhone: normalise,
      payoutOperator: operateurDuNumero(normalise),
      payoutPhoneVerifiedAt: demande.now,
    },
    journal: {
      sellerId: etat.sellerId,
      kind: "reversement_modifie",
      actor: demande.acteur.role,
      at: demande.now,
      payload: {
        ancien: etat.payoutPhone,
        nouveau: normalise,
        ...(demande.acteur.ip ? { ip: demande.acteur.ip } : {}),
      },
    },
  };
}
