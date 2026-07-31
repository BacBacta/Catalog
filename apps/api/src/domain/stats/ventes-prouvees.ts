import type { ProofState } from "@catalog/contracts";

/**
 * La part des ventes PROUVEES.
 *
 * Module PUR : pas de base, pas de reseau, pas d'horloge.
 *
 * **C'est l'indicateur le plus important du produit**, et pas parce qu'il est
 * joli sur un tableau de bord : c'est la mesure du CONTOURNEMENT, donc du modele
 * lui-meme. Catalog ne vaut que si les vendeuses collent leurs SMS. Une part qui
 * s'effondre ne dit pas « les vendeuses sont paresseuses », elle dit « le
 * produit ne tient pas sa promesse » — et c'est ce chiffre-la qu'il faut
 * regarder avant tous les autres.
 *
 * Il se decompose en TROIS et non en deux, parce que « prouve » et
 * « contresigne » ne valent pas la meme chose : le second porte deux voix
 * independantes sur le meme identifiant, c'est la preuve la plus forte du
 * produit. Les confondre effacerait precisement ce que la contre-signature
 * apporte.
 */

export interface PartVentesProuvees {
  /** SMS operateur analyse, sept controles passes. */
  prouve: number;
  /** En plus du SMS, l'acheteuse a confirme. Deux voix : le plus fort. */
  contresigne: number;
  /** Depot direct declare a la main. Il compte, il n'est pas prouve. */
  nonTrace: number;
  /**
   * Total des ventes RETENUES au denominateur.
   *
   * Les commandes contestees et celles encore en attente n'y sont PAS : une
   * vente dont on ne sait pas encore si elle a ete payee ne dit rien sur le
   * contournement, et l'y compter ferait plonger l'indicateur a chaque nouvelle
   * commande de la journee.
   */
  total: number;
}

/**
 * Part, en POURCENTAGE ENTIER, de ce qui est reellement prouve.
 *
 * `null` quand aucune vente n'est retenue : zero se lirait « aucune vendeuse ne
 * colle ses SMS », alors que la verite est « on n'a encore rien a mesurer ».
 * C'est la meme regle que la note du lot 12, et pour la meme raison — un chiffre
 * par defaut est un mensonge par defaut.
 *
 * `contresigne` compte comme prouve : il est plus fort, pas different.
 */
export function pourcentProuve(part: PartVentesProuvees): number | null {
  if (part.total <= 0) return null;
  return Math.round(((part.prouve + part.contresigne) * 100) / part.total);
}

/**
 * Repartit des etats de preuve en trois familles.
 *
 * Les etats hors champ — `attendu`, `conteste` — sont EXCLUS du denominateur
 * plutot que ranges dans « non trace ». Une commande contestee est un litige
 * ouvert, pas un contournement ; une commande en attente n'a simplement pas
 * encore de reponse. Les compter comme des echecs de preuve accuserait la
 * vendeuse d'un fait qui n'est pas etabli.
 */
export function repartirVentes(etats: readonly ProofState[]): PartVentesProuvees {
  const part: PartVentesProuvees = { prouve: 0, contresigne: 0, nonTrace: 0, total: 0 };
  for (const e of etats) {
    if (e === "prouve") part.prouve += 1;
    else if (e === "contresigne") part.contresigne += 1;
    else if (e === "declare_non_trace") part.nonTrace += 1;
    else continue; // attendu, conteste : hors champ, pas au denominateur.
    part.total += 1;
  }
  return part;
}
