import {
  decisionReconstruction,
  type MotifReconstruction,
} from "../domain/deploiement/reconstruction-boutique.ts";
import { fetchBorne } from "./fetch-borne.ts";

/**
 * Le declencheur de reconstruction de la boutique publique — ADR 0065, revise
 * par l'ADR 0068.
 *
 * ── Ce qu'il fait, et ce qu'il ne sait pas ────────────────────────────────
 *
 * Il DEMANDE une reconstruction, par l'un de deux transports. Il ne sait rien
 * du resultat : une construction dure des minutes, l'accuse revient en
 * millisecondes. Cet accuse n'est donc PAS une garantie de mise en ligne, et
 * aucun texte ne doit le presenter comme telle.
 *
 * ── Deux transports, et pourquoi le second existe ─────────────────────────
 *
 * 1. `crochet` — une URL fournie par l'hebergeur, qui relance SA construction.
 * 2. `dispatch` — un `repository_dispatch` GitHub, qui reveille le workflow de
 *    deploiement.
 *
 * Le premier etait le choix d'origine. Mesure du 11/08/2026 : le projet Vercel
 * de la boutique **n'est relie a aucun depot**, et un crochet de deploiement
 * suppose un projet relie — il ne peut donc pas en avoir. Le crochet ne
 * pouvait pas atteindre la boutique, quelle que soit l'URL.
 *
 * Il n'est pas retire pour autant : le jour ou la boutique serait reliee a un
 * depot, il redevient le transport le plus simple. Voir l'ADR 0068 pour la
 * raison — non evidente — qui fait qu'on ne l'a PAS reliee.
 *
 * ── Absent par defaut ─────────────────────────────────────────────────────
 *
 * Sans variables, rien n'est monte et rien ne part — meme regime que
 * `PAYMENT_AGGREGATOR_ENABLED` (AGENTS.md §5) et que les Flows. Un
 * environnement de developpement ne redeploie pas la production parce qu'on y
 * a cree un article de test.
 *
 * ── Jamais fatal ──────────────────────────────────────────────────────────
 *
 * Une reconstruction ratee ne doit JAMAIS empecher la publication d'un
 * article. La vendeuse a fait son geste, il est enregistre ; la page web
 * suivra a la prochaine occasion. C'est la meme lecon que le Flow refuse du
 * banc du 10/08 : ce qui est en plus ne casse pas ce qui est essentiel.
 *
 * ── Aucun secret dans les traces — ADR 0023 ───────────────────────────────
 *
 * Ni l'URL du crochet, ni le jeton, ni le CORPS des reponses. Un message
 * d'erreur d'hebergeur peut refleter l'URL appelee ; un message de GitHub peut
 * refleter l'en-tete recu. Seul le code HTTP est journalise.
 */

export interface DeclencheurReconstruction {
  /**
   * Demande une reconstruction. Rend `true` si elle a ete DEMANDEE — pas si
   * elle a abouti, ce qu'on ne peut pas savoir d'ici.
   */
  demander(motif: MotifReconstruction): Promise<boolean>;
}

/**
 * Le regroupement, partage par les deux transports.
 *
 * La date se pose AVANT l'envoi : deux publications simultanees ne doivent pas
 * produire deux constructions parce que la premiere n'avait pas encore repondu.
 *
 * Il vit EN MEMOIRE. Le mettre en base ajouterait une table et une migration
 * pour economiser une construction occasionnelle — le mauvais cote de
 * l'echange. En revanche, avec plusieurs instances d'API, chacune a son
 * compteur : le regroupement est un plancher, pas une garantie. Dit ici plutot
 * que decouvert un jour de facture.
 */
class Regroupement {
  readonly #maintenant: () => Date;
  #derniereDemandeA: Date | null = null;

  constructor(maintenant?: (() => Date) | undefined) {
    this.#maintenant = maintenant ?? (() => new Date());
  }

  autorise(motif: MotifReconstruction): boolean {
    const maintenant = this.#maintenant();
    const decision = decisionReconstruction({
      motif,
      derniereDemandeA: this.#derniereDemandeA,
      maintenant,
    });
    if (!decision.reconstruire) return false;
    this.#derniereDemandeA = maintenant;
    return true;
  }
}

/** Journalise le SEUL code HTTP — jamais le corps, jamais l'URL, jamais le jeton. */
function refus(quoi: string, statut: number): false {
  console.warn(`boutique : ${quoi} refusee (HTTP ${statut})`);
  return false;
}

function injoignable(quoi: string): false {
  console.warn(`boutique : ${quoi} injoignable (details retenus)`);
  return false;
}

export interface ReconstructionConfig {
  hookUrl: string;
  fetchImpl?: typeof fetch | undefined;
  maintenant?: (() => Date) | undefined;
}

/** Transport 1 — le crochet de l'hebergeur. */
export class DeclencheurCrochet implements DeclencheurReconstruction {
  readonly #hookUrl: string;
  readonly #fetch: typeof fetch;
  readonly #regroupement: Regroupement;

  constructor(cfg: ReconstructionConfig) {
    if (!cfg.hookUrl) {
      throw new Error(
        "Declencheur de reconstruction sans URL de crochet. " +
          "Ne le construisez pas quand SHOP_REBUILD_HOOK_URL est absente.",
      );
    }
    this.#hookUrl = cfg.hookUrl;
    /* Borne : un appel du bot echoue ou finit, jamais « il attend ». */
    this.#fetch = fetchBorne(cfg.fetchImpl ?? fetch);
    this.#regroupement = new Regroupement(cfg.maintenant);
  }

  async demander(motif: MotifReconstruction): Promise<boolean> {
    if (!this.#regroupement.autorise(motif)) return false;
    try {
      const r = await this.#fetch(this.#hookUrl, { method: "POST" });
      return r.ok ? true : refus("reconstruction", r.status);
    } catch {
      return injoignable("reconstruction");
    }
  }
}

/** L'evenement attendu par `.github/workflows/deploiement.yml`. */
export const EVENEMENT_DISPATCH = "reconstruction-boutique";

export interface DispatchConfig {
  /** `proprietaire/depot`. Pas un secret — le jeton, lui, en est un. */
  depot: string;
  jeton: string;
  environnement?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  maintenant?: (() => Date) | undefined;
}

/**
 * Transport 2 — `repository_dispatch` GitHub.
 *
 * Le workflow refait l'instantane du catalogue depuis la base, reconstruit la
 * boutique et la deploie par `vercel deploy apps/shop/dist`. C'est ce chemin-la
 * qui garde `dist/` comme racine DEPLOYEE, donc qui garde la politique de
 * securite et les reecritures `/v/*` et `/suivi/*` (ADR 0067).
 *
 * **Le dispatch ne fonctionne que depuis la branche par defaut** : GitHub ne
 * lit le fichier de workflow que la. Une branche de travail ne peut pas s'en
 * servir, et c'est normal.
 */
export class DeclencheurDispatch implements DeclencheurReconstruction {
  readonly #depot: string;
  readonly #jeton: string;
  readonly #environnement: string;
  readonly #fetch: typeof fetch;
  readonly #regroupement: Regroupement;

  constructor(cfg: DispatchConfig) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.depot)) {
      throw new Error(
        `Depot de reconstruction mal forme : « ${cfg.depot} ». ` +
          "Attendu « proprietaire/depot ».",
      );
    }
    if (!cfg.jeton) {
      throw new Error(
        "Declencheur de reconstruction sans jeton. " +
          "Ne le construisez pas quand SHOP_REBUILD_GITHUB_TOKEN est absente.",
      );
    }
    this.#depot = cfg.depot;
    this.#jeton = cfg.jeton;
    this.#environnement = cfg.environnement?.trim() || "preproduction";
    /* Borne : un appel du bot echoue ou finit, jamais « il attend ». */
    this.#fetch = fetchBorne(cfg.fetchImpl ?? fetch);
    this.#regroupement = new Regroupement(cfg.maintenant);
  }

  async demander(motif: MotifReconstruction): Promise<boolean> {
    if (!this.#regroupement.autorise(motif)) return false;
    try {
      const r = await this.#fetch(`https://api.github.com/repos/${this.#depot}/dispatches`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#jeton}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
          "user-agent": "catalog-api",
        },
        body: JSON.stringify({
          event_type: EVENEMENT_DISPATCH,
          /* Le motif voyage pour que la page des executions dise POURQUOI
             celle-ci est partie. L'environnement designe le projet Vercel. */
          client_payload: { motif, environnement: this.#environnement },
        }),
      });
      return r.ok ? true : refus("reconstruction", r.status);
    } catch {
      return injoignable("reconstruction");
    }
  }
}

/**
 * Le declencheur, ou `null` quand rien n'est configure — et c'est le cas
 * NORMAL en developpement. L'appelant teste `?.` et ne s'en occupe plus.
 *
 * Le dispatch l'emporte quand ses deux variables sont la : c'est le seul des
 * deux qui atteint aujourd'hui la boutique (ADR 0068). Le crochet reste le
 * repli, pour le jour ou elle serait reliee a un depot.
 */
export function declencheurDepuisEnv(
  env: NodeJS.ProcessEnv = process.env,
): DeclencheurReconstruction | null {
  const depot = env.SHOP_REBUILD_GITHUB_REPO?.trim();
  const jeton = env.SHOP_REBUILD_GITHUB_TOKEN?.trim();
  if (depot && jeton) {
    return new DeclencheurDispatch({
      depot,
      jeton,
      environnement: env.SHOP_REBUILD_ENVIRONNEMENT?.trim(),
    });
  }
  const hookUrl = env.SHOP_REBUILD_HOOK_URL?.trim();
  if (!hookUrl) return null;
  return new DeclencheurCrochet({ hookUrl });
}
