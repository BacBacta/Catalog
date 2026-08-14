/**
 * Expiration d'une commande non payee, et ses rappels.
 *
 * **Le temps courant est un PARAMETRE.** Jamais `Date.now()` lu ici : un domaine
 * qui lit l'horloge produit des tests non deterministes, et une fenetre de 48 h
 * qu'on ne peut pas verifier au bord n'est pas une fenetre. Un test parcourt les
 * fichiers de ce repertoire pour l'empecher.
 *
 * Le fuseau est `Africa/Douala`, UTC+1 sans heure d'ete. Ce module ne manipule
 * que des durees en millisecondes, donc il y est insensible — mais l'appelant qui
 * affiche une echeance ne l'est pas.
 */

/** Une commande non payee vit 48 h. */
export const FENETRE_EXPIRATION_MS = 48 * 60 * 60_000;

/**
 * Rappels, en heures ECOULEES depuis la creation.
 *
 * Lecture retenue de « rappel a 2 h et 24 h » : le temps compte depuis la
 * creation, pas avant l'echeance. La sequence 2 h → 24 h → 48 h se lit ainsi, et
 * 24 h apres la creation tombe de toute facon a 24 h de l'echeance. Seul le
 * premier rappel differe selon la lecture (2 h ou 46 h) ; **a confirmer** avec
 * une vendeuse, mais un rappel a 46 h serait deux heures avant la mort de la
 * commande, ce qui laisse peu de temps pour agir.
 */
export const RAPPELS_HEURES = [2, 24] as const;

export type Rappel = (typeof RAPPELS_HEURES)[number];

export interface CommandePourExpiration {
  creeA: Date;
  /**
   * Vrai des qu'UN FRANC est entre sur le portefeuille de la vendeuse — un
   * acompte suffit, le solde n'a pas a etre couvert.
   *
   * ── Ce champ s'appelait `soldeRegle`, et c'etait le mauvais predicat ────
   *
   * Arbitrage du 14/08 (ADR 0101). « Le total attendu est couvert » faisait
   * expirer une commande dont l'acheteuse avait reellement paye la moitie.
   *
   * Catalog ne detient aucun fonds (AGENTS.md §2) : faire « expirer » une
   * commande deja payee suggererait un retour d'argent qu'il ne peut pas
   * faire. Et un acompte prouve porte un RECU — l'expirer l'orphelinerait.
   *
   * L'expiration ne concerne donc qu'un seul cas : personne n'a rien paye.
   */
  argentEncaisse: boolean;
  /** Sortie de parcours. Une commande annulee n'expire pas non plus. */
  annuleeA: Date | null;
  /** Rappels deja partis, en heures. Rend la fonction idempotente. */
  rappelsEnvoyes: readonly number[];
}

export type EtatExpiration =
  /** Rien a faire : payee, annulee, ou encore dans les temps sans rappel du. */
  | { etat: "vivante"; echeance: Date; resteMs: number; rappelsDus: Rappel[] }
  | { etat: "expiree"; echeance: Date; depuisMs: number }
  /** Un franc encaisse, ou annulee : l'expiration ne s'applique plus. */
  | { etat: "hors_champ"; raison: "argent_encaisse" | "annulee" };

export function echeance(creeA: Date, fenetreMs: number = FENETRE_EXPIRATION_MS): Date {
  return new Date(creeA.getTime() + fenetreMs);
}

/**
 * Etat d'expiration a l'instant `now`, et rappels a envoyer.
 *
 * Trois proprietes voulues :
 *
 * 1. **idempotence** — un rappel deja envoye ne ressort jamais. Le job peut
 *    tourner toutes les minutes sans inonder l'acheteuse ;
 * 2. **rattrapage** — un rappel dont l'heure est passee ressort tant qu'il n'a
 *    pas ete envoye. Un job arrete trois heures ne perd pas le rappel de 2 h ;
 * 3. **aucun rappel apres l'expiration** — rappeler une commande morte ne sert
 *    qu'a faire honte a l'acheteuse.
 */
export function etatExpiration(
  commande: CommandePourExpiration,
  now: Date,
  fenetreMs: number = FENETRE_EXPIRATION_MS,
): EtatExpiration {
  if (commande.argentEncaisse) return { etat: "hors_champ", raison: "argent_encaisse" };
  if (commande.annuleeA) return { etat: "hors_champ", raison: "annulee" };

  const fin = echeance(commande.creeA, fenetreMs);
  const ecouleMs = now.getTime() - commande.creeA.getTime();

  if (now.getTime() >= fin.getTime()) {
    return { etat: "expiree", echeance: fin, depuisMs: now.getTime() - fin.getTime() };
  }

  const envoyes = new Set(commande.rappelsEnvoyes);
  const rappelsDus = RAPPELS_HEURES.filter((h) => !envoyes.has(h) && ecouleMs >= h * 60 * 60_000);

  return { etat: "vivante", echeance: fin, resteMs: fin.getTime() - now.getTime(), rappelsDus };
}

/** `true` quand la commande doit passer expiree a cet instant. */
export function doitExpirer(commande: CommandePourExpiration, now: Date): boolean {
  return etatExpiration(commande, now).etat === "expiree";
}
