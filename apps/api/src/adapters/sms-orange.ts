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
 * **Les deux partagent le MEME chemin technique** — `/smsmessaging/v1/outbound/`
 * — et la meme documentation. Il y a donc DEUX facons de se retrouver en
 * « Orange seulement », et une seule est dans ce fichier :
 *
 * 1. **le parametre de requete** `?resource_type_parameter_management=SMS_OCB2`.
 *    Cet adaptateur ne le pose JAMAIS, et un test le verifie ;
 * 2. **la souscription de l'application**, choisie dans la console Orange —
 *    `addapi/sms-cm` ou `addapi/sms-onnet-cm`. **Ce code ne peut pas la voir ni
 *    la contraindre.** Des identifiants issus d'une application souscrite a
 *    l'offre « Orange Only » enverraient en Orange seul, et tous les tests de ce
 *    depot passeraient quand meme.
 *
 * Le point 2 est donc une verification de COMPTE, pas de code : elle vit dans
 * `docs/runbooks/checklist-lancement.md`. La dire ici plutot que de laisser
 * croire que le test suffit.
 *
 * Pourquoi tant d'insistance : une vendeuse sur trois est chez MTN. Si l'envoi
 * devenait « Orange seulement », elles ne recevraient plus leur code de
 * connexion — et **rien ne le dirait**. L'API repondrait, le compteur d'envois
 * monterait, et le seul signe serait des vendeuses qui n'arrivent plus a entrer
 * et qui n'appellent pas. C'est exactement la panne silencieuse que
 * `sms-provider.ts` decrit : « une passerelle qui accepte le message puis ne le
 * delivre pas est le cas courant, et il ne se voit pas depuis un code 200 ».
 *
 * Le seul controle possible est une MESURE : envoyer a un numero MTN et a un
 * numero Orange, et regarder ce qui arrive. C'est la premiere ligne du protocole
 * de terrain.
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
 * DEMANDE ; un `send()` qui se termine sans lever veut donc dire « accepte par
 * Orange », jamais « arrive chez la vendeuse ».
 *
 * L'ecart entre les deux n'est pas theorique : c'est le cas courant que
 * `sms-provider.ts` decrit — « une passerelle qui accepte le message puis ne le
 * delivre pas […] ne se voit pas depuis un code HTTP 200 ».
 *
 * **L'accuse de livraison comble cet ecart**, et il est branche : `accuseUrl`
 * ci-dessous, la route `POST /api/sms/accuse/:secret`, et le compteur
 * `catalog.sms.livraison` ventile par operateur.
 *
 * C'est aussi le SEUL controle automatique du point 2 plus haut. Si les numeros
 * en 67 et 68 ne sont jamais livres alors que ceux en 69 le sont toujours, la
 * souscription est fausse — et on le sait avant qu'une vendeuse MTN n'ait
 * renonce a se connecter.
 *
 * Une nuance a ne pas perdre : `DeliveryImpossible` **n'est pas une preuve de
 * non-delivrance** — un telephone eteint plus de 24 h produit le meme statut.
 * L'interpretation vit dans `domain/sms/livraison.ts`, qui ne tient qu'une seule
 * valeur pour certaine.
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
  /**
   * L'URL que Orange rappellera avec l'accuse de livraison, secret compris.
   *
   * ── Deux facons de la declarer, et il faut savoir laquelle marche ────────
   *
   * La documentation Orange demande de faire inscrire l'URL sur une LISTE
   * BLANCHE, par un formulaire, hors API. La norme dont cette API derive prevoit
   * en plus un `receiptRequest` par message, que l'adaptateur pose ci-dessous.
   *
   * **Les deux n'ont pas ete verifiees sur un vrai compte**, faute d'en avoir
   * un : c'est marque comme tel dans la checklist de lancement plutot que
   * presente comme acquis. Si seule la liste blanche fonctionne, ce champ est
   * sans effet et le rappel arrive quand meme — rien ne casse.
   *
   * Absente, aucun `receiptRequest` n'est pose et rien ne change.
   */
  accuseUrl?: string | undefined;
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
          /**
           * L'accuse de livraison. `callbackData` porte l'ETIQUETTE du message
           * — `otp_connexion` — et rien d'autre : **jamais le code, jamais le
           * numero**. Cette valeur revient telle quelle dans le rappel, qui
           * n'est ni chiffre ni signe ; y mettre un OTP reviendrait a le publier.
           */
          ...(this.#cfg.accuseUrl
            ? {
                receiptRequest: {
                  notifyURL: this.#cfg.accuseUrl,
                  callbackData: message.kind,
                },
              }
            : {}),
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
