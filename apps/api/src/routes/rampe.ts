import type { RampeConfig } from "@catalog/contracts/ussd";
import { Hono } from "hono";
import { avecSpan, PARCOURS, poser } from "../observabilite/traces.ts";

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
  /**
   * Le drapeau `verifie` de chaque operateur, une fois pour toutes.
   *
   * Il voyage dans la trace parce que c'est la question qu'on se posera devant
   * un pic d'echecs de paiement : est-ce qu'on sert un raccourci que PERSONNE
   * n'a jamais compose a Douala ? Tant que ce drapeau est faux, la reponse est
   * oui, et ce n'est pas un defaut — c'est l'inconnue de terrain n° 2
   * (AGENTS.md §10) rendue visible la ou on la cherchera.
   */
  const tousVerifies = config.operateurs.every((o) =>
    o.raccourcis.every((r) => r.verifie === true),
  );

  return new Hono().get("/", (c) =>
    avecSpan(PARCOURS.rampeOuverte, {}, async (span) => {
      poser(span, { "catalog.rampe.code_verifie": tousVerifies });
      c.header("Access-Control-Allow-Origin", "*");
      // Une minute : assez pour amortir une rafale, assez peu pour qu'un
      // changement de code arrive vite chez les acheteuses.
      c.header("Cache-Control", "public, max-age=60");
      return c.json(config);
    }),
  );
}
