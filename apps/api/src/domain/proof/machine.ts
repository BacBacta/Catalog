import {
  canIssueReceipt,
  type OperatorKey,
  type ProofState,
  type Verdict,
} from "@catalog/contracts";

/**
 * La machine a etats de la PREUVE — pas du paiement.
 *
 * Catalog n'opere aucun paiement : il le **constate**, apres coup, sur la foi du
 * SMS que la vendeuse a recu de son operateur. Ces etats decrivent donc la
 * SOLIDITE D'UNE PREUVE, jamais l'avancee d'un transfert. C'est la distinction
 * qui gouverne tout ce fichier, et celle qu'un lecteur presse confondra.
 *
 * Module PUR : pas de base, pas de reseau, pas d'horloge implicite. Le temps
 * arrive en parametre. Aucun analyseur de SMS ici — c'est le lot 8 ; ce fichier
 * definit les transitions que cet analyseur alimentera.
 *
 * ## Les cinq etats, du plus faible au plus fort
 *
 * | rang | etat | ce qu'il vaut |
 * |---|---|---|
 * | 0 | `attendu` | la commande existe, rien n'est apporte |
 * | 1 | `declare_non_trace` | la vendeuse affirme avoir recu, sans SMS |
 * | 2 | `prouve` | SMS analyse, sept controles passes |
 * | 3 | `contresigne` | l'acheteuse a confirme. Deux voix, le plus fort |
 * | — | `conteste` | une partie dement. N'efface rien |
 *
 * `conteste` n'a pas de rang : ce n'est pas un degre de preuve mais un litige,
 * et il est atteignable depuis n'importe quel etat.
 */

/** Rang de solidite. `conteste` n'en a pas : voir l'en-tete. */
const RANG: Record<Exclude<ProofState, "conteste">, number> = {
  attendu: 0,
  declare_non_trace: 1,
  prouve: 2,
  contresigne: 3,
};

export function rangPreuve(etat: ProofState): number | null {
  return etat === "conteste" ? null : RANG[etat];
}

/* ────────────────────────── les transitions ────────────────────────── */

/**
 * Les evenements qui font bouger la preuve.
 *
 * Ce ne sont pas des etats cibles mais des FAITS : « la vendeuse a declare »,
 * « un SMS a passe les controles ». Nommer l'evenement plutot que la cible
 * empeche un appelant de forcer un etat qu'aucun fait ne justifie.
 */
export type EvenementPreuve =
  /** La vendeuse declare avoir recu l'argent, sans SMS a l'appui. */
  | { type: "declaration_manuelle"; par: "vendeuse" }
  /**
   * Un SMS a ete analyse. `verdict` vient des sept controles du lot 8.
   * `operatorTxId` est obligatoire : marquer « paye et prouve » sans identifiant
   * d'operateur est un interdit d'AGENTS.md.
   */
  | {
      type: "sms_analyse";
      verdict: Verdict;
      operator: OperatorKey;
      operatorTxId: string;
      /**
       * Sens du message. `entrant` = recu par la VENDEUSE : c'est le seul qui
       * fait autorite, parce que c'est elle qui a l'argent. `sortant` = emis par
       * l'acheteuse : il corrobore, il ne prouve pas.
       */
      sens: "entrant" | "sortant";
    }
  /** L'acheteuse confirme depuis son lien de suivi. */
  | { type: "contresignature"; par: "acheteuse" }
  /** Une partie dement. */
  | { type: "contestation"; par: "vendeuse" | "acheteuse" | "support"; motif?: string };

export type RefusTransition =
  /** L'evenement demandait un etat de rang inferieur ou egal. Journalise, ignore. */
  | "recul_ignore"
  /** L'evenement n'a aucune transition definie depuis cet etat. */
  | "transition_interdite"
  /** Le litige est ouvert : plus rien n'avance sans intervention humaine. */
  | "litige_ouvert"
  /** SMS accepte SOUS RESERVE, ou de sens sortant : ne suffit pas a prouver. */
  | "preuve_insuffisante"
  /** SMS refuse par les controles. */
  | "sms_refuse"
  /** Contresignature demandee sans preuve prealable. */
  | "contresignature_sans_preuve"
  /** Contestation demandee alors qu'aucun paiement n'a ete attribue. */
  | "contestation_sans_paiement"
  /** Identifiant d'operateur absent : on ne marque jamais prouve sans lui. */
  | "identifiant_operateur_absent";

/**
 * Entree de journal, en AJOUT SEUL.
 *
 * **Toute tentative y figure, refusee comme acceptee.** Une transition arriere
 * ignoree sans trace est une anomalie invisible — et c'est exactement le signal
 * qu'on voudra lire le jour ou un etat parait faux.
 *
 * Ne contient JAMAIS le texte du SMS : il porte le solde du compte de la
 * vendeuse. Seul l'identifiant de transaction y entre.
 */
export interface JournalPreuve {
  kind: "preuve_avancee" | "preuve_refusee";
  at: Date;
  de: ProofState;
  vers: ProofState;
  evenement: EvenementPreuve["type"];
  par: string;
  raison?: RefusTransition;
  operator?: OperatorKey;
  operatorTxId?: string;
  motif?: string;
}

export type ResultatTransition =
  | { ok: true; etat: ProofState; journal: JournalPreuve }
  /** `etat` est l'etat INCHANGE : la transition est ignoree, pas appliquee. */
  | { ok: false; etat: ProofState; raison: RefusTransition; journal: JournalPreuve };

/** Auteur de l'evenement, pour le journal. */
function auteur(e: EvenementPreuve): string {
  return e.type === "sms_analyse" ? "vendeuse" : e.par;
}

/**
 * Etat cible qu'un evenement viserait, sans juger s'il y a droit.
 *
 * Separer « ou ca va » de « est-ce permis » rend les deux testables
 * separement, et rend le refus explicable : on peut dire « ce serait un recul »
 * plutot que « non ».
 */
function cible(e: EvenementPreuve): ProofState {
  switch (e.type) {
    case "declaration_manuelle":
      return "declare_non_trace";
    case "sms_analyse":
      return "prouve";
    case "contresignature":
      return "contresigne";
    case "contestation":
      return "conteste";
  }
}

/**
 * Applique un evenement a un etat de preuve.
 *
 * Renvoie la decision **et** l'entree de journal, dans les deux cas. C'est le
 * meme contrat que `payout-phone.ts` : l'appelant persiste les deux dans la meme
 * transaction, et un refus laisse donc une trace aussi solide qu'une acceptation.
 *
 * `now` est un parametre. Il n'y a pas de valeur par defaut : une horloge par
 * defaut se glisse dans les tests sans qu'on la voie.
 */
export function appliquerEvenement(
  etat: ProofState,
  evenement: EvenementPreuve,
  now: Date,
): ResultatTransition {
  const vers = cible(evenement);

  const journalBase = {
    at: now,
    de: etat,
    vers,
    evenement: evenement.type,
    par: auteur(evenement),
    ...(evenement.type === "sms_analyse"
      ? { operator: evenement.operator, operatorTxId: evenement.operatorTxId }
      : {}),
    ...(evenement.type === "contestation" && evenement.motif ? { motif: evenement.motif } : {}),
  } as const;

  const refus = (raison: RefusTransition): ResultatTransition => ({
    ok: false,
    etat,
    raison,
    journal: { ...journalBase, kind: "preuve_refusee", vers: etat, raison },
  });

  const avance = (): ResultatTransition => ({
    ok: true,
    etat: vers,
    journal: { ...journalBase, kind: "preuve_avancee" },
  });

  /*
   * 1. La contestation passe AVANT tout le reste : elle est atteignable depuis
   *    n'importe quel etat, y compris `contresigne`. C'est voulu — la preuve la
   *    plus forte reste contestable, sinon une collusion a deux voix serait
   *    definitive.
   */
  if (evenement.type === "contestation") {
    if (etat === "conteste") return refus("recul_ignore");
    /**
     * **On ne conteste pas un paiement qui n'existe pas.**
     *
     * Contester veut dire « ce paiement n'est pas de moi ». Sur `attendu`,
     * personne n'a rien verse ni rien declare : il n'y a aucun paiement a
     * desavouer, et l'acheteuse qui appuie veut dire tout autre chose — se
     * raviser, annuler, comprendre. Le produit lui faisait signer un LITIGE :
     * plus de contre-signature, plus d'avis, recu refuse, aucun retour.
     *
     * Mesure du banc, 11/08/2026 : commande creee a 10:08:17, contestee a
     * 10:08:47. Trente secondes.
     *
     * Des qu'un versement est ATTRIBUE — declare non trace, prouve,
     * contresigne — le desaveu retrouve son objet, et la regle du controle 7
     * ne bouge pas : la preuve la plus forte reste contestable, sinon une
     * collusion a deux voix serait definitive.
     */
    if (etat === "attendu") return refus("contestation_sans_paiement");
    return avance();
  }

  /*
   * 2. Un litige ouvert bloque toute avancee. Le resoudre est une action humaine,
   *    hors de ce module : le domaine ne doit pas pouvoir sortir tout seul d'un
   *    desaccord entre deux personnes.
   */
  if (etat === "conteste") return refus("litige_ouvert");

  /*
   * 3. Ce que l'evenement doit prouver de lui-meme, avant toute question d'ordre.
   */
  if (evenement.type === "sms_analyse") {
    if (evenement.verdict === "refuse") return refus("sms_refuse");
    if (!evenement.operatorTxId.trim()) return refus("identifiant_operateur_absent");
    /*
     * Deux cas qui ne prouvent pas, et c'est le coeur du produit :
     *  - `accepte_sous_reserve` vient d'un motif marque « a confirmer » — le SMS
     *    Orange de reception, dont la capture disponible est tronquee ;
     *  - un message de sens `sortant` est celui de l'acheteuse. Il porte le meme
     *    identifiant de transaction, ce qui offre un recoupement gratuit, mais
     *    **seul le SMS recu par la vendeuse peut prouver un paiement** : c'est
     *    elle qui a l'argent, donc son message qui fait autorite. Passer a
     *    `prouve` sur le seul message sortant est un interdit d'AGENTS.md.
     */
    if (evenement.verdict === "accepte_sous_reserve") return refus("preuve_insuffisante");
    if (evenement.sens === "sortant") return refus("preuve_insuffisante");
  }

  if (evenement.type === "contresignature" && etat !== "prouve") {
    /*
     * La contresignature ne cree pas la preuve, elle la renforce. Sans preuve
     * prealable, elle serait une voix seule sur un paiement que personne n'a
     * constate — c'est-a-dire un « oui » sans objet.
     */
    return refus("contresignature_sans_preuve");
  }

  /*
   * 4. L'ordre. Un etat ne RECULE JAMAIS, et une transition vers le meme etat
   *    n'est pas une avancee.
   */
  const rangActuel = rangPreuve(etat);
  const rangCible = rangPreuve(vers);
  if (rangActuel === null || rangCible === null) {
    // Inatteignable : `conteste` est traite plus haut, des deux cotes.
    return refus("transition_interdite");
  }
  if (rangCible <= rangActuel) return refus("recul_ignore");

  return avance();
}

/* ────────────────────────── predicats de sortie ────────────────────────── */

/**
 * Un recu n'est emis que sur une preuve reelle.
 *
 * Le predicat vit dans `packages/contracts` — il est la source de verite des deux
 * cotes de la frontiere HTTP — et il est reexporte ici pour que le domaine n'ait
 * pas a le redeclarer. **`declare_non_trace` n'y ouvre pas droit**, et c'est ce
 * qui donne au recu sa valeur : un depot declare a la main n'est pas une preuve.
 * Le recu lui-meme est produit au lot 10.
 */
export { canIssueReceipt };

/**
 * Un avis « achat verifie » suit la meme regle que le recu.
 *
 * Sans cela, une reputation se batirait sur des declarations, c'est-a-dire
 * s'acheterait — exactement ce que le produit refuse.
 */
export function compteCommeAchatVerifie(etat: ProofState): boolean {
  return canIssueReceipt(etat);
}

/** Le litige est ouvert : plus rien n'avance sans intervention humaine. */
export function estBloque(etat: ProofState): boolean {
  return etat === "conteste";
}

/**
 * Etats depuis lesquels une commande peut encore progresser.
 *
 * Utile a l'interface pour savoir s'il faut proposer « coller le SMS » : une
 * commande contresignee n'a plus rien a apporter, une contestee attend un humain.
 */
export function peutEncoreAvancer(etat: ProofState): boolean {
  return etat !== "contresigne" && etat !== "conteste";
}
