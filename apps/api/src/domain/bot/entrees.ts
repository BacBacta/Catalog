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

export type EntreeBot =
  | { de: string; genre: "texte"; texte: string }
  | { de: string; genre: "bouton"; id: string }
  | { de: string; genre: "liste"; id: string }
  /**
   * Une PHOTO — ADR 0034. C'est le geste le plus naturel du canal : une
   * vendeuse photographie l'article qu'elle a en main. On ne retient que
   * l'identifiant du media et sa legende ; les octets se telechargent
   * ailleurs, et n'entrent jamais dans l'etat de conversation.
   */
  | { de: string; genre: "image"; mediaId: string; legende?: string };

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
        type?: unknown;
        text?: { body?: unknown };
        image?: { id?: unknown; caption?: unknown };
        interactive?: {
          type?: unknown;
          button_reply?: { id?: unknown };
          list_reply?: { id?: unknown };
        };
      } | null;
      if (typeof m?.from !== "string") continue;

      if (m.type === "text" && typeof m.text?.body === "string") {
        sortie.push({ de: m.from, genre: "texte", texte: m.text.body });
        continue;
      }
      if (m.type === "image" && typeof m.image?.id === "string") {
        sortie.push({
          de: m.from,
          genre: "image",
          mediaId: m.image.id,
          ...(typeof m.image.caption === "string" ? { legende: m.image.caption } : {}),
        });
        continue;
      }
      if (m.type === "interactive") {
        const i = m.interactive;
        if (i?.type === "button_reply" && typeof i.button_reply?.id === "string") {
          sortie.push({ de: m.from, genre: "bouton", id: i.button_reply.id });
        } else if (i?.type === "list_reply" && typeof i.list_reply?.id === "string") {
          sortie.push({ de: m.from, genre: "liste", id: i.list_reply.id });
        }
      }
      /* stickers, audios, accuses : ignores ici — le service peut
         repondre un message d'aide, mais ce n'est pas le travail du parseur. */
    }
  }
  return sortie;
}
