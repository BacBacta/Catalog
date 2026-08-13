import type { SmsMessage, SmsSender } from "../domain/sms-sender.ts";
import { fetchBorne } from "./fetch-borne.ts";

/**
 * WhatsApp Cloud API — les modeles d'**authentification**.
 *
 * Il implemente `SmsSender` et non une interface a lui : du point de vue du
 * metier, envoyer un code est envoyer un code. C'est la seule chose que le
 * domaine doit savoir, et c'est ce qui permet de basculer de canal par
 * configuration, sans toucher a une regle.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  UN MODELE N'EST PAS UNE PHRASE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Un SMS transporte du texte libre. **WhatsApp non.** Meta approuve un gabarit —
 * « {{1}} is your verification code » — et l'API attend le PARAMETRE, pas la
 * phrase finie. `message.text` est donc IGNORE ici, et c'est `message.valeur`
 * qui part : le code brut, transmis par l'appelant a cote de la phrase
 * exactement pour cela (voir `domain/sms-sender.ts`).
 *
 * Sans ce champ, il faudrait re-extraire le code de la phrase par une expression
 * reguliere — qui se casserait a la premiere reformulation d'un libelle. Un
 * canal ne doit pas dependre de la ponctuation d'un autre.
 *
 * ── Le code figure DEUX FOIS, et ce n'est pas une faute de frappe ─────────
 *
 * Un modele d'authentification avec bouton « copier le code » porte deux
 * emplacements : un dans le corps, un dans le bouton. **Les deux doivent
 * recevoir la meme valeur.** N'en remplir qu'un fait rejeter la requete par
 * Meta — ou, pire, produit un bouton qui copie autre chose que ce qui est
 * ecrit. Un test verrouille cette duplication.
 *
 * ── Ce qui n'est PAS fait ici, et qu'il faut savoir ───────────────────────
 *
 * 1. **La delivrance n'est pas constatee.** Un `send()` qui se termine veut dire
 *    « accepte par Meta », pas « lu par la vendeuse ». Le rappel de statut
 *    existe mais ajouterait une route publique, donc une surface a proteger ;
 *    il n'est pas branche.
 * 2. **Le repli SMS n'est pas ici.** Une vendeuse dont le numero n'a pas
 *    WhatsApp ne recevra rien, et cet adaptateur ne peut pas le savoir avant
 *    d'essayer. Le repli se decide au-dessus, en choisissant l'adaptateur.
 *
 * Source : documentation Meta des modeles d'authentification, et la forme de la
 * charge utile d'envoi (composants `body` et `button`, `sub_type`, `index`).
 */

export interface WhatsAppConfig {
  /** Identifiant du numero expediteur, fourni par Meta. */
  phoneNumberId: string;
  /** Jeton d'acces permanent de l'application. */
  accessToken: string;
  /** Nom du modele approuve — il ne s'invente pas, il se lit dans la console. */
  templateName: string;
  /**
   * Code de langue du modele, tel qu'approuve : `fr`, `en_US`, `en`…
   *
   * **Il doit correspondre EXACTEMENT au modele approuve.** Un `fr_FR` la ou
   * Meta a enregistre `fr` fait echouer l'envoi, avec un message qui ne dit pas
   * que c'est la langue qui cloche.
   */
  langue?: string;
  /** Version de l'API Graph. */
  version?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const BASE_DEFAUT = "https://graph.facebook.com";
const VERSION_DEFAUT = "v21.0";

/**
 * Les seuls messages qu'un modele d'authentification peut porter.
 *
 * Un gabarit approuve en categorie « authentification » ne sert qu'a cela : y
 * faire passer un rappel de solde serait un detournement de categorie, que Meta
 * sanctionne, et le texte n'aurait aucun sens dans le gabarit. Les deux autres
 * etiquettes doivent partir par un autre canal.
 */
const KINDS_SUPPORTES: ReadonlySet<SmsMessage["kind"]> = new Set([
  "otp_connexion",
  "otp_reversement",
]);

/**
 * Meta attend le destinataire **sans le `+`**, en chiffres seulement.
 * `+237677000001` → `237677000001`.
 */
export function destinataire(numero: string): string {
  return numero.replace(/\D/g, "");
}

/**
 * La charge utile d'envoi. Fonction PURE, donc verifiable sans reseau — et
 * c'est elle qui porte la duplication du code.
 */
export function chargeUtile(options: {
  to: string;
  templateName: string;
  langue: string;
  code: string;
}) {
  const parametre = [{ type: "text", text: options.code }];
  return {
    messaging_product: "whatsapp",
    to: destinataire(options.to),
    type: "template",
    template: {
      name: options.templateName,
      language: { code: options.langue },
      components: [
        { type: "body", parameters: parametre },
        /**
         * Le bouton « copier le code ». `sub_type: "url"` et `index: 0` sont
         * imposes par Meta pour le premier bouton d'un modele
         * d'authentification ; ils ne se devinent pas, ils se recopient.
         */
        { type: "button", sub_type: "url", index: 0, parameters: parametre },
      ],
    },
  };
}

export class WhatsAppSender implements SmsSender {
  readonly name = "whatsapp-cloud";

  readonly #cfg: WhatsAppConfig;
  readonly #fetch: typeof fetch;
  readonly #url: string;

  constructor(cfg: WhatsAppConfig) {
    /** Meme regle que l'adaptateur Orange : on nomme la VARIABLE a poser. */
    const VARIABLE = {
      phoneNumberId: "WHATSAPP_PHONE_NUMBER_ID",
      accessToken: "WHATSAPP_ACCESS_TOKEN",
      templateName: "WHATSAPP_TEMPLATE_OTP",
    } as const;
    const manquants = (["phoneNumberId", "accessToken", "templateName"] as const).filter(
      (k) => !cfg[k],
    );
    if (manquants.length) {
      throw new Error(
        `Configuration WhatsApp incomplete. Variables absentes : ` +
          `${manquants.map((k) => VARIABLE[k]).join(", ")}. ` +
          "Voir .env.example, section « whatsapp : modèle d'authentification (Cloud API) ».",
      );
    }
    this.#cfg = cfg;
    this.#fetch = fetchBorne(cfg.fetchImpl ?? globalThis.fetch);
    const base = (cfg.baseUrl ?? BASE_DEFAUT).replace(/\/$/, "");
    this.#url = `${base}/${cfg.version ?? VERSION_DEFAUT}/${cfg.phoneNumberId}/messages`;
  }

  async send(message: SmsMessage): Promise<void> {
    if (!KINDS_SUPPORTES.has(message.kind)) {
      throw new Error(
        `WhatsApp : le modele d'authentification ne porte pas « ${message.kind} ». ` +
          "Seuls otp_connexion et otp_reversement passent par ce canal ; " +
          "les rappels et expirations demandent un modele d'une autre categorie.",
      );
    }

    /**
     * **Sans le code brut, on ne devine pas.** Lever ici plutot que d'envoyer un
     * message vide : un OTP vide serait accepte par Meta et arriverait chez la
     * vendeuse sous la forme « votre code est » — elle appellerait, et personne
     * ne saurait pourquoi.
     */
    if (!message.valeur) {
      throw new Error(
        `WhatsApp : ${message.kind} sans valeur brute. ` +
          "Un modele attend un parametre, pas une phrase — voir SmsMessage.valeur.",
      );
    }

    const r = await this.#fetch(this.#url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        chargeUtile({
          to: message.to,
          templateName: this.#cfg.templateName,
          langue: this.#cfg.langue ?? "fr",
          code: message.valeur,
        }),
      ),
    });

    if (!r.ok) {
      /**
       * Meta rend un code d'erreur numerique utile au diagnostic — 131026
       * « impossible de delivrer », 132001 « modele inexistant ». On le remonte,
       * **sans le corps complet** : celui-ci recopie la charge utile envoyee,
       * donc le code OTP.
       */
      const detail = await r
        .json()
        .then((c) => (c as { error?: { code?: number } } | null)?.error?.code)
        .catch(() => undefined);
      throw new Error(
        `WhatsApp : envoi refuse (HTTP ${r.status}` +
          `${detail === undefined ? "" : `, code ${detail}`}) pour ${message.kind}.`,
      );
    }
  }
}
