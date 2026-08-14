/**
 * La forme du recu — SANS Zod, comme `phone.ts` et `ussd.ts`.
 *
 * Ce module part dans le NAVIGATEUR : la page publique de verification et la
 * page de suivi de l'acheteuse l'importent. Une fonction destinee au navigateur
 * ne partage pas son module avec un schema (voir l'en-tete de `phone.ts`).
 *
 * **Il n'y a qu'UNE declaration de cette forme dans le depot.** Le domaine de
 * l'API la manipule avec de vraies dates, la boutique la recoit en JSON avec des
 * chaines ISO : c'est le meme type, parametre par sa representation du temps.
 * Redeclarer la forme des deux cotes de la frontiere, c'est se donner rendez-vous
 * avec une divergence silencieuse — AGENTS.md l'interdit.
 */

/**
 * Comment controler le paiement aupres de l'operateur.
 *
 * Le code vient de la CONFIGURATION de la rampe, jamais d'un gabarit de recu :
 * un recu qui figerait un code enverrait l'acheteuse sur un code faux le jour ou
 * l'operateur en change.
 */
export interface MarcheAsuivre {
  /** Le code d'entree de l'operateur, tel qu'il est configure. */
  codeOperateur: string;
  /** `false` si quelqu'un a retire le drapeau du code d'entree. On le dit. */
  codeVerifie: boolean;
  etapes: string[];
  /** Les intitules de menu n'ont pas ete releves : l'interface le signale. */
  etapesAConfirmer: boolean;
}

/**
 * Le recu.
 *
 * `D` est la representation du temps : `Date` cote serveur, `string` une fois
 * passe par JSON.
 */
export interface Recu<D = Date> {
  reference: string;
  code: string;
  boutique: string;
  operateur: { cle: string; nom: string };
  /** Le coeur du recu : l'identifiant que l'operateur peut confirmer. */
  operatorTxId: string;
  montantXaf: number;
  totalXaf: number;
  /** Ce qui reste du : un recu partiel est un recu, pas un solde efface. */
  resteXaf: number;
  /** Date lue dans le SMS de l'operateur. */
  survenuA: D | null;
  /** Date a laquelle Catalog a constate — jamais confondue avec la precedente. */
  constateA: D;
  contresigneA: D | null;
  etat: string;
  /** Le motif de SMS est-il reconstitue ? Le recu le porte, sans le cacher. */
  aConfirmer: boolean;
  marcheAsuivre: MarcheAsuivre;
}

/** Le recu tel qu'il arrive du reseau. */
export type RecuJson = Recu<string>;

/** Pourquoi il n'y a pas de recu. Un refus NOMME, jamais une page vide. */
export type RefusRecu =
  /** Aucune commande ne porte ce code. */
  | "code_inconnu"
  /**
   * Depot direct declare a la main. Il fait avancer la commande, il ne donne
   * PAS de recu — c'est precisement ce qui donne sa valeur au recu.
   */
  | "declare_non_trace"
  /** La preuve n'est pas encore apportee. */
  | "preuve_absente"
  /** Une partie dement. Le recu se retire, la preuve reste. */
  | "conteste";

/**
 * Ce qu'un refus veut dire, pour quelqu'un qui verifie un paiement.
 *
 * **Un refus explicite, jamais une page vide.** Une personne a qui l'on montre un
 * reçu doit savoir si le code est faux, si le paiement n'a pas ete prouve, ou
 * s'il est conteste — ces trois situations n'appellent pas la meme decision.
 */
export const MESSAGE_REFUS: Record<RefusRecu, { titre: string; detail: string }> = {
  code_inconnu: {
    titre: "Aucun reçu ne porte ce code",
    detail:
      "Vérifiez les caractères saisis. Si le code est bien celui qu'on vous a donné, alors aucun " +
      "paiement n'a été prouvé pour cette commande : n'expédiez rien et n'envoyez pas d'argent.",
  },
  declare_non_trace: {
    titre: "Paiement déclaré à la main, sans reçu",
    detail:
      "Le/la vendeur/se déclare avoir reçu l'argent, mais aucun SMS d'opérateur ne l'atteste. " +
      "Il n'y a donc rien à vérifier auprès de l'opérateur, et pas de reçu.",
  },
  preuve_absente: {
    titre: "Le paiement n'est pas encore prouvé",
    detail:
      "Aucun SMS d'opérateur n'a encore été apporté pour cette commande. Le reçu apparaîtra " +
      "quand le/la vendeur/se aura collé le message reçu de son opérateur.",
  },
  conteste: {
    titre: "Ce paiement est contesté",
    detail:
      "Une des deux parties dément. La preuve apportée n'a pas été effacée, mais le reçu ne " +
      "s'affiche plus tant que le désaccord n'est pas réglé.",
  },
};
