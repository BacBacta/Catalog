/**
 * Limitation de debit GENERALE, pour toutes les routes publiques.
 *
 * ── Pourquoi une seconde limitation alors que le lot 4 en a deja une ───────
 *
 * `domain/rate-limit.ts` protege l'envoi d'OTP, et il protege une FACTURE : un
 * SMS coute de l'argent, donc la limite compte des envois reussis, se ventile
 * par numero, et se souvient d'une journee entiere. Rien de tout cela n'a de
 * sens ici. Les routes publiques du recu, du suivi et de la rampe ne coutent
 * pas un franc a l'appel ; ce qu'on borne, c'est le PARCOURS AUTOMATISE —
 * quelqu'un qui essaie des codes de verification en boucle, ou qui martele la
 * contre-signature. La bonne unite est donc la requete par adresse et par
 * fenetre courte, sans notion de reussite.
 *
 * Fusionner les deux aurait produit un module qui fait mal les deux choses.
 *
 * ── Ce que cette limitation NE protege pas, et il faut le savoir ───────────
 *
 * Elle n'empeche pas une attaque repartie sur mille adresses. Aucune limitation
 * applicative ne le fait ; c'est le role du reseau de bordure. Ce qu'elle
 * garantit, c'est qu'une seule machine ne peut pas parcourir l'espace des codes
 * ni saturer la base a elle seule — et, accessoirement, qu'un ilot de la
 * boutique parti en boucle ne mette pas l'API a genoux.
 *
 * **Elle ne remplace pas l'entropie des cles.** Un code de verification tire
 * huit caracteres d'un alphabet de vingt-cinq (~10^11 combinaisons) et un jeton
 * de suivi en porte 192 bits : ni l'un ni l'autre ne se parcourt, limitation ou
 * pas. La limitation est la deuxieme serrure, jamais la premiere.
 *
 * Module PUR : le temps courant et la liste des passages arrivent en
 * parametres. Aucune horloge, aucun stockage, aucun `process.env`.
 */

/** Un passage deja compte : une cle (l'adresse, en general) et son instant. */
export interface Passage {
  cle: string;
  at: Date;
}

export interface RegleDeDebit {
  /** Nombre de requetes tolerees dans la fenetre. */
  max: number;
  /** Largeur de la fenetre glissante, en millisecondes. */
  fenetreMs: number;
}

/**
 * Les regles par famille de route.
 *
 * Trois familles, et les valeurs disent pourquoi elles different :
 *
 * - `lecture` — le recu, le suivi, la rampe, le statut. Une acheteuse qui
 *   rafraichit sa page de suivi en attendant sa commande peut le faire souvent
 *   et legitimement ; 120 par minute laisse deux requetes par seconde en
 *   continu, ce qu'aucune main humaine n'atteint mais qu'un onglet ouvert avec
 *   plusieurs rafraichissements ne franchit pas non plus.
 * - `ecriture` — contre-signature, contestation, avis. Ce sont des gestes
 *   UNIQUES par commande : dix par minute est deja dix fois trop genereux, et
 *   c'est voulu — une acheteuse qui tape deux fois parce que le reseau a laché
 *   ne doit jamais rencontrer un refus.
 * - `preuve` — le collage de SMS. Sous session vendeuse, mais borne quand meme :
 *   c'est le seul point d'entree ou l'on peut ESSAYER quelque chose, en forgeant
 *   des identifiants jusqu'a en trouver un qui passe. Trente par minute est
 *   au-dessus de tout usage reel — une vendeuse colle un SMS par vente — et
 *   tres au-dessous de ce qu'il faudrait pour explorer un espace d'identifiants.
 *
 * Ce sont des VALEURS PAR DEFAUT, remplacables par l'environnement, exactement
 * comme les plafonds d'OTP du lot 4 et pour la meme raison : au Cameroun, la
 * traduction d'adresses des operateurs mobiles fait sortir plusieurs acheteuses
 * par une meme adresse publique. La bonne valeur ne se devine pas depuis un
 * bureau.
 */
export const REGLES_PAR_DEFAUT = {
  lecture: { max: 120, fenetreMs: 60_000 },
  ecriture: { max: 10, fenetreMs: 60_000 },
  preuve: { max: 30, fenetreMs: 60_000 },
} as const satisfies Record<string, RegleDeDebit>;

export type FamilleDeRoute = keyof typeof REGLES_PAR_DEFAUT;

export type DecisionDeDebit =
  | { autorise: true; restant: number }
  | { autorise: false; reessayerDansMs: number };

/**
 * Cette cle a-t-elle encore droit a une requete ?
 *
 * Fenetre GLISSANTE et non fixe. Une fenetre fixe — « 120 par minute civile » —
 * autorise 240 requetes en deux secondes a cheval sur le changement de minute,
 * ce qui est exactement le pic qu'on veut empecher.
 */
export function verifierDebit(
  passages: readonly Passage[],
  demande: { cle: string; now: Date },
  regle: RegleDeDebit,
): DecisionDeDebit {
  const t = demande.now.getTime();
  const dansLaFenetre = passages.filter(
    (p) => p.cle === demande.cle && t - p.at.getTime() < regle.fenetreMs,
  );

  if (dansLaFenetre.length < regle.max) {
    return { autorise: true, restant: regle.max - dansLaFenetre.length - 1 };
  }

  const plusAncienne = Math.min(...dansLaFenetre.map((p) => p.at.getTime()));
  return { autorise: false, reessayerDansMs: Math.max(1, plusAncienne + regle.fenetreMs - t) };
}

/** Secondes entieres a annoncer dans `Retry-After`. Jamais zero : zero invite a boucler. */
export function secondesAvantReprise(d: DecisionDeDebit): number {
  return d.autorise ? 0 : Math.max(1, Math.ceil(d.reessayerDansMs / 1000));
}

/**
 * Les regles, lues dans la configuration.
 *
 * Une valeur non numerique ou negative est **ignoree** au profit du defaut :
 * une faute de frappe dans la configuration ne doit pas ouvrir la vanne. Meme
 * regle que `limitesDepuisEnv` du lot 4, meme raison.
 */
export function reglesDepuisEnv(
  env: Record<string, string | undefined>,
): Record<FamilleDeRoute, RegleDeDebit> {
  const n = (cle: string, defaut: number): number => {
    const v = Number(env[cle]);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : defaut;
  };
  const d = REGLES_PAR_DEFAUT;
  return {
    lecture: {
      max: n("DEBIT_LECTURE_MAX", d.lecture.max),
      fenetreMs: n("DEBIT_LECTURE_FENETRE_MS", d.lecture.fenetreMs),
    },
    ecriture: {
      max: n("DEBIT_ECRITURE_MAX", d.ecriture.max),
      fenetreMs: n("DEBIT_ECRITURE_FENETRE_MS", d.ecriture.fenetreMs),
    },
    preuve: {
      max: n("DEBIT_PREUVE_MAX", d.preuve.max),
      fenetreMs: n("DEBIT_PREUVE_FENETRE_MS", d.preuve.fenetreMs),
    },
  };
}

/**
 * Retire les passages sortis de toutes les fenetres.
 *
 * Sans elagage, la memoire du processus croit avec le trafic et ne redescend
 * jamais : c'est une fuite, et elle se declare le jour de pic, pas avant. Le
 * calcul du seuil est fait par l'appelant, qui connait la plus large fenetre.
 */
export function elaguer(passages: readonly Passage[], avant: Date): Passage[] {
  const t = avant.getTime();
  return passages.filter((p) => p.at.getTime() >= t);
}
