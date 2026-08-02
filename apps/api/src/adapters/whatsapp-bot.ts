import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";

/**
 * Envoi des messages du bot via 360dialog — ADR 0031.
 *
 * Le format des corps est EXACTEMENT celui de la Cloud API de Meta ; 360dialog
 * ne change que deux choses : l'hote, et l'authentification par en-tete
 * `D360-API-KEY`. Le jour d'un passage en Meta directe, seul cet adaptateur
 * bouge — le domaine ne sait pas qui transporte.
 *
 *   POST {base}/messages
 *   En-tete : D360-API-KEY: xxxx
 *   Corps   : le message tel que construit par domain/bot/messages.ts
 *
 * La BASE n'a pas de defaut. Sandbox (waba-sandbox.360dialog.io) et production
 * (waba-v2.360dialog.io) acceptent les memes corps avec des cles differentes :
 * un defaut silencieux enverrait un jour des messages de test a de vraies
 * acheteuses, ou l'inverse. La variable est exigee avec la cle.
 */

export interface WhatsappBotConfig {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch | undefined;
}

export class EnvoyeurWhatsappBot implements EnvoyeurBot {
  readonly nom = "360dialog";

  readonly #cfg: WhatsappBotConfig;
  readonly #fetch: typeof fetch;

  constructor(cfg: WhatsappBotConfig) {
    /* Le garde leve a la construction — meme lecon que MboaSMS (ADR 0026) :
       mieux vaut un service qui refuse de demarrer qu'un bot qui ecoute sans
       pouvoir repondre. Le message nomme les variables d'environnement. */
    if (!cfg.apiKey) {
      throw new Error(
        "Configuration du bot WhatsApp incomplete. Variable absente : WABOT_API_KEY. " +
          "Voir .env.example, section « bot WhatsApp ».",
      );
    }
    if (!cfg.baseUrl) {
      throw new Error(
        "Configuration du bot WhatsApp incomplete. Variable absente : WABOT_BASE_URL " +
          "(sandbox et production n'ont pas de defaut, deliberement). " +
          "Voir .env.example, section « bot WhatsApp ».",
      );
    }
    this.#cfg = cfg;
    this.#fetch = cfg.fetchImpl ?? fetch;
  }

  async envoyer(message: MessageSortant): Promise<void> {
    const url = `${this.#cfg.baseUrl.replace(/\/$/, "")}/messages`;
    const reponse = await this.#fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": this.#cfg.apiKey,
      },
      body: JSON.stringify(message),
    });

    /**
     * Un HTTP 200 sans identifiant de message n'est pas un envoi — meme regle
     * que MboaSMS. Le corps d'erreur n'est JAMAIS recopie dans l'exception :
     * il peut refleter des en-tetes ou du contenu de conversation, et nos
     * traces ne portent pas ca (ADR 0023).
     */
    if (!reponse.ok) {
      throw new Error(`envoi bot refuse : HTTP ${reponse.status}`);
    }
    const corps = (await reponse.json().catch(() => null)) as {
      messages?: Array<{ id?: unknown }>;
    } | null;
    if (typeof corps?.messages?.[0]?.id !== "string") {
      throw new Error("envoi bot sans identifiant de message : non confirme");
    }
  }
}
