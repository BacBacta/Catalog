/**
 * Le texte d'un GESTE, normalisé — ADR 0104.
 *
 * ── Pourquoi la barre oblique compte ──────────────────────────────────────
 *
 * Quatre commandes sont posées sur le numéro (`composants.mjs --accueil-poser`,
 * ADR 0087) : `/vendre`, `/boutique`, `/suivi`, `/aide`. WhatsApp les affiche
 * dans le menu « / » de la zone de saisie, dans **n'importe quelle**
 * conversation — contrairement aux amorces, qui n'apparaissent que dans un fil
 * vide. C'est donc la moitié de l'accueil qui est joignable tout le temps.
 *
 * Aucune règle ne retirait la barre. Mesuré le 14/08/2026, sur `aiguiller` :
 *
 * | tapé        | prospect               | vendeuse installée      |
 * |-------------|------------------------|-------------------------|
 * | `vendre`    | inscription            | vendeuse                |
 * | `/vendre`   | **acheteuse** (raté)   | vendeuse                |
 * | `vendu`     | acheteuse              | inscription (comptoir)  |
 * | `/vendu`    | acheteuse              | **vendeuse** (raté)     |
 * | `ajouter`   | acheteuse              | inscription             |
 * | `/ajouter`  | acheteuse              | **vendeuse** (raté)     |
 *
 * Trois aiguillages, pas un. Rien ne cassait bruyamment — la personne recevait
 * l'accueil, qui est une réponse utile —, mais un menu qui annonce « /vendre —
 * Ouvrir ma boutique en deux minutes » et rend un accueil générique ment sur ce
 * qu'il fait. C'est la même faute que l'amorce « Voir une boutique ».
 *
 * `/suivi` marchait déjà, par accident heureux : `demandeStatut` cherche
 * `\bsuivis?\b`, et la barre est une frontière de mot.
 *
 * ── Où cette fonction s'emploie, et où elle ne s'emploie PAS ──────────────
 *
 * Elle sert à RECONNAÎTRE un geste, jamais à fabriquer une valeur. Le nom d'un
 * article, un point de remise ou un nom de boutique qui commenceraient par une
 * barre la gardent : « une valeur n'est pas un geste » (ADR 0102), et la règle
 * vaut dans les deux sens. C'est pourquoi `avancerComptoir` et les comparaisons
 * en cours de tunnel continuent d'employer leur normalisation à elles.
 */
export function motDeGeste(brut: string): string {
  return (
    brut
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase()
      /* Une barre en tête, et une seule forme : c'est ce que le menu « / » de
       WhatsApp produit. Le `+` couvre la faute de frappe à deux barres ; le
       second `trim` couvre « / vendre ». */
      .replace(/^\/+\s*/, "")
  );
}
