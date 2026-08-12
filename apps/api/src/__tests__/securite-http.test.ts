import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { PositionDInterrupteur } from "../domain/deploiement/ouverture.ts";
import { REGLES_PAR_DEFAUT } from "../domain/securite/debit.ts";
import { familleDe, limiterDebit, MemoireDeDebit } from "../middleware/debit.ts";
import {
  CSP_API,
  classeDuChemin,
  cors,
  entetesDeSecurite,
  interrupteur,
  lireAvecPlafond,
  monterAvecGardes,
  natureDe,
  TAILLE_JSON_MAX,
  tailleMaximale,
} from "../middleware/securite.ts";

/**
 * Les gardes de bordure, exerces sur de vraies requetes.
 *
 * Chacun de ces tests correspond a une ligne de la revue de securite du lot 15.
 * Ils sont ecrits comme des TENTATIVES : la question posee n'est jamais « le
 * bon en-tete est-il present », c'est « qu'est-ce qui se passe si j'essaie ».
 */

/* ────────────────────────── en-tetes ────────────────────────── */

describe("en-tetes de securite", () => {
  const app = new Hono().use("*", entetesDeSecurite()).get("/x", (c) => c.json({ ok: true }));

  it("pose nosniff, CSP, cadre interdit et politique de referent", async () => {
    const r = await app.request("/x");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Content-Security-Policy")).toBe(CSP_API);
    expect(r.headers.get("X-Frame-Options")).toBe("DENY");
    expect(r.headers.get("Permissions-Policy")).toContain("camera=()");
  });

  /**
   * **L'en-tete qui compte le plus dans ce produit.** Le jeton de suivi voyage
   * dans l'URL et autorise la contre-signature : une requete partant d'une page
   * qui le porte emporterait l'URL entiere dans son `Referer`.
   */
  it("interdit toute fuite de referent", async () => {
    const r = await app.request("/x");
    expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  /**
   * HSTS vaut pour un domaine entier et pour deux ans. Le poser depuis une
   * application qu'on teste en clair sur `localhost` rend un sous-domaine
   * injoignable sans recours.
   */
  it("ne pose HSTS que si on le demande", async () => {
    expect((await app.request("/x")).headers.get("Strict-Transport-Security")).toBeNull();
    const avec = new Hono()
      .use("*", entetesDeSecurite({ hsts: true }))
      .get("/x", (c) => c.json({}));
    expect((await avec.request("/x")).headers.get("Strict-Transport-Security")).toContain(
      "max-age=63072000",
    );
  });

  /**
   * Un 429 ou un 503 sont les reponses les plus faciles a provoquer : ce sont
   * celles qu'il ne faut surtout pas laisser sortir moins protegees que les
   * autres. C'est ce que l'ordre des gardes garantit, et ce test le verrouille.
   */
  it("les reponses d'erreur des autres gardes portent aussi les en-tetes", async () => {
    const bloque = new Hono()
      .use("*", entetesDeSecurite())
      .use(
        "*",
        interrupteur(() => "ferme"),
      )
      .post("/api/commandes", (c) => c.json({}));
    const r = await bloque.request("/api/commandes", { method: "POST" });
    expect(r.status).toBe(503);
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

/* ────────────────────────── le montage ────────────────────────── */

describe("montage des gardes", () => {
  /**
   * **Le defaut que ce test empeche a ete mesure, pas imagine.**
   *
   * La premiere ecriture de ce lot posait les gardes par `app.use("*", …)` dans
   * `server.ts`. Hono execute les gestionnaires dans l'ordre d'ENREGISTREMENT :
   * `/health`, declare dans `app.ts` donc enregistre a l'import, passait avant
   * eux et ressortait sans un seul en-tete de securite. En silence, sans erreur.
   *
   * Le test reproduit exactement la situation — une route enregistree AVANT le
   * montage — et exige que les gardes s'y appliquent quand meme.
   */
  const construire = () => {
    const sous = new Hono();
    // Enregistree AVANT le montage, comme `/health` dans `app.ts`.
    sous.get("/health", (c) => c.json({ status: "ok" }));
    sous.post("/api/suivi/j/contresigner", (c) => c.json({ ok: true }));
    return monterAvecGardes(sous, {
      origines: ["https://app.catalog.cm"],
      position: () => "ouvert",
      debit: async (_c, next) => next(),
      cohorte: async (_c, next) => next(),
      plafond: () => 32,
    });
  };

  it("une route enregistree avant le montage porte quand meme les en-tetes", async () => {
    const r = await construire().request("/health");
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("et elle passe aussi par le plafond de taille", async () => {
    const r = await construire().request("/api/suivi/j/contresigner", {
      method: "POST",
      body: JSON.stringify({ motif: "x".repeat(200) }),
    });
    expect(r.status).toBe(413);
  });
});

/* ────────────────────────── CORS ────────────────────────── */

describe("CORS", () => {
  const ORIGINE = "https://app.catalog.cm";
  const app = new Hono()
    .use("*", cors({ origines: [ORIGINE] }))
    .get("/api/rampe", (c) => c.json({}))
    .get("/api/recu/ACDE-4679", (c) => c.json({}))
    .get("/api/recu/identifiant/176", (c) => c.json({}))
    .get("/api/vendeuse/moi", (c) => c.json({}))
    .get("/api/interne", (c) => c.json({}));

  it("classe les chemins, le prefixe le plus long d'abord", () => {
    expect(classeDuChemin("/api/rampe")).toBe("publique");
    expect(classeDuChemin("/api/recu/ACDE-4679")).toBe("publique");
    expect(classeDuChemin("/api/suivi/abc")).toBe("publique");
    // La recherche par identifiant d'operateur est SOUS SESSION : un identifiant
    // MTN est un nombre a onze chiffres, donc enumerable.
    expect(classeDuChemin("/api/recu/identifiant/17600000001")).toBe("session");
    expect(classeDuChemin("/api/vendeuse/moi")).toBe("session");
    expect(classeDuChemin("/api/interne")).toBe("fermee");
  });

  it("un prefixe ne deborde pas sur un chemin qui commence pareil", () => {
    // `/api/rampette` n'est pas `/api/rampe`.
    expect(classeDuChemin("/api/rampette")).toBe("fermee");
  });

  it("les routes publiques sont lisibles par n'importe quelle origine", async () => {
    const r = await app.request("/api/rampe", { headers: { origin: "https://ailleurs.example" } });
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(r.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("les routes sous session n'ouvrent qu'aux origines enumerees", async () => {
    const bonne = await app.request("/api/vendeuse/moi", { headers: { origin: ORIGINE } });
    expect(bonne.headers.get("Access-Control-Allow-Origin")).toBe(ORIGINE);
    expect(bonne.headers.get("Access-Control-Allow-Credentials")).toBe("true");

    const mauvaise = await app.request("/api/vendeuse/moi", {
      headers: { origin: "https://attaquant.example" },
    });
    expect(mauvaise.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  /**
   * Le joker avec identifiants est refuse par les navigateurs eux-memes. Le
   * verrouiller ici evite qu'une « simplification » le reintroduise : la
   * consequence serait qu'un site tiers lise le catalogue et les statistiques
   * d'une vendeuse connectee.
   */
  it("jamais de joker sur une route qui porte un cookie", async () => {
    const r = await app.request("/api/recu/identifiant/176", { headers: { origin: ORIGINE } });
    expect(r.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  /**
   * Sans `Vary: Origin`, un cache partage sert a `https://b` une reponse
   * autorisee pour `https://a`. Le defaut est intermittent et depend du cache,
   * donc irreproductible.
   */
  it("annonce toujours que la reponse varie selon l'origine", async () => {
    expect((await app.request("/api/rampe")).headers.get("Vary")).toContain("Origin");
  });

  it("repond au preliminaire sans reveiller la route", async () => {
    const r = await app.request("/api/vendeuse/moi", {
      method: "OPTIONS",
      headers: { origin: ORIGINE },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
  });
});

/* ────────────────────────── taille des charges ────────────────────────── */

describe("taille maximale des corps", () => {
  const app = new Hono()
    .use("*", tailleMaximale(64))
    .post("/x", async (c) => c.json({ recu: (await c.req.json()) as unknown }));

  it("laisse passer un corps normal, et la route le lit encore", async () => {
    const r = await app.request("/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ recu: { a: 1 } });
  });

  it("refuse sur l'annonce, sans lire", async () => {
    const r = await app.request("/x", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "5000" },
      body: JSON.stringify({ a: "x".repeat(200) }),
    });
    expect(r.status).toBe(413);
    expect(((await r.json()) as { erreur: string }).erreur).toBe("charge_trop_grosse");
  });

  /**
   * **La tentative qui justifie ce garde.** Le controle d'en-tete seul se
   * contourne d'une ligne : un corps en `Transfer-Encoding: chunked` n'a pas de
   * `Content-Length`, et l'application se met alors a mettre en tampon ce qu'on
   * lui envoie, aussi longtemps qu'on l'envoie.
   */
  it("refuse un corps sans Content-Length qui depasse a la lecture", async () => {
    const flux = new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (let i = 0; i < 10; i += 1) ctrl.enqueue(new Uint8Array(32));
        ctrl.close();
      },
    });
    const r = await app.request("/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: flux,
      duplex: "half",
    });
    expect(r.status).toBe(413);
  });

  it("refuse un corps dont l'annonce MENT en dessous de la realite", async () => {
    const flux = new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (let i = 0; i < 10; i += 1) ctrl.enqueue(new Uint8Array(32));
        ctrl.close();
      },
    });
    const r = await app.request("/x", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "10" },
      body: flux,
      duplex: "half",
    });
    expect(r.status).toBe(413);
  });

  it("le plafond peut dependre du chemin", async () => {
    const variable = new Hono()
      .use(
        "*",
        tailleMaximale((chemin) => (chemin === "/gros" ? 4096 : 8)),
      )
      .post("/gros", (c) => c.json({ ok: true }))
      .post("/petit", (c) => c.json({ ok: true }));
    const corps = JSON.stringify({ a: "x".repeat(100) });
    expect((await variable.request("/gros", { method: "POST", body: corps })).status).toBe(200);
    expect((await variable.request("/petit", { method: "POST", body: corps })).status).toBe(413);
  });

  it("une requete sans corps traverse le garde", async () => {
    const lecture = new Hono().use("*", tailleMaximale(8)).get("/y", (c) => c.json({ ok: true }));
    expect((await lecture.request("/y")).status).toBe(200);
  });

  it("le plafond par defaut laisse largement passer un SMS d'operateur", () => {
    // Le plus long SMS de la specification fait un peu plus de 300 caracteres.
    expect(TAILLE_JSON_MAX).toBeGreaterThan(4096);
  });

  describe("lireAvecPlafond", () => {
    it("rend les octets quand ils tiennent", async () => {
      const f = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new Uint8Array([1, 2]));
          ctrl.enqueue(new Uint8Array([3]));
          ctrl.close();
        },
      });
      expect(await lireAvecPlafond(f, 10)).toEqual(new Uint8Array([1, 2, 3]));
    });

    /**
     * Continuer a lire apres le refus serait offrir a l'attaquant le travail
     * qu'on vient de lui refuser.
     */
    it("s'arrete au franchissement et n'epuise pas la source", async () => {
      let produits = 0;
      const f = new ReadableStream<Uint8Array>({
        pull(ctrl) {
          produits += 1;
          if (produits > 1000) return ctrl.close();
          ctrl.enqueue(new Uint8Array(16));
        },
      });
      expect(await lireAvecPlafond(f, 32)).toBeNull();
      expect(produits).toBeLessThan(10);
    });
  });
});

/* ────────────────────────── limitation de debit ────────────────────────── */

describe("limitation de debit", () => {
  const construire = (position = 0) => {
    const regles = { ...REGLES_PAR_DEFAUT, lecture: { max: 3, fenetreMs: 60_000 } };
    let t = new Date("2026-08-01T10:00:00Z").getTime() + position;
    return new Hono()
      .use(
        "*",
        limiterDebit({
          regles,
          memoire: new MemoireDeDebit(regles),
          maintenant: () => {
            t += 100;
            return new Date(t);
          },
        }),
      )
      .get("/api/recu/ACDE-4679", (c) => c.json({ ok: true }))
      .get("/health", (c) => c.json({ ok: true }))
      .post("/api/suivi/j/contresigner", (c) => c.json({ ok: true }));
  };

  it("classe les routes par famille", () => {
    expect(familleDe("GET", "/api/recu/ACDE-4679")).toBe("lecture");
    expect(familleDe("POST", "/api/suivi/xyz/contresigner")).toBe("ecriture");
    expect(familleDe("POST", "/api/commandes/abc/preuve")).toBe("preuve");
    // Les routes sous session vendeuse ne sont pas limitees par adresse :
    // plusieurs vendeuses sortent par la meme adresse publique au Cameroun.
    expect(familleDe("PATCH", "/api/articles/abc")).toBeNull();
  });

  /**
   * **Le point d'entree qu'une supervision interroge toutes les dix secondes.**
   * Le limiter reviendrait a declarer le service en panne parce qu'on le
   * surveille.
   */
  it("le diagnostic est exempt", () => {
    expect(familleDe("GET", "/health")).toBeNull();
    expect(familleDe("GET", "/api/statut")).toBeNull();
  });

  it("refuse au-dela du plafond, avec Retry-After", async () => {
    const app = construire();
    for (let i = 0; i < 3; i += 1) {
      expect((await app.request("/api/recu/ACDE-4679")).status).toBe(200);
    }
    const r = await app.request("/api/recu/ACDE-4679");
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(((await r.json()) as { erreur: string }).erreur).toBe("trop_de_requetes");
  });

  /**
   * Sans famille dans la cle, une acheteuse qui rafraichit sa page de suivi
   * consommerait le budget de sa propre contre-signature — et le geste unique du
   * produit echouerait a cause d'une lecture anodine.
   */
  it("saturer les lectures n'empeche pas d'ecrire", async () => {
    const app = construire();
    for (let i = 0; i < 4; i += 1) await app.request("/api/recu/ACDE-4679");
    const r = await app.request("/api/suivi/j/contresigner", { method: "POST" });
    expect(r.status).toBe(200);
  });

  it("deux adresses ne se penalisent pas", async () => {
    const app = construire();
    for (let i = 0; i < 4; i += 1) {
      await app.request("/api/recu/ACDE-4679", { headers: { "x-forwarded-for": "10.0.0.1" } });
    }
    const autre = await app.request("/api/recu/ACDE-4679", {
      headers: { "x-forwarded-for": "10.0.0.2" },
    });
    expect(autre.status).toBe(200);
  });

  it("le diagnostic reste joignable une fois la lecture saturee", async () => {
    const app = construire();
    for (let i = 0; i < 5; i += 1) await app.request("/api/recu/ACDE-4679");
    expect((await app.request("/health")).status).toBe(200);
  });
});

/* ────────────────────────── interrupteur ────────────────────────── */

describe("interrupteur d'arret", () => {
  const construire = (position: PositionDInterrupteur) =>
    new Hono()
      .use(
        "*",
        interrupteur(() => position),
      )
      .get("/api/recu/ACDE-4679", (c) => c.json({ recu: true }))
      .post("/api/suivi/j/contresigner", (c) => c.json({ ok: true }))
      .get("/api/statut", (c) => c.json({ niveau: "ok" }))
      .get("/health", (c) => c.json({ ok: true }));

  it("classe les requetes par methode, sauf le diagnostic", () => {
    expect(natureDe("GET", "/api/recu/X")).toBe("lecture");
    expect(natureDe("POST", "/api/suivi/j/contresigner")).toBe("ecriture");
    expect(natureDe("GET", "/health")).toBe("diagnostic");
    expect(natureDe("GET", "/api/statut")).toBe("diagnostic");
  });

  it("ouvert ne change rien", async () => {
    const app = construire("ouvert");
    expect((await app.request("/api/suivi/j/contresigner", { method: "POST" })).status).toBe(200);
  });

  /**
   * **Le recu survit a la panne.** Un recu est une preuve opposable : faire
   * disparaitre les preuves deja emises le jour d'un incident technique en
   * ferait un incident de confiance.
   */
  it("lecture_seule garde les recus consultables et coupe les ecritures", async () => {
    const app = construire("lecture_seule");
    expect((await app.request("/api/recu/ACDE-4679")).status).toBe(200);
    const r = await app.request("/api/suivi/j/contresigner", { method: "POST" });
    expect(r.status).toBe(503);
    expect(r.headers.get("Retry-After")).toBe("60");
    expect(((await r.json()) as { erreur: string }).erreur).toBe("service_en_lecture_seule");
  });

  it("ferme coupe tout sauf le diagnostic", async () => {
    const app = construire("ferme");
    expect((await app.request("/api/recu/ACDE-4679")).status).toBe(503);
    // Sans cette exception, la page de statut tomberait avec le reste — au
    // moment precis ou on la regarde.
    expect((await app.request("/api/statut")).status).toBe(200);
    expect((await app.request("/health")).status).toBe(200);
  });
});
