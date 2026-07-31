import type { MiddlewareHandler } from "hono";
import { type ConfigurationCohorte, ouvertePour } from "../domain/deploiement/ouverture.ts";
import { type SessionDeps, vendeuseCourante } from "../routes/seller.ts";

/**
 * Le garde d'ouverture progressive.
 *
 * ── Il ne bloque JAMAIS une lecture ────────────────────────────────────────
 *
 * Une vendeuse hors de la vague voit tout ce qu'elle possede : son catalogue,
 * ses commandes, ses statistiques. Seules les ECRITURES sont retenues, avec un
 * message qui dit pourquoi et que ce n'est pas de sa faute.
 *
 * La regle inverse — cacher les donnees de quelqu'un parce qu'un pourcentage
 * n'est pas encore monte — serait a la fois cruelle et absurde : le risque
 * qu'une ouverture progressive cherche a borner est celui des ecritures
 * nouvelles, pas celui d'un `SELECT` que la base sert depuis des mois.
 *
 * ── Il ne s'applique qu'a l'app vendeuse ───────────────────────────────────
 *
 * Le parcours ACHETEUSE n'est jamais gate. Une acheteuse ne choisit pas sa
 * vendeuse en fonction de nos vagues de deploiement : si elle a un lien de
 * suivi, elle doit pouvoir contresigner, point. Refuser la contre-signature de
 * l'acheteuse d'une vendeuse hors vague casserait le controle n° 7 pour une
 * raison qui ne la regarde pas.
 *
 * ── Le cout : une resolution de session de plus ────────────────────────────
 *
 * Ce garde resout la session, et la route en aval la resoudra encore. C'est une
 * requete de base supplementaire sur les seules ecritures de l'app vendeuse —
 * quelques dizaines par jour et par vendeuse. Le prix est assume : le partage
 * du resultat via le contexte creerait un couplage entre ce garde et chaque
 * route, et ce couplage se casserait a la premiere route ecrite sans lui.
 */

export interface OptionsCohorte {
  session: SessionDeps;
  config: () => ConfigurationCohorte;
}

/** Les prefixes de l'app vendeuse. Le parcours acheteuse n'y figure pas. */
const PREFIXES_VENDEUSE = [
  "/api/articles",
  "/api/commandes",
  "/api/reversement",
  "/api/vendeuse",
] as const;

export function estEcritureVendeuse(methode: string, chemin: string): boolean {
  if (methode === "GET" || methode === "HEAD" || methode === "OPTIONS") return false;
  return PREFIXES_VENDEUSE.some((p) => chemin === p || chemin.startsWith(`${p}/`));
}

export function gardeDeCohorte(options: OptionsCohorte): MiddlewareHandler {
  return async (c, next) => {
    if (!estEcritureVendeuse(c.req.method, new URL(c.req.url).pathname)) return next();

    const config = options.config();
    // Cohorte grande ouverte : aucune resolution de session, aucun cout.
    if (config.pourcent >= 100) return next();

    const v = await vendeuseCourante(options.session, c.req.raw);
    // Pas de session, ou pas encore de profil : ce n'est pas a ce garde de
    // trancher. La route en aval rendra son 401 ou son 409, qui sont plus precis.
    if (!v?.seller) return next();

    if (ouvertePour(v.seller.id, config)) return next();

    return c.json(
      {
        erreur: "hors_cohorte",
        message:
          "Votre boutique n'est pas encore activée pour cette étape de l'ouverture. " +
          "Vos articles et vos commandes restent consultables ; les modifications " +
          "seront possibles très bientôt.",
      },
      403,
    );
  };
}
