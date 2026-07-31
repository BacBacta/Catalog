import { normalizePhone } from "@catalog/contracts";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { phoneNumber } from "better-auth/plugins";
import { ConsoleSmsSender } from "./adapters/sms-console.ts";
import { OrangeSmsSender } from "./adapters/sms-orange.ts";
import { PendingSmsProvider, resolveSmsSender } from "./adapters/sms-provider.ts";
import { WhatsAppSender } from "./adapters/sms-whatsapp.ts";
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
  /** Origines du navigateur autorisees. Voir `origines()`. */
  trustedOrigins?: string[];
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

/**
 * Origines acceptees, lues dans `TRUSTED_ORIGINS` (liste separee par des
 * virgules). Rien n'est devine : une origine implicite serait soit trop large,
 * soit fausse selon l'environnement.
 */
export function origines(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createAuth(deps: AuthDeps) {
  const trusted = deps.trustedOrigins ?? origines();

  return betterAuth({
    database: prismaAdapter(deps.prisma, { provider: "postgresql" }),
    secret: deps.secret ?? process.env.BETTER_AUTH_SECRET,
    baseURL: deps.baseURL ?? process.env.BETTER_AUTH_URL,

    // Pas de mot de passe, pas d'e-mail : le telephone est le seul facteur.
    emailAndPassword: { enabled: false },

    /**
     * Better Auth appelle `prisma[modelName]`. Nos modeles s'appellent
     * `AuthUser`, `AuthSession`, `AuthAccount`, `AuthVerification` — le prefixe
     * dit a la lecture du schema ce qui appartient a la bibliotheque et ce qui
     * appartient au metier, la ou un `User` nu se confondrait avec `Seller`.
     *
     * Ces quatre lignes sont donc la traduction, et **elles sont obligatoires** :
     * sans elles, Better Auth cherche `prisma.verification` et echoue en 500 au
     * premier envoi d'OTP. Les noms de TABLE, eux, ne changent pas : ils sont
     * poses par `@@map` et restent `user`, `session`, `account`, `verification`.
     */
    user: { modelName: "authUser" },
    session: { modelName: "authSession" },
    account: { modelName: "authAccount" },
    verification: { modelName: "authVerification" },

    /**
     * Origines acceptees. L'app vendeuse est servie par Vite, qui renvoie `/api`
     * vers ce serveur : le navigateur envoie donc l'origine de l'app, pas celle
     * de l'API, et Better Auth la refuserait sans cette liste.
     */
    ...(trusted.length ? { trustedOrigins: trusted } : {}),

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
            /** Le code brut, pour les canaux a gabarit. Voir `SmsMessage`. */
            valeur: code,
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

/**
 * Fabriques disponibles. C'est le seul endroit ou un nom de fournisseur vit.
 *
 * Quatre valeurs pour `SMS_PROVIDER` :
 *
 * | valeur | canal | remarque |
 * |---|---|---|
 * | `console` | aucun, ecrit sur la sortie standard | refuse de se charger en production |
 * | `orange` | SMS, **tous operateurs** du Cameroun | API `sms-cm` |
 * | `whatsapp` | modele d'authentification WhatsApp | ne porte QUE les deux OTP |
 * | `provider` | rien : leve | la place tenue, si l'on veut une autre passerelle |
 *
 * **Le choix se fait ici et nulle part ailleurs.** Aucune route, aucun job,
 * aucune regle metier ne sait quel canal est actif — c'est ce qui permet d'en
 * changer sans toucher au domaine, et de revenir en arriere en une variable.
 */
export function smsSenderDepuisEnv(env: NodeJS.ProcessEnv = process.env): SmsSender {
  return resolveSmsSender(env, {
    console: () => new ConsoleSmsSender(env),
    orange: () =>
      new OrangeSmsSender({
        clientId: env.ORANGE_CLIENT_ID ?? "",
        clientSecret: env.ORANGE_CLIENT_SECRET ?? "",
        senderAddress: env.ORANGE_SENDER_ADDRESS ?? "",
        senderName: env.ORANGE_SENDER_NAME,
        accuseUrl: env.SMS_ACCUSE_URL,
        ...(env.ORANGE_BASE_URL ? { baseUrl: env.ORANGE_BASE_URL } : {}),
      }),
    whatsapp: () =>
      new WhatsAppSender({
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? "",
        accessToken: env.WHATSAPP_ACCESS_TOKEN ?? "",
        templateName: env.WHATSAPP_TEMPLATE_OTP ?? "",
        ...(env.WHATSAPP_TEMPLATE_LANGUE ? { langue: env.WHATSAPP_TEMPLATE_LANGUE } : {}),
        ...(env.WHATSAPP_API_VERSION ? { version: env.WHATSAPP_API_VERSION } : {}),
        ...(env.WHATSAPP_BASE_URL ? { baseUrl: env.WHATSAPP_BASE_URL } : {}),
      }),
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
