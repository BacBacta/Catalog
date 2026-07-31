import { type Context, Hono, type MiddlewareHandler } from "hono";
import {
  autorise,
  MESSAGE_INTERRUPTEUR,
  type NatureDeRequete,
  type PositionDInterrupteur,
} from "../domain/deploiement/ouverture.ts";

/**
 * Les gardes de bordure : en-tetes, CORS, taille des charges utiles,
 * interrupteur d'arret.
 *
 * Tout ce fichier s'applique **avant** les routes, dans `server.ts`, et rien
 * n'y depend d'une regle metier. C'est deliberé : une regle de securite qui
 * s'applique route par route finit par manquer la route ecrite la semaine
 * prochaine.
 */

/* ────────────────────────── 1. en-tetes ────────────────────────── */

/**
 * Les en-tetes de securite de l'API.
 *
 * **Cette API ne rend que du JSON**, et les en-tetes le disent :
 *
 * - `X-Content-Type-Options: nosniff` — sans lui, un navigateur peut decider
 *   qu'une reponse JSON dont le contenu commence par du texte est en fait du
 *   HTML, et l'executer. C'est la voie classique du XSS par reflexion sur une
 *   API : il suffit qu'un message d'erreur recopie une valeur fournie par
 *   l'appelant.
 * - `Content-Security-Policy: default-src 'none'` — une reponse d'API n'a aucune
 *   ressource a charger, jamais. `frame-ancestors 'none'` interdit en plus de
 *   l'encadrer, ce que `X-Frame-Options` dit une seconde fois pour les vieux
 *   navigateurs — et les vieux navigateurs sont la norme sur le marche vise.
 * - `Referrer-Policy: no-referrer` — **l'en-tete qui compte le plus dans ce
 *   produit.** Le jeton de suivi de l'acheteuse voyage DANS L'URL
 *   (`/suivi/<jeton>`), et c'est lui qui autorise la contre-signature (ADR
 *   0021). Toute requete partant d'une page qui porte ce jeton emporterait
 *   l'URL complete dans son `Referer` : il suffirait d'une image hebergee
 *   ailleurs, un jour, pour publier le secret dans les journaux d'un tiers.
 *   Le meme en-tete est pose sur la boutique par `apps/shop/public/_headers`,
 *   et pour cette raison-la exactement.
 * - `Permissions-Policy` — Catalog ne demande ni camera, ni micro, ni position.
 *   Le declarer coupe court a toute demande qu'une dependance future poserait.
 *
 * `Strict-Transport-Security` n'est PAS pose ici par defaut : il vaut pour un
 * domaine entier et pour deux ans, et le poser depuis une application qu'on
 * teste en clair sur `localhost` est le genre d'erreur qui rend un sous-domaine
 * injoignable sans recours. Il se pose en bordure, et `hsts: true` existe pour
 * l'environnement qui sait qu'il est en HTTPS.
 */
export const CSP_API = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

export function entetesDeSecurite(options: { hsts?: boolean } = {}): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Security-Policy", CSP_API);
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    if (options.hsts) {
      c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }
  };
}

/* ────────────────────────── 2. CORS ────────────────────────── */

/**
 * Trois classes de route, et il faut savoir laquelle avant d'ecrire un
 * en-tete.
 *
 * - `publique` — le recu, le suivi, la rampe, le statut. Lisibles par
 *   n'importe quelle origine, **sans cookie** : ce qui autorise est la cle
 *   portee dans l'URL, jamais la session. `Access-Control-Allow-Origin: *` y
 *   est correct, et il est meme necessaire — la boutique statique est servie
 *   depuis un autre domaine que l'API.
 * - `session` — l'app vendeuse. Cookie d'authentification, donc origine
 *   ENUMEREE et `Allow-Credentials`. Le joker y est interdit par la
 *   specification elle-meme (un navigateur refuse `*` avec des identifiants),
 *   ce qui est une chance : l'erreur ne peut pas passer inapercue.
 * - `fermee` — tout le reste. Aucun en-tete CORS : un navigateur tiers ne lit
 *   pas la reponse.
 *
 * ── Ce que le CORS ne fait PAS ─────────────────────────────────────────────
 *
 * Il n'empeche pas la requete de partir, seulement d'en lire la reponse. Une
 * requete « simple » — POST en `text/plain` — atteint le serveur quoi qu'il
 * arrive. Le CORS n'est donc pas la protection contre la falsification de
 * requete : celle-ci vient du jeton pour l'acheteuse, et du `SameSite` du
 * cookie pour la vendeuse. Ecrire l'inverse dans un commentaire serait la
 * meilleure facon de se croire protege.
 */
export type ClasseCors = "publique" | "session" | "fermee";

/**
 * La classe d'un chemin. **L'ordre compte** : `/api/recu/identifiant` est sous
 * session alors que `/api/recu/...` est public, et le prefixe le plus long
 * doit donc etre teste d'abord.
 */
const PREFIXES: ReadonlyArray<[string, ClasseCors]> = [
  ["/api/recu/identifiant", "session"],
  ["/api/rampe", "publique"],
  ["/api/recu", "publique"],
  ["/api/suivi", "publique"],
  ["/api/statut", "publique"],
  ["/health", "publique"],
  ["/api/auth", "session"],
  ["/api/vendeuse", "session"],
  ["/api/reversement", "session"],
  ["/api/articles", "session"],
  ["/api/statistiques", "session"],
  ["/api/commandes", "session"],
  ["/api/media", "session"],
];

export function classeDuChemin(chemin: string): ClasseCors {
  for (const [prefixe, classe] of PREFIXES) {
    if (chemin === prefixe || chemin.startsWith(`${prefixe}/`)) return classe;
  }
  return "fermee";
}

export interface OptionsCors {
  /** Origines de l'app vendeuse. Vide = aucune origine tierce sous session. */
  origines: readonly string[];
}

export function cors(options: OptionsCors): MiddlewareHandler {
  const autorisees = new Set(options.origines);

  return async (c, next) => {
    const classe = classeDuChemin(new URL(c.req.url).pathname);
    const origine = c.req.header("origin");

    const poser = (): void => {
      if (classe === "publique") {
        c.header("Access-Control-Allow-Origin", "*");
        // Une ressource publique en lecture seule : l'encadrement d'origine
        // croisee n'a rien a lui prendre.
        c.header("Cross-Origin-Resource-Policy", "cross-origin");
      } else if (classe === "session" && origine && autorisees.has(origine)) {
        c.header("Access-Control-Allow-Origin", origine);
        c.header("Access-Control-Allow-Credentials", "true");
        c.header("Cross-Origin-Resource-Policy", "same-site");
      } else {
        c.header("Cross-Origin-Resource-Policy", "same-origin");
      }
      /**
       * **`Vary: Origin` meme quand la reponse ne depend pas de l'origine.** Un
       * cache partage qui garderait une reponse avec `Allow-Origin: https://a`
       * la servirait ensuite a `https://b`, qui la rejetterait — un defaut
       * intermittent, dependant du cache, donc irreproductible.
       */
      c.header("Vary", "Origin");
    };

    if (c.req.method === "OPTIONS") {
      poser();
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      c.header("Access-Control-Allow-Headers", "content-type, authorization");
      c.header("Access-Control-Max-Age", "600");
      return c.body(null, 204);
    }

    await next();
    poser();
  };
}

/* ────────────────────────── 3. taille des charges utiles ────────────────────────── */

/**
 * Plafond par defaut d'un corps JSON : **16 Ko**.
 *
 * Le plus gros corps legitime de ce produit est un SMS d'operateur colle — 400
 * caracteres au pire — ou un texte d'avis, borne a 1 000 caracteres par la
 * route. Seize kilo-octets laissent deux ordres de grandeur de marge et
 * restent tres au-dessous de ce qu'il faudrait pour peser sur la memoire du
 * processus.
 */
export const TAILLE_JSON_MAX = 16 * 1024;

/**
 * Le plafond des corps de requete, **compte sur les octets recus** et pas
 * seulement sur l'en-tete annonce.
 *
 * C'est la difference qui fait tout l'interet de ce garde. Un client hostile ne
 * remplit pas `Content-Length` honnetement : il l'omet — un corps en
 * `Transfer-Encoding: chunked` n'en a pas — ou il ment. Le controle d'en-tete
 * seul se contourne donc en une ligne de `curl`, et l'application se met alors
 * a mettre en tampon ce qu'on lui envoie, aussi longtemps qu'on l'envoie.
 *
 * Le corps est lu ici, plafonne, puis **remis a disposition** de la route : la
 * requete est reconstruite autour des octets deja lus, de sorte que
 * `c.req.json()` et `c.req.formData()` fonctionnent normalement en aval. Mettre
 * en tampon n'est pas un cout : `formData()` le fait de toute facon pour lire un
 * fichier.
 */
export function tailleMaximale(
  plafond: number | ((chemin: string) => number) = TAILLE_JSON_MAX,
): MiddlewareHandler {
  const limiteDe = typeof plafond === "function" ? plafond : () => plafond;

  return async (c, next) => {
    const corps = c.req.raw.body;
    if (!corps || c.req.method === "GET" || c.req.method === "HEAD") return next();

    const limite = limiteDe(new URL(c.req.url).pathname);

    // Bornage a l'annonce, quand elle existe : refuser avant de lire evite le
    // travail, et c'est le seul cas ou l'on peut le faire.
    const annonce = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(annonce) && annonce > limite) return refus(c, limite);

    const lu = await lireAvecPlafond(corps, limite);
    if (lu === null) return refus(c, limite);

    // La requete est reconstruite autour des octets deja lus. `duplex` n'est pas
    // requis pour un corps deja materialise, et les en-tetes sont recopies.
    (c.req as { raw: Request }).raw = new Request(c.req.raw.url, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: lu,
    });

    await next();
  };
}

function refus(c: Context, limite: number) {
  return c.json(
    {
      erreur: "charge_trop_grosse",
      message: "L'envoi est trop volumineux.",
      maximumOctets: limite,
    },
    413,
  );
}

/**
 * Lit un flux jusqu'au plafond. Rend `null` des que le plafond est franchi,
 * **sans finir de lire** : continuer serait offrir a l'attaquant le travail
 * qu'on vient de lui refuser.
 */
export async function lireAvecPlafond(
  flux: ReadableStream<Uint8Array>,
  plafond: number,
): Promise<Uint8Array | null> {
  const lecteur = flux.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > plafond) {
        await lecteur.cancel().catch(() => {});
        return null;
      }
      morceaux.push(value);
    }
  } finally {
    lecteur.releaseLock();
  }

  const sortie = new Uint8Array(total);
  let decalage = 0;
  for (const m of morceaux) {
    sortie.set(m, decalage);
    decalage += m.byteLength;
  }
  return sortie;
}

/* ────────────────────────── 4. interrupteur d'arret ────────────────────────── */

/**
 * La nature d'une requete, pour l'interrupteur.
 *
 * `/health` et `/api/statut` sont du **diagnostic** et passent en toutes
 * positions : un service muet ne se supervise pas, et la page de statut
 * publique est justement ce qu'on regarde quand le reste est coupe.
 *
 * Tout le reste se decide sur la METHODE. C'est grossier et c'est voulu : une
 * liste de routes en ecriture se desynchronise du code au premier ajout, alors
 * qu'une methode ne ment pas.
 */
export function natureDe(methode: string, chemin: string): NatureDeRequete {
  if (chemin === "/health" || chemin.startsWith("/health/")) return "diagnostic";
  if (chemin === "/api/statut" || chemin.startsWith("/api/statut/")) return "diagnostic";
  return methode === "GET" || methode === "HEAD" || methode === "OPTIONS" ? "lecture" : "ecriture";
}

export function interrupteur(position: () => PositionDInterrupteur): MiddlewareHandler {
  return async (c, next) => {
    const p = position();
    if (p === "ouvert") return next();

    const nature = natureDe(c.req.method, new URL(c.req.url).pathname);
    if (autorise(p, nature)) return next();

    /**
     * 503 et non 500 : c'est un etat voulu, temporaire, et un client bien eleve
     * le distingue d'une panne. `Retry-After` donne une minute — assez pour
     * qu'un rafraichissement ne tombe pas dans la meme seconde, assez peu pour
     * qu'une reouverture soit vue tout de suite.
     */
    c.header("Retry-After", "60");
    return c.json(MESSAGE_INTERRUPTEUR[p], 503);
  };
}

/* ────────────────────────── 5. le montage ────────────────────────── */

/**
 * Enveloppe une application dans les gardes, et rend la racine a servir.
 *
 * ── Pourquoi une ENVELOPPE et pas des `app.use("*", …)` ────────────────────
 *
 * Hono execute les gestionnaires dans l'ordre ou ils sont ENREGISTRES. Un
 * intergiciel ajoute apres une route ne s'applique donc pas a cette route — en
 * silence, sans erreur, sans avertissement.
 *
 * Ce n'est pas une precaution theorique : la premiere version de ce lot posait
 * les gardes dans `server.ts` avec `app.use("*", …)`, et `/health` — declare
 * dans `app.ts`, donc enregistre a l'import, donc avant — ressortait **sans un
 * seul en-tete de securite**. Mesure sur le serveur en marche, pas devinee.
 *
 * Monter l'application dans une racine rend la question impossible a poser : la
 * racine ne connait que les gardes et un sous-arbre, et le sous-arbre est
 * complet au moment du montage. C'est aussi ce qui garde `app.ts` constructible
 * nu, sans base et sans configuration.
 */
export interface OptionsDeGardes {
  hsts?: boolean;
  origines: readonly string[];
  position: () => PositionDInterrupteur;
  debit: MiddlewareHandler;
  cohorte: MiddlewareHandler;
  /** Plafond des corps, par chemin. */
  plafond: (chemin: string) => number;
}

export function monterAvecGardes(sous: Hono, options: OptionsDeGardes): Hono {
  const racine = new Hono();

  /**
   * L'ordre n'est pas une preference de lecture : il garantit que les gardes
   * les moins chers refusent en premier.
   *
   * 1. **en-tetes** — poses sur TOUTE reponse, y compris celles que les gardes
   *    suivants produisent. Un 429 sans `nosniff` serait la reponse la moins
   *    protegee du service, et c'est celle qu'on provoque le plus facilement ;
   * 2. **CORS** — repond aux preliminaires `OPTIONS` sans reveiller la suite ;
   * 3. **interrupteur** — arrete avant tout travail ; c'est son interet meme ;
   * 4. **debit** — refuse sans toucher ni au corps ni a la base ;
   * 5. **taille** — lit le corps, plafonne, et le remet a disposition ;
   * 6. **cohorte** — resout une session, donc coute une requete de base : en
   *    dernier, et seulement sur les ecritures de l'app vendeuse.
   */
  racine.use("*", entetesDeSecurite(options.hsts === undefined ? {} : { hsts: options.hsts }));
  racine.use("*", cors({ origines: options.origines }));
  racine.use("*", interrupteur(options.position));
  racine.use("*", options.debit);
  racine.use("*", tailleMaximale(options.plafond));
  racine.use("*", options.cohorte);

  racine.route("/", sous);
  return racine;
}
