import type { Context, MiddlewareHandler } from "hono";
import type { OtpAttemptStore } from "../adapters/otp-attempt-store.ts";
import { debutDuJour } from "../adapters/otp-attempt-store.ts";
import {
  checkOtpRateLimit,
  DEFAULT_OTP_LIMITS,
  type OtpLimits,
  prochainCreneau,
} from "../domain/rate-limit.ts";

/**
 * La limitation de debit, en couche HTTP.
 *
 * Elle est **ici** et pas dans `sendOTP` pour une raison precise : l'adresse IP
 * est une donnee de la requete. Enfouie dans le rappel d'envoi de Better Auth,
 * elle serait absente ou devinee, et la limite par adresse — celle qui empeche de
 * contourner la limite par numero en faisant tourner les numeros — ne tiendrait
 * pas.
 *
 * Deux temps, dans cet ordre :
 *
 * 1. **avant** l'appel : on decide. Un refus ne coute aucun SMS.
 * 2. **apres** une reponse reussie : on enregistre. Compter les echecs
 *    permettrait d'enfermer une vendeuse dehors avec des requetes invalides ;
 *    ne compter que les envois reels aligne le compteur sur la facture.
 */

export interface OtpRateLimitDeps {
  store: OtpAttemptStore;
  /** Etiquette de la table : `otp_connexion`, `otp_reversement`. */
  kind: string;
  limits?: OtpLimits;
  maintenant?: () => Date;
  /** Extrait le numero du corps. Renvoie `null` si la requete n'en porte pas. */
  numero: (corps: unknown) => string | null;
}

/**
 * Adresse de l'appelant. `x-forwarded-for` peut porter une liste : la premiere
 * entree est le client. En l'absence d'en-tete, on retient `inconnue` — une
 * chaine stable, pour que ces requetes se limitent entre elles plutot que
 * d'echapper a la regle.
 */
export function adresseDe(c: Context): string {
  const xff = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  return c.req.header("x-real-ip")?.trim() || "inconnue";
}

const MESSAGE: Record<string, string> = {
  trop_de_demandes_pour_ce_numero:
    "Trop de demandes pour ce numero. Attendez quelques minutes avant de redemander un code.",
  trop_de_demandes_depuis_cette_adresse:
    "Trop de demandes depuis cet appareil. Attendez un moment avant de reessayer.",
  plafond_journalier_du_numero:
    "Ce numero a atteint sa limite de codes pour aujourd'hui. Reessayez demain.",
  plafond_journalier_global: "Le service d'envoi est momentanement sature. Reessayez plus tard.",
};

export function otpRateLimit(deps: OtpRateLimitDeps): MiddlewareHandler {
  const limits = deps.limits ?? DEFAULT_OTP_LIMITS;

  return async (c, next) => {
    const now = deps.maintenant?.() ?? new Date();

    // Le corps est lu ici puis remis a disposition : Hono met la requete en
    // cache, donc l'appelant en aval peut le relire.
    const corps = await c.req.raw
      .clone()
      .json()
      .catch(() => null);
    const numero = deps.numero(corps);
    if (!numero) return next();

    const ip = adresseDe(c);
    const tentatives = await deps.store.depuis(debutDuJour(now));
    const decision = checkOtpRateLimit(tentatives, { phone: numero, ip, now }, limits);

    if (!decision.allowed) {
      const secondes = prochainCreneau(decision);
      c.header("Retry-After", String(secondes));
      return c.json(
        {
          erreur: decision.reason,
          message: MESSAGE[decision.reason],
          reessayerDansSecondes: secondes,
        },
        429,
      );
    }

    await next();

    // On n'enregistre que si un SMS est bien parti. Better Auth repond 200 sur
    // l'envoi ; tout le reste est une requete qui n'a rien coute.
    if (c.res.status >= 200 && c.res.status < 300) {
      await deps.store.enregistrer({ phone: numero, ip, at: now, kind: deps.kind });
    }
  };
}
