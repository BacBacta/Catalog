import type { SmsMessage, SmsSender } from "../domain/sms-sender.ts";

/**
 * Orange **SMS Cameroon** — l'API `sms-cm` du portail Orange Developer.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  LE PIEGE A CONNAITRE AVANT TOUT LE RESTE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Orange publie **deux** API aux noms presque identiques :
 *
 * | API | portee |
 * |---|---|
 * | `sms-cm` — « SMS Cameroon » | **tous les operateurs** du Cameroun |
 * | `sms-onnet-cm` — « SMS Cameroon (Orange Only) » | abonnes Orange seulement |
 *
 * Et la bascule de l'une a l'autre tient a un **parametre de requete** :
 * `?resource_type_parameter_management=SMS_OCB2` restreint l'envoi au reseau
 * Orange. Cet adaptateur ne le pose JAMAIS, et un test le verifie.
 *
 * Pourquoi tant d'insistance : une vendeuse sur trois est chez MTN. Si l'envoi
 * devenait « Orange seulement », elles ne recevraient plus leur code de
 * connexion — et **rien ne le dirait**. L'API repondrait, le compteur d'envois
 * monterait, et le seul signe serait des vendeuses qui n'arrivent plus a entrer
 * et qui n'appellent pas. C'est exactement la panne silencieuse que
 * `sms-provider.ts` decrit : « une passerelle qui accepte le message puis ne le
 * delivre pas est le cas courant, et il ne se voit pas depuis un code 200 ».
 *
 * ── Le jeton OAuth est mis en cache, et il le faut ────────────────────────
 *
 * Orange rend un jeton valable une heure. Le redemander a chaque SMS ajouterait
 * un aller-retour reseau devant chaque connexion de vendeuse, et consommerait un
 * quota d'authentification pour rien. Il est donc garde jusqu'a son expiration,
 * avec une marge : un jeton qui expire pendant le vol de la requete produirait
 * un 401 intermittent, le pire genre de defaut.
 *
 * ── Ce que cet adaptateur ne fait PAS ─────────────────────────────────────
 *
 * Il ne sait pas si le message a ete **delivre**. Orange accuse reception de la
 * demande ; la delivrance se constate par un rappel de statut que ce lot ne
 * branche pas (voir l'ADR). Un `send()` qui se termine sans lever veut dire
 * « accepte par Orange », jamais « lu par la vendeuse ».
 *
 * Source : `https://developer.orange.com/apis/sms-cm` et la mise en route
 * commune `https://developer.orange.com/apis/sms/getting-started`.
 */

export interface OrangeSmsConfig {
  /** Identifiants de l'application Orange Developer. */
  clientId: string;
  clientSecret: string;
  /**
   * Le numero emetteur fourni par Orange, en E.164 (`+237XXXXXXXXX`). Il entre
   * DANS le chemin de l'URL, encode, et dans le corps.
   */
  senderAddress: string;
  /**
   * Nom d'expediteur affiche, s'il a ete valide. Absent, Orange utilise le nom
   * genere par defaut — et sa documentation signale que certains pays ne
   * l'acceptent plus. Ne pas l'inventer : il se declare.
   */
  senderName?: string | undefined;
  /** Racine de l'API. Parametrable pour les tests, jamais en production. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maintenant?: () => number;
}

const BASE_DEFAUT = "https://api.orange.com";

/**
 * Marge de securite sur l'expiration du jeton, en secondes.
 *
 * Un jeton qui expire pendant le vol de la requete produit un 401 que rien
 * n'explique et qui ne se reproduit pas. Soixante secondes couvrent largement un
 * aller-retour depuis l'Europe.
 */
const MARGE_EXPIRATION_S = 60;

/** `+237677000001` → `tel:+237677000001`, la forme attendue par l'API. */
export function adresseTel(numero: string): string {
  const net = numero.trim();
  return net.startsWith("tel:") ? net : `tel:${net}`;
}

/**
 * Le chemin d'envoi, avec le numero emetteur **encode**.
 *
 * `tel:+237…` contient deux caracteres reserves dans un segment d'URL — `:` et
 * `+` — qui deviennent `%3A` et `%2B`. Les laisser tels quels produit un 404 ou
 * un envoi vers un emetteur inconnu, selon l'humeur du serveur.
 */
export function cheminEnvoi(baseUrl: string, senderAddress: string): string {
  const encode = encodeURIComponent(adresseTel(senderAddress));
  return `${baseUrl.replace(/\/$/, "")}/smsmessaging/v1/outbound/${encode}/requests`;
}

export class OrangeSmsSender implements SmsSender {
  readonly name = "orange-sms-cm";

  readonly #cfg: OrangeSmsConfig;
  readonly #fetch: typeof fetch;
  readonly #maintenant: () => number;
  readonly #baseUrl: string;

  /** Jeton en cache, avec l'instant (en ms) au-dela duquel il ne vaut plus. */
  #jeton: { valeur: string; expireA: number } | null = null;

  constructor(cfg: OrangeSmsConfig) {
    const manquants = (["clientId", "clientSecret", "senderAddress"] as const).filter(
      (k) => !cfg[k],
    );
    if (manquants.length) {
      throw new Error(
        `Configuration Orange SMS incomplete : ${manquants.join(", ")}. ` +
          "Voir .env.example, section « fournisseur SMS ».",
      );
    }
    this.#cfg = cfg;
    this.#fetch = cfg.fetchImpl ?? globalThis.fetch;
    this.#maintenant = cfg.maintenant ?? (() => Date.now());
    this.#baseUrl = (cfg.baseUrl ?? BASE_DEFAUT).replace(/\/$/, "");
  }

  /* ────────────────────────── OAuth ────────────────────────── */

  async #jetonValide(): Promise<string> {
    const t = this.#maintenant();
    if (this.#jeton && t < this.#jeton.expireA) return this.#jeton.valeur;

    /**
     * `Basic base64(clientId:clientSecret)`. Orange appelle cela l'« en-tete
     * d'autorisation » et le donne tout fait dans la console ; on le
     * reconstruit, pour n'avoir que deux secrets a poser et pas trois formes du
     * meme.
     */
    const basic = Buffer.from(`${this.#cfg.clientId}:${this.#cfg.clientSecret}`).toString("base64");

    const r = await this.#fetch(`${this.#baseUrl}/oauth/v3/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });

    if (!r.ok) {
      // Le corps d'erreur n'est PAS recopie : il peut refleter l'en-tete
      // d'autorisation envoye, donc le secret.
      throw new Error(`Orange : authentification refusee (HTTP ${r.status}).`);
    }

    const corps = (await r.json()) as { access_token?: string; expires_in?: string | number };
    if (!corps.access_token) throw new Error("Orange : reponse d'authentification sans jeton.");

    const duree = Number(corps.expires_in);
    const secondes = Number.isFinite(duree) && duree > 0 ? duree : 3600;
    this.#jeton = {
      valeur: corps.access_token,
      expireA: t + Math.max(1, secondes - MARGE_EXPIRATION_S) * 1000,
    };
    return this.#jeton.valeur;
  }

  /* ────────────────────────── envoi ────────────────────────── */

  async send(message: SmsMessage): Promise<void> {
    const jeton = await this.#jetonValide();

    const r = await this.#fetch(cheminEnvoi(this.#baseUrl, this.#cfg.senderAddress), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jeton}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        outboundSMSMessageRequest: {
          address: adresseTel(message.to),
          senderAddress: adresseTel(this.#cfg.senderAddress),
          ...(this.#cfg.senderName ? { senderName: this.#cfg.senderName } : {}),
          outboundSMSTextMessage: { message: message.text },
        },
      }),
    });

    if (!r.ok) {
      /**
       * **Le message d'erreur ne porte ni le texte, ni le code, ni le numero
       * complet.** Il remonte jusqu'au journal du serveur, et un OTP dans un
       * journal est un OTP compromis. L'etiquette `kind` suffit a savoir quel
       * parcours a echoue.
       */
      throw new Error(`Orange : envoi refuse (HTTP ${r.status}) pour ${message.kind}.`);
    }
  }
}
