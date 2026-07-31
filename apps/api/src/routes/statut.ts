import { Hono } from "hono";
import type { PositionDInterrupteur } from "../domain/deploiement/ouverture.ts";

/**
 * `GET /api/statut` — ce que la page de statut publique affiche.
 *
 * ── Ce que cette route DIT, et ce qu'elle refuse de dire ───────────────────
 *
 * Elle rend trois choses que le processus connait reellement : la position de
 * l'interrupteur, la joignabilite de la base, et le message d'incident qu'un
 * exploitant a ecrit a la main. Rien d'autre.
 *
 * En particulier, **elle n'annonce aucun pourcentage de disponibilite** et
 * **elle ne dit rien de la sante des formats de SMS**. Les deux seraient des
 * chiffres inventes :
 *
 * - une disponibilite se mesure depuis l'exterieur, sur une fenetre, par
 *   quelque chose qui survit a la panne. Un service qui calcule sa propre
 *   disponibilite affiche 100 % exactement quand il est incapable de repondre ;
 * - le canari de formats (lot 14) tourne en integration continue, pas dans ce
 *   processus. L'API ne sait pas s'il est vert. Afficher « formats SMS : OK »
 *   serait une affirmation qu'aucun code ne soutient — et c'est precisement la
 *   ligne que Catalog ne franchit pas (AGENTS.md §7.7).
 *
 * Ce que la page dit a la place : ou l'information existe vraiment.
 *
 * ── La sonde de base est mise en cache, et ce n'est pas une optimisation ───
 *
 * Une page de statut est consultee au moment ou tout le monde a un probleme.
 * Si chaque consultation ouvrait une requete, la page de statut ajouterait sa
 * propre charge a la panne qu'elle decrit. La sonde est donc partagee entre
 * tous les appelants pendant quelques secondes.
 */

export interface StatutDeps {
  /** Sonde de base. Doit rendre `false` plutot que lever. */
  baseJoignable: () => Promise<boolean>;
  position: () => PositionDInterrupteur;
  /** Message d'incident ecrit a la main par l'exploitant. */
  message?: () => string | null;
  version?: string;
  maintenant?: () => Date;
  /** Duree de validite de la sonde, en millisecondes. */
  cacheMs?: number;
}

/** Ce que l'API rend. Vocabulaire ferme : la page publique le traduit. */
export type NiveauDeStatut = "ok" | "degrade" | "interrompu";

export function niveauDe(position: PositionDInterrupteur, baseJoignable: boolean): NiveauDeStatut {
  if (position === "ferme") return "interrompu";
  /**
   * Base injoignable : les recus ne se lisent plus, donc ce n'est pas
   * « degrade », c'est interrompu. Le dire franchement vaut mieux qu'un vert
   * pale que personne ne croit.
   */
  if (!baseJoignable) return "interrompu";
  return position === "lecture_seule" ? "degrade" : "ok";
}

export function statutRoutes(deps: StatutDeps) {
  const cacheMs = deps.cacheMs ?? 5_000;
  let sonde: { a: number; joignable: boolean } | null = null;

  async function baseJoignable(now: Date): Promise<boolean> {
    if (sonde && now.getTime() - sonde.a < cacheMs) return sonde.joignable;
    const joignable = await deps.baseJoignable().catch(() => false);
    sonde = { a: now.getTime(), joignable };
    return joignable;
  }

  return new Hono().get("/", async (c) => {
    const now = deps.maintenant?.() ?? new Date();
    const position = deps.position();
    const joignable = await baseJoignable(now);
    const niveau = niveauDe(position, joignable);

    c.header("Access-Control-Allow-Origin", "*");
    // Cinq secondes : une page de statut perimee est pire qu'inutile, mais sans
    // aucun cache elle amplifie la panne qu'elle decrit.
    c.header("Cache-Control", "public, max-age=5");

    return c.json(
      {
        niveau,
        service: position,
        base: joignable ? "joignable" : "injoignable",
        /**
         * Les lectures de recu marchent-elles ? C'est LA question de
         * l'acheteuse : un recu est une preuve opposable, et elle veut savoir
         * si elle peut la montrer maintenant.
         */
        recusConsultables: niveau !== "interrompu",
        /** Les ecritures : payer, contresigner, coller un SMS. */
        operationsPossibles: niveau === "ok",
        message: deps.message?.() ?? null,
        version: deps.version ?? null,
        a: now.toISOString(),
      },
      // 200 meme en panne : le code de statut HTTP decrit la reponse a CETTE
      // requete, pas l'etat du service. Un 503 ici empecherait une supervision
      // de distinguer « la page de statut est tombee » de « le service est
      // arrete », qui sont deux incidents differents.
      200,
    );
  });
}
