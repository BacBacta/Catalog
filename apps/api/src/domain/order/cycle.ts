import { type OrderStep, type ProofState, stepRank } from "@catalog/contracts";
import { compteCommeAchatVerifie } from "../proof/machine.ts";

/**
 * Le cycle de vie d'une commande, du cote LIVRAISON.
 *
 * Module PUR : pas de base, pas de reseau, pas d'horloge. `now` arrive en
 * parametre, comme partout dans `src/domain`.
 *
 * **Deux machines, pas une.** La preuve a la sienne (`proof/machine.ts`) et ce
 * module ne la duplique pas : il la consulte. Les deux avancent separement, et
 * c'est voulu — une commande peut etre livree sans etre prouvee (depot direct
 * declare a la main) et prouvee sans etre livree (acompte verse le lundi,
 * remise le jeudi). Les fondre ferait perdre l'un ou l'autre.
 */

/** Mode de livraison, tel que le porte `deliverySchema` de `contracts`. */
export type ModeLivraison = "livraison" | "retrait";

export interface CommandePourCycle {
  etape: OrderStep;
  modeLivraison: ModeLivraison;
  totalXaf: number;
  amountPaidXaf: number;
  balanceXaf: number;
  etatPreuve: ProofState;
  /** Sortie de parcours. Une commande annulee n'avance plus. */
  annuleeA: Date | null;
}

/**
 * Les etapes REELLEMENT franchissables selon le mode.
 *
 * Le point de retrait est un mode de plein droit (ADR 0005), pas un cas
 * degrade : il n'a pas de livreur. Lui imposer « chez le livreur » obligerait
 * la vendeuse a declarer une etape qui n'a pas eu lieu pour faire avancer sa
 * commande — c'est-a-dire a mentir au systeme qui doit la servir.
 */
export function etapesPour(mode: ModeLivraison): OrderStep[] {
  return mode === "retrait"
    ? ["recue", "preparee", "livree"]
    : ["recue", "preparee", "chez_le_livreur", "livree"];
}

export type RefusEtape =
  /** L'etape visee est de rang inferieur ou egal. Journalise, ignore. */
  | "recul_ignore"
  /** L'etape n'existe pas pour ce mode de livraison. */
  | "etape_hors_mode"
  /** Il reste de l'argent a encaisser : on ne clot pas sur un solde ouvert. */
  | "solde_ouvert"
  | "commande_annulee";

/**
 * Entree de journal, en AJOUT SEUL, et de meme forme que `JournalPreuve`.
 *
 * **Toute tentative y figure, refusee comme acceptee.** Un recul ignore sans
 * trace est une anomalie invisible, et c'est precisement le signal qu'on
 * voudra lire le jour ou une etape parait fausse.
 *
 * Ne porte AUCUN montant : le journal d'evenements est lisible par plus de
 * monde que le solde d'une vendeuse. Les mouvements d'argent vont au journal
 * comptable, qui a ses propres regles.
 */
export interface JournalEtape {
  kind: "etape_avancee" | "etape_refusee";
  at: Date;
  de: OrderStep;
  vers: OrderStep;
  par: "vendeuse";
  raison?: RefusEtape;
}

export type ResultatEtape =
  | { ok: true; etape: OrderStep; journal: JournalEtape }
  /** `etape` est l'etape INCHANGEE : la transition est ignoree, pas appliquee. */
  | { ok: false; etape: OrderStep; raison: RefusEtape; journal: JournalEtape };

/**
 * Fait avancer une commande d'une etape.
 *
 * Renvoie la decision **et** l'entree de journal dans les deux cas : l'appelant
 * persiste les deux dans la meme transaction. C'est le contrat deja tenu par
 * `proof/machine.ts` et `payout-phone.ts`.
 *
 * Un saut d'etape en avant est permis — une vendeuse qui prepare et remet dans
 * la meme heure ne doit pas avoir a cliquer deux fois pour dire la verite. Ce
 * qui ne l'est pas, c'est de reculer.
 */
export function avancerEtape(
  commande: CommandePourCycle,
  vers: OrderStep,
  now: Date,
): ResultatEtape {
  const journalBase = { at: now, de: commande.etape, vers, par: "vendeuse" } as const;

  const refus = (raison: RefusEtape): ResultatEtape => ({
    ok: false,
    etape: commande.etape,
    raison,
    journal: { kind: "etape_refusee", ...journalBase, raison },
  });

  if (commande.annuleeA) return refus("commande_annulee");
  if (!etapesPour(commande.modeLivraison).includes(vers)) return refus("etape_hors_mode");
  if (stepRank(vers) <= stepRank(commande.etape)) return refus("recul_ignore");

  /**
   * La seule etape que l'argent conditionne. Les intermediaires ne le sont pas :
   * preparer une commande dont l'acompte est verse est exactement ce que le mode
   * `acompte` demande.
   *
   * Refuser plutot qu'encaisser d'office : Catalog ne constate un paiement que
   * sur preuve ou sur declaration EXPLICITE de la vendeuse. Avancer l'etape ne
   * peut pas valoir aveu de reception d'argent.
   */
  if (vers === "livree" && commande.balanceXaf > 0) return refus("solde_ouvert");

  return { ok: true, etape: vers, journal: { kind: "etape_avancee", ...journalBase } };
}

/**
 * Ce qu'il reste a encaisser sur une commande, en francs entiers.
 *
 * Alimente la tuile « soldes a encaisser » du tableau de bord. Une commande
 * annulee ne compte pas : afficher un solde qu'on n'attend plus fabriquerait
 * une dette imaginaire.
 */
export function soldeAEncaisser(commande: CommandePourCycle): number {
  if (commande.annuleeA) return 0;
  return Math.max(0, commande.balanceXaf);
}

/**
 * Droit a l'avis VERIFIE.
 *
 * Deux conditions, et il faut les deux : la commande est livree, et le paiement
 * compte comme un achat verifie. La seconde delegue a `compteCommeAchatVerifie`
 * — on ne redit pas ici quels etats de preuve valent preuve, sinon les deux
 * definitions divergeront.
 *
 * **Le depot direct declare a la main n'y donne pas droit**, et c'est le point
 * du lot : il fait avancer la commande, il reste marque non trace. On ne
 * cherche pas a le bloquer — la vendeuse le ferait de toute facon hors du
 * systeme, et on perdrait aussi la donnee. On le distingue.
 */
export function peutDeposerAvisVerifie(commande: CommandePourCycle): boolean {
  return commande.etape === "livree" && compteCommeAchatVerifie(commande.etatPreuve);
}

/* ────────────────────────── le suivi, cote acheteuse ────────────────────────── */

export interface EtapeSuivi {
  cle: OrderStep;
  libelle: string;
  /** Deja franchie. */
  faite: boolean;
  /** L'etape ou en est la commande MAINTENANT. */
  courante: boolean;
}

/**
 * Les libelles que l'ACHETEUSE lit.
 *
 * Ils vivent ici, pas dans la boutique : le serveur les calcule, l'ilot les
 * affiche. C'est ce qui evite d'ajouter un dictionnaire de textes au chemin
 * critique d'une page bornee a 30 Ko de JS.
 *
 * **« Le livreur vous appellera en arrivant dans votre quartier. »** Ce n'est pas
 * une formule de politesse, c'est la realite du terrain : il n'existe pas
 * d'adresse postale au Cameroun (ADR 0005), le livreur telephone en arrivant et
 * se fait guider au point de repere. Ecrire « en cours de livraison a votre
 * adresse » ferait attendre l'acheteuse devant sa porte pendant qu'on l'appelle.
 */
const LIBELLES: Record<ModeLivraison, Record<OrderStep, string>> = {
  livraison: {
    recue: "Commande recue par la boutique",
    preparee: "Preparee, prete a partir",
    chez_le_livreur: "Confiee au livreur — il vous appellera en arrivant dans votre quartier",
    livree: "Livree",
  },
  retrait: {
    recue: "Commande recue par la boutique",
    preparee: "Preparee, prete a retirer",
    chez_le_livreur: "Confiee au livreur",
    livree: "Retiree au point convenu",
  },
};

/**
 * Les etapes a montrer, dans l'ordre, avec ce qui est fait et ou on en est.
 *
 * La liste depend du mode : un retrait n'affiche pas une etape « chez le
 * livreur » qui n'aura jamais lieu — elle resterait grise pour toujours, et une
 * acheteuse en conclurait que sa commande est bloquee.
 */
export function etapesDuSuivi(commande: CommandePourCycle): EtapeSuivi[] {
  const rangCourant = stepRank(commande.etape);
  return etapesPour(commande.modeLivraison).map((cle) => ({
    cle,
    libelle: LIBELLES[commande.modeLivraison][cle],
    faite: stepRank(cle) <= rangCourant,
    courante: cle === commande.etape,
  }));
}
