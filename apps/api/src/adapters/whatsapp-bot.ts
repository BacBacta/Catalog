import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { AccuseLecture, MessageSortant } from "../domain/bot/messages.ts";
import { fetchBorne } from "./fetch-borne.ts";
import { entetesAuth, type TransportWhatsapp } from "./whatsapp-transport.ts";

/**
 * Envoi des messages du bot — ADR 0031, revise par l'ADR 0046.
 *
 * Le format des corps est EXACTEMENT celui de la Cloud API de Meta, quel que
 * soit le transport : le domaine ne sait pas qui porte ses messages.
 *
 *   360dialog   POST {base}/messages              D360-API-KEY: xxxx
 *   Meta        POST {base}/{idNumero}/messages   Authorization: Bearer xxxx
 *
 * La difference de CHEMIN vient de Meta : chez lui, le numero emetteur est un
 * segment d'URL, pas une donnee du corps. Chez 360dialog, la cle designe deja
 * le canal — il n'y a rien a nommer.
 *
 * La BASE n'a pas de defaut. Sandbox (waba-sandbox.360dialog.io), production
 * (waba-v2.360dialog.io) et Meta (graph.facebook.com) acceptent les memes
 * corps avec des cles differentes : un defaut silencieux enverrait un jour des
 * messages de test a de vraies acheteuses, ou l'inverse. La variable est
 * exigee avec la cle.
 */

export interface WhatsappBotConfig {
  apiKey: string;
  baseUrl: string;
  transport: TransportWhatsapp;
  /** Exige par Meta seul : le numero emetteur y est un segment d'URL. */
  phoneNumberId?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  /** Pause avant l'unique reessai (ADR 0093). Les tests passent 0. */
  delaiReessaiMs?: number | undefined;
}

/** La pause par defaut avant le reessai : courte — l'acheteuse attend sa bulle. */
const DELAI_REESSAI_MS = 400;

/**
 * Un refus d'envoi, avec ce qu'il faut pour decider du reessai — ADR 0093.
 * `transitoire` : vrai sur un 5xx (l'etat de Meta, pas le notre), faux sur un
 * 4xx (le meme corps echouera pareil) et sur un 200 sans identifiant (le
 * message est peut-etre PARTI : reessayer risquerait la bulle en double).
 */
class ErreurEnvoi extends Error {
  readonly transitoire: boolean;
  constructor(message: string, transitoire: boolean) {
    super(message);
    this.name = "ErreurEnvoi";
    this.transitoire = transitoire;
  }
}

export class EnvoyeurWhatsappBot implements EnvoyeurBot {
  /* Le nom part dans les traces : le figer a « 360dialog » ferait mentir
     le journal du jour ou on diagnostique un envoi passe par Meta. */
  readonly nom: string;

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
    /* Meta refuse un envoi sans son numero emetteur dans le chemin. Le dire a
       la construction plutot que de decouvrir des HTTP 404 en production. */
    if (cfg.transport === "meta" && !cfg.phoneNumberId) {
      throw new Error(
        "Configuration du bot WhatsApp incomplete. Variable absente : " +
          "WHATSAPP_PHONE_NUMBER_ID, exigee par le transport « meta » — le numero " +
          "emetteur y est un segment d'URL. Voir .env.example, section « bot WhatsApp ».",
      );
    }
    this.nom = cfg.transport;
    this.#cfg = cfg;
    /* Borne : un appel du bot echoue ou finit, jamais « il attend ». */
    this.#fetch = fetchBorne(cfg.fetchImpl ?? fetch);
  }

  /**
   * L'accuse de lecture — ADR 0049. Meme route que les messages
   * (`POST /messages`), corps different : il designe un message recu au lieu
   * d'en composer un. De CONFORT : l'appelant l'ignore s'il echoue.
   */
  async accuser(accuse: AccuseLecture): Promise<void> {
    const base = this.#cfg.baseUrl.replace(/\/$/, "");
    const url =
      this.#cfg.transport === "meta"
        ? `${base}/${this.#cfg.phoneNumberId}/messages`
        : `${base}/messages`;
    const reponse = await this.#fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...entetesAuth(this.#cfg.transport, this.#cfg.apiKey),
      },
      body: JSON.stringify(accuse),
    });
    if (!reponse.ok) {
      const code = (
        (await reponse.json().catch(() => null)) as { error?: { code?: unknown } } | null
      )?.error?.code;
      throw new Error(
        `accuse de lecture refuse : HTTP ${reponse.status}${
          typeof code === "number" ? `, code Meta ${code}` : ""
        }`,
      );
    }
  }

  /**
   * L'envoi, avec UN reessai sur echec transitoire — ADR 0093, constat B5 de
   * l'audit 2026-08 : un 5xx Meta passager perdait definitivement une reponse
   * de conversation, et `termineLe` (ADR 0040) interdit — a raison — le
   * rattrapage par relivraison. Le reessai vit donc ICI, dans l'adaptateur,
   * ou l'on sait distinguer le transitoire du definitif.
   *
   * Un seul reessai, et sur transitoire seulement : un 4xx rejouerait le meme
   * refus, et une file de reessais differerait des bulles de conversation qui
   * n'ont de sens que tout de suite. Le reessai apres une panne RESEAU peut,
   * rarement, doubler une bulle deja partie — accepte et documente : une
   * bulle en double gene, un bot muet fait fuir.
   */
  async envoyer(message: MessageSortant): Promise<void> {
    try {
      return await this.#tenter(message);
    } catch (cause) {
      const transitoire = cause instanceof ErreurEnvoi ? cause.transitoire : true;
      if (!transitoire) throw cause;
      /* La raison se nomme : sans cette ligne, un reessai qui repare a chaque
         fois masquerait une degradation de Meta jusqu'a la panne complete. */
      console.warn(
        `envoi bot : reessai apres echec transitoire (${
          cause instanceof Error ? cause.message : "panne reseau"
        })`,
      );
      await new Promise((r) => setTimeout(r, this.#cfg.delaiReessaiMs ?? DELAI_REESSAI_MS));
      return await this.#tenter(message);
    }
  }

  async #tenter(message: MessageSortant): Promise<void> {
    const base = this.#cfg.baseUrl.replace(/\/$/, "");
    const url =
      this.#cfg.transport === "meta"
        ? `${base}/${this.#cfg.phoneNumberId}/messages`
        : `${base}/messages`;
    const reponse = await this.#fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...entetesAuth(this.#cfg.transport, this.#cfg.apiKey),
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
      /* Le code d'erreur Meta est un ENTIER (#131037 : « display name
         approval », etc.) : il nomme la cause sans porter une lettre de
         contenu, et il se journalise donc (ADR 0023 respecte). Le 07/08/2026,
         son absence a coute une heure de diagnostic a l'aveugle — tous les
         envois mouraient en silence sur un « HTTP 400 » muet. */
      const code = (
        (await reponse.json().catch(() => null)) as { error?: { code?: unknown } } | null
      )?.error?.code;
      throw new ErreurEnvoi(
        `envoi bot refuse : HTTP ${reponse.status}${
          typeof code === "number" ? `, code Meta ${code}` : ""
        }`,
        reponse.status >= 500,
      );
    }
    const corps = (await reponse.json().catch(() => null)) as {
      messages?: Array<{ id?: unknown }>;
    } | null;
    if (typeof corps?.messages?.[0]?.id !== "string") {
      throw new ErreurEnvoi("envoi bot sans identifiant de message : non confirme", false);
    }
  }
}
