import type { PayMode } from "@catalog/contracts";
import { planDePaiement } from "../order/paiement.ts";

/**
 * La relance d'acompte — ADR 0033. Module PUR : la decision se prend sur des
 * donnees passees en parametre, le temps courant compris.
 *
 * Une seule relance, envoyee ~1 h apres la creation par un travail pg-boss.
 * Elle est GRATUITE tant qu'elle part dans la fenetre de service de 24 h
 * ouverte par le message de l'acheteuse — d'ou la borne haute : passe ce
 * delai, on n'envoie RIEN plutot qu'un message hors fenetre qui serait
 * refuse (ou facture comme un gabarit, plus tard). Les 20 h laissent une
 * marge : la fenetre exacte depend du DERNIER message de l'acheteuse, que
 * la commande ne connait pas.
 *
 * Ce module DECIDE ; il n'envoie rien et ne connait pas pg-boss.
 */

/** Delai avant relance. Assez tot pour aider, assez tard pour ne pas harceler. */
export const RELANCE_APRES_S = 60 * 60;

/** Au-dela, la fenetre de service n'est plus sure : on se tait. */
export const RELANCE_FENETRE_MAX_MS = 20 * 60 * 60 * 1000;

export interface CommandePourRelance {
  payMode: PayMode;
  totalXaf: number;
  amountPaidXaf: number;
  annuleeA: Date | null;
  creeeA: Date;
}

export type DecisionRelance = { relancer: false } | { relancer: true; acompteXaf: number };

/**
 * Faut-il relancer ? Oui seulement si : un acompte etait attendu, RIEN n'est
 * encore arrive, la commande vit toujours, et la fenetre est encore sure.
 *
 * `amountPaidXaf > 0` vaut silence meme si l'acompte n'est pas complet : une
 * acheteuse qui a deja envoye de l'argent n'a pas besoin qu'un robot le lui
 * reclame — c'est la conversation avec la vendeuse qui regle les ecarts.
 */
export function decisionRelance(c: CommandePourRelance, maintenant: Date): DecisionRelance {
  if (c.payMode !== "acompte") return { relancer: false };
  if (c.amountPaidXaf > 0) return { relancer: false };
  if (c.annuleeA) return { relancer: false };
  const age = maintenant.getTime() - c.creeeA.getTime();
  if (age < 0 || age > RELANCE_FENETRE_MAX_MS) return { relancer: false };
  return { relancer: true, acompteXaf: planDePaiement(c.totalXaf, "acompte").duAvantXaf };
}
