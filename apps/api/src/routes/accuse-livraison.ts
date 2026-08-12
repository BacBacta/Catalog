import { Hono } from "hono";
import { interpreter, lireAccuse, operateurProbable } from "../domain/sms/livraison.ts";
import { mesurerLivraisonSms } from "../observabilite/mesures.ts";

/**
 * `POST /api/sms/accuse/:secret` — l'accuse de livraison d'Orange.
 *
 * ── Comment on sait que c'est bien Orange ─────────────────────────────────
 *
 * On ne le sait pas, et il faut le dire franchement : **Orange ne signe pas ses
 * rappels.** Il n'y a ni en-tete d'authentification, ni empreinte du corps. La
 * documentation demande de faire inscrire l'URL sur une liste blanche chez eux,
 * ce qui protege dans un sens — Orange n'appelle que nous — mais pas dans
 * l'autre : n'importe qui connaissant l'URL peut poster.
 *
 * D'ou le secret dans le CHEMIN, qui est l'idiome deja retenu par ce depot pour
 * le lien de suivi de l'acheteuse (ADR 0021). Ce qu'il apporte exactement :
 *
 * - un tiers qui ignore le secret ne peut pas fabriquer de fausses mesures ;
 * - il ne protege PAS d'une fuite du secret, ni d'un rejeu.
 *
 * C'est proportionne a l'enjeu, et l'enjeu est modeste : **cette route ne
 * touche a rien.** Elle n'ecrit aucune commande, ne change aucun etat de preuve,
 * n'autorise personne. Elle incremente un compteur. Le pire qu'un attaquant qui
 * connaitrait le secret puisse faire, c'est fausser un tableau de bord — pas
 * voler un franc.
 *
 * C'est aussi pourquoi elle ne consulte pas la base : rien a lire, rien a
 * ecrire, donc rien a ralentir le jour ou la base souffre.
 *
 * ── Elle repond TOUJOURS 200, sauf mauvais secret ─────────────────────────
 *
 * Orange attend un `200 OK`. Lui rendre une erreur sur un corps qu'on ne
 * comprend pas ne ferait revenir personne — l'accuse serait perdu de toute
 * facon —, et ferait en plus sonner une alarme de leur cote pour un defaut qui
 * est le notre. On accepte, on compte ce qu'on a compris, et un corps
 * illisible devient une mesure `illisible` plutot qu'un silence.
 */

export interface AccuseDeps {
  /**
   * Le secret attendu dans le chemin. **Absent, la route n'existe pas** — c'est
   * un refus de demarrer plutot qu'une porte ouverte par defaut.
   */
  secret: string;
}

export function accuseLivraisonRoutes(deps: AccuseDeps) {
  const r = new Hono();

  r.post("/accuse/:secret", async (c) => {
    /**
     * Comparaison a longueur constante, pour ne pas laisser deviner le secret
     * caractere par caractere. Le gain est theorique sur un reseau, le cout est
     * nul, et l'inverse serait difficile a defendre dans une revue.
     */
    const fourni = c.req.param("secret");
    if (!egalConstant(fourni, deps.secret)) return c.json({ erreur: "inconnu" }, 404);

    const corps = await c.req.json().catch(() => null);
    const accuse = lireAccuse(corps);

    if (!accuse) {
      mesurerLivraisonSms({ operateur: "inconnu", etat: "inconnu", statut: "illisible" });
      return c.json({ recu: true }, 200);
    }

    const verdict = interpreter(accuse.statut);
    /**
     * **La ventilation par operateur est la raison d'etre de cette route.** Un
     * ecart systematique entre les prefixes MTN et Orange ne s'explique pas par
     * des telephones eteints : il dit que l'application est souscrite a la
     * mauvaise offre Orange, et c'est le seul controle automatique de cette
     * couverture (voir `adapters/sms-orange.ts`).
     *
     * Le NUMERO lui-meme n'est pas une etiquette : sa cardinalite est infinie,
     * et c'est une donnee personnelle qui n'a rien a faire dans un systeme de
     * metriques. Meme regle que pour l'identifiant d'operateur du lot 14.
     */
    mesurerLivraisonSms({
      operateur: operateurProbable(accuse.numero),
      etat: verdict.etat,
      statut: accuse.statut,
    });

    return c.json({ recu: true }, 200);
  });

  return r;
}

/**
 * Comparaison sans court-circuit sur la premiere difference.
 *
 * `timingSafeEqual` de `node:crypto` exige deux tampons de meme longueur et
 * leve sinon — ce qui reintroduit la fuite qu'on veut eviter. Cette version
 * compare toujours la totalite, longueur comprise.
 */
function egalConstant(a: string | undefined, b: string): boolean {
  const gauche = a ?? "";
  if (gauche.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < b.length; i += 1) ecart |= gauche.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}
