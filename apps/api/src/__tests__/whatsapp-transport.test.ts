import { describe, expect, it } from "vitest";
import { EnvoyeurWhatsappBot } from "../adapters/whatsapp-bot.ts";
import { LecteurMediaWhatsapp } from "../adapters/whatsapp-media.ts";
import { entetesAuth, resoudreTransport } from "../adapters/whatsapp-transport.ts";

/**
 * Le transport WhatsApp — ADR 0046.
 *
 * Ces tests existent parce que `docs/terrain/test-bot-sandbox.md` a affirme
 * pendant des semaines que passer au numero de test Meta etait « un changement
 * d'environnement, pas de code ». C'etait faux sur trois points, et chacun
 * d'eux est ici :
 *
 *   1. l'en-tete d'authentification n'est pas le meme ;
 *   2. le chemin d'envoi n'est pas le meme ;
 *   3. la reecriture d'hote du telechargement de media, indispensable chez
 *      360dialog, CASSE le telechargement chez Meta.
 *
 * Le troisieme est le plus couteux : il ne se voit qu'en telechargeant une
 * vraie photo, et le bac a sable 360dialog n'a aucun endpoint media.
 */

const SANDBOX = "https://waba-sandbox.360dialog.io/v1";
const PROD_360 = "https://waba-v2.360dialog.io";
const META = "https://graph.facebook.com/v21.0";

function faussetteJson(corps: unknown, type = "application/json") {
  return new Response(JSON.stringify(corps), { headers: { "content-type": type } });
}
function faussetteOctets(octets: Uint8Array, type = "image/jpeg") {
  return new Response(octets, { headers: { "content-type": type } });
}

describe("resoudreTransport", () => {
  it("deduit le transport de l'hote — aucune variable a ajouter aux deploiements existants", () => {
    expect(resoudreTransport(undefined, SANDBOX)).toBe("360dialog");
    expect(resoudreTransport(undefined, PROD_360)).toBe("360dialog");
    expect(resoudreTransport(undefined, META)).toBe("meta");
  });

  it("REFUSE de demarrer sur une configuration qui se contredit", () => {
    /* Le cas reel : une base Meta avec une cle 360dialog produit des HTTP 401
       qu'on impute a la cle, et on passe la soiree dessus. Ici le service ne
       demarre pas, et il dit lequel des deux est faux. */
    expect(() => resoudreTransport("360dialog", META)).toThrow(/incoherente/i);
    expect(() => resoudreTransport("meta", PROD_360)).toThrow(/incoherente/i);
  });

  it("exige une declaration quand l'hote ne tranche pas", () => {
    expect(() => resoudreTransport(undefined, "https://relais.exemple.test/v1")).toThrow(
      /WABOT_TRANSPORT/,
    );
    expect(resoudreTransport("meta", "https://relais.exemple.test/v1")).toBe("meta");
  });

  it("refuse une valeur inventee plutot que de retomber sur un defaut", () => {
    expect(() => resoudreTransport("cloud", META)).toThrow(/360dialog.*meta|meta.*360dialog/i);
  });

  it("l'en-tete d'authentification n'est pas le meme des deux cotes", () => {
    expect(entetesAuth("360dialog", "K")).toEqual({ "D360-API-KEY": "K" });
    expect(entetesAuth("meta", "K")).toEqual({ Authorization: "Bearer K" });
  });
});

describe("l'envoyeur, selon le transport", () => {
  it("360dialog : POST {base}/messages, cle en en-tete maison", async () => {
    const vues: Array<{ url: string; entetes: Record<string, string> }> = [];
    const envoyeur = new EnvoyeurWhatsappBot({
      apiKey: "CLE360",
      baseUrl: PROD_360,
      transport: "360dialog",
      fetchImpl: async (url, init) => {
        vues.push({ url: String(url), entetes: (init?.headers ?? {}) as Record<string, string> });
        return faussetteJson({ messages: [{ id: "wamid.1" }] });
      },
    });
    await envoyeur.envoyer({ messaging_product: "whatsapp" } as never);
    expect(vues[0]?.url).toBe("https://waba-v2.360dialog.io/messages");
    expect(vues[0]?.entetes["D360-API-KEY"]).toBe("CLE360");
    expect(vues[0]?.entetes.Authorization).toBeUndefined();
  });

  it("un refus d'envoi NOMME le code d'erreur Meta — et rien d'autre du corps", async () => {
    /* Le 07/08/2026, tous les envois sont morts en silence sur (#131037)
       « display name approval » : une heure de diagnostic a l'aveugle, parce
       que l'exception ne portait que « HTTP 400 ». Le code Meta est un ENTIER,
       sans contenu de conversation — il se journalise (ADR 0023 respecte). Le
       texte du corps, lui, ne traverse jamais. */
    const envoyeur = new EnvoyeurWhatsappBot({
      apiKey: "CLE360",
      baseUrl: PROD_360,
      transport: "360dialog",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "display name approval SECRET",
              code: 131037,
              type: "OAuthException",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    });
    await expect(envoyeur.envoyer({ messaging_product: "whatsapp" } as never)).rejects.toThrowError(
      /envoi bot refuse : HTTP 400, code Meta 131037$/,
    );
  });

  it("un refus sans corps lisible reste un refus nu — pas de code invente", async () => {
    const envoyeur = new EnvoyeurWhatsappBot({
      apiKey: "CLE360",
      baseUrl: PROD_360,
      transport: "360dialog",
      delaiReessaiMs: 0,
      fetchImpl: async () => new Response("indisponible", { status: 503 }),
    });
    await expect(envoyeur.envoyer({ messaging_product: "whatsapp" } as never)).rejects.toThrowError(
      /envoi bot refuse : HTTP 503$/,
    );
  });

  /**
   * Le reessai borne — ADR 0093, non-retour du constat B5 de l'audit
   * 2026-08 : « un 5xx Meta transitoire perd definitivement une reponse de
   * conversation ». UN reessai, sur transitoire seulement : le rattrapage par
   * relivraison est interdit a raison par `termineLe` (ADR 0040).
   */
  describe("le reessai borne (ADR 0093)", () => {
    const REPONSE_OK = () => faussetteJson({ messages: [{ id: "wamid.ok" }] });

    it("un 5xx passager est rejoue UNE fois, et la reponse part", async () => {
      let appels = 0;
      const envoyeur = new EnvoyeurWhatsappBot({
        apiKey: "K",
        baseUrl: PROD_360,
        transport: "360dialog",
        delaiReessaiMs: 0,
        fetchImpl: async () =>
          ++appels === 1 ? new Response("indisponible", { status: 503 }) : REPONSE_OK(),
      });
      await envoyeur.envoyer({ messaging_product: "whatsapp" } as never);
      expect(appels).toBe(2);
    });

    it("une panne RESEAU est rejouee aussi — au risque assume d'une bulle en double", async () => {
      let appels = 0;
      const envoyeur = new EnvoyeurWhatsappBot({
        apiKey: "K",
        baseUrl: PROD_360,
        transport: "360dialog",
        delaiReessaiMs: 0,
        fetchImpl: async () => {
          if (++appels === 1) throw new TypeError("fetch failed");
          return REPONSE_OK();
        },
      });
      await envoyeur.envoyer({ messaging_product: "whatsapp" } as never);
      expect(appels).toBe(2);
    });

    it("un 4xx est DEFINITIF : le meme corps echouerait pareil, aucun second appel", async () => {
      let appels = 0;
      const envoyeur = new EnvoyeurWhatsappBot({
        apiKey: "K",
        baseUrl: PROD_360,
        transport: "360dialog",
        delaiReessaiMs: 0,
        fetchImpl: async () => {
          appels++;
          return new Response(JSON.stringify({ error: { code: 131047 } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        },
      });
      await expect(
        envoyeur.envoyer({ messaging_product: "whatsapp" } as never),
      ).rejects.toThrowError(/HTTP 400, code Meta 131047$/);
      expect(appels).toBe(1);
    });

    it("un 200 SANS identifiant ne se rejoue pas : le message est peut-etre parti", async () => {
      let appels = 0;
      const envoyeur = new EnvoyeurWhatsappBot({
        apiKey: "K",
        baseUrl: PROD_360,
        transport: "360dialog",
        delaiReessaiMs: 0,
        fetchImpl: async () => {
          appels++;
          return faussetteJson({ messages: [] });
        },
      });
      await expect(
        envoyeur.envoyer({ messaging_product: "whatsapp" } as never),
      ).rejects.toThrowError(/non confirme/);
      expect(appels).toBe(1);
    });

    it("deux 5xx d'affilee : l'echec remonte, il n'y a pas de troisieme tentative", async () => {
      let appels = 0;
      const envoyeur = new EnvoyeurWhatsappBot({
        apiKey: "K",
        baseUrl: PROD_360,
        transport: "360dialog",
        delaiReessaiMs: 0,
        fetchImpl: async () => {
          appels++;
          return new Response("indisponible", { status: 502 });
        },
      });
      await expect(
        envoyeur.envoyer({ messaging_product: "whatsapp" } as never),
      ).rejects.toThrowError(/HTTP 502$/);
      expect(appels).toBe(2);
    });
  });

  it("meta : le numero emetteur est un SEGMENT d'URL, et la cle un jeton porteur", async () => {
    const vues: Array<{ url: string; entetes: Record<string, string> }> = [];
    const envoyeur = new EnvoyeurWhatsappBot({
      apiKey: "JETON",
      baseUrl: META,
      transport: "meta",
      phoneNumberId: "998877",
      fetchImpl: async (url, init) => {
        vues.push({ url: String(url), entetes: (init?.headers ?? {}) as Record<string, string> });
        return faussetteJson({ messages: [{ id: "wamid.2" }] });
      },
    });
    await envoyeur.envoyer({ messaging_product: "whatsapp" } as never);
    expect(vues[0]?.url).toBe("https://graph.facebook.com/v21.0/998877/messages");
    expect(vues[0]?.entetes.Authorization).toBe("Bearer JETON");
    expect(vues[0]?.entetes["D360-API-KEY"]).toBeUndefined();
  });

  it("meta sans numero emetteur : echoue A LA CONSTRUCTION, pas au premier envoi", () => {
    /* Sinon le defaut se manifeste en HTTP 404 sur un message reel, la nuit du
       lancement. Meme lecon que MboaSMS (ADR 0026). */
    expect(
      () => new EnvoyeurWhatsappBot({ apiKey: "J", baseUrl: META, transport: "meta" }),
    ).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
  });
});

describe("le lecteur de media, selon le transport", () => {
  const LOOKASIDE = "https://lookaside.fbsbx.com/whatsapp/media/1?token=abc";

  it("360dialog : l'hote de l'URL rendue est REECRIT vers celui de l'API", async () => {
    /* La regle 360dialog, et le defaut du 02/08/2026 : suivre l'URL telle
       quelle echoue, parce que lookaside ne connait pas notre cle. */
    const appels: string[] = [];
    const lecteur = new LecteurMediaWhatsapp({
      apiKey: "CLE360",
      baseUrl: PROD_360,
      transport: "360dialog",
      fetchImpl: async (url) => {
        appels.push(String(url));
        return appels.length === 1
          ? faussetteJson({ url: LOOKASIDE, mime_type: "image/jpeg" })
          : faussetteOctets(new Uint8Array([1, 2, 3]));
      },
    });
    const media = await lecteur.lire("MEDIA1");
    expect(appels[0]).toBe("https://waba-v2.360dialog.io/MEDIA1");
    expect(appels[1]).toBe("https://waba-v2.360dialog.io/whatsapp/media/1?token=abc");
    expect(media?.typeAnnonce).toBe("image/jpeg");
  });

  it("meta : l'URL rendue est suivie TELLE QUELLE — la reecriture la casserait", async () => {
    /* C'est la ligne qui n'est verifiable qu'avec un vrai media, donc jamais
       sur le bac a sable 360dialog, qui n'en a aucun. */
    const appels: string[] = [];
    const lecteur = new LecteurMediaWhatsapp({
      apiKey: "JETON",
      baseUrl: META,
      transport: "meta",
      fetchImpl: async (url) => {
        appels.push(String(url));
        return appels.length === 1
          ? faussetteJson({ url: LOOKASIDE, mime_type: "image/jpeg" })
          : faussetteOctets(new Uint8Array([1, 2, 3]));
      },
    });
    const media = await lecteur.lire("MEDIA1");
    expect(appels[0]).toBe("https://graph.facebook.com/v21.0/MEDIA1");
    expect(appels[1]).toBe(LOOKASIDE);
    expect(media?.octets.byteLength).toBe(3);
  });

  it("meta : aucun repli sur la forme on-premise `/media/{id}`", async () => {
    /* Elle n'existe que chez 360dialog. La tenter chez Meta est un appel de
       plus, garanti perdant, sur le chemin d'une photo qui n'arrive deja pas. */
    const appels: string[] = [];
    const lecteur = new LecteurMediaWhatsapp({
      apiKey: "JETON",
      baseUrl: META,
      transport: "meta",
      fetchImpl: async (url) => {
        appels.push(String(url));
        return new Response("", { status: 404 });
      },
    });
    expect(await lecteur.lire("MEDIA1")).toBeNull();
    expect(appels).toEqual(["https://graph.facebook.com/v21.0/MEDIA1"]);
  });

  it("360dialog : le repli on-premise reste tente", async () => {
    const appels: string[] = [];
    const lecteur = new LecteurMediaWhatsapp({
      apiKey: "CLE360",
      baseUrl: SANDBOX,
      transport: "360dialog",
      fetchImpl: async (url) => {
        appels.push(String(url));
        return appels.length === 1
          ? new Response("", { status: 404 })
          : faussetteOctets(new Uint8Array([9]));
      },
    });
    const media = await lecteur.lire("MEDIA1");
    expect(appels[1]).toBe("https://waba-sandbox.360dialog.io/v1/media/MEDIA1");
    expect(media?.octets.byteLength).toBe(1);
  });
});
