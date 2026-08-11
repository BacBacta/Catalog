import {
  decisionReconstruction,
  type MotifReconstruction,
} from "../domain/deploiement/reconstruction-boutique.ts";

/**
 * Le declencheur de reconstruction de la boutique publique — ADR 0065.
 *
 * ── Ce qu'il fait, et ce qu'il ne sait pas ────────────────────────────────
 *
 * Il envoie une requete a un CROCHET de deploiement — une URL fournie par
 * l'hebergeur, qui relance la construction. Il ne sait rien du resultat :
 * une construction dure des minutes, le crochet repond en millisecondes.
 * L'accuse de reception n'est donc PAS une garantie de mise en ligne, et
 * aucun texte ne doit le presenter comme telle.
 *
 * ── Absent par defaut ─────────────────────────────────────────────────────
 *
 * Sans `SHOP_REBUILD_HOOK_URL`, rien n'est monte et rien ne part — meme
 * regime que `PAYMENT_AGGREGATOR_ENABLED` (AGENTS.md §5) et que les Flows.
 * Un environnement de developpement ne redeploie pas la production parce
 * qu'on y a cree un article de test.
 *
 * ── Jamais fatal ──────────────────────────────────────────────────────────
 *
 * Une reconstruction ratee ne doit JAMAIS empecher la publication d'un
 * article. La vendeuse a fait son geste, il est enregistre ; la page web
 * suivra a la prochaine occasion. C'est la meme lecon que le Flow refuse du
 * banc du 10/08 : ce qui est en plus ne casse pas ce qui est essentiel.
 */

export interface DeclencheurReconstruction {
  /**
   * Demande une reconstruction. Rend `true` si elle a ete DEMANDEE — pas si
   * elle a abouti, ce qu'on ne peut pas savoir d'ici.
   */
  demander(motif: MotifReconstruction): Promise<boolean>;
}

export interface ReconstructionConfig {
  hookUrl: string;
  fetchImpl?: typeof fetch | undefined;
  maintenant?: (() => Date) | undefined;
}

export class DeclencheurCrochet implements DeclencheurReconstruction {
  readonly #cfg: ReconstructionConfig;
  readonly #fetch: typeof fetch;
  /**
   * La derniere demande, EN MEMOIRE.
   *
   * Le regroupement n'a pas besoin de survivre a un redemarrage : au pire, un
   * deploiement de plus part apres une bascule de version. Le mettre en base
   * ajouterait une table et une migration pour economiser une construction
   * occasionnelle — c'est le mauvais cote de l'echange.
   *
   * En revanche, avec plusieurs instances d'API, chacune a son compteur : le
   * regroupement est donc un plancher, pas une garantie. Dit ici plutot que
   * decouvert un jour de facture.
   */
  #derniereDemandeA: Date | null = null;

  constructor(cfg: ReconstructionConfig) {
    if (!cfg.hookUrl) {
      throw new Error(
        "Declencheur de reconstruction sans URL de crochet. " +
          "Ne le construisez pas quand SHOP_REBUILD_HOOK_URL est absente.",
      );
    }
    this.#cfg = cfg;
    this.#fetch = cfg.fetchImpl ?? fetch;
  }

  async demander(motif: MotifReconstruction): Promise<boolean> {
    const maintenant = this.#cfg.maintenant?.() ?? new Date();
    const decision = decisionReconstruction({
      motif,
      derniereDemandeA: this.#derniereDemandeA,
      maintenant,
    });
    if (!decision.reconstruire) return false;

    /* La date se pose AVANT l'envoi : deux publications simultanees ne doivent
       pas produire deux constructions parce que la premiere n'avait pas encore
       repondu. */
    this.#derniereDemandeA = maintenant;

    try {
      const r = await this.#fetch(this.#cfg.hookUrl, { method: "POST" });
      if (!r.ok) {
        /* Le corps n'est PAS recopie : l'URL du crochet est un secret, et un
           message d'erreur d'hebergeur peut la refleter (ADR 0023). */
        console.warn(`boutique : reconstruction refusee (HTTP ${r.status})`);
        return false;
      }
      return true;
    } catch {
      console.warn("boutique : reconstruction injoignable (details retenus)");
      return false;
    }
  }
}

/**
 * Le declencheur, ou `null` quand la variable est absente — et c'est le cas
 * NORMAL en developpement. L'appelant teste `?.` et ne s'en occupe plus.
 */
export function declencheurDepuisEnv(
  env: NodeJS.ProcessEnv = process.env,
): DeclencheurReconstruction | null {
  const hookUrl = env.SHOP_REBUILD_HOOK_URL?.trim();
  if (!hookUrl) return null;
  return new DeclencheurCrochet({ hookUrl });
}
