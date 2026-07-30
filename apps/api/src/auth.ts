import { normalizePhone } from "@catalog/contracts";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { phoneNumber } from "better-auth/plugins";
import { ConsoleSmsSender } from "./adapters/sms-console.ts";
import { PendingSmsProvider, resolveSmsSender } from "./adapters/sms-provider.ts";
import type { SmsSender } from "./domain/sms-sender.ts";
import { texteSms } from "./domain/sms-sender.ts";

/**
 * Authentification vendeuse — Better Auth 1.6 avec le plugin `phoneNumber`.
 *
 * **Il n'y a PAS d'authentification par e-mail dans ce produit.** Les
 * commercantes camerounaises s'identifient par numero de telephone. Le champ
 * `email` du noyau de Better Auth recoit une valeur technique derivee du
 * numero : aucun ecran ne la demande, aucun message ne l'affiche, et rien n'est
 * jamais envoye dessus.
 *
 * Le fournisseur SMS arrive par injection. Aucun fournisseur n'est code en dur
 * ici : `resolveSmsSender` choisit d'apres la configuration, et l'adaptateur de
 * developpement refuse de se charger en production.
 */

export interface AuthDeps {
  prisma: PrismaClient;
  sms: SmsSender;
  /** Appele APRES l'envoi reussi, pour enregistrer la tentative (debit). */
  onOtpEnvoye?: (data: { phone: string; kind: string }) => Promise<void>;
  /** Consulte AVANT l'envoi. Lever ici empeche l'envoi. */
  avantEnvoi?: (data: { phone: string }) => Promise<void>;
  secret?: string;
  baseURL?: string;
}

/**
 * Adresse technique derivee du numero. Le domaine `.invalid` est reserve par la
 * RFC 2606 : il ne peut pas exister, donc aucun message ne partira jamais
 * dessus, meme par accident de configuration.
 */
export function emailTechnique(phone: string): string {
  const n = normalizePhone(phone) ?? phone;
  return `${n.replace(/\D/g, "")}@telephone.catalog.invalid`;
}

export function createAuth(deps: AuthDeps) {
  return betterAuth({
    database: prismaAdapter(deps.prisma, { provider: "postgresql" }),
    secret: deps.secret ?? process.env.BETTER_AUTH_SECRET,
    baseURL: deps.baseURL ?? process.env.BETTER_AUTH_URL,

    // Pas de mot de passe, pas d'e-mail : le telephone est le seul facteur.
    emailAndPassword: { enabled: false },

    plugins: [
      phoneNumber({
        otpLength: 6,
        expiresIn: 5 * 60,
        /** Trois essais de saisie, comme la limite de renvoi. */
        allowedAttempts: 3,

        /**
         * Seuls les numeros camerounais sont acceptes. `normalizePhone` fait
         * foi — on ne reecrit pas la regle de format ici, elle vit dans
         * `packages/contracts`.
         */
        phoneNumberValidator: (phone) => normalizePhone(phone) !== null,

        async sendOTP({ phoneNumber: to, code }) {
          const n = normalizePhone(to);
          if (!n) throw new Error("numero non camerounais");

          // La limitation de debit est consultee ICI, avant l'envoi : un SMS
          // envoye puis compte serait deja paye.
          await deps.avantEnvoi?.({ phone: n });

          await deps.sms.send({
            to: n,
            text: texteSms("otp_connexion", code),
            kind: "otp_connexion",
          });

          await deps.onOtpEnvoye?.({ phone: n, kind: "otp_connexion" });
        },

        /**
         * L'inscription se fait a la premiere verification reussie : une
         * vendeuse n'a pas de formulaire d'inscription separe, elle entre son
         * numero et elle est dedans.
         */
        signUpOnVerification: {
          getTempEmail: emailTechnique,
          getTempName: (phone) => normalizePhone(phone) ?? phone,
        },
      }),
    ],
  });
}

/** Fabriques disponibles. C'est le seul endroit ou un nom de fournisseur vit. */
export function smsSenderDepuisEnv(env: NodeJS.ProcessEnv = process.env): SmsSender {
  return resolveSmsSender(env, {
    console: () => new ConsoleSmsSender(env),
    provider: () =>
      new PendingSmsProvider({
        ...(env.SMS_API_KEY ? { apiKey: env.SMS_API_KEY } : {}),
        ...(env.SMS_SENDER_ID ? { senderId: env.SMS_SENDER_ID } : {}),
        ...(env.SMS_BASE_URL ? { baseUrl: env.SMS_BASE_URL } : {}),
      }),
  });
}

/** Instance par defaut, pour le serveur. Les tests construisent la leur. */
export function createDefaultAuth() {
  return createAuth({ prisma: createPrismaClient(), sms: smsSenderDepuisEnv() });
}
