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
