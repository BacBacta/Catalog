/**
 * L'enveloppe d'une livraison entrante WhatsApp — la SEULE lecture des formes.
 *
 * Deux parseurs se partagent le meme corps de webhook : celui des defis de
 * connexion (`connexion-whatsapp.ts`, ADR 0027) et celui du bot
 * (`bot/entrees.ts`, ADR 0031). Ils lisent des choses differentes — l'un ne
 * veut que le texte, l'autre comprend les boutons, les photos, les Flows —,
 * mais ils doivent voir exactement les MEMES messages.
 *
 * Ils ne les voyaient pas. Le bot avait appris la forme PLATE le 02/08/2026 ;
 * la connexion ne connaissait que l'enveloppe Cloud API. Sur un transport qui
 * livre a plat, le bot repondait et la connexion restait muette — voir
 * l'ADR 0081. Une divergence de ce genre ne se remarque pas : les deux
 * parseurs sont corrects isolement, c'est leur DESACCORD qui est le defaut.
 *
 * D'ou ce module : les formes de livraison se declarent ICI, une fois. Ce que
 * chacun fait ensuite d'un message lui appartient.
 *
 * Les deux formes, toutes deux mesurees le 02/08/2026 :
 * - l'enveloppe Cloud API (`entry[].changes[].value.messages[]`) — Meta
 *   directe et production 360dialog ;
 * - la forme PLATE v1 (`messages[]` a la racine) — le bac a sable 360dialog.
 *
 * Posture defensive, comme partout sur ce chemin : un corps difforme rend une
 * liste vide, jamais une levee. Une livraison qui plante est relivree, et une
 * relivraison en boucle est une panne.
 */

/** Les messages d'une livraison, a plat, quelle qu'ait ete son enveloppe. */
export function messagesDeLivraison(corps: unknown): unknown[] {
  const sortie: unknown[] = [];
  const racine = corps as { entry?: unknown; messages?: unknown } | null;

  if (Array.isArray(racine?.messages)) sortie.push(...racine.messages);

  if (Array.isArray(racine?.entry)) {
    for (const entree of racine.entry) {
      const changements = (entree as { changes?: unknown } | null)?.changes;
      if (!Array.isArray(changements)) continue;
      for (const changement of changements) {
        const messages = (changement as { value?: { messages?: unknown } } | null)?.value?.messages;
        if (Array.isArray(messages)) sortie.push(...messages);
      }
    }
  }

  return sortie;
}
