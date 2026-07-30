import { normalizePhone } from "@catalog/contracts";
import { Hono } from "hono";
import type { OtpAttemptStore } from "../adapters/otp-attempt-store.ts";
import type { OtpLimits } from "../domain/rate-limit.ts";
import { otpRateLimit } from "../middleware/otp-rate-limit.ts";

/**
 * Montage de Better Auth, avec la limitation de debit devant l'envoi d'OTP.
 *
 * Le handler de Better Auth sert tout `/api/auth/*` : envoi du code,
 * verification, session, deconnexion. On ne reecrit aucune de ces routes — on
 * pose seulement un garde devant celle qui coute de l'argent.
 *
 * **L'ordre est celui du fichier** : le middleware est declare avant `all("/*")`,
 * donc il s'execute avant. L'inverse laisserait passer les envois.
 */

export interface AuthRoutesDeps {
  /** `auth.handler` de l'instance Better Auth. */
  handler: (req: Request) => Promise<Response>;
  otpStore: OtpAttemptStore;
  /** Plafonds. Absents, les valeurs par defaut du domaine s'appliquent. */
  limits?: OtpLimits;
  maintenant?: () => Date;
}

export function authRoutes(deps: AuthRoutesDeps) {
  const r = new Hono();

  r.use(
    "/phone-number/send-otp",
    otpRateLimit({
      store: deps.otpStore,
      kind: "otp_connexion",
      ...(deps.limits ? { limits: deps.limits } : {}),
      ...(deps.maintenant ? { maintenant: deps.maintenant } : {}),
      /**
       * La cle est le numero NORMALISE. Sans cela, « 677123456 » et
       * « +237677123456 » compteraient separement et trois demandes deviendraient
       * six : la limite se contournerait en changeant la mise en forme.
       */
      numero: (corps) => {
        const n = (corps as { phoneNumber?: unknown } | null)?.phoneNumber;
        return typeof n === "string" ? normalizePhone(n) : null;
      },
    }),
  );

  r.all("/*", (c) => deps.handler(c.req.raw));
  return r;
}
