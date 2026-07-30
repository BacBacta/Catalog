import type { RampeConfig } from "@catalog/contracts/ussd";
import { Hono } from "hono";

/**
 * `GET /api/rampe` — la configuration de la rampe de paiement.
 *
 * **Publique et sans authentification**, parce que c'est une ACHETEUSE qui la
 * lit, depuis la boutique statique, avant toute notion de compte. Elle ne
 * contient rien de sensible : des codes d'operateur que tout le monde compose
 * chaque jour, et les etapes ecrites.
 *
 * C'est ce point d'entree qui rend la promesse tenable : un operateur change son
 * code, on change une variable d'environnement et on redemarre l'API. **Aucune
 * reconstruction de la boutique, aucun redeploiement du front.** Si la valeur
 * etait figee a la construction du site statique, elle serait fausse pendant des
 * heures — et une chaine USSD fausse n'echoue pas proprement, elle ouvre un menu
 * inattendu.
 *
 * `Access-Control-Allow-Origin: *` : la boutique est servie depuis un autre
 * domaine que l'API. La ressource est publique et en lecture seule, il n'y a
 * rien a proteger d'un autre site — mais on n'ouvre que CETTE route.
 */
export function rampeRoutes(config: RampeConfig) {
  return new Hono().get("/", (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    // Une minute : assez pour amortir une rafale, assez peu pour qu'un
    // changement de code arrive vite chez les acheteuses.
    c.header("Cache-Control", "public, max-age=60");
    return c.json(config);
  });
}
