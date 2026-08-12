/**
 * Les gabarits utilitaires — ADR 0054.
 *
 * ── Pourquoi ils existent ──────────────────────────────────────────────────
 *
 * Notre bot n'initie jamais une conversation (ADR 0034) : hors de la fenetre
 * de 24 h ouverte par un message entrant, une notification ATTEND en base
 * jusqu'a la prochaine interaction. Elle n'est jamais perdue — mais une
 * commande arrivee a 21 h un vendredi n'est pas remise avant que la vendeuse
 * ne reecrive, et **elle ne peut pas provoquer l'ouverture d'une fenetre dont
 * elle ignore l'existence**.
 *
 * Le gabarit est la seule facon d'ouvrir cette porte. Meta le facture : c'est
 * la seule ligne de cout variable du produit, et c'est ce qui fait du
 * « Catalog previent » un palier payant defendable.
 *
 * ── Pourquoi la liste est FERMEE ───────────────────────────────────────────
 *
 * Un gabarit ne se declenche que sur un evenement qui a DEJA de la valeur :
 * une commande creee, un paiement prouve, une remise faite, un acompte
 * attendu, un reversement absent. Une boutique qui genere du cout est, par
 * construction, une boutique qui vend.
 *
 * ── Les regles de Meta, tenues par des tests ──────────────────────────────
 *
 * Categorie `utility` uniquement — un gabarit utilitaire qui fait de la
 * promotion est refuse, et une serie de refus abime la note de qualite du
 * numero. Variables numerotees a partir de 1, sans trou. Jamais de variable
 * en tete ni en fin de corps. Pas de double saut de ligne, pas d'espace en
 * fin de ligne. Un parametre ne porte jamais de saut de ligne.
 *
 * ── Ce que ce module n'est PAS ─────────────────────────────────────────────
 *
 * Il ne sait pas si un gabarit est APPROUVE. Personne ne le sait sans
 * demander a Meta, et une approbation peut etre retiree. L'envoi tente, et
 * l'appelant retombe sur la file d'attente si Meta refuse — la notification
 * n'est jamais perdue, dans aucun cas.
 */

export type Langue = "fr" | "en";

/** Les evenements qui MERITENT d'ouvrir une fenetre facturee. */
export type SujetNotification =
  | "nouvelle_commande"
  | "paiement_prouve"
  | "commande_livree"
  | "acompte_attendu"
  | "reversement_absent"
  | "paiement_conteste";

export interface Gabarit {
  /**
   * Le nom depose chez Meta. Minuscules, chiffres, soulignes.
   *
   * ── Pourquoi « _v2 » alors qu'il n'y a jamais eu de v1 ────────────────────
   *
   * Le 08/08/2026, les cinq premiers depots ont ete refuses faute d'exemples,
   * puis SUPPRIMES pour etre redeposes proprement. Chez Meta la suppression
   * est asynchrone et le nom reste retenu — jusqu'a 30 jours. Un nom neuf, lui,
   * passe sur-le-champ.
   *
   * Le nom n'est JAMAIS vu par personne : ni la vendeuse, ni l'acheteuse, qui
   * ne lisent que le texte. C'est un identifiant technique. Le suffixe est
   * donc le prix d'une manoeuvre ratee, pas la trace d'une version — et il ne
   * se cherche pas de v1.
   */
  nom: string;
  categorie: "utility";
  /** Combien de `{{n}}` le corps attend. */
  variables: number;
  corps: Record<Langue, string>;
  /**
   * Un EXEMPLE par variable — ADR 0054, ajoute apres le refus du 08/08/2026.
   *
   * Meta ne peut pas juger « {{1}} » : il exige un echantillon pour lire le
   * message comme la personne le lira. Sans lui, le depot est refuse avec
   * `INVALID_FORMAT`, sans un mot de plus. Mesure : les dix gabarits refuses
   * d'un coup, puis deux essais temoins — celui qui portait un exemple est
   * passe en examen, l'autre non.
   *
   * Ils vivent ICI et pas dans le script de depot : ce sont les valeurs que
   * Meta relit a chaque revision, elles meritent d'etre versionnees et
   * testees comme le reste.
   */
  exemples: string[];
  /** A qui il s'adresse — pour choisir la langue du fil. */
  destinataire: "vendeuse" | "acheteuse";
}

export const GABARITS: Record<SujetNotification, Gabarit> = {
  nouvelle_commande: {
    nom: "catalog_nouvelle_commande_v2",
    categorie: "utility",
    variables: 3,
    destinataire: "vendeuse",
    corps: {
      fr: "Nouvelle commande {{1}} sur votre boutique Catalog.\nTotal : {{2}}.\nÀ livrer : {{3}}.\nRépondez à ce message pour voir le détail et coller le SMS de paiement.",
      en: "New order {{1}} on your Catalog shop.\nTotal: {{2}}.\nDeliver to: {{3}}.\nReply to this message to see the details and paste the payment SMS.",
    },
    exemples: ["CT-482910", "15 000 FCFA", "Bafoussam, Banengo, en face du marché A"],
  },
  paiement_prouve: {
    nom: "catalog_paiement_prouve_v2",
    categorie: "utility",
    variables: 2,
    destinataire: "acheteuse",
    corps: {
      fr: "Votre paiement pour la commande {{1}} est confirmé.\nMontant reçu : {{2}}.\nRépondez à ce message pour voir votre reçu.",
      en: "Your payment for order {{1}} is confirmed.\nAmount received: {{2}}.\nReply to this message to see your receipt.",
    },
    exemples: ["CT-482910", "7 500 FCFA"],
  },
  commande_livree: {
    nom: "catalog_commande_livree_v2",
    categorie: "utility",
    variables: 1,
    destinataire: "acheteuse",
    corps: {
      fr: "Votre commande {{1}} est marquée comme remise.\nRépondez à ce message pour la confirmer ou signaler un souci.",
      en: "Your order {{1}} has been marked as handed over.\nReply to this message to confirm it or report a problem.",
    },
    exemples: ["CT-482910"],
  },
  acompte_attendu: {
    nom: "catalog_acompte_attendu_v2",
    categorie: "utility",
    variables: 2,
    destinataire: "acheteuse",
    corps: {
      fr: "Votre commande {{1}} attend encore un acompte de {{2}}.\nRépondez à ce message pour reprendre le paiement.",
      en: "Your order {{1}} is still waiting for a deposit of {{2}}.\nReply to this message to continue the payment.",
    },
    exemples: ["CT-482910", "7 500 FCFA"],
  },
  /**
   * L'acheteuse dement le paiement — ADR 0036, et c'est le sujet le plus
   * urgent des trois qui manquaient.
   *
   * La contre-signature donne a l'acheteuse un bouton « ce n'est pas moi ».
   * Sans ce gabarit, la vendeuse ne l'apprend qu'a sa prochaine visite dans le
   * fil — et une contestation decouverte trois jours plus tard est un litige
   * devenu insoluble. C'est la valeur n° 1 du produit, la preuve opposable,
   * qui se retournerait contre celle qu'elle est censee proteger.
   *
   * **Le nom ne porte pas de suffixe**, et ce n'est pas un oubli : celui des
   * cinq autres est le prix de la manoeuvre ratee du 08/08, pas une marque de
   * version. Un nom neuf passe sur-le-champ.
   */
  paiement_conteste: {
    nom: "catalog_paiement_conteste",
    categorie: "utility",
    variables: 1,
    destinataire: "vendeuse",
    corps: {
      fr: "L'acheteuse de la commande {{1}} ne reconnaît pas ce paiement.\nLa commande est gelée : elle n'avance plus tant que le désaccord n'est pas réglé.\nRépondez à ce message pour en parler.",
      en: "The buyer of order {{1}} does not recognise this payment.\nThe order is frozen: it will not move until the disagreement is settled.\nReply to this message to discuss it.",
    },
    exemples: ["CT-482910"],
  },
  reversement_absent: {
    nom: "catalog_reversement_absent_v2",
    categorie: "utility",
    variables: 1,
    destinataire: "vendeuse",
    corps: {
      fr: "Votre boutique {{1}} n'a pas encore de numéro de reversement.\nSans lui, vos clientes ne peuvent pas vous payer depuis Catalog.\nRépondez à ce message pour le poser.",
      en: "Your shop {{1}} does not have a payout number yet.\nWithout it, your customers cannot pay you through Catalog.\nReply to this message to set it up.",
    },
    exemples: ["Chez Amina"],
  },
};

/** Le gabarit d'un sujet, ou `null` — on n'en invente jamais un. */
export function gabaritPour(sujet: SujetNotification): Gabarit | null {
  return GABARITS[sujet] ?? null;
}

/**
 * Combien de variables manquent. Envoyer un gabarit incomplet le fait rejeter
 * par Meta ; le DIRE permet a l'appelant de retomber sur la file d'attente.
 */
export function variablesManquantes(g: Gabarit, parametres: readonly string[]): number {
  return Math.max(0, g.variables - parametres.filter((p) => p.trim() !== "").length);
}
