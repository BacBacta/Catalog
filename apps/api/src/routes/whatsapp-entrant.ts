import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { lireMessagesEntrants, type MessageEntrant } from "../domain/connexion-whatsapp.ts";

/**
 * `POST /api/whatsapp/entrant/:secret` — les messages recus par le numero
 * WhatsApp de Catalog, livres par le webhook Meta. Voir l'ADR 0027.
 *
 * C'est la moitie « reception » de la connexion par WhatsApp entrant : le
 * message pre-rempli de la vendeuse arrive ici, avec son numero atteste par
 * Meta dans `wa_id`.
 *
 * Deux serrures, parce que deux menaces distinctes :
 *
 * - **le secret d'URL** (compare a longueur constante, comme l'accuse de
 *   livraison) coupe le bruit d'internet et la force brute d'adresse ;
 * - **la signature `X-Hub-Signature-256`** — HMAC du corps BRUT avec le secret
 *   d'application Meta — prouve que la livraison vient de Meta. Sans elle,
 *   n'importe qui connaissant l'URL pourrait fabriquer un faux message entrant,
 *   c'est-a-dire se connecter au compte de n'importe quelle vendeuse dont il
 *   provoque un defi. **Elle n'est donc pas optionnelle.**
 *
 * La reponse est toujours 200 une fois les serrures passees : un code inconnu,
 * expire ou rejoue n'est pas une erreur, c'est un message ordinaire. Repondre
 * autre chose ferait re-livrer Meta en boucle.
 *
 * Le `GET` sur la meme URL est la poignee de main d'abonnement de Meta
 * (`hub.challenge`), avec le meme secret comme jeton de verification.
 */

export interface WhatsAppEntrantDeps {
  /** Le secret du chemin ET de la poignee de main. Absent, la route n'existe pas. */
  secret: string;
  /** Le secret d'application Meta, pour la signature. Meme regle. */
  appSecret: string;
  /** Ce que fait chaque message — injecte, pour tester la route sans Better Auth. */
  surMessage: (message: MessageEntrant) => Promise<void>;
}

export function whatsappEntrantRoutes(deps: WhatsAppEntrantDeps) {
  const r = new Hono();

  r.get("/entrant/:secret", (c) => {
    if (!egalConstant(c.req.param("secret"), deps.secret)) {
      return c.json({ erreur: "inconnu" }, 404);
    }
    const mode = c.req.query("hub.mode");
    const jeton = c.req.query("hub.verify_token");
    const defi = c.req.query("hub.challenge");
    if (mode === "subscribe" && jeton != null && egalConstant(jeton, deps.secret) && defi) {
      return c.text(defi);
    }
    return c.json({ erreur: "poignee de main invalide" }, 403);
  });

  r.post("/entrant/:secret", async (c) => {
    if (!egalConstant(c.req.param("secret"), deps.secret)) {
      return c.json({ erreur: "inconnu" }, 404);
    }

    /**
     * La signature se calcule sur le corps BRUT, avant toute analyse JSON :
     * re-serialiser changerait l'ordre des cles ou les espaces, et tout
     * refuserait. C'est le piege classique de ce webhook.
     */
    const brut = await c.req.text();
    const fournie = c.req.header("x-hub-signature-256");
    const attendue = `sha256=${createHmac("sha256", deps.appSecret).update(brut).digest("hex")}`;
    if (!fournie || !egalConstant(fournie, attendue)) {
      return c.json({ erreur: "signature absente ou invalide" }, 401);
    }

    let corps: unknown;
    try {
      corps = JSON.parse(brut);
    } catch {
      return c.json({ recu: true }, 200);
    }

    for (const message of lireMessagesEntrants(corps)) {
      /**
       * Chaque message est traite isolement : une erreur sur l'un ne doit ni
       * bloquer les suivants, ni faire re-livrer toute la fournee par Meta.
       * L'usage unique du code rend les relivraisons inoffensives de toute
       * facon — mieux vaut un defi perdu qu'une boucle de relivraison.
       */
      await deps.surMessage(message).catch(() => {});
    }

    return c.json({ recu: true }, 200);
  });

  return r;
}

/** Meme approche que dans `accuse-livraison.ts` : comparaison a longueur constante. */
function egalConstant(a: string | undefined, b: string): boolean {
  if (typeof a !== "string") return false;
  const ta = Buffer.from(a);
  const tb = Buffer.from(b);
  if (ta.length !== tb.length) return false;
  return timingSafeEqual(ta, tb);
}
