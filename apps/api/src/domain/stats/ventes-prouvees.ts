import type { ProofState, RepartitionVentes } from "@catalog/contracts";

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

/**
 * La repartition vient de `@catalog/contracts` et n'est PAS redeclaree ici.
 *
 * AGENTS.md §6 : on ne redeclare jamais un type a la main de part et d'autre
 * d'une frontiere. Cette repartition traverse la frontiere HTTP — l'ecran
 * statistiques la lit telle quelle — donc sa forme appartient au contrat, et le
 * domaine s'y conforme au lieu d'en tenir une copie qui divergera.
 *
 * Ce que le contrat NE dit pas, et que ce fichier tient : quels etats entrent au
 * denominateur, et pourquoi. Un schema decrit une forme, pas une regle.
 */
export type { RepartitionVentes } from "@catalog/contracts";

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
export function pourcentProuve(part: RepartitionVentes): number | null {
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
export function repartirVentes(etats: readonly ProofState[]): RepartitionVentes {
  return repartirComptes(etats.map((etat) => ({ etat, nombre: 1 })));
}

/**
 * La meme repartition, a partir de COMPTES deja agreges.
 *
 * C'est la forme que rend un `GROUP BY` : cinq lignes, pas cinq mille. La base
 * sait compter mieux que nous, et deplier ses comptes en un tableau d'etats pour
 * les recompter serait un aller-retour gratuit — sur la vendeuse qui a le plus
 * de commandes, c'est-a-dire exactement celle qu'il ne faut pas ralentir.
 *
 * `repartirVentes` s'y ramene : une seule regle decide de ce qui entre au
 * denominateur, et il n'y a pas deux endroits ou l'oublier.
 */
export function repartirComptes(
  comptes: ReadonlyArray<{ etat: ProofState; nombre: number }>,
): RepartitionVentes {
  const part: RepartitionVentes = { prouve: 0, contresigne: 0, nonTrace: 0, total: 0 };
  for (const { etat, nombre } of comptes) {
    if (!Number.isInteger(nombre) || nombre < 0) {
      throw new Error(`compte invalide pour ${etat} : ${nombre}`);
    }
    if (etat === "prouve") part.prouve += nombre;
    else if (etat === "contresigne") part.contresigne += nombre;
    else if (etat === "declare_non_trace") part.nonTrace += nombre;
    else continue; // attendu, conteste : hors champ, pas au denominateur.
    part.total += nombre;
  }
  return part;
}
