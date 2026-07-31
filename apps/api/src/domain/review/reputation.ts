import type { CommandePourCycle } from "../order/cycle.ts";
import { peutDeposerAvisVerifie } from "../order/cycle.ts";

/**
 * La reputation d'une vendeuse.
 *
 * Module PUR : pas de base, pas de reseau, pas d'horloge.
 *
 * **C'est l'actif de verrouillage du produit.** Une reputation ne se transporte
 * pas ailleurs : c'est ce qui rend le depart couteux, la ou le catalogue et la
 * rampe se recopient en une apres-midi. Sa regle centrale est donc une regle
 * d'HONNETETE, pas de calcul — la note ne reflete que des achats dont l'argent
 * a laisse une trace.
 */

/** L'echelle. Cinq crans entiers, pas de demi-etoile. */
export const NOTE_MIN = 1;
export const NOTE_MAX = 5;

export interface DroitAuDepot {
  /** L'acheteuse peut deposer un avis. */
  possible: boolean;
  /** Cet avis portera le label « achat verifie ». */
  verifie: boolean;
}

/**
 * Qui peut deposer, et avec quel label.
 *
 * **Un depot direct non trace n'est pas BLOQUE.** L'acheteuse a bien recu sa
 * commande et a le droit d'en parler ; son avis sera publie. Il ne porte
 * simplement pas le label et n'entre pas dans la note. On ne l'empeche pas, on
 * le distingue — c'est la meme logique que pour le recu au lot 10.
 *
 * `verifie` delegue a `peutDeposerAvisVerifie` plutot que de redire quels etats
 * de preuve comptent : une seule definition, dans `order/cycle.ts`.
 */
export function droitAuDepot(commande: CommandePourCycle): DroitAuDepot {
  const livree = commande.etape === "livree" && !commande.annuleeA;
  return { possible: livree, verifie: livree && peutDeposerAvisVerifie(commande) };
}

export interface AvisPourNote {
  note: number;
  verifie: boolean;
}

export interface Reputation {
  /**
   * Moyenne des avis VERIFIES, arrondie au dixieme — ou `null` s'il n'y en a
   * aucun. `null` et non zero : zero se lirait « tres mauvaise boutique », ce
   * qui est un mensonge sur une vendeuse qui debute.
   */
  note: number | null;
  /** Ventes verifiees. C'est le chiffre qu'une acheteuse inconnue regarde. */
  nbVerifies: number;
  /** Tous les avis publies, verifies ou non. */
  nbTotal: number;
}

/**
 * Note et compteurs d'une boutique.
 *
 * **Les avis non verifies sont publies mais n'entrent PAS dans la note.** Sans
 * cette regle, il suffirait de declarer des paiements a la main pour se
 * fabriquer une reputation — et le label « achat verifie » ne voudrait plus
 * rien dire, ni ici ni sur le recu.
 *
 * La moyenne se calcule en ENTIERS jusqu'au dernier moment. La note n'est pas
 * de l'argent, mais la meme discipline evite qu'un 4,999999 s'affiche « 5,0 »
 * a un endroit et « 4,9 » a un autre.
 */
export function reputation(avis: readonly AvisPourNote[]): Reputation {
  for (const a of avis) {
    if (!Number.isInteger(a.note) || a.note < NOTE_MIN || a.note > NOTE_MAX) {
      // Refuser plutot que ranger en silence : une note hors echelle est un
      // defaut d'ecriture en amont, pas une valeur a corriger ici.
      throw new Error(`note hors echelle : ${a.note}`);
    }
  }

  const verifies = avis.filter((a) => a.verifie);
  const somme = verifies.reduce((s, a) => s + a.note, 0);

  return {
    note: verifies.length === 0 ? null : Math.round((somme * 10) / verifies.length) / 10,
    nbVerifies: verifies.length,
    nbTotal: avis.length,
  };
}
