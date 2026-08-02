import type { SmsMessage, SmsSender } from "../domain/sms-sender.ts";

/**
 * MboaSMS — passerelle camerounaise, agregateur des trois reseaux.
 *
 * Voir l'ADR 0026. Ce que cet adaptateur apporte que les autres n'apportaient
 * pas : **une livraison annoncee vers MTN, Orange ET Camtel** par une seule
 * integration. L'API SMS d'Orange ne dessert en pratique que ce que sa
 * souscription autorise, et le produit SMS de MTN n'est pas ouvert au catalogue
 * camerounais — il ne couvrirait de toute facon que ses propres abonnes.
 *
 * ── Forme de l'API ────────────────────────────────────────────────────────
 *
 *   POST {base}/api/v1/developer/sms/send-otp    codes de verification
 *   POST {base}/api/v1/developer/sms/send        le reste
 *   En-tete : X-API-Key: mboa_xxxx
 *   Corps   : { phoneNumbers: string[], message: string, senderId?: string }
 *
 * Deux points de conception qui ne sont pas des details :
 *
 * **On vise `send-otp` pour les codes.** La documentation le recommande pour la
 * 2FA et annonce facturation et format de reponse identiques. Un point d'entree
 * dedie est ce qui permet a une passerelle de prioriser une file, et c'est
 * exactement ce qu'on veut pour un code que la vendeuse attend, ecran allume.
 *
 * **On envoie un seul numero a la fois**, bien que le champ soit un tableau. Un
 * OTP est nominatif ; grouper des destinataires ferait porter a un echec partiel
 * la responsabilite de dire QUI n'a pas recu. Voir `#verifier`.
 */

export interface MboaConfig {
  apiKey: string;
  /** Facultatif : a defaut, la passerelle utilise l'identifiant du compte. */
  senderId?: string | undefined;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

const BASE_PAR_DEFAUT = "https://api.mboasms.com";

/** Les codes vont sur le point d'entree dedie ; le reste sur l'envoi ordinaire. */
const EST_UN_CODE: Record<SmsMessage["kind"], boolean> = {
  otp_connexion: true,
  otp_reversement: true,
  rappel_solde: false,
  expiration: false,
};

export function cheminMboa(baseUrl: string, kind: SmsMessage["kind"]): string {
  const suffixe = EST_UN_CODE[kind] ? "send-otp" : "send";
  return `${baseUrl.replace(/\/$/, "")}/api/v1/developer/sms/${suffixe}`;
}

export class MboaSmsSender implements SmsSender {
  readonly name = "mboasms";

  readonly #cfg: MboaConfig;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(cfg: MboaConfig) {
    /**
     * Le garde leve a la CONSTRUCTION, donc a l'import du serveur.
     *
     * C'est deliberement brutal, et c'est la lecon du 01/08/2026 : une
     * passerelle qui accepte un message mal configure sans le delivrer produit
     * une panne invisible, ou la vendeuse reste devant un champ qu'elle ne
     * pourra jamais remplir. Mieux vaut un service qui refuse de demarrer.
     *
     * Le message nomme la variable d'environnement absente, pas le champ de
     * configuration : c'est ce que l'operateur peut corriger.
     */
    if (!cfg.apiKey) {
      throw new Error(
        "Configuration MboaSMS incomplete. Variable absente : MBOA_API_KEY. " +
          "Voir .env.example, section « mboasms ».",
      );
    }
    this.#cfg = cfg;
    this.#baseUrl = cfg.baseUrl || BASE_PAR_DEFAUT;
    this.#fetch = cfg.fetchImpl ?? fetch;
  }

  async send(message: SmsMessage): Promise<void> {
    const r = await this.#fetch(cheminMboa(this.#baseUrl, message.kind), {
      method: "POST",
      headers: {
        "X-API-Key": this.#cfg.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        phoneNumbers: [message.to],
        message: message.text,
        ...(this.#cfg.senderId ? { senderId: this.#cfg.senderId } : {}),
      }),
    });

    if (!r.ok) {
      /**
       * Le corps d'erreur n'est PAS recopie : une passerelle qui echoue
       * renvoie couramment la requete refusee, donc le texte du message, donc
       * l'OTP. Meme regle que pour Orange et Meta.
       */
      throw new Error(`MboaSMS : envoi refuse (HTTP ${r.status}).`);
    }

    await this.#verifier(r);
  }

  /**
   * **HTTP 200 ne suffit pas.**
   *
   * C'est la lecon la plus chere de la journee du 01/08/2026 : l'API SMS
   * d'Orange a rendu 201 sur six envois dont AUCUN n'est arrive, y compris sur
   * une adresse d'expediteur au format invalide. Un code de succes n'atteste
   * que la reception de la requete par une facade.
   *
   * MboaSMS rend `{ success, totalRecipients }`. On exige les deux : le drapeau
   * vrai, et au moins un destinataire retenu. Une passerelle qui accepte la
   * requete puis retient zero numero est le cas d'echec partiel que
   * `sms-provider.ts` demandait de trancher avant d'ecrire cet adaptateur.
   *
   * Ce qui reste NON RESOLU et doit etre dit : la documentation n'expose ni
   * rappel de livraison, ni rapport de remise. Une acceptation ici ne prouve
   * donc toujours pas une reception. Voir l'ADR 0026, section « ce qu'on ne
   * saura pas ».
   */
  async #verifier(r: Response): Promise<void> {
    const corps = (await r.json().catch(() => null)) as {
      success?: boolean;
      totalRecipients?: number;
    } | null;

    if (corps?.success !== true) {
      throw new Error("MboaSMS : la passerelle a repondu sans confirmer l'envoi.");
    }
    if (typeof corps.totalRecipients === "number" && corps.totalRecipients < 1) {
      throw new Error("MboaSMS : la passerelle n'a retenu aucun destinataire.");
    }
  }
}
