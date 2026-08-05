/**
 * Qui edite Catalog, et ou l'on ecrit — ADR 0041.
 *
 * **Le seul endroit a changer** quand l'entite legale ou l'adresse de contact
 * evoluent. Ces valeurs sont lues par la politique de confidentialite et par
 * le pied de page, c'est-a-dire par les pages qu'un verificateur 360dialog ou
 * Meta ouvre en premier.
 *
 * ── Deux valeurs sont a CONFIRMER par le porteur du produit ───────────────
 *
 * 1. `nom` ne revendique AUCUNE societe, volontairement. Ecrire « SARL » ou un
 *    registre de commerce qui n'existe pas serait faux sur la page meme qui
 *    sert a etablir la confiance — et la verification d'entreprise de Meta
 *    demande un document officiel au meme nom. Le jour ou l'entite existe,
 *    c'est cette ligne qui change, et elle doit alors correspondre EXACTEMENT
 *    au nom d'affichage WhatsApp et au document fourni.
 * 2. `contact` est l'adresse du compte. Une adresse sur le domaine du produit
 *    (`contact@<domaine>`) vaut nettement mieux devant un verificateur : elle
 *    prouve le controle du domaine declare. A changer des que le domaine est
 *    pris.
 */

export const EDITEUR = {
  /** Le nom sous lequel le produit se presente. Sans revendication de societe. */
  nom: "Catalog",
  /** Ou le produit est edite. Il n'y a pas d'adresse postale au Cameroun (ADR 0005). */
  lieu: "Douala, Cameroun",
  /** L'adresse a laquelle on ecrit — y compris pour une suppression de donnees. */
  contact: "swappilot.exchange@gmail.com",
} as const;
