import { Hono } from "hono";
import type { ConsoleSmsSender } from "../adapters/sms-console.ts";

/**
 * Point d'entree de DEVELOPPEMENT : relire le dernier code envoye a un numero.
 *
 * Il existe pour une seule raison : permettre au test de bout en bout de
 * parcourir le vrai chemin d'authentification. Le fournisseur factice garde les
 * messages en memoire, mais Playwright tourne dans un autre processus et ne peut
 * pas les lire — sans cette route, le test devrait simuler l'API, et il ne
 * prouverait plus rien du serveur.
 *
 * **Il refuse de se monter des que le fournisseur SMS n'est pas le factice.**
 * Ce n'est pas un reglage a part qu'on pourrait oublier d'eteindre : le meme objet
 * qui rend la route utile est celui qui refuse de se construire en production
 * (`ConsoleSmsSender`). Il n'y a donc aucun etat ou cette route existe et livre
 * de vrais codes.
 */

export interface DevOtpDeps {
  /** `null` quand le fournisseur actif n'est pas le factice. */
  console: ConsoleSmsSender | null;
  env?: { NODE_ENV?: string | undefined } | undefined;
}

/** `null` = ne rien monter. L'appelant ne monte pas la route. */
export function devOtpRoutes(deps: DevOtpDeps): Hono | null {
  const env = deps.env ?? process.env;
  if (env.NODE_ENV === "production") return null;
  if (!deps.console) return null;
  const sender = deps.console;

  return new Hono().get("/dernier-code", (c) => {
    const numero = c.req.query("numero");
    if (!numero) return c.json({ erreur: "numero requis" }, 422);
    const code = sender.dernierCode(numero);
    if (!code) return c.json({ erreur: "aucun_code" }, 404);
    return c.json({ code });
  });
}
