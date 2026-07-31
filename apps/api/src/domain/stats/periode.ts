import type { Jour } from "./serie.ts";

/**
 * La fenetre observee, en jours de DOUALA.
 *
 * Module PUR : l'instant courant arrive en parametre. Un domaine qui lit
 * l'horloge produit des graphiques qu'aucun test ne peut fixer — et sur une
 * fenetre glissante, c'est le bord qui casse en premier.
 *
 * **Le decalage est ecrit en dur, et c'est voulu.** `Africa/Douala` est UTC+1
 * toute l'annee : le Cameroun n'a pas d'heure d'ete, et n'en a jamais eu. On
 * n'appelle donc ni `toLocaleDateString` ni `Intl.DateTimeFormat` avec un nom de
 * fuseau : les deux dependent des donnees ICU embarquees dans le binaire Node,
 * qui varient d'une image de conteneur a l'autre. Un `Node` compile en
 * `small-icu` renverrait des jours en UTC sans le dire, et la fenetre glisserait
 * d'une heure — assez pour qu'une commande de 23 h 30 tombe le mauvais jour.
 *
 * Ce n'est pas une hypothese a confirmer : c'est une constante geographique. Le
 * jour ou elle changerait, le pays entier le saurait avant nous.
 */

const DECALAGE_DOUALA_MS = 3_600_000;
const MS_PAR_JOUR = 86_400_000;

/** Le jour de Douala qui contient cet instant. */
export function jourDeDouala(instant: Date): Jour {
  const t = instant.getTime();
  if (!Number.isFinite(t)) throw new Error("instant invalide");
  return new Date(t + DECALAGE_DOUALA_MS).toISOString().slice(0, 10);
}

export interface Fenetre {
  du: Jour;
  au: Jour;
  /** Nombre de jours inclus, bornes comprises. */
  jours: number;
  /** Premier instant du jour `du`, en UTC — la borne basse d'une requete. */
  debut: Date;
  /**
   * Premier instant du jour SUIVANT `au`, en UTC. Borne haute EXCLUE.
   *
   * Exclue et non incluse a `23:59:59.999` : une commande enregistree a
   * `23:59:59.9995` existe — les horloges de base ont plus de precision qu'une
   * milliseconde — et une borne fermee la perdrait sans que rien ne le signale.
   */
  fin: Date;
}

/**
 * Les `jours` derniers jours, le jour courant COMPRIS.
 *
 * Trente jours veut donc dire « aujourd'hui et les vingt-neuf precedents », pas
 * « les trente jours d'avant aujourd'hui ». C'est la lecture qu'attend une
 * vendeuse qui ouvre son ecran a midi : ce qu'elle a vendu ce matin en fait
 * partie.
 */
export function fenetreGlissante(maintenant: Date, jours: number): Fenetre {
  if (!Number.isInteger(jours) || jours < 1 || jours > 366) {
    throw new Error(`fenetre invalide : ${jours} jours`);
  }
  const au = jourDeDouala(maintenant);
  const debutAu = Date.parse(`${au}T00:00:00Z`) - DECALAGE_DOUALA_MS;
  const debut = new Date(debutAu - (jours - 1) * MS_PAR_JOUR);
  return {
    du: jourDeDouala(debut),
    au,
    jours,
    debut,
    fin: new Date(debutAu + MS_PAR_JOUR),
  };
}

/**
 * Le jour de Douala d'une colonne SQL `DATE`.
 *
 * PostgreSQL n'attache aucun fuseau a un `DATE` ; le pilote le rend en `Date`
 * JavaScript a MINUIT UTC. Lui appliquer le decalage de Douala le ferait basculer
 * au lendemain — c'est exactement le defaut d'une heure que `jourDeDouala`
 * previent ailleurs, et qu'on reintroduirait ici en reutilisant la meme fonction
 * par reflexe.
 *
 * Deux fonctions parce qu'il y a deux natures : un INSTANT porte une heure et se
 * traduit, un JOUR n'en porte pas et se lit.
 */
export function jourDeColonneDate(date: Date): Jour {
  return date.toISOString().slice(0, 10);
}
