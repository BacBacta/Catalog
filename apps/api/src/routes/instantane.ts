import { Hono } from "hono";
import type { Instantane } from "../adapters/instantane-catalogue.ts";
import type { VerificateurJeton } from "../adapters/jeton-actions-github.ts";

/**
 * `GET /api/instantane` — la photo du catalogue dont la boutique est construite.
 *
 * ── A quoi elle sert ──────────────────────────────────────────────────────
 *
 * Le job `boutique` de `.github/workflows/deploiement.yml` a besoin de
 * l'instantane pour construire les pages. Il l'obtenait en interrogeant la base
 * de production, ce qui exigeait d'y deposer `DATABASE_URL`. Depuis l'ADR 0070,
 * il le DEMANDE ici : le secret de la base reste du seul cote qui en a besoin.
 *
 * ── Pourquoi elle n'est PAS publique, alors que la donnee l'est ────────────
 *
 * Chaque champ servi est deja sur une page de boutique. Mais une page a la
 * fois : reunir en un appel le numero WhatsApp de toutes les vendeuses actives
 * change la nature de la chose. On ne construit pas la liste de diffusion de
 * ses propres vendeuses.
 *
 * ── L'authentification ne coute AUCUN secret ──────────────────────────────
 *
 * L'appelant presente le jeton d'identite que GitHub signe pour l'execution en
 * cours. L'API verifie la signature avec une cle publique et lit le nom du
 * depot. Rien n'a ete invente, rien n'a ete transmis a un humain, rien n'est a
 * faire tourner un jour.
 *
 * ── Dormante sans configuration ───────────────────────────────────────────
 *
 * Sans `SHOP_REBUILD_GITHUB_REPO`, aucun verificateur n'est construit et la
 * route n'est pas montee — meme regime que le declencheur de reconstruction,
 * dont elle partage la variable.
 */

export interface InstantaneDeps {
  verificateur: VerificateurJeton;
  construire: () => Promise<Instantane>;
}

/**
 * Le refus ne dit PAS pourquoi.
 *
 * « audience invalide » apprend a l'appelant qu'il a le bon depot et la
 * mauvaise audience — c'est-a-dire la moitie de ce qu'il cherche. Le motif
 * ferme du domaine sert au diagnostic depuis les journaux du serveur, pas
 * depuis la reponse.
 */
const REFUS = { erreur: "non_autorise" } as const;

export function instantaneRoutes(deps: InstantaneDeps) {
  return new Hono().get("/", async (c) => {
    const entete = c.req.header("authorization") ?? "";
    const jeton = /^bearer\s+(.+)$/i.exec(entete.trim())?.[1]?.trim();
    if (!jeton) return c.json(REFUS, 401);

    const verdict = await deps.verificateur.verifier(jeton);
    if (!verdict.ok) {
      console.warn(`instantane : jeton refuse (${verdict.motif})`);
      return c.json(REFUS, 403);
    }

    /**
     * `no-store` : cette reponse porte les numeros de toutes les vendeuses
     * actives. Elle ne doit dormir dans aucun cache intermediaire, et il n'y a
     * rien a economiser — quelques appels par jour, un par deploiement.
     */
    c.header("Cache-Control", "no-store");
    return c.json(await deps.construire());
  });
}
