import { passkey } from "@better-auth/passkey";
import { normalizePhone } from "@catalog/contracts";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { phoneNumber } from "better-auth/plugins";
import { ConsoleSmsSender } from "./adapters/sms-console.ts";
import { MboaSmsSender } from "./adapters/sms-mboa.ts";
import { OrangeSmsSender } from "./adapters/sms-orange.ts";
import { PendingSmsProvider, resolveSmsSender } from "./adapters/sms-provider.ts";
import { WhatsAppSender } from "./adapters/sms-whatsapp.ts";
import { connexionWhatsApp } from "./auth-connexion-whatsapp.ts";
import { envoyerCodeBanc, numeroDuBanc } from "./banc-essai.ts";
import type { SmsSender } from "./domain/sms-sender.ts";
import { texteSms } from "./domain/sms-sender.ts";

/**
 * Authentification vendeuse — Better Auth 1.6 avec le plugin `phoneNumber`.
 *
 * **Il n'y a PAS de parcours e-mail dans ce produit** : aucune adresse ne se
 * saisit, aucun message ne part jamais vers une boite. L'ADR 0029 a AMENDE la
 * regle d'un cran precis — le bouton « Continuer avec Google », selecteur de
 * compte systeme, est permis : l'adresse Google devient la cle technique du
 * compte sans qu'aucun ecran ne la demande. Pour les comptes nes du telephone,
 * le champ `email` garde sa valeur technique derivee du numero (`.invalid`).
 *
 * Le fournisseur SMS arrive par injection. Aucun fournisseur n'est code en dur
 * ici : `resolveSmsSender` choisit d'apres la configuration, et l'adaptateur de
 * developpement refuse de se charger en production.
 */

export interface AuthDeps {
  prisma: PrismaClient;
  sms: SmsSender;
  /**
   * Le numero WhatsApp de Catalog (WABA), pour la connexion par message
   * ENTRANT — ADR 0027. Absent, le canal est ferme : les points d'entree
   * repondent `disponible: false` et refusent de creer un defi.
   */
  wabaNumero?: string | undefined;
  /**
   * WebAuthn — ADR 0028. Le `rpId` est EPINGLE AU DOMAINE de l'app vendeuse :
   * une cle enrolee sous un domaine meurt avec lui, et fly.dev comme vercel.app
   * sont sur la Public Suffix List. Ces options ne se posent donc QUE sur le
   * domaine definitif. Absentes, le plugin n'est pas monte : ses points
   * d'entree repondent 404, et l'app vendeuse n'affiche rien.
   */
  passkeyRpId?: string | undefined;
  passkeyOrigin?: string | undefined;
  /**
   * La ceremonie Google — ADR 0029. En dormance sans les deux identifiants :
   * ni fournisseur monte, ni bouton affiche (l'endpoint d'etat le dit). La
   * SEULE ceremonie sans dossier a deposer nulle part.
   */
  googleClientId?: string | undefined;
  googleClientSecret?: string | undefined;
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

/**
 * **Le garde de demarrage le plus insidieux du service, avant cette fonction.**
 *
 * `betterAuth()` rend un contexte construit par une fonction `async`, a laquelle
 * aucun `.catch` n'est attache tant qu'aucune requete n'arrive. Sa validation du
 * secret rejette donc APRES le `serve()` et APRES le `console.log` d'ecoute. La
 * sortie observee, dans cet ordre :
 *
 *     catalog-api ecoute sur http://localhost:8080
 *     [BetterAuthError: You are using the default secret…]
 *
 * et Node 24 tue le processus sur le rejet non gere. Sur Fly, cela donne une
 * boucle de redemarrage dont chaque iteration montre une ligne d'ECOUTE
 * REUSSIE — l'operateur cherche du cote du port, du health check ou de la
 * memoire, et le runbook lui a promis que seuls deux gardes empechent de
 * demarrer.
 *
 * Pire : sans cette verification, `secret` vaut `undefined` et Better Auth
 * retombe sur une valeur PAR DEFAUT, publique et identique chez tout le monde.
 * Hors production, le processus ne mourrait meme pas — il signerait les sessions
 * avec un secret connu.
 *
 * On echoue donc ici, synchroniquement, avec le nom de la variable a poser.
 */
export function verifierSecretAuth(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET est absent. Il signe les sessions vendeur/se : sans lui, " +
        "Better Auth retombe sur un secret par defaut, public et partage. " +
        "Poser une valeur aleatoire de 32 octets : openssl rand -hex 32. " +
        "Voir docs/runbooks/deploiement.md, section « Les secrets ».",
    );
  }
}

/**
 * La surface d'auth que le serveur CONSOMME — et rien de plus.
 *
 * L'inference complete de `betterAuth()` refererait des types non portables de
 * @simplewebauthn (TS2883) des que le plugin passkey entre dans le tableau. On
 * annote donc structurellement : `handler` pour le montage HTTP, `getSession`
 * dans la forme exacte qu'attendent les routes (voir `SessionDeps`), et
 * `$context` pour l'adaptateur interne du rappel WhatsApp entrant (ADR 0027). Les points
 * d'entree des plugins, eux, se servent en HTTP — ils n'ont pas besoin de
 * types ici.
 */
export interface InstanceAuth {
  handler: (requete: Request) => Promise<Response>;
  api: {
    getSession: (entree: {
      headers: Headers;
    }) => Promise<{ user: { id: string; phoneNumber?: string | null | undefined } } | null>;
  };
  $context: Promise<{ internalAdapter: unknown }>;
}

export function createAuth(deps: AuthDeps): InstanceAuth {
  const trusted = deps.trustedOrigins ?? origines();
  // Seulement quand le secret n'est pas injecte : les tests construisent le leur.
  if (deps.secret === undefined) verifierSecretAuth();

  // L'elargissement est sur : la surface reelle contient strictement plus.
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
    /**
     * La ceremonie Google (ADR 0029), en dormance sans identifiants. Le flux
     * est la redirection OAuth classique ; le rappel est
     * `/api/auth/callback/google`, a declarer dans la console Google Cloud.
     */
    ...(deps.googleClientId && deps.googleClientSecret
      ? {
          socialProviders: {
            google: { clientId: deps.googleClientId, clientSecret: deps.googleClientSecret },
          },
        }
      : {}),

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
        /* Les numeros du banc d'essai (ADR 0058) passent aussi — liste
           NOMMEE dans l'environnement, vide par defaut : sans elle, la regle
           +237 est exactement celle d'avant. */
        phoneNumberValidator: (phone) =>
          normalizePhone(phone) !== null || numeroDuBanc(phone) !== null,

        async sendOTP({ phoneNumber: to, code }) {
          const banc = numeroDuBanc(to);
          const n = normalizePhone(to) ?? banc;
          if (!n) throw new Error("numero non camerounais");

          /* Un numero du banc ne peut pas recevoir le canal normal — en
             preprod l'OTP part en SMS par Orange Cameroun, qui ne livre pas
             hors du pays. Son code part par le WhatsApp du bot, en texte
             libre : le banc converse deja avec lui. Memes garde-fous de
             debit que le canal normal. */
          if (banc) {
            await deps.avantEnvoi?.({ phone: n });
            await envoyerCodeBanc(n, texteSms("otp_connexion", code));
            await deps.onOtpEnvoye?.({ phone: n, kind: "otp_connexion" });
            return;
          }

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

      /**
       * La connexion par WhatsApp ENTRANT — ADR 0027. Le plugin est toujours
       * monte : sans numero WABA il repond `disponible: false`, et l'ecran
       * vendeuse n'affiche pas le bouton. La creation d'utilisateur y est le
       * miroir exact du `signUpOnVerification` ci-dessus — meme adresse
       * technique, meme nom — pour qu'une vendeuse arrivee par un canal se
       * connecte par l'autre sur le MEME compte.
       */
      connexionWhatsApp({
        waba: deps.wabaNumero,
        emailTechnique,
        googleActif: Boolean(deps.googleClientId && deps.googleClientSecret),
      }),

      /**
       * Les passkeys — ADR 0028, EN DORMANCE tant que le domaine final n'existe
       * pas. La table `passkey` (AuthPasskey) existe des maintenant : une
       * migration expand n'attend pas son consommateur. `aaguid` et `backedUp`
       * alimentent l'ecran « Appareils » — nom du fournisseur, et promesse
       * qu'un telephone restaure retrouvera sa cle.
       */
      ...(deps.passkeyRpId
        ? [
            passkey({
              rpID: deps.passkeyRpId,
              rpName: "Catalog",
              ...(deps.passkeyOrigin ? { origin: deps.passkeyOrigin } : {}),
              schema: { passkey: { modelName: "authPasskey" } },
            }),
          ]
        : []),
    ],
  }) as unknown as InstanceAuth;
}

/**
 * Fabriques disponibles. C'est le seul endroit ou un nom de fournisseur vit.
 *
 * Cinq valeurs pour `SMS_PROVIDER` :
 *
 * | valeur | canal | remarque |
 * |---|---|---|
 * | `console` | aucun, ecrit sur la sortie standard | refuse de se charger en production |
 * | `orange` | SMS, **tous operateurs** du Cameroun | API `sms-cm` |
 * | `mboasms` | SMS, **MTN, Orange et Camtel** | passerelle locale, ADR 0026 |
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
    mboasms: () =>
      new MboaSmsSender({
        apiKey: env.MBOA_API_KEY ?? "",
        senderId: env.MBOA_SENDER_ID,
        baseUrl: env.MBOA_BASE_URL,
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
