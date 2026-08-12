import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  AUDIENCE_INSTANTANE,
  EMETTEUR_ACTIONS,
  TOLERANCE_HORLOGE_S,
  type VerdictJeton,
  verifierRevendications,
} from "../domain/deploiement/jeton-actions.ts";

/**
 * Verificateur du jeton d'identite d'une execution GitHub Actions — ADR 0070.
 *
 * Il fait UNE chose que le domaine ne peut pas faire : recuperer les cles
 * publiques de GitHub et verifier la signature. Les regles d'acceptation —
 * emetteur, audience, depot, fraicheur — restent dans
 * `domain/deploiement/jeton-actions.ts`, ou elles se lisent sans reseau.
 *
 * ── L'ensemble de cles est distant, et mis en cache par `jose` ────────────
 *
 * `createRemoteJWKSet` garde les cles en memoire et ne rappelle GitHub que
 * lorsqu'une signature designe une cle inconnue — c'est ce qui rend une
 * rotation de cle transparente sans redemarrage. Le premier appel apres un
 * demarrage paie donc un aller-retour ; il n'y en a que quelques-uns par jour,
 * un par deploiement de boutique.
 *
 * ── La liste d'algorithmes est FERMEE ─────────────────────────────────────
 *
 * `algorithms: ["RS256"]` n'est pas une precaution de style. Sans liste, un
 * jeton peut declarer l'algorithme avec lequel il veut etre verifie — la
 * confusion d'algorithme, la premiere faille de toute implementation de JWT.
 * GitHub signe en RS256 ; on n'accepte que cela.
 */

export interface VerificateurJeton {
  verifier(jeton: string): Promise<VerdictJeton>;
}

export interface JetonActionsConfig {
  /** `proprietaire/depot`. Pas un secret. */
  depot: string;
  audience?: string | undefined;
  maintenant?: (() => Date) | undefined;
  /** Point d'injection des tests : evite un vrai ensemble de cles distant. */
  resoudre?: ((jeton: string) => Promise<Record<string, unknown>>) | undefined;
}

const URL_JWKS = new URL(`${EMETTEUR_ACTIONS}/.well-known/jwks`);

export class VerificateurJetonActions implements VerificateurJeton {
  readonly #depot: string;
  readonly #audience: string;
  readonly #maintenant: () => Date;
  readonly #resoudre: (jeton: string) => Promise<Record<string, unknown>>;

  constructor(cfg: JetonActionsConfig) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.depot)) {
      throw new Error(
        `Depot mal forme pour la verification du jeton : « ${cfg.depot} ». ` +
          "Attendu « proprietaire/depot ».",
      );
    }
    this.#depot = cfg.depot;
    this.#audience = cfg.audience?.trim() || AUDIENCE_INSTANTANE;
    this.#maintenant = cfg.maintenant ?? (() => new Date());
    this.#resoudre = cfg.resoudre ?? defautResoudre();
  }

  async verifier(jeton: string): Promise<VerdictJeton> {
    let revendications: Record<string, unknown>;
    try {
      revendications = await this.#resoudre(jeton);
    } catch {
      /**
       * Signature invalide, cle introuvable, GitHub injoignable : de
       * l'exterieur c'est le meme refus. Le detail ne sort pas — ni dans la
       * reponse, ni dans une trace (ADR 0023).
       */
      return { ok: false, motif: "emetteur" };
    }
    return verifierRevendications({
      revendications,
      depotAttendu: this.#depot,
      audienceAttendue: this.#audience,
      maintenant: this.#maintenant(),
    });
  }
}

/**
 * L'ensemble de cles n'est construit qu'au PREMIER appel : un processus qui ne
 * sert jamais l'instantane n'ouvre jamais de connexion vers GitHub.
 */
function defautResoudre(): (jeton: string) => Promise<Record<string, unknown>> {
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  return async (jeton) => {
    jwks ??= createRemoteJWKSet(URL_JWKS);
    const { payload } = await jwtVerify(jeton, jwks, {
      algorithms: ["RS256"],
      issuer: EMETTEUR_ACTIONS,
      clockTolerance: TOLERANCE_HORLOGE_S,
    });
    return payload as Record<string, unknown>;
  };
}

/**
 * Le verificateur, ou `null` quand le depot n'est pas configure — et alors la
 * route n'est pas montee du tout. Meme regime que le declencheur de
 * reconstruction, avec lequel il partage sa variable : c'est le meme depot, vu
 * dans les deux sens. L'API le reveille, il revient chercher l'instantane.
 */
export function verificateurDepuisEnv(
  env: NodeJS.ProcessEnv = process.env,
): VerificateurJeton | null {
  const depot = env.SHOP_REBUILD_GITHUB_REPO?.trim();
  if (!depot) return null;
  return new VerificateurJetonActions({ depot });
}
