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

export interface MessageTexte {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: { body: string; preview_url: boolean };
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
  interactive: {
    type: "button";
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

export type MessageSortant = MessageTexte | MessageBoutons | MessageListe;

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

export function texte(vers: string, corps: string): MessageTexte {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "text",
    text: { body: corpsOuLeve(corps), preview_url: false },
  };
}

export function boutons(
  vers: string,
  corps: string,
  choix: ReadonlyArray<{ id: string; titre: string }>,
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
    interactive: {
      type: "button",
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
