/**
 * La confiance dite AU MOMENT DU DOUTE — ADR 0061, rang 2a.
 *
 * ── Pourquoi ce module existe ─────────────────────────────────────────────
 *
 * Une acheteuse s'apprete a envoyer un acompte a quelqu'un qu'elle ne connait
 * pas. Catalog **ne peut pas** la rassurer par un sequestre : les fonds ne
 * transitent jamais par un compte a nous, et c'est ce qui definit le produit
 * (AGENTS.md §2, ADR 0009). Il ne reste qu'un levier, et il est honnete :
 * montrer ce que cette boutique a DEJA prouve, a l'instant precis ou la
 * question se pose.
 *
 * Les compteurs existent depuis le lot 12. Ce qui manquait n'etait pas la
 * donnee — c'etait le moment.
 *
 * ── Le zero est une INFORMATION, pas un vide ──────────────────────────────
 *
 * L'accueil, lui, se tait quand `nbVerifies` vaut zero : on ne fait pas dire
 * « 0 vente » a une vendeuse qui debute, et devant une vitrine c'est le bon
 * choix. **Ici, non.** Le silence, au moment de payer, se lit comme « boutique
 * etablie » — c'est le sens que lui donne l'acheteuse, pas celui qu'on voulait.
 *
 * On dit donc « cette boutique debute », qui est vrai, utile, et n'est pas la
 * meme phrase que « 0 vente ». La difference n'est pas cosmetique : l'une
 * informe, l'autre humilie.
 *
 * ── Ce module est PUR ─────────────────────────────────────────────────────
 *
 * Il ne compte rien lui-meme et n'ecrit aucun texte : il tranche la FORME du
 * message. Les nombres arrivent du service, la copie vit dans `textes.ts`,
 * traduite. C'est ce qui permet de tester la regle sans base ni langue.
 */

export interface ComptesDeConfiance {
  /**
   * Les commandes dont le paiement est ALLE JUSQU'A LA PREUVE — etats `prouve`
   * et `contresigne`. Ni les commandes creees, ni les paiements declares non
   * traces : ce compteur ne vaut que s'il ne compte QUE ce qui est opposable.
   */
  paiementsProuves: number;
  /** Les avis adosses a un paiement prouve. Les autres n'existent pas ici. */
  avisVerifies: number;
}

export type VerdictConfiance =
  | { forme: "etablie"; paiementsProuves: number; avisVerifies: number }
  | { forme: "debutante" };

/**
 * Le seuil est **un seul paiement prouve**, et pas davantage.
 *
 * Un seuil plus haut — trois, dix — paraitrait plus prudent et serait pire :
 * il ferait passer pour debutantes des boutiques qui ont deja prouve quelque
 * chose, donc il mentirait dans le sens ou ca coute a une vraie vendeuse. La
 * phrase porte le NOMBRE ; c'est a l'acheteuse d'en juger, pas a nous de
 * decider a partir de quand il compte.
 *
 * Les nombres negatifs ou fractionnaires seraient un defaut d'appel : on les
 * ramene a zero plutot que de les afficher.
 */
export function confianceAuPaiement(c: ComptesDeConfiance): VerdictConfiance {
  const prouves = entierPositif(c.paiementsProuves);
  if (prouves < 1) return { forme: "debutante" };
  return {
    forme: "etablie",
    paiementsProuves: prouves,
    avisVerifies: entierPositif(c.avisVerifies),
  };
}

function entierPositif(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
