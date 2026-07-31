/**
 * L'ouverture progressive, et l'interrupteur d'arret.
 *
 * Deux mecanismes distincts, dans un seul module parce qu'ils repondent a la
 * meme question — « qui peut faire quoi, maintenant ? » — et qu'un exploitant
 * les manipule le meme jour.
 *
 * ── 1. Les cohortes ────────────────────────────────────────────────────────
 *
 * On n'ouvre pas a tout le monde le meme matin. On ouvre a une vague, on
 * regarde les compteurs du lot 14, on elargit. La vague est calculee par un
 * HACHAGE de l'identifiant de vendeuse, et ce choix a une propriete qu'une
 * liste tiree au sort n'a pas :
 *
 * > **Elle est monotone.** Une vendeuse admise a 10 % l'est encore a 20 %, a
 * > 50 % et a 100 %. Elargir n'a jamais pour effet de refermer la porte a
 * > quelqu'un qui l'avait franchie.
 *
 * C'est la propriete qui rend l'ouverture progressive supportable pour les
 * personnes concernees : une vendeuse qui a mis son catalogue en ligne lundi ne
 * peut pas se retrouver dehors mercredi parce qu'un chiffre a bouge. Un tirage
 * aleatoire ou un `Math.random()` n'offriraient pas cela — et ne seraient pas
 * reproductibles d'un redemarrage a l'autre.
 *
 * La liste explicite (`pilotes`) passe AVANT le pourcentage : c'est par elle
 * qu'on fait entrer les vendeuses de la phase de test terrain, dont on connait
 * les identifiants et dont on ne veut pas dependre d'un hachage.
 *
 * ── 2. L'interrupteur d'arret ──────────────────────────────────────────────
 *
 * Trois positions, et la position intermediaire est la plus importante :
 *
 * | position | ecritures | lectures de recu et de suivi |
 * |---|---|---|
 * | `ouvert` | oui | oui |
 * | `lecture_seule` | **non** | **oui** |
 * | `ferme` | non | non |
 *
 * **`lecture_seule` garde les recus lisibles, et ce n'est pas un detail.** Un
 * recu est une preuve opposable : une acheteuse le montre a une vendeuse, un
 * litige se tranche avec. Le jour ou l'on coupe les ecritures — deploiement
 * fautif, base qui souffre, doute sur une regle —, faire disparaitre en meme
 * temps les preuves deja emises transformerait un incident technique en
 * incident de confiance. La valeur numero un du produit doit survivre a sa
 * propre panne.
 *
 * `ferme` existe pour le cas ou l'integrite des donnees est en doute : servir
 * un recu peut-etre faux est alors pire que n'en servir aucun. C'est une
 * position rare, et elle se justifie par ecrit dans le journal d'incident.
 *
 * Module PUR : aucune horloge, aucun `process.env`, aucune base. La
 * configuration arrive deja lue.
 */

/* ────────────────────────── cohortes ────────────────────────── */

export interface ConfigurationCohorte {
  /**
   * Part des vendeuses admises, de 0 a 100. Hors bornes, la valeur est ramenee
   * dans l'intervalle plutot que refusee : un `-5` saisi en urgence doit fermer,
   * pas planter.
   */
  pourcent: number;
  /** Identifiants admis quel que soit le pourcentage. */
  pilotes: readonly string[];
}

export const COHORTE_OUVERTE: ConfigurationCohorte = { pourcent: 100, pilotes: [] };

/**
 * Le seau d'une vendeuse, de 0 a 99.
 *
 * FNV-1a 32 bits : quatre lignes, aucune dependance, et une repartition
 * suffisamment uniforme pour ce qu'on lui demande. Ce n'est PAS une fonction de
 * hachage cryptographique et ne doit jamais servir a autre chose : elle
 * s'inverse, elle se collisionne, et son seul role est de repartir des
 * identifiants opaques en cent paquets stables.
 *
 * `>>> 0` a chaque tour : sans lui, le decalage a gauche fait passer la valeur
 * en negatif des le 32e bit et le modulo final change de signe.
 */
export function seauDe(identifiant: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < identifiant.length; i += 1) {
    h ^= identifiant.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/** Cette vendeuse est-elle dans la vague ouverte ? */
export function ouvertePour(identifiant: string, config: ConfigurationCohorte): boolean {
  if (config.pilotes.includes(identifiant)) return true;
  const pourcent = Math.min(100, Math.max(0, Math.floor(config.pourcent)));
  if (pourcent <= 0) return false;
  if (pourcent >= 100) return true;
  return seauDe(identifiant) < pourcent;
}

/* ────────────────────────── interrupteur ────────────────────────── */

export type PositionDInterrupteur = "ouvert" | "lecture_seule" | "ferme";

export const POSITIONS: readonly PositionDInterrupteur[] = ["ouvert", "lecture_seule", "ferme"];

/**
 * Lit une position depuis une chaine de configuration.
 *
 * **Une valeur inconnue rend `ouvert`, pas une erreur.** L'inverse serait
 * tentant — « en cas de doute, on ferme » — et serait un defaut : une faute de
 * frappe dans une variable d'environnement mettrait le service a l'arret sans
 * que personne l'ait decide. L'arret est un acte deliberé ; il s'ecrit
 * exactement.
 */
export function positionDepuis(valeur: string | undefined): PositionDInterrupteur {
  const v = String(valeur ?? "")
    .trim()
    .toLowerCase();
  return (POSITIONS as readonly string[]).includes(v) ? (v as PositionDInterrupteur) : "ouvert";
}

/** Ce qu'une requete demande au service. */
export type NatureDeRequete = "lecture" | "ecriture" | "diagnostic";

/**
 * La requete passe-t-elle ?
 *
 * `diagnostic` — `/health` et `/api/statut` — passe TOUJOURS, y compris en
 * position `ferme`. Un service qui se tait completement est un service qu'on ne
 * peut pas superviser, et la page de statut publique est justement ce qu'on
 * regarde quand tout le reste est coupe.
 */
export function autorise(position: PositionDInterrupteur, nature: NatureDeRequete): boolean {
  if (nature === "diagnostic") return true;
  if (position === "ouvert") return true;
  if (position === "ferme") return false;
  return nature === "lecture";
}

/** Message rendu a l'appelant. Il dit ce qui se passe, et ce qui marche encore. */
export const MESSAGE_INTERRUPTEUR: Record<
  Exclude<PositionDInterrupteur, "ouvert">,
  { erreur: string; message: string }
> = {
  lecture_seule: {
    erreur: "service_en_lecture_seule",
    message:
      "Catalog est momentanément en lecture seule : les reçus déjà émis restent consultables, " +
      "mais aucune nouvelle opération n'est enregistrée. Réessayez dans quelques minutes.",
  },
  ferme: {
    erreur: "service_indisponible",
    message:
      "Catalog est momentanément indisponible. L'équipe est prévenue. " +
      "Aucune donnée n'est perdue : rien n'a été enregistré pendant l'interruption.",
  },
};
