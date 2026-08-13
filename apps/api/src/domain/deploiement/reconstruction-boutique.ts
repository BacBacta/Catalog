/**
 * Quand la boutique publique doit se reconstruire — ADR 0065.
 *
 * ── Pourquoi une reconstruction, et pas une lecture ────────────────────────
 *
 * `apps/shop` lit un instantane JSON pris a la CONSTRUCTION et ne parle jamais
 * a la base (lot 6). C'est ce qui tient les 30 Ko de JavaScript, le LCP, et ce
 * qui fait qu'une page de boutique survit a une API tombee. La regle de
 * dependance est inversee EXPRES.
 *
 * Le prix de ce choix a ete mesure le 11/08/2026 : `chez-bea-test` et
 * `chez-oumar`, deux boutiques nees dans le fil WhatsApp, repondaient **404**.
 * Elles avaient des articles, une carte-vitrine, des commandes — et aucune
 * page web. Rien ne le disait a la vendeuse, et rien ne la lui donnait.
 *
 * On ne renonce donc pas a l'instantane : on le RAFRAICHIT quand ce que
 * l'acheteuse voit a change.
 *
 * ── Ce module est PUR ──────────────────────────────────────────────────────
 *
 * Il ne connait ni le mecanisme de deploiement, ni la file d'attente, ni
 * l'horloge. Il repond a une seule question : « cet evenement-la, a cet
 * instant-la, justifie-t-il un deploiement ? » — et le temps entre en
 * parametre, comme partout dans `src/domain`.
 */

/**
 * **La liste est FERMEE**, pour la meme raison que celle des gabarits
 * (ADR 0054) : une reconstruction coute un deploiement entier. Elle ne part
 * que sur un evenement qui change ce que l'ACHETEUSE voit sur la page.
 *
 * Ce qui n'y est PAS, et pourquoi :
 * - une commande creee, payee, livree — la boutique n'affiche pas les
 *   commandes ;
 * - le numero de reversement — il n'a rien a faire sur une page en cache CDN.
 */
export const MOTIFS_RECONSTRUCTION = [
  /** Une boutique vient de naitre : elle n'a encore AUCUNE page. */
  "boutique_creee",
  /** Un article publie, retire, renomme, reprice. */
  "article_publie",
  /** Le nom, la ville, la description de la boutique ont change. */
  "boutique_modifiee",
  /** Le mode conges — la page doit dire que la boutique est fermee (ADR 0039). */
  "conges_bascules",
  /**
   * Un avis VERIFIE depose — revision du 13/08/2026. La premiere version
   * l'excluait (« il arrive trop souvent pour justifier un deploiement a lui
   * seul ») ; l'analyse des surfaces a montre le cout reel de l'exclusion :
   * sans autre evenement, le PREMIER avis verifie d'une jeune boutique — son
   * evenement de credibilite — restait invisible sans limite de temps. Le
   * regroupement absorbe la frequence ; l'exclusion n'absorbait rien, elle
   * reportait sine die. L'avis NON verifie, lui, ne parait pas sur la page —
   * il ne reconstruit rien.
   */
  "avis_verifie",
] as const;

export type MotifReconstruction = (typeof MOTIFS_RECONSTRUCTION)[number];

/**
 * Le REGROUPEMENT.
 *
 * Une vendeuse qui publie sa collection d'un coup — le geste le plus naturel
 * du premier jour — declencherait un deploiement par photo. Une demande qui
 * arrive dans cette fenetre est absorbee par celle qui court deja : elle sera
 * dans le meme instantane, puisque celui-ci est pris au demarrage de la
 * construction, pas a la demande.
 */
export const REGROUPEMENT_S = 10 * 60;

/**
 * Ce qu'on ANNONCE a la vendeuse.
 *
 * Il doit couvrir le regroupement PLUS la construction elle-meme, sinon la
 * promesse est fausse des la premiere fois — et une promesse fausse sur la
 * seule chose qu'elle attend vaut moins que le silence.
 */
export const ATTENTE_ANNONCEE_MIN = Math.ceil(REGROUPEMENT_S / 60) + 5;

/**
 * Ce qu'on annonce quand le regroupement est SAUTE — la naissance d'une
 * boutique. Il ne reste que la chaine de verification et la construction,
 * mesurees le 12/08/2026 : trois minutes de porte, deux de construction et de
 * mise en ligne. On annonce cinq, pas quatre : une promesse tenue de justesse
 * est une promesse qu'on finira par manquer.
 */
export const ATTENTE_SANS_REGROUPEMENT_MIN = 5;

export type DecisionReconstruction =
  | { reconstruire: true; motif: MotifReconstruction; attenteAnnonceeMinutes: number }
  | { reconstruire: false; raison: "motif_inconnu" | "deja_demandee" };

export function decisionReconstruction(entree: {
  motif: MotifReconstruction;
  /** Quand une reconstruction a ete demandee pour la derniere fois. */
  derniereDemandeA: Date | null;
  maintenant: Date;
}): DecisionReconstruction {
  if (!MOTIFS_RECONSTRUCTION.includes(entree.motif)) {
    return { reconstruire: false, raison: "motif_inconnu" };
  }

  /**
   * ── La NAISSANCE d'une boutique ne se regroupe pas ─────────────────────
   *
   * Le regroupement existe pour absorber une rafale : une vendeuse qui publie
   * sa collection declencherait un deploiement par photo. Une naissance n'est
   * jamais une rafale — elle n'arrive qu'une fois par boutique, et c'est
   * exactement le moment ou la vendeuse regarde.
   *
   * Mesure du 12/08/2026 : une boutique creee dans le fil pouvait attendre
   * jusqu'a dix minutes derriere la fenetre d'une AUTRE vendeuse avant meme
   * que la construction commence. Du point de vue de celle qui vient de
   * s'inscrire, « ma page n'existe pas » et « ma page arrive dans quinze
   * minutes » se ressemblent beaucoup trop.
   *
   * Le cout de l'exemption est borne par construction : une boutique ne peut
   * naitre qu'une fois, donc ce chemin ne peut pas s'emballer.
   */
  if (entree.motif !== "boutique_creee" && entree.derniereDemandeA) {
    const ecoule = (entree.maintenant.getTime() - entree.derniereDemandeA.getTime()) / 1000;
    if (ecoule < REGROUPEMENT_S) return { reconstruire: false, raison: "deja_demandee" };
  }

  return {
    reconstruire: true,
    motif: entree.motif,
    /**
     * Ce qu'on annonce depend du chemin qu'on vient de prendre. Une naissance
     * ne traverse pas le regroupement : lui annoncer quinze minutes serait
     * faux dans le sens qui coute — la vendeuse renoncerait a regarder.
     */
    attenteAnnonceeMinutes:
      entree.motif === "boutique_creee" ? ATTENTE_SANS_REGROUPEMENT_MIN : ATTENTE_ANNONCEE_MIN,
  };
}
