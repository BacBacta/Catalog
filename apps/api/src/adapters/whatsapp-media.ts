import type { LecteurMedia, MediaEntrant } from "../domain/bot/media.ts";
import { entetesAuth, type TransportWhatsapp } from "./whatsapp-transport.ts";

/**
 * Telechargement d'une photo entrante via 360dialog — ADR 0034, revise apres
 * le terrain du 02/08/2026 (ADR 0035).
 *
 * ── Ce que le terrain a etabli ─────────────────────────────────────────────
 *
 * **Le sandbox n'a PAS de medias.** Sa documentation le dit en toutes
 * lettres : ni televersement ni recuperation par media ID — il n'expose que
 * la configuration du relais entrant et `/v1/messages`. Une photo envoyee au
 * sandbox ne peut donc JAMAIS etre lue, et l'article se publie sans elle :
 * c'est le comportement voulu, pas une panne. Le chemin media ne se verifie
 * qu'avec un numero de test Meta ou en production.
 *
 * ── Deux formes, et une seule sonde pour les distinguer ────────────────────
 *
 * La Cloud API (production, `waba-v2`) procede en DEUX temps :
 *
 *   GET {base}/{media_id}      → JSON { url, mime_type, file_size, sha256 }
 *   GET {url reecrite}         → les octets ; l'URL vaut cinq minutes
 *
 * **L'URL du JSON pointe chez Meta (`lookaside.fbsbx.com`) et ne connait pas
 * notre cle** : la documentation 360dialog demande de REMPLACER son hote par
 * celui de l'API, chemin et parametres conserves, puis de presenter
 * `D360-API-KEY`. La suivre telle quelle echoue — c'est le defaut que le
 * diagnostic du 02/08/2026 a mis au jour.
 *
 * L'API v1 (on-premise) rend les octets DIRECTEMENT sur `GET /v1/media/{id}` ;
 * on la tente en second. Toujours pas verifiee sur un vrai on-premise
 * (AGENTS.md §7.7) — et jamais verifiable sur le sandbox, voir ci-dessus.
 *
 * ── Ce qui ne sort jamais d'ici ────────────────────────────────────────────
 *
 * Aucun corps d'erreur n'est recopie dans une exception ou une trace, et
 * aucune photo ne l'est evidemment : meme regle que l'envoyeur (ADR 0023).
 * Un echec rend `null`, jamais une levee — une photo qu'on ne sait pas lire
 * est un message d'aide a la vendeuse, pas une panne.
 */

export interface LecteurMediaConfig {
  apiKey: string;
  baseUrl: string;
  transport: TransportWhatsapp;
  /**
   * Plafond d'octets acceptes. Le pipeline d'images a le sien
   * (`IMAGE_TAILLE_MAX_OCTETS`) ; celui-ci arrete la LECTURE avant de remplir
   * la memoire avec ce qu'on refusera ensuite.
   */
  tailleMax?: number;
  fetchImpl?: typeof fetch | undefined;
}

const TAILLE_MAX_DEFAUT = 16 * 1024 * 1024; // la borne de Meta pour une image.

export class LecteurMediaWhatsapp implements LecteurMedia {
  /* Le nom part dans les traces : le figer a « 360dialog » ferait mentir
     le journal du jour ou on diagnostique un envoi passe par Meta. */
  readonly nom: string;

  readonly #cfg: LecteurMediaConfig;
  readonly #fetch: typeof fetch;

  constructor(cfg: LecteurMediaConfig) {
    if (!cfg.apiKey || !cfg.baseUrl) {
      throw new Error(
        "Lecteur de media WhatsApp incomplet : WABOT_API_KEY et WABOT_BASE_URL sont exigees. " +
          "Voir .env.example, section « bot WhatsApp ».",
      );
    }
    this.nom = cfg.transport;
    this.#cfg = cfg;
    this.#fetch = cfg.fetchImpl ?? fetch;
  }

  async lire(mediaId: string): Promise<MediaEntrant | null> {
    if (!/^[\w.-]{1,256}$/.test(mediaId)) return null;
    const base = this.#cfg.baseUrl.replace(/\/$/, "");
    const entetes = entetesAuth(this.#cfg.transport, this.#cfg.apiKey);

    try {
      /* Forme Cloud d'abord ({base}/{id}). La forme v1 ({base}/media/{id}) est
         une particularite on-premise de 360dialog : chez Meta elle rendrait un
         404 sur un identifiant qui n'existe pas, et le repli n'a aucun sens. */
      let premiere = await this.#fetch(`${base}/${mediaId}`, { headers: entetes });
      if (!premiere.ok) {
        if (this.#cfg.transport === "meta") return null;
        premiere = await this.#fetch(`${base}/media/${mediaId}`, { headers: entetes });
        if (!premiere.ok) return null;
      }

      const type = premiere.headers.get("content-type") ?? "";
      if (!type.includes("json")) {
        /* Forme v1 : les octets, tout de suite. NON VERIFIEE (voir l'en-tete). */
        return await this.#octets(premiere, type);
      }

      const meta = (await premiere.json().catch(() => null)) as {
        url?: unknown;
        mime_type?: unknown;
      } | null;
      if (typeof meta?.url !== "string") return null;

      /**
       * Le second temps, et le SEUL endroit ou les deux transports divergent
       * vraiment.
       *
       * Chez **360dialog**, l'URL rendue pointe chez Meta (`lookaside.fbsbx.com`)
       * et ne connait pas notre cle : leur documentation demande d'en REMPLACER
       * l'hote par celui de l'API, chemin et parametres conserves, puis de
       * presenter `D360-API-KEY`. La suivre telle quelle echoue — c'est le
       * defaut du 02/08/2026.
       *
       * Chez **Meta**, la meme reecriture CASSERAIT le telechargement :
       * `lookaside.fbsbx.com` accepte le jeton porteur, et l'envoyer vers
       * `graph.facebook.com` rendrait un chemin qui n'existe pas. L'URL se suit
       * telle quelle.
       *
       * Une seule ligne de difference, et elle est invisible tant qu'on ne teste
       * qu'un des deux chemins.
       */
      const telechargement =
        this.#cfg.transport === "meta" ? meta.url : this.#reecrireHote(meta.url, base);

      const seconde = await this.#fetch(telechargement, { headers: entetes });
      if (!seconde.ok) return null;
      return await this.#octets(
        seconde,
        typeof meta.mime_type === "string"
          ? meta.mime_type
          : (seconde.headers.get("content-type") ?? ""),
      );
    } catch {
      /* Reseau coupe, TLS refuse, corps difforme : pas de photo, pas de panne. */
      return null;
    }
  }

  /** La regle 360dialog : meme chemin, meme parametres, notre hote. */
  #reecrireHote(url: string, base: string): string {
    const cible = new URL(url);
    const notre = new URL(base);
    return `${notre.origin}${cible.pathname}${cible.search}`;
  }

  async #octets(reponse: Response, typeAnnonce: string): Promise<MediaEntrant | null> {
    const max = this.#cfg.tailleMax ?? TAILLE_MAX_DEFAUT;
    /* La longueur annoncee est un premier filtre — pas une garantie : le corps
       est ensuite mesure pour de bon. */
    const annoncee = Number(reponse.headers.get("content-length") ?? "0");
    if (Number.isFinite(annoncee) && annoncee > max) return null;

    const tampon = new Uint8Array(await reponse.arrayBuffer());
    if (tampon.byteLength === 0 || tampon.byteLength > max) return null;
    return { octets: tampon, typeAnnonce: typeAnnonce.split(";")[0]?.trim() ?? "" };
  }
}
