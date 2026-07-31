import { describe, expect, it } from "vitest";
import { adresseTel, cheminEnvoi, OrangeSmsSender } from "../adapters/sms-orange.ts";
import { chargeUtile, destinataire, WhatsAppSender } from "../adapters/sms-whatsapp.ts";
import type { SmsMessage } from "../domain/sms-sender.ts";
import { texteSms } from "../domain/sms-sender.ts";

/**
 * Les deux adaptateurs d'envoi de code, exerces contre un serveur simule.
 *
 * Aucun reseau : `fetchImpl` est injecte et enregistre ce qui aurait ete envoye.
 * Ce qui est verifie n'est donc pas « ca marche » — seul un vrai compte le dira
 * — mais **la forme exacte de ce qui part**, recopiee des documentations Orange
 * et Meta. Une charge utile mal formee ne se voit pas autrement qu'en
 * production, et pas tout de suite.
 */

const OTP: SmsMessage = {
  to: "+237677000001",
  text: texteSms("otp_connexion", "483920"),
  kind: "otp_connexion",
  valeur: "483920",
};

/** Un `fetch` de test : il note les appels et rend ce qu'on lui dit. */
function espion(reponses: Array<{ ok: boolean; statut?: number; corps?: unknown }>) {
  const appels: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    appels.push({ url: String(url), init: init ?? {} });
    const r = reponses[Math.min(i++, reponses.length - 1)] ?? { ok: true };
    return {
      ok: r.ok,
      status: r.statut ?? (r.ok ? 200 : 500),
      json: async () => r.corps ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return { appels, fetchImpl };
}

const JETON_OK = { ok: true, corps: { access_token: "jeton-abc", expires_in: "3600" } };

const corpsDe = (init: RequestInit) => JSON.parse(String(init.body));

/** Un en-tete d'un appel enregistre, sans supposer que l'appel a eu lieu. */
const entete = (appel: { init: RequestInit } | undefined, nom: string): string | undefined =>
  (appel?.init.headers as Record<string, string> | undefined)?.[nom];

/**
 * Le message d'une erreur attendue.
 *
 * `expect().rejects.toThrow()` n'accepte pas de predicat : on capture donc, et
 * on affirme sur le texte. Ces assertions-la portent sur ce qui NE doit PAS s'y
 * trouver — un OTP dans un journal est un OTP compromis.
 */
async function messageDeLErreur(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error("l'action devait lever, elle a abouti");
}

/* ═══════════════════════════ Orange ═══════════════════════════ */

describe("Orange — SMS Cameroon", () => {
  const construire = (
    reponses: Array<{ ok: boolean; statut?: number; corps?: unknown }>,
    extra: Record<string, unknown> = {},
  ) => {
    const { appels, fetchImpl } = espion(reponses);
    const envoyeur = new OrangeSmsSender({
      clientId: "id",
      clientSecret: "secret",
      senderAddress: "+237699000000",
      baseUrl: "https://api.exemple.test",
      fetchImpl,
      ...extra,
    });
    return { appels, envoyeur };
  };

  it("refuse de se construire sans identifiants", () => {
    expect(
      () =>
        new OrangeSmsSender({ clientId: "", clientSecret: "s", senderAddress: "+237699000000" }),
    ).toThrow(/incomplete/i);
  });

  it("demande un jeton, puis envoie", async () => {
    const { appels, envoyeur } = construire([JETON_OK, { ok: true }]);
    await envoyeur.send(OTP);

    expect(appels).toHaveLength(2);
    expect(appels[0]?.url).toBe("https://api.exemple.test/oauth/v3/token");
    expect(appels[0]?.init.body).toBe("grant_type=client_credentials");
    // `Basic base64("id:secret")`, reconstruit depuis les deux secrets.
    expect(entete(appels[0], "Authorization")).toBe(
      `Basic ${Buffer.from("id:secret").toString("base64")}`,
    );
    expect(entete(appels[1], "Authorization")).toBe("Bearer jeton-abc");
  });

  /**
   * `tel:+237…` porte deux caracteres reserves dans un segment d'URL. Les
   * laisser tels quels produit un 404, ou un envoi depuis un emetteur inconnu.
   */
  it("encode le numero emetteur dans le chemin", () => {
    expect(cheminEnvoi("https://api.exemple.test", "+237699000000")).toBe(
      "https://api.exemple.test/smsmessaging/v1/outbound/tel%3A%2B237699000000/requests",
    );
    expect(adresseTel("+237677000001")).toBe("tel:+237677000001");
    // Idempotent : une adresse deja prefixee ne se prefixe pas deux fois.
    expect(adresseTel("tel:+237677000001")).toBe("tel:+237677000001");
  });

  it("compose le corps attendu par l'API", async () => {
    const { appels, envoyeur } = construire([JETON_OK, { ok: true }]);
    await envoyeur.send(OTP);

    expect(corpsDe(appels[1]?.init as RequestInit)).toEqual({
      outboundSMSMessageRequest: {
        address: "tel:+237677000001",
        senderAddress: "tel:+237699000000",
        outboundSMSTextMessage: { message: OTP.text },
      },
    });
  });

  it("n'ajoute le nom d'expediteur que s'il est configure", async () => {
    const sans = construire([JETON_OK, { ok: true }]);
    await sans.envoyeur.send(OTP);
    expect(
      corpsDe(sans.appels[1]?.init as RequestInit).outboundSMSMessageRequest,
    ).not.toHaveProperty("senderName");

    const avec = construire([JETON_OK, { ok: true }], { senderName: "CATALOG" });
    await avec.envoyeur.send(OTP);
    expect(corpsDe(avec.appels[1]?.init as RequestInit).outboundSMSMessageRequest.senderName).toBe(
      "CATALOG",
    );
  });

  /**
   * ══════════════════════════════════════════════════════════════════════
   *  LE TEST LE PLUS IMPORTANT DE CE FICHIER
   * ══════════════════════════════════════════════════════════════════════
   *
   * `?resource_type_parameter_management=SMS_OCB2` bascule l'envoi sur le
   * reseau Orange SEUL. Une vendeuse sur trois est chez MTN : le poser, c'est
   * les empecher de se connecter — et rien ne le dirait, puisque l'API
   * repondrait normalement.
   */
  it("n'utilise JAMAIS le parametre qui restreint au reseau Orange", async () => {
    const { appels, envoyeur } = construire([JETON_OK, { ok: true }]);
    await envoyeur.send(OTP);
    expect(appels[1]?.url).not.toContain("resource_type_parameter_management");
    expect(appels[1]?.url).not.toContain("SMS_OCB2");
    // Et l'API visee est bien celle de tous les operateurs.
    expect(appels[1]?.url).toContain("/smsmessaging/v1/outbound/");
  });

  it("reutilise le jeton tant qu'il est valide", async () => {
    const { appels, envoyeur } = construire([JETON_OK, { ok: true }, { ok: true }]);
    await envoyeur.send(OTP);
    await envoyeur.send(OTP);
    // Un seul appel a OAuth pour deux envois.
    expect(appels.filter((a) => a.url.includes("/oauth/"))).toHaveLength(1);
  });

  /**
   * Un jeton qui expire pendant le vol de la requete produit un 401
   * intermittent, que rien n'explique et qui ne se reproduit pas. La marge
   * d'une minute existe pour cela.
   */
  it("redemande un jeton avant son expiration reelle", async () => {
    const { appels, fetchImpl } = espion([
      { ok: true, corps: { access_token: "a", expires_in: "120" } },
      { ok: true },
      { ok: true, corps: { access_token: "b", expires_in: "120" } },
      { ok: true },
    ]);
    let t = 0;
    const envoyeur = new OrangeSmsSender({
      clientId: "id",
      clientSecret: "secret",
      senderAddress: "+237699000000",
      baseUrl: "https://api.exemple.test",
      fetchImpl,
      maintenant: () => t,
    });

    await envoyeur.send(OTP);
    // 70 s plus tard : le jeton vaut encore 50 s, mais la marge est de 60.
    t = 70_000;
    await envoyeur.send(OTP);
    expect(appels.filter((a) => a.url.includes("/oauth/"))).toHaveLength(2);
  });

  it("leve quand l'authentification echoue, sans recopier la reponse", async () => {
    const { envoyeur } = construire([{ ok: false, statut: 401, corps: { secret: "fuite" } }]);
    const message = await messageDeLErreur(() => envoyeur.send(OTP));
    expect(message).toContain("HTTP 401");
    // Le corps d'erreur peut refleter l'en-tete d'autorisation envoye.
    expect(message).not.toContain("fuite");
  });

  /**
   * Le message d'erreur remonte jusqu'au journal du serveur. Un OTP dans un
   * journal est un OTP compromis — et le texte du SMS le contient.
   */
  it("l'erreur d'envoi ne porte ni le code, ni le texte", async () => {
    const { envoyeur } = construire([JETON_OK, { ok: false, statut: 502 }]);
    const message = await messageDeLErreur(() => envoyeur.send(OTP));
    expect(message).toContain("HTTP 502");
    // L'etiquette suffit a savoir quel parcours a echoue...
    expect(message).toContain("otp_connexion");
    // ...et ni le code ni la phrase ne partent dans le journal.
    expect(message).not.toContain("483920");
    expect(message).not.toContain(OTP.text);
  });
});

/* ═══════════════════════════ WhatsApp ═══════════════════════════ */

describe("WhatsApp — modele d'authentification", () => {
  const construire = (
    reponses: Array<{ ok: boolean; statut?: number; corps?: unknown }>,
    extra: Record<string, unknown> = {},
  ) => {
    const { appels, fetchImpl } = espion(reponses);
    const envoyeur = new WhatsAppSender({
      phoneNumberId: "123456",
      accessToken: "jeton",
      templateName: "catalog_otp",
      baseUrl: "https://graph.exemple.test",
      fetchImpl,
      ...extra,
    });
    return { appels, envoyeur };
  };

  it("refuse de se construire sans modele", () => {
    expect(
      () => new WhatsAppSender({ phoneNumberId: "1", accessToken: "t", templateName: "" }),
    ).toThrow(/incomplete/i);
  });

  it("Meta veut le destinataire sans le plus", () => {
    expect(destinataire("+237677000001")).toBe("237677000001");
    expect(destinataire("237 677 000 001")).toBe("237677000001");
  });

  it("vise le bon point d'entree", async () => {
    const { appels, envoyeur } = construire([{ ok: true }]);
    await envoyeur.send(OTP);
    expect(appels[0]?.url).toBe("https://graph.exemple.test/v21.0/123456/messages");
    expect(entete(appels[0], "Authorization")).toBe("Bearer jeton");
  });

  /**
   * ══════════════════════════════════════════════════════════════════════
   *  LE CODE FIGURE DEUX FOIS, ET CE N'EST PAS UNE FAUTE DE FRAPPE
   * ══════════════════════════════════════════════════════════════════════
   *
   * Un modele d'authentification a bouton « copier le code » porte deux
   * emplacements : le corps et le bouton. N'en remplir qu'un fait rejeter la
   * requete — ou produit un bouton qui copie autre chose que ce qui est ecrit.
   */
  it("place le code dans le corps ET dans le bouton", () => {
    const charge = chargeUtile({
      to: "+237677000001",
      templateName: "catalog_otp",
      langue: "fr",
      code: "483920",
    });

    expect(charge).toEqual({
      messaging_product: "whatsapp",
      to: "237677000001",
      type: "template",
      template: {
        name: "catalog_otp",
        language: { code: "fr" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "483920" }] },
          {
            type: "button",
            sub_type: "url",
            index: 0,
            parameters: [{ type: "text", text: "483920" }],
          },
        ],
      },
    });

    // Dit autrement, pour que l'intention survive a une refonte du test.
    const corps = charge.template.components.find((c) => c.type === "body");
    const bouton = charge.template.components.find((c) => c.type === "button");
    expect(corps?.parameters[0]?.text).toBe(bouton?.parameters[0]?.text);
  });

  /**
   * **La phrase n'est pas envoyee, et c'est le point entier de ce canal.**
   * Meta approuve un gabarit ; l'API attend le parametre.
   */
  it("ignore le texte redige et n'envoie que la valeur brute", async () => {
    const { appels, envoyeur } = construire([{ ok: true }]);
    await envoyeur.send(OTP);
    const envoye = JSON.stringify(corpsDe(appels[0]?.init as RequestInit));
    expect(envoye).toContain("483920");
    expect(envoye).not.toContain("votre code de connexion");
  });

  /**
   * Un OTP vide serait accepte par Meta et arriverait sous la forme « votre code
   * est » — la vendeuse appellerait, et personne ne saurait pourquoi.
   */
  it("leve plutot que d'envoyer un code vide", async () => {
    const { envoyeur } = construire([{ ok: true }]);
    const sansValeur: SmsMessage = { to: OTP.to, text: OTP.text, kind: "otp_connexion" };
    await expect(envoyeur.send(sansValeur)).rejects.toThrow(/valeur brute/i);
  });

  /**
   * Un gabarit approuve en categorie « authentification » ne sert qu'a cela. Y
   * faire passer un rappel de solde est un detournement que Meta sanctionne, et
   * le texte n'aurait aucun sens dans le gabarit.
   */
  it("refuse les messages qui ne sont pas des OTP", async () => {
    const { envoyeur } = construire([{ ok: true }]);
    for (const kind of ["rappel_solde", "expiration"] as const) {
      await expect(envoyeur.send({ to: OTP.to, text: "x", kind, valeur: "3751" })).rejects.toThrow(
        /ne porte pas/,
      );
    }
  });

  it("la langue du modele est configurable, parce qu'elle doit coller a l'approbation", async () => {
    const { appels, envoyeur } = construire([{ ok: true }], { langue: "en_US" });
    await envoyeur.send(OTP);
    expect(corpsDe(appels[0]?.init as RequestInit).template.language.code).toBe("en_US");
  });

  it("remonte le code d'erreur de Meta, sans le corps qui recopie l'OTP", async () => {
    const { envoyeur } = construire([
      { ok: false, statut: 400, corps: { error: { code: 132001, message: "483920" } } },
    ]);
    const message = await messageDeLErreur(() => envoyeur.send(OTP));
    // 132001 = « modele inexistant » : utile au diagnostic, donc remonte.
    expect(message).toContain("132001");
    expect(message).toContain("otp_connexion");
    // Le corps d'erreur de Meta recopie la charge utile, donc l'OTP.
    expect(message).not.toContain("483920");
  });
});
