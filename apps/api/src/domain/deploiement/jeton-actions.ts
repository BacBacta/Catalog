/**
 * Le jeton d'identite d'une execution GitHub Actions — ADR 0070.
 *
 * ── Le probleme qu'il resout ──────────────────────────────────────────────
 *
 * La boutique publique se construit a partir d'un INSTANTANE du catalogue, pris
 * dans le job `boutique` de `.github/workflows/deploiement.yml`. Jusqu'ici cet
 * instantane etait produit en interrogeant la base de production DEPUIS
 * l'integration continue — ce qui exigeait d'y deposer `DATABASE_URL`, la
 * chaine de connexion complete, identifiant et mot de passe compris.
 *
 * Un secret de base de production dans un fournisseur d'integration continue,
 * c'est la cle du coffre confiee au coursier. Il n'y est pas necessaire :
 * l'API, elle, a deja cette chaine, legitimement, parce que c'est son travail.
 * Elle peut donc SERVIR l'instantane, et la construction n'a plus qu'a le
 * demander.
 *
 * Reste a savoir a qui on le sert. L'instantane rassemble, en un seul appel,
 * le numero WhatsApp de TOUTES les vendeuses actives. Chacun de ces numeros est
 * deja publie — c'est le bouton « ecrire a la vendeuse » de sa page —, mais
 * une page a la fois. Un point d'entree qui les rend d'un bloc transforme un
 * catalogue en liste de diffusion. La difference est reelle, meme si la donnee
 * ne l'est pas : on ne l'ouvre pas.
 *
 * ── Pourquoi PAS un jeton partage ─────────────────────────────────────────
 *
 * La reponse habituelle serait un secret commun, pose des deux cotes. Elle
 * echoue ici pour une raison de fond : ce secret devrait etre INVENTE, puis
 * TRANSMIS a un humain pour qu'il le recopie. Un secret qui traverse une
 * conversation est un secret publie — c'est exactement la dette ouverte que le
 * depot traine deja. On ne la creuse pas pour economiser trente lignes.
 *
 * GitHub signe, sur demande, un jeton court decrivant l'execution en cours :
 * quel depot, quelle reference, quel workflow. Sa cle publique est publiee. Il
 * n'y a donc **aucun secret a poser nulle part** — ni chez GitHub, ni chez Fly.
 * L'API verifie une signature et lit un nom de depot, qui n'est pas un secret
 * et qu'elle connait deja : c'est celui qu'elle reveille (`DeclencheurDispatch`).
 *
 * ── Ce module est PUR ─────────────────────────────────────────────────────
 *
 * Il ne recupere aucune cle, n'ouvre aucune connexion, ne lit pas l'horloge :
 * la SIGNATURE est verifiee par l'adaptateur, les REVENDICATIONS le sont ici.
 * C'est la separation habituelle de `src/domain` — et elle a un interet propre
 * ici : les regles d'acceptation se lisent et se testent sans reseau ni cle.
 */

/** L'emetteur des jetons d'Actions. Valeur fixe, publiee par GitHub. */
export const EMETTEUR_ACTIONS = "https://token.actions.githubusercontent.com";

/**
 * L'audience demandee par le workflow et exigee ici.
 *
 * Elle est CHOISIE par nous, et c'est ce qui compte : un jeton demande pour un
 * autre usage — le plus courant etant `sts.amazonaws.com` — ne vaut pas pour
 * cette route, meme s'il vient du bon depot. Une audience laissee au defaut
 * ferait de tout jeton du depot une cle pour l'instantane.
 */
export const AUDIENCE_INSTANTANE = "catalog-instantane";

/** Ce qu'on tolere de decalage d'horloge, en secondes, dans les deux sens. */
export const TOLERANCE_HORLOGE_S = 60;

/**
 * Les revendications qu'on lit. Le jeton en porte davantage ; ce qui n'est pas
 * ici n'entre dans aucune decision.
 */
export interface RevendicationsActions {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  repository?: unknown;
}

export type VerdictJeton = { ok: true } | { ok: false; motif: MotifRefus };

/**
 * Vocabulaire FERME des refus. Il sort dans les traces et jamais dans la
 * reponse HTTP : dire a un appelant refuse *pourquoi* il l'est lui apprend la
 * forme du jeton attendu.
 */
export type MotifRefus =
  | "emetteur"
  | "audience"
  | "depot"
  | "expire"
  | "pas_encore_valide"
  | "revendications_absentes";

function audienceContient(aud: unknown, attendue: string): boolean {
  if (typeof aud === "string") return aud === attendue;
  if (Array.isArray(aud)) return aud.some((a) => a === attendue);
  return false;
}

/** Les noms de depot GitHub ne sont pas sensibles a la casse. */
function memeDepot(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export interface EntreeVerification {
  revendications: RevendicationsActions;
  /** `proprietaire/depot`, tel que l'API le connait deja. */
  depotAttendu: string;
  audienceAttendue?: string;
  maintenant: Date;
  toleranceSecondes?: number;
}

/**
 * Les regles d'acceptation, dans l'ordre ou elles sont evaluees.
 *
 * ── Ce qui n'est PAS verifie, et pourquoi ─────────────────────────────────
 *
 * La reference (`ref`) ne l'est pas. L'exiger sur `refs/heads/main` paraitrait
 * plus sur, mais cela interdirait de rejouer le deploiement depuis une branche
 * — ce qu'on fait justement pour EPROUVER la chaine avant de la fusionner. Or
 * la frontiere de confiance n'est pas la branche : quiconque peut pousser une
 * branche sur ce depot peut deja en lire le contenu et declencher ce workflow.
 * Le depot est la bonne granularite ; la branche donnerait l'illusion d'une
 * barriere qui n'en est pas une.
 */
export function verifierRevendications(entree: EntreeVerification): VerdictJeton {
  const { revendications: r, depotAttendu, maintenant } = entree;
  const audience = entree.audienceAttendue ?? AUDIENCE_INSTANTANE;
  const tolerance = (entree.toleranceSecondes ?? TOLERANCE_HORLOGE_S) * 1000;

  if (r.iss !== EMETTEUR_ACTIONS) return { ok: false, motif: "emetteur" };
  if (!audienceContient(r.aud, audience)) return { ok: false, motif: "audience" };

  if (typeof r.repository !== "string" || r.repository.length === 0) {
    return { ok: false, motif: "revendications_absentes" };
  }
  if (!memeDepot(r.repository, depotAttendu)) return { ok: false, motif: "depot" };

  /**
   * `exp` est OBLIGATOIRE. Un jeton sans date de fin serait valable pour
   * toujours ; l'absence se traite comme un refus, jamais comme « pas de
   * limite ».
   */
  if (typeof r.exp !== "number") return { ok: false, motif: "revendications_absentes" };
  if (r.exp * 1000 + tolerance <= maintenant.getTime()) return { ok: false, motif: "expire" };

  if (typeof r.nbf === "number" && r.nbf * 1000 - tolerance > maintenant.getTime()) {
    return { ok: false, motif: "pas_encore_valide" };
  }

  return { ok: true };
}
