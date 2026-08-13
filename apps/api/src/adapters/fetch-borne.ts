/**
 * Un `fetch` QUI FINIT TOUJOURS — banc du 13/08/2026.
 *
 * ── Le defaut que ce fichier ferme ────────────────────────────────────────
 *
 * Une vendeuse publie son deuxieme article par le formulaire. L'article
 * entre en base — la sonde le confirme, deux articles — et **plus rien
 * n'arrive dans le fil**. Aucune erreur, aucune trace, aucune relivraison
 * utile : le bot n'a pas leve, il n'a jamais fini.
 *
 * Tous les appels sortants du bot etaient des `fetch` NUS. Or `fetch` sans
 * signal n'expire pas : une connexion qui reste ouverte sans jamais repondre
 * — un CDN froid, un relais qui avale, une machine qui part au ralenti —
 * suspend la promesse pour toujours. Et comme la route entrante attend la
 * fin du traitement avant de rendre son 200, la panne est PARFAITEMENT
 * muette : rien ne tombe, rien ne s'ecrit, la conversation s'arrete.
 *
 * ── La regle ──────────────────────────────────────────────────────────────
 *
 * **Un appel reseau du bot echoue, ou il finit.** Jamais « il attend ». Une
 * requete qui depasse son delai devient une erreur ordinaire, que les
 * appelants savent deja traiter : un media illisible publie l'article sans
 * photo, un envoi refuse se journalise, une reconstruction ratee se retente
 * a la publication suivante.
 *
 * Le delai est genereux — quinze secondes — parce qu'il ne borne pas la
 * performance, il borne l'INFINI. Un reseau camerounais lent doit passer ;
 * une connexion morte, non.
 */

/** Quinze secondes : de quoi laisser passer un reseau lent, pas une panne. */
export const DELAI_RESEAU_MS = 15_000;

/**
 * L'etablissement de la connexion, plus court que l'echange lui-meme.
 *
 * Un hote injoignable doit se dire vite : cinq secondes suffisent a savoir
 * qu'on ne parlera pas. Passe cette porte, l'echange a droit aux quinze
 * secondes ci-dessus. `fetch` ne distingue pas les deux — le SDK de stockage,
 * si, et c'est lui qui s'en sert (ADR 0089).
 */
export const DELAI_CONNEXION_MS = 5_000;

/**
 * Enveloppe un `fetch` d'un delai d'attente.
 *
 * Le signal de l'appelant est PRESERVE quand il y en a un : les deux
 * s'additionnent (`AbortSignal.any`), le premier qui parle gagne. Sans cela,
 * poser un delai retirerait une annulation deja demandee.
 */
export function fetchBorne(base: typeof fetch = fetch, delaiMs = DELAI_RESEAU_MS): typeof fetch {
  return async (entree: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const minuterie = AbortSignal.timeout(delaiMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, minuterie]) : minuterie;
    return base(entree, { ...init, signal });
  };
}
