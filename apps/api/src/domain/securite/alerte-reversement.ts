/**
 * L'alerte a l'ANCIEN numero, et le gel qu'elle permet — ADR 0061, rang 2b.
 *
 * ── Le scenario, et pourquoi il n'est pas theorique ───────────────────────
 *
 * Le telephone EST le fonds de commerce, et il se vole. Celui qui le tient
 * tient le fil WhatsApp, donc le compte, donc — en une manipulation — le
 * numero sur lequel les acheteuses paient. Le journal d'audit voyait deja
 * chaque changement de reversement ; il ne PREVENAIT personne.
 *
 * Ce que ce module ajoute tient en une phrase : **quand le numero de
 * reversement change, l'ancien numero l'apprend.** La double SIM etant la
 * norme au Cameroun (AGENTS.md §2), la vraie proprietaire tient encore l'autre
 * puce — c'est la seule voie qui ne passe pas par l'appareil vole.
 *
 * Cout du geste : une notification. Cout de son absence : la caisse.
 *
 * ── Ce module est PUR ─────────────────────────────────────────────────────
 *
 * Il n'envoie rien et n'ecrit rien. Il repond a deux questions : « faut-il
 * alerter, et qui ? », puis « ce STOP-la vaut-il gel ? ». Le temps entre en
 * parametre.
 */

export interface ChangementDeReversement {
  /** Le numero AVANT le changement. `null` : premiere pose. */
  ancienNumero: string | null;
  nouveauNumero: string;
}

export type DecisionAlerte =
  | { alerter: false; motif: MotifSilence }
  | { alerter: true; vers: string };

/** Vocabulaire ferme des silences — chacun est une decision, pas un oubli. */
export type MotifSilence =
  /**
   * **Premiere pose : personne a prevenir.** Aucun ancien numero n'existe,
   * donc aucune destinataire legitime. Alerter le numero de CONNEXION serait
   * tentant et faux : sur un appareil vole, il est deja entre les mains du
   * voleur, et l'alerte lui apprendrait seulement qu'un garde-fou existe.
   */
  | "premiere_pose"
  /** Le numero n'a pas change : il n'y a rien a signaler. */
  | "inchange";

export function decisionAlerte(c: ChangementDeReversement): DecisionAlerte {
  if (!c.ancienNumero) return { alerter: false, motif: "premiere_pose" };
  if (c.ancienNumero === c.nouveauNumero) return { alerter: false, motif: "inchange" };
  return { alerter: true, vers: c.ancienNumero };
}

/**
 * La fenetre pendant laquelle un STOP se rattache a une alerte.
 *
 * Sept jours, et c'est un choix de terrain : une vendeuse dont le telephone a
 * ete vole ne s'en apercoit pas toujours le jour meme, et la puce de secours
 * n'est pas forcement dans un appareil allume. Plus court protegerait moins ;
 * beaucoup plus long ferait geler des comptes sur un message sans rapport.
 */
export const FENETRE_STOP_MS = 7 * 24 * 60 * 60 * 1000;

/** Le mot qui gele. Insensible a la casse, aux accents et aux espaces. */
const MOT_STOP = /^\s*stop\s*$/i;

export interface DemandeDeGel {
  /** Le texte recu, tel quel. */
  texte: string;
  /** Quand l'alerte est partie vers ce numero. `null` : aucune alerte. */
  alerteEnvoyeeA: Date | null;
  maintenant: Date;
}

export type DecisionGel = { geler: false; motif: MotifNonGel } | { geler: true };

export type MotifNonGel =
  /** Le message n'est pas un STOP. */
  | "pas_un_stop"
  /** Aucune alerte n'est partie vers ce numero : rien a annuler. */
  | "aucune_alerte"
  /** L'alerte est trop ancienne — au-dela, un STOP est probablement autre chose. */
  | "hors_fenetre";

/**
 * **Le STOP ne vaut que s'il repond a une alerte.** Sans cette condition,
 * n'importe quel « stop » recu par le bot — un desabonnement, une faute de
 * frappe — gelerait un reversement.
 */
export function decisionGel(d: DemandeDeGel): DecisionGel {
  if (!MOT_STOP.test(d.texte)) return { geler: false, motif: "pas_un_stop" };
  if (!d.alerteEnvoyeeA) return { geler: false, motif: "aucune_alerte" };
  const age = d.maintenant.getTime() - d.alerteEnvoyeeA.getTime();
  if (age < 0 || age > FENETRE_STOP_MS) return { geler: false, motif: "hors_fenetre" };
  return { geler: true };
}

/**
 * ── Ce que le gel FAIT, et les deux choses qu'il refuse de faire ──────────
 *
 * Il **efface le numero de reversement** et interdit d'en poser un nouveau
 * jusqu'a intervention humaine.
 *
 * 1. **Il ne REVIENT PAS a l'ancien numero.** Ce serait diriger l'argent vers
 *    une puce dont on ne sait pas qui la tient aujourd'hui — on suppose
 *    seulement que quelqu'un la tenait au moment du STOP. Dans le doute, on
 *    arrete l'argent, on ne le redirige pas.
 * 2. **Il ne ferme PAS la boutique.** Les commandes en cours vont a leur terme,
 *    la page reste en ligne, la vendeuse reste joignable. Fermer punirait la
 *    victime pour un vol qu'elle subit. Sans reversement pose, le bot sait
 *    deja faire : on commande, on ne paie pas d'avance (`reversementPose`).
 *
 * Ce que voit une acheteuse : une boutique qui ne prend plus d'acompte. Ce que
 * voit un voleur : un compte qui ne rapporte rien.
 */
export interface EffetDuGel {
  payoutPhone: null;
  payoutPhoneVerifiedAt: null;
  payoutOperator: null;
  reversementGeleDepuis: Date;
}

export function effetDuGel(maintenant: Date): EffetDuGel {
  return {
    payoutPhone: null,
    payoutPhoneVerifiedAt: null,
    payoutOperator: null,
    reversementGeleDepuis: maintenant,
  };
}
