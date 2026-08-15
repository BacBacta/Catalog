/**
 * Lecture des entrees du bot depuis une livraison entrante Meta — ADR 0031.
 *
 * Meme posture defensive que `lireMessagesEntrants` (ADR 0027) : un corps
 * difforme rend une liste vide, jamais une levee — une livraison qui plante
 * est relivree, et une relivraison en boucle est une panne. Mais la ou le
 * parseur des defis ne lit que le texte, celui-ci comprend les reponses
 * interactives : l'IDENTIFIANT d'un bouton ou d'une ligne de liste, pose a
 * l'envoi, est ce qui route la conversation. Le libelle, tronque ou reformule
 * par le client WhatsApp, ne route jamais rien.
 */

/**
 * `messageId` est le wamid du message ENTRANT — ce qui permet d'y REAGIR et
 * de le CITER (ADR 0035, P1) : l'accuse posé sur la photo meme, le verdict
 * qui cite le SMS. Facultatif : une livraison sans identifiant reste lue.
 */
/**
 * Les formes que le bot ne sait PAS traiter, mais qu'il doit reconnaitre —
 * ADR 0049. Le vocal vient en tete : c'est le geste le plus naturel d'une
 * vendeuse qui tape lentement, et c'etait la sortie muette du produit.
 */
export type FormeNonLue =
  | "vocal"
  | "video"
  | "document"
  | "sticker"
  | "localisation"
  | "contact"
  | "inconnue";

/** Ce que Meta nomme, et ce que nous en disons. */
const FORMES: Record<string, FormeNonLue> = {
  audio: "vocal",
  video: "video",
  document: "document",
  sticker: "sticker",
  /* `location` reste ici : une localisation SANS coordonnees exploitables
     retombe sur la forme non lue plutot que de devenir un faux point. */
  location: "localisation",
  contacts: "contact",
};

/**
 * Les types qui ne sont PAS des questions, et auxquels on ne repond donc
 * jamais. Repondre « je ne sais pas lire ca » a un 👍 est pire que le
 * silence : c'est un reproche adresse a quelqu'un qui vient d'approuver.
 */
const SANS_REPONSE = new Set(["reaction", "system", "ephemeral", "order"]);

export type EntreeBot =
  | { de: string; genre: "texte"; texte: string; messageId?: string }
  | { de: string; genre: "bouton"; id: string; messageId?: string }
  | { de: string; genre: "liste"; id: string; messageId?: string }
  /**
   * Une PHOTO — ADR 0034. C'est le geste le plus naturel du canal : une
   * vendeuse photographie l'article qu'elle a en main. On ne retient que
   * l'identifiant du media et sa legende ; les octets se telechargent
   * ailleurs, et n'entrent jamais dans l'etat de conversation.
   */
  | { de: string; genre: "image"; mediaId: string; legende?: string; messageId?: string }
  /**
   * UN POINT sur la carte — sprint « le bot devient une application ».
   *
   * On ne retient que les deux coordonnees. Meta joint parfois un `name` et
   * une `address` saisis par l'expediteur : ils ne sont PAS lus, et c'est
   * l'ADR 0005 qui l'exige — il n'existe pas d'adresse au Cameroun, et un
   * champ d'adresse qui entre par la fenetre reste un champ d'adresse.
   */
  | { de: string; genre: "localisation"; lat: number; lng: number; messageId?: string }
  /**
   * Une forme que le bot ne sait pas traiter — ADR 0049. Elle est lue POUR
   * pouvoir repondre : le silence est la pire des reponses sur un canal ou
   * l'absence de reponse veut dire panne. Aucun contenu n'est retenu, pas
   * meme un identifiant de media : on ne lit pas ce qu'on ne sait pas lire.
   */
  | { de: string; genre: "autre"; forme: FormeNonLue; messageId?: string }
  /**
   * La reponse d'un Flow — ADR 0055. Le contenu voyage BRUT : c'est le
   * domaine qui le lit, pas le parseur, qui reste du texte vers des donnees.
   */
  | { de: string; genre: "flux"; reponse: string; messageId?: string };

export function lireEntreesBot(corps: unknown): EntreeBot[] {
  const sortie: EntreeBot[] = [];
  /**
   * DEUX formes de livraison, toutes deux mesurees le 02/08/2026 :
   * - l'enveloppe Cloud API (`entry[].changes[].value.messages[]`) — Meta
   *   directe et production 360dialog ;
   * - la forme PLATE v1 (`messages[]` a la racine) — le sandbox 360dialog.
   * Le parseur lit les deux ; tout le reste du bot n'en sait rien.
   */
  const paquets: unknown[] = [];
  const racine = corps as { entry?: unknown; messages?: unknown } | null;
  if (Array.isArray(racine?.messages)) paquets.push(racine.messages);
  if (Array.isArray(racine?.entry)) {
    for (const entree of racine.entry) {
      const changements = (entree as { changes?: unknown } | null)?.changes;
      if (!Array.isArray(changements)) continue;
      for (const changement of changements) {
        const messages = (changement as { value?: { messages?: unknown } } | null)?.value?.messages;
        if (Array.isArray(messages)) paquets.push(messages);
      }
    }
  }
  for (const messages of paquets as unknown[][]) {
    for (const message of messages) {
      const m = message as {
        from?: unknown;
        id?: unknown;
        type?: unknown;
        text?: { body?: unknown };
        image?: { id?: unknown; caption?: unknown };
        location?: { latitude?: unknown; longitude?: unknown };
        interactive?: {
          type?: unknown;
          button_reply?: { id?: unknown };
          list_reply?: { id?: unknown };
          nfm_reply?: { response_json?: unknown };
        };
      } | null;
      if (typeof m?.from !== "string") continue;
      const messageId = typeof m.id === "string" && m.id ? { messageId: m.id } : {};

      if (m.type === "text" && typeof m.text?.body === "string") {
        sortie.push({ de: m.from, genre: "texte", texte: m.text.body, ...messageId });
        continue;
      }
      if (m.type === "image" && typeof m.image?.id === "string") {
        sortie.push({
          de: m.from,
          genre: "image",
          mediaId: m.image.id,
          ...(typeof m.image.caption === "string" ? { legende: m.image.caption } : {}),
          ...messageId,
        });
        continue;
      }
      /**
       * La position — lue POUR de bon, la ou elle n'etait qu'une « forme non
       * traitee ». `deliverySchema` porte un `geo?` optionnel depuis le lot 7,
       * prevu et jamais alimente : c'est ce chemin-la qui manquait.
       *
       * Les deux coordonnees sont EXIGEES et doivent etre finies. Zero degre
       * de latitude est un point REEL — le golfe de Guinee, a 300 km de
       * Douala : une coordonnee absente ne devient jamais un 0, elle retombe
       * sur la forme non lue.
       */
      if (m.type === "location") {
        const lat = m.location?.latitude;
        const lng = m.location?.longitude;
        if (
          typeof lat === "number" &&
          Number.isFinite(lat) &&
          typeof lng === "number" &&
          Number.isFinite(lng)
        ) {
          sortie.push({ de: m.from, genre: "localisation", lat, lng, ...messageId });
          continue;
        }
        /* Coordonnees inexploitables : rien n'est retenu, et la suite traite
           le message comme une forme non lue. */
      }

      if (m.type === "interactive") {
        const i = m.interactive;
        if (i?.type === "button_reply" && typeof i.button_reply?.id === "string") {
          sortie.push({ de: m.from, genre: "bouton", id: i.button_reply.id, ...messageId });
        } else if (i?.type === "list_reply" && typeof i.list_reply?.id === "string") {
          sortie.push({ de: m.from, genre: "liste", id: i.list_reply.id, ...messageId });
        } else if (i?.type === "nfm_reply" && typeof i.nfm_reply?.response_json === "string") {
          /* La reponse d'un Flow — ADR 0055. */
          sortie.push({
            de: m.from,
            genre: "flux",
            reponse: i.nfm_reply.response_json,
            ...messageId,
          });
        } else {
          /* Une reponse interactive d'une forme inedite — catalogue natif,
             carrousel — ne se perd pas en silence tant qu'elle n'est pas
             traitee. */
          sortie.push({ de: m.from, genre: "autre", forme: "inconnue", ...messageId });
        }
        continue;
      }

      /* Tout le reste — ADR 0049. Ce qui n'est pas une question ne recoit pas
         de reponse ; ce qui en est une en recoit toujours une, meme si c'est
         pour dire qu'on ne sait pas encore la lire. */
      if (typeof m.type === "string" && !SANS_REPONSE.has(m.type)) {
        sortie.push({
          de: m.from,
          genre: "autre",
          forme: FORMES[m.type] ?? "inconnue",
          ...messageId,
        });
      }
      /* Depuis l'ADR 0049, plus rien n'est ignore en silence : le parseur
         NOMME la forme, et chaque fil decide de la reponse. */
    }
  }
  return sortie;
}

/* ────────────────────────── les statuts d'envoi ─────────────────────────── */

/**
 * Un statut de livraison SORTANTE, renvoye par Meta — ADR 0091.
 *
 * `entry[].changes[].value.statuses[]` n'etait cueilli nulle part : un envoi
 * accepte en HTTP 200 puis refuse APRES COUP (numero bloque, fenetre fermee
 * constatee cote Meta, code 131047) etait invisible. On LIT, on ne reagit
 * pas : voir est la decision de la v1 — reagir en serait une autre.
 *
 * Meme posture defensive que `lireEntreesBot` : un corps difforme rend une
 * liste vide, jamais une levee.
 */
export interface StatutEnvoi {
  /** Le wamid du message SORTANT concerne. */
  messageId: string;
  statut: "sent" | "delivered" | "read" | "failed";
  /** Les codes d'erreur Meta, entiers — presents surtout sur `failed`. */
  codes: number[];
}

const STATUTS_CONNUS = new Set(["sent", "delivered", "read", "failed"]);

export function lireStatutsEnvoi(corps: unknown): StatutEnvoi[] {
  const sortie: StatutEnvoi[] = [];
  const paquets: unknown[] = [];
  const racine = corps as { entry?: unknown; statuses?: unknown } | null;
  /* La forme plate du sandbox, par parite avec les messages. */
  if (Array.isArray(racine?.statuses)) paquets.push(racine.statuses);
  if (Array.isArray(racine?.entry)) {
    for (const entree of racine.entry) {
      const changements = (entree as { changes?: unknown } | null)?.changes;
      if (!Array.isArray(changements)) continue;
      for (const changement of changements) {
        const statuses = (changement as { value?: { statuses?: unknown } } | null)?.value?.statuses;
        if (Array.isArray(statuses)) paquets.push(statuses);
      }
    }
  }
  for (const statuses of paquets as unknown[][]) {
    for (const brut of statuses) {
      const s = brut as {
        id?: unknown;
        status?: unknown;
        errors?: unknown;
      } | null;
      if (!s || typeof s.id !== "string" || typeof s.status !== "string") continue;
      if (!STATUTS_CONNUS.has(s.status)) continue;
      const codes = Array.isArray(s.errors)
        ? s.errors
            .map((e) => (e as { code?: unknown } | null)?.code)
            .filter((c): c is number => typeof c === "number" && Number.isInteger(c))
        : [];
      sortie.push({ messageId: s.id, statut: s.status as StatutEnvoi["statut"], codes });
    }
  }
  return sortie;
}
