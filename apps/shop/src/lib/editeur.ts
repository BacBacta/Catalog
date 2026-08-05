/**
 * Qui edite Catalog — ADR 0041.
 *
 * **Le seul endroit a changer.** Ces valeurs sont lues par la page d'accueil et
 * par la politique de confidentialite, c'est-a-dire par les pages qu'un
 * verificateur 360dialog ou Meta ouvre en premier.
 *
 * Elles viennent du REGISTRE DE COMMERCE (declaration de constitution de
 * personne morale, greffe du Tribunal de Premiere Instance de Douala-Ndokoti,
 * inscription du 28 mai 2019). Elles ne se retapent pas de memoire : la
 * verification d'entreprise de Meta compare le site au document fourni, et une
 * incoherence — un mot de la denomination, un chiffre du capital — fait
 * echouer le dossier et coute un nouveau depot.
 *
 * ── `Catalog` et `Horizon Services` ne sont pas la meme chose ─────────────
 *
 * `Catalog` est le PRODUIT (ADR 0010). `Horizon Services` est la SOCIETE qui
 * l'edite. Le nom d'affichage WhatsApp doit correspondre a l'un des deux et
 * rester coherent avec le document depose — c'est une decision du porteur du
 * produit, pas un detail d'implementation.
 */

export const EDITEUR = {
  /** Le nom du PRODUIT (ADR 0010) : majuscule, sans « ue ». */
  produit: "Catalog",

  /** La denomination sociale, telle qu'elle figure au registre. */
  societe: "HORIZON SERVICES",
  /** Societe a responsabilite limitee pluripersonnelle. */
  forme: "SARL pluripersonnelle",
  capitalXaf: 1_000_000,
  /**
   * Numero d'immatriculation.
   *
   * ⚠️ Lu sur un champ MANUSCRIT du registre. Les quatre derniers chiffres
   * doivent etre confirmes d'un coup d'oeil sur l'original avant toute
   * publication : un numero faux sur une page publique est une mention legale
   * fausse, et c'est exactement ce qu'un verificateur recoupe.
   */
  rccm: "RC/DLA/2019/B/1183",
  /** Il n'existe pas d'adresse postale au Cameroun (ADR 0005) : la boite l'est. */
  siege: "B.P. 1524, Douala, Cameroun",
  gerant: "Clovis Raoul Tsannang Nguimfack",

  /**
   * L'adresse a laquelle on ecrit — y compris pour une suppression de donnees.
   * Une adresse sur le domaine du produit vaudrait mieux devant un
   * verificateur : elle prouve le controle du domaine declare.
   */
  contact: "swappilot.exchange@gmail.com",
} as const;
