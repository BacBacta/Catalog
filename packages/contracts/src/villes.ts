/**
 * La ville d'une boutique — ADR 0050.
 *
 * ── Pourquoi il n'y a pas de liste ────────────────────────────────────────
 *
 * `city` etait une enumeration de DEUX valeurs — « Douala » et « Yaounde ».
 * Une boutique a Bafoussam ne pouvait jamais vendre en livraison, « Yaoundé »
 * avec son accent echouait, et l'echec ne tombait pas a l'inscription : il
 * tombait chez l'ACHETEUSE, au dernier appui, apres neuf tours de parole.
 *
 * La tentation etait d'ecrire une liste plus longue. Elle ne corrige rien :
 * elle deplace le mur a la soixantieme ville. Et l'ecrire de memoire serait
 * exactement ce qu'AGENTS.md §7.7 interdit — une ville oubliee exclut une
 * vendeuse du produit, en silence, sans que personne ne sache pourquoi.
 *
 * Le vrai defaut n'etait pas la longueur de la liste : c'est que DEUX
 * validateurs gardaient la meme valeur a deux moments differents, et que
 * celui qui refusait s'executait chez quelqu'un d'autre, trois semaines plus
 * tard. On garde donc UN predicat, appele aux deux portes d'ecriture et a la
 * lecture, et un test de propriete qui leur interdit de diverger.
 *
 * Ce fichier n'importe RIEN, pas meme zod — meme regle que `phone.ts` : une
 * fonction destinee au navigateur ne partage pas son module avec un schema
 * (ADR 0015, budget de 30 Ko de la boutique publique).
 */

/**
 * Bornes REPRISES du point d'ecriture le plus contraint du depot
 * (`apps/api/src/domain/bot/inscription.ts`, `NOM_MIN` / `NOM_MAX`). Rien
 * n'est invente ici : c'est la borne existante, deplacee la ou tout le monde
 * peut l'importer.
 */
export const VILLE_MIN = 2;
export const VILLE_MAX = 80;

/**
 * LE predicat. Le seul.
 *
 * Il s'applique a la saisie BRUTE et trime lui-meme : un appelant qui oublie
 * de trimer est un appelant qui diverge, et c'est precisement ce qu'on vient
 * de payer.
 */
export function villeAcceptable(brut: string): boolean {
  const net = brut.trim();
  return net.length >= VILLE_MIN && net.length <= VILLE_MAX;
}

/**
 * La saisie a-t-elle la FORME d'autre chose qu'un nom de lieu ? — ADR 0091.
 *
 * ── Ce que ce predicat n'est pas ──────────────────────────────────────────
 *
 * Ce n'est **pas** une liste de villes deguisee, et la distinction est tout le
 * sujet. L'ADR 0050 a refuse la liste pour une raison qui tient toujours : elle
 * deplace le mur a la soixantieme ville et exclut en silence une vendeuse de
 * Foumbot. Ici, **aucun mot n'est jugé** — seule la forme l'est. « Foumbot »,
 * « Douala 5e », « Kribi » et n'importe quel toponyme jamais entendu passent
 * tous, parce que rien dans leur forme ne detonne.
 *
 * Ce n'est pas non plus un REFUS. Le predicat est vrai, l'appelant **pose une
 * question** et la personne peut confirmer. Un lieu reellement nomme « Chez
 * Tantine ? » — improbable, mais ce n'est pas a nous de le decider — s'ecrit
 * quand meme, en un appui de plus.
 *
 * ── Ce que le harnais a mesure, et qui a motive ce predicat ───────────────
 *
 * A l'etape « ville de livraison », `villeAcceptable` seul laissait passer
 * « est-ce que vous vendez des chaussures pour bebe ? », `12345`, `?? ...` et
 * une URL. La question atterrissait dans `order.delivery.city`, puis dans le
 * gabarit Meta envoye a la vendeuse. Voir `docs/audit-pipeline-2026-08.md`,
 * constat C-001.
 *
 * Les quatre formes retenues, et le defaut que chacune attrape :
 *
 * | forme | ce qu'elle attrape |
 * |---|---|
 * | un point d'interrogation | la question posee au bot, avalee comme reponse |
 * | aucune lettre | `12345`, `?? ...` — une saisie qui a derape |
 * | une adresse web | un lien colle par erreur |
 * | plus de cinq mots | une phrase, jamais un toponyme |
 *
 * Le seuil de cinq mots est genereux a dessein : « Douala Bonaberi carrefour
 * Total Ndokoti » en fait cinq et passe. Au-dela, on demande — on ne refuse pas.
 */
export function villeDouteuse(brut: string): boolean {
  const net = brut.trim();
  if (net === "") return false;
  if (net.includes("?") || net.includes("¿")) return true;
  /* Aucune lettre : ni latine, ni accentuee. `\p{L}` couvre les deux. */
  if (!/\p{L}/u.test(net)) return true;
  if (/https?:\/\/|www\./i.test(net)) return true;
  return net.split(/\s+/).length > 5;
}
