/**
 * Limitation de debit des envois d'OTP.
 *
 * Un SMS coute de l'argent. Une boucle d'envoi non bridee est **a la fois** une
 * faille — on inonde de messages un numero qui n'est pas le sien — et une
 * facture. Les deux comptent, et la seconde est celle qu'on oublie.
 *
 * Quatre limites, du plus specifique au plus general :
 *
 * 1. **par numero, sur une fenetre courte** — celle que rencontre une vendeuse
 *    qui tape trop vite ou n'a pas recu le premier message ;
 * 2. **par adresse IP** — sans elle, on contourne la premiere en faisant
 *    tourner les numeros depuis la meme machine ;
 * 3. **par numero et par jour** — sans elle, il suffit d'attendre la fin de
 *    chaque fenetre pour envoyer un SMS toutes les quinze minutes, sans fin ;
 * 4. **globale et par jour** — le garde-fou de la facture, qui tient meme si
 *    l'attaque est repartie sur mille numeros et mille adresses.
 *
 * Le domaine est PUR : le temps courant est un parametre, et la liste des
 * tentatives arrive de l'appelant. Aucun acces base, aucune horloge implicite.
 */

export interface OtpAttempt {
  at: Date;
  /** Numero au format E.164. */
  phone: string;
  ip: string;
}

export interface Fenetre {
  max: number;
  fenetreMs: number;
}

export interface OtpLimits {
  parNumero: Fenetre;
  parIp: Fenetre;
  parNumeroParJour: { max: number };
  globalParJour: { max: number };
}

/**
 * Valeurs par defaut.
 *
 * Trois demandes par quart d'heure : de quoi rater un SMS et redemander, sans
 * permettre le harcelement. Dix par jour et par numero : au-dela, ce n'est plus
 * une vendeuse qui se connecte.
 */
export const DEFAULT_OTP_LIMITS: OtpLimits = {
  parNumero: { max: 3, fenetreMs: 15 * 60_000 },
  parIp: { max: 12, fenetreMs: 60 * 60_000 },
  parNumeroParJour: { max: 10 },
  globalParJour: { max: 2_000 },
};

export type RefusReason =
  | "trop_de_demandes_pour_ce_numero"
  | "trop_de_demandes_depuis_cette_adresse"
  | "plafond_journalier_du_numero"
  | "plafond_journalier_global";

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: RefusReason; retryAfterMs: number };

/** Debut du jour civil, en heure locale du processus (TZ=Africa/Douala). */
function debutDuJour(d: Date): number {
  const j = new Date(d);
  j.setHours(0, 0, 0, 0);
  return j.getTime();
}

export function checkOtpRateLimit(
  tentatives: readonly OtpAttempt[],
  demande: { phone: string; ip: string; now: Date },
  limits: OtpLimits = DEFAULT_OTP_LIMITS,
): Decision {
  const t = demande.now.getTime();
  const jour = debutDuJour(demande.now);

  const duNumero = tentatives.filter((a) => a.phone === demande.phone);
  const deLIp = tentatives.filter((a) => a.ip === demande.ip);

  /* 1. Fenetre courte par numero. */
  const recentesNumero = duNumero.filter((a) => t - a.at.getTime() < limits.parNumero.fenetreMs);
  if (recentesNumero.length >= limits.parNumero.max) {
    return {
      allowed: false,
      reason: "trop_de_demandes_pour_ce_numero",
      retryAfterMs: attente(recentesNumero, t, limits.parNumero.fenetreMs),
    };
  }

  /* 2. Fenetre par adresse. */
  const recentesIp = deLIp.filter((a) => t - a.at.getTime() < limits.parIp.fenetreMs);
  if (recentesIp.length >= limits.parIp.max) {
    return {
      allowed: false,
      reason: "trop_de_demandes_depuis_cette_adresse",
      retryAfterMs: attente(recentesIp, t, limits.parIp.fenetreMs),
    };
  }

  /* 3. Plafond journalier du numero. */
  const jourNumero = duNumero.filter((a) => a.at.getTime() >= jour);
  if (jourNumero.length >= limits.parNumeroParJour.max) {
    return {
      allowed: false,
      reason: "plafond_journalier_du_numero",
      retryAfterMs: jour + 86_400_000 - t,
    };
  }

  /* 4. Plafond journalier global — la facture. */
  const jourGlobal = tentatives.filter((a) => a.at.getTime() >= jour);
  if (jourGlobal.length >= limits.globalParJour.max) {
    return {
      allowed: false,
      reason: "plafond_journalier_global",
      retryAfterMs: jour + 86_400_000 - t,
    };
  }

  return { allowed: true };
}

/** Temps restant avant que la plus ancienne tentative de la fenetre sorte. */
function attente(dansLaFenetre: readonly OtpAttempt[], t: number, fenetreMs: number): number {
  const plusAncienne = Math.min(...dansLaFenetre.map((a) => a.at.getTime()));
  return Math.max(1, plusAncienne + fenetreMs - t);
}

/** Secondes entieres a annoncer a l'appelant (en-tete `Retry-After`). */
export function prochainCreneau(d: Decision): number {
  return d.allowed ? 0 : Math.ceil(d.retryAfterMs / 1000);
}
