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
 * - **une preuve d'origine**, sans laquelle n'importe qui connaissant l'URL
 *   pourrait fabriquer un faux message entrant — c'est-a-dire se connecter au
 *   compte de n'importe quelle vendeuse dont il provoque un defi. **Elle n'est
 *   donc pas optionnelle**, mais elle prend deux formes selon le transporteur :
 *   la signature `X-Hub-Signature-256` en Meta directe, l'en-tete rejoue en
 *   relais 360dialog (ADR 0035). Au moins l'une des deux est exigee a la
 *   construction ; aucune des deux, la route ne se construit pas.
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
  /**
   * Le secret d'application Meta, pour la signature `X-Hub-Signature-256`.
   *
   * ABSENT en relais 360dialog : ce secret est un objet de la Meta directe, et
   * un WABA servi par un partenaire n'en a pas. Sans lui, aucune signature ne
   * peut etre verifiee — donc toute livraison qui en porte une est refusee,
   * plutot que d'etre acceptee sur la foi d'un verrou qu'on ne sait pas lire.
   */
  appSecret?: string | undefined;
  /** Ce que fait chaque message — injecte, pour tester la route sans Better Auth. */
  surMessage: (message: MessageEntrant) => Promise<void>;
  /**
   * Verrou d'EN-TETE, pour les livraisons relayees par 360dialog (ADR 0031) :
   * le relais ne signe pas, mais rejoue tel quel l'en-tete Authorization
   * configure sur son webhook. Accepte SEULEMENT quand la signature est
   * absente — une signature presente et fausse reste un refus.
   */
  authEnTete?: string | undefined;
  /** Le bot (ADR 0031) : recoit la livraison ENTIERE apres les defis. */
  surLivraison?: ((corps: unknown) => Promise<void>) | undefined;
}

export function whatsappEntrantRoutes(deps: WhatsAppEntrantDeps) {
  /* Le garde leve a la construction, comme l'envoyeur du bot et MboaSMS : une
     route qui accepterait tout corps portant le bon secret d'URL est une porte
     ouverte sur les comptes vendeuses, et le symptome serait un silence. */
  if (!deps.appSecret && !deps.authEnTete) {
    throw new Error(
      "Webhook WhatsApp entrant : aucune preuve d'origine configuree. " +
        "Poser WHATSAPP_APP_SECRET (Meta directe) ou WABOT_WEBHOOK_AUTH (relais 360dialog). " +
        "Voir .env.example et l'ADR 0035.",
    );
  }

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
    /* Sans secret d'application, `parSignature` reste faux MEME si une
       signature est fournie : ne pas savoir verifier n'est pas verifier. */
    const parSignature =
      deps.appSecret != null &&
      fournie != null &&
      egalConstant(
        fournie,
        `sha256=${createHmac("sha256", deps.appSecret).update(brut).digest("hex")}`,
      );
    /* L'en-tete ne remplace la signature que quand elle est ABSENTE : une
       signature fausse reste une signature fausse. */
    const parEnTete =
      fournie == null &&
      deps.authEnTete != null &&
      egalConstant(c.req.header("authorization"), deps.authEnTete);
    if (!parSignature && !parEnTete) {
      /* Trace SANS CONTENU : uniquement la forme du refus. C'est ce qui permet
         de distinguer « le relais n'envoie rien » de « le relais envoie sans
         le verrou attendu » — la panne muette du 02/08/2026. */
      console.warn(
        `livraison entrante refusee : signature=${fournie != null} en-tete=${c.req.header("authorization") != null}`,
      );
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

    /* Le bot lit la livraison ENTIERE — reponses interactives comprises, que
       `lireMessagesEntrants` ne voit pas. Il saute lui-meme les defis. */
    if (deps.surLivraison) await deps.surLivraison(corps).catch(() => {});

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
