import { describe, expect, it, vi } from "vitest";
import { LecteurMediaWhatsapp } from "../adapters/whatsapp-media.ts";

/**
 * Le lecteur de photos entrantes — ADR 0047.
 *
 * Ce qui se teste ici n'est pas « ca telecharge » : c'est que l'adaptateur
 * distingue les DEUX formes de reponse sans qu'on le lui dise, et qu'aucun
 * echec ne devient une levee — une photo illisible est un message d'aide a la
 * vendeuse, jamais une panne de conversation.
 */

const CFG = { apiKey: "cle", baseUrl: "https://waba.test/v1" };
const octets = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

const reponseJson = (corps: unknown) =>
  new Response(JSON.stringify(corps), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const reponseOctets = (type = "image/jpeg") =>
  new Response(octets, { status: 200, headers: { "content-type": type } });

describe("LecteurMediaWhatsapp", () => {
  it("refuse de se construire sans cle ni base — comme l'envoyeur", () => {
    expect(() => new LecteurMediaWhatsapp({ apiKey: "", baseUrl: "x" })).toThrow(/WABOT_API_KEY/);
    expect(() => new LecteurMediaWhatsapp({ apiKey: "x", baseUrl: "" })).toThrow(/WABOT_BASE_URL/);
  });

  it("forme Cloud API : JSON d'abord, octets ensuite, cle posee aux DEUX appels", async () => {
    const appels: Array<{ url: string; cle: string | undefined }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      appels.push({
        url: u,
        cle: (init?.headers as Record<string, string> | undefined)?.["D360-API-KEY"],
      });
      return u.includes("/telechargement")
        ? reponseOctets()
        : reponseJson({ url: "https://waba.test/telechargement/abc", mime_type: "image/jpeg" });
    });

    const lecteur = new LecteurMediaWhatsapp({ ...CFG, fetchImpl: fetchImpl as never });
    const media = await lecteur.lire("MEDIA-1");

    expect(media?.typeAnnonce).toBe("image/jpeg");
    expect(media?.octets).toEqual(octets);
    expect(appels).toHaveLength(2);
    expect(appels[0]?.url).toBe("https://waba.test/v1/MEDIA-1");
    // L'URL de telechargement reste derriere l'authentification : sans cet
    // en-tete, la seconde requete rendrait un 401 et la photo serait perdue.
    expect(appels[1]?.cle).toBe("cle");
  });

  it("l'URL Meta (lookaside) est REECRITE vers l'hote de l'API — la regle 360dialog", async () => {
    const appels: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      appels.push(u);
      return u.includes("attachments")
        ? reponseOctets()
        : reponseJson({
            url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=X&hash=Y",
            mime_type: "image/jpeg",
          });
    });
    const lecteur = new LecteurMediaWhatsapp({ ...CFG, fetchImpl: fetchImpl as never });
    const media = await lecteur.lire("MEDIA-3");
    expect(media?.octets).toEqual(octets);
    /* L'hote de Meta ne connait pas notre cle : chemin et parametres gardes,
       hote remplace par celui de la base. */
    expect(appels[1]).toBe("https://waba.test/whatsapp_business/attachments/?mid=X&hash=Y");
  });

  it("un premier chemin refuse fait tenter la forme /media/{id} — l'on-premise v1", async () => {
    const appels: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      appels.push(u);
      return u.includes("/media/") ? reponseOctets("image/png") : new Response("", { status: 404 });
    });
    const lecteur = new LecteurMediaWhatsapp({ ...CFG, fetchImpl: fetchImpl as never });
    const media = await lecteur.lire("MEDIA-4");
    expect(media?.typeAnnonce).toBe("image/png");
    expect(appels).toEqual(["https://waba.test/v1/MEDIA-4", "https://waba.test/v1/media/MEDIA-4"]);
  });

  it("forme v1 : des octets directement, sans second appel", async () => {
    const fetchImpl = vi.fn(async () => reponseOctets("image/png"));
    const lecteur = new LecteurMediaWhatsapp({ ...CFG, fetchImpl: fetchImpl as never });
    const media = await lecteur.lire("MEDIA-2");
    expect(media?.typeAnnonce).toBe("image/png");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("le type annonce perd ses parametres — « image/jpeg; charset » vaut « image/jpeg »", async () => {
    const fetchImpl = vi.fn(async () => reponseOctets("image/jpeg; charset=binary"));
    const lecteur = new LecteurMediaWhatsapp({ ...CFG, fetchImpl: fetchImpl as never });
    expect((await lecteur.lire("M"))?.typeAnnonce).toBe("image/jpeg");
  });

  it("rend null — jamais une levee — sur refus, corps difforme, reseau coupe", async () => {
    const cas: Array<() => Promise<Response>> = [
      async () => new Response("", { status: 404 }),
      async () => reponseJson({ pas: "d'url" }),
      async () => {
        throw new Error("reseau coupe");
      },
    ];
    for (const fetchImpl of cas) {
      const lecteur = new LecteurMediaWhatsapp({ ...CFG, fetchImpl: fetchImpl as never });
      await expect(lecteur.lire("M")).resolves.toBeNull();
    }
  });

  it("refuse un identifiant difforme sans appeler le reseau", async () => {
    const fetchImpl = vi.fn(async () => reponseOctets());
    const lecteur = new LecteurMediaWhatsapp({ ...CFG, fetchImpl: fetchImpl as never });
    expect(await lecteur.lire("../../secret")).toBeNull();
    expect(await lecteur.lire("")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("arrete une photo trop lourde, annoncee comme mesuree", async () => {
    const annonce = new Response(octets, {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "99999999" },
    });
    const parAnnonce = new LecteurMediaWhatsapp({
      ...CFG,
      tailleMax: 10,
      fetchImpl: (async () => annonce) as never,
    });
    expect(await parAnnonce.lire("M")).toBeNull();

    // Sans `content-length`, seule la mesure reelle tranche.
    const parMesure = new LecteurMediaWhatsapp({
      ...CFG,
      tailleMax: 2,
      fetchImpl: (async () => reponseOctets()) as never,
    });
    expect(await parMesure.lire("M")).toBeNull();
  });

  it("un corps vide n'est pas une photo", async () => {
    const vide = () =>
      new Response(new Uint8Array(), { status: 200, headers: { "content-type": "image/jpeg" } });
    const lecteur = new LecteurMediaWhatsapp({ ...CFG, fetchImpl: (async () => vide()) as never });
    expect(await lecteur.lire("M")).toBeNull();
  });
});
