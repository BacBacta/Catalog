/**
 * Constructeurs des messages sortants du bot — ADR 0031.
 *
 * Le format est celui de la Cloud API de Meta, que 360dialog expose tel quel.
 * Les LIMITES de l'API sont tenues ici et testees : un depassement au moment
 * de l'envoi serait un refus HTTP silencieux pour l'acheteuse.
 *
 * Deux familles de textes, deux regles :
 * - les textes STATIQUES (libelles du produit) : une erreur de longueur est un
 *   bogue d'appelant, elle LEVE ;
 * - les textes venus des DONNEES (nom d'article d'une vendeuse) : troncature
 *   propre avec une ellipse — une vendeuse au nom trop long vend quand meme.
 */

const CORPS_MAX = 4096;
const BOUTON_TITRE_MAX = 20;
const BOUTONS_MAX = 3;
const LISTE_LIGNES_MAX = 10;
const LIGNE_TITRE_MAX = 24;
const LIGNE_DESCRIPTION_MAX = 72;
const LEGENDE_MAX = 1024;

export interface MessageTexte {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  /** Present : le message CITE celui-la — la reponse contextuelle (ADR 0035). */
  context?: { message_id: string };
  text: { body: string; preview_url: boolean };
}

/**
 * Une reaction posee SUR un message recu — l'accuse sans bruit (ADR 0035) :
 * le 👍 sur la photo d'article, le ✅ sur le SMS colle. Toujours un envoi de
 * CONFORT : l'appelant l'envoie en mieux-disant, jamais en chemin critique.
 */
export interface MessageReaction {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "reaction";
  reaction: { message_id: string; emoji: string };
}

export interface BoutonReponse {
  type: "reply";
  reply: { id: string; title: string };
}

export interface MessageBoutons {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "interactive";
  /** Present : le message CITE celui-la (ADR 0035). */
  context?: { message_id: string };
  interactive: {
    type: "button";
    /**
     * En-tete image optionnel — la vitrine d'une boutique, la photo d'un
     * article. Le lien doit etre lisible par les serveurs de Meta AU MOMENT de
     * l'envoi : un lien mort fait refuser le message entier, pas seulement
     * l'image. C'est l'appelant qui garantit l'existence de l'objet.
     */
    header?: { type: "image"; image: { link: string } };
    body: { text: string };
    action: { buttons: BoutonReponse[] };
  };
}

export interface LigneListe {
  id: string;
  title: string;
  description?: string;
}

export interface MessageListe {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "interactive";
  interactive: {
    type: "list";
    body: { text: string };
    action: { button: string; sections: Array<{ rows: LigneListe[] }> };
  };
}

/**
 * Une photo pleine largeur, avec sa legende — la fiche article « image
 * d'abord » et la rafale « voir en photos » (ADR 0035). Comme l'en-tete des
 * messages a boutons : le lien doit etre lisible par les serveurs de Meta AU
 * MOMENT de l'envoi, et c'est l'appelant qui le garantit.
 */
export interface MessageImage {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "image";
  image: { link: string; caption?: string };
}

export type MessageSortant =
  | MessageTexte
  | MessageBoutons
  | MessageListe
  | MessageImage
  | MessageReaction;

/** Troncature propre : jamais plus de `max`, ellipse comprise. */
function tronquer(texte: string, max: number): string {
  const net = texte.trim();
  if (net.length <= max) return net;
  return `${net.slice(0, max - 1).trimEnd()}…`;
}

function corpsOuLeve(corps: string): string {
  const net = corps.trim();
  if (!net) throw new Error("le corps d'un message ne peut pas etre vide");
  return tronquer(net, CORPS_MAX);
}

export function texte(vers: string, corps: string, options: { citer?: string } = {}): MessageTexte {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "text",
    ...(options.citer ? { context: { message_id: options.citer } } : {}),
    text: { body: corpsOuLeve(corps), preview_url: false },
  };
}

export function reaction(vers: string, messageId: string, emoji: string): MessageReaction {
  if (!messageId.trim()) throw new Error("une reaction exige le message cible");
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "reaction",
    reaction: { message_id: messageId, emoji },
  };
}

/** Retire la citation d'un message — le repli quand l'API la refuse. */
export function sansCitation<M extends { context?: { message_id: string } }>(m: M): M {
  const { context: _context, ...reste } = m;
  return reste as M;
}

export function image(vers: string, lien: string, legende?: string): MessageImage {
  if (!lien.trim()) throw new Error("un message image exige un lien");
  const nette = legende?.trim();
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "image",
    /* La legende vient des DONNEES (nom d'article, prix) : troncature propre,
       jamais de levee — une vendeuse au nom trop long vend quand meme. */
    image: { link: lien, ...(nette ? { caption: tronquer(nette, LEGENDE_MAX) } : {}) },
  };
}

export function boutons(
  vers: string,
  corps: string,
  choix: ReadonlyArray<{ id: string; titre: string }>,
  options: { image?: string; citer?: string } = {},
): MessageBoutons {
  if (choix.length === 0) throw new Error("un message a boutons exige au moins un bouton");
  if (choix.length > BOUTONS_MAX)
    throw new Error(`l'API n'accepte pas plus de trois boutons (recu ${choix.length})`);
  const ids = new Set<string>();
  for (const c of choix) {
    if (!c.id.trim()) throw new Error("identifiant de bouton vide : le routage en depend");
    if (ids.has(c.id)) throw new Error(`identifiant de bouton en double : ${c.id}`);
    ids.add(c.id);
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "interactive",
    ...(options.citer ? { context: { message_id: options.citer } } : {}),
    interactive: {
      type: "button",
      ...(options.image
        ? { header: { type: "image" as const, image: { link: options.image } } }
        : {}),
      body: { text: corpsOuLeve(corps) },
      action: {
        buttons: choix.map((c) => ({
          type: "reply" as const,
          reply: { id: c.id, title: tronquer(c.titre, BOUTON_TITRE_MAX) },
        })),
      },
    },
  };
}

export function liste(
  vers: string,
  corps: string,
  libelleBouton: string,
  lignes: ReadonlyArray<{ id: string; titre: string; description?: string }>,
): MessageListe {
  if (lignes.length === 0) throw new Error("une liste exige au moins une ligne");
  if (lignes.length > LISTE_LIGNES_MAX)
    throw new Error(
      `l'API n'accepte pas plus de dix lignes de liste (recu ${lignes.length}) — paginer`,
    );
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: corpsOuLeve(corps) },
      action: {
        button: tronquer(libelleBouton, BOUTON_TITRE_MAX),
        sections: [
          {
            rows: lignes.map((l) => ({
              id: l.id,
              title: tronquer(l.titre, LIGNE_TITRE_MAX),
              ...(l.description
                ? { description: tronquer(l.description, LIGNE_DESCRIPTION_MAX) }
                : {}),
            })),
          },
        ],
      },
    },
  };
}
