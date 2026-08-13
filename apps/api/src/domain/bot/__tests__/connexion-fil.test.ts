import { describe, expect, it } from "vitest";
import { issueConnexion, messageConnexion } from "../connexion-fil.ts";

/**
 * Le fil ne doit plus rester muet — banc du 13/08/2026.
 *
 * « ça reste muet, et ce n'est que lorsque je retourne sur la page que je
 * constate que la connexion est établie. » Un canal qui ne repond pas ne dit
 * pas « ça a marché » : il dit « je suis peut-etre mort ».
 */
describe("l'issue d'un message de connexion", () => {
  it("un message ORDINAIRE ne recoit rien d'ici — c'est le bot qui parle", () => {
    expect(issueConnexion({ porteUnCode: false, verdict: "ignore", dejaAccuse: false })).toBe(
      "silence",
    );
    /* Meme verifie : sans code, ce flux n'a rien a dire. */
    expect(issueConnexion({ porteUnCode: false, verdict: "verifie", dejaAccuse: false })).toBe(
      "silence",
    );
  });

  it("un code accepte se confirme", () => {
    expect(issueConnexion({ porteUnCode: true, verdict: "verifie", dejaAccuse: false })).toBe(
      "confirme",
    );
  });

  it("un code refuse le DIT, au lieu de laisser chercher", () => {
    expect(issueConnexion({ porteUnCode: true, verdict: "ignore", dejaAccuse: false })).toBe(
      "code_mort",
    );
  });

  /**
   * LE piege des relivraisons. Meta relivre ; a la seconde passe, le code est
   * deja consomme, donc le verdict est « ignore ». Sans ce garde, quelqu'un
   * qui vient de se connecter recevrait « ce code n'est plus valable ».
   */
  it("une relivraison ne contredit jamais la confirmation deja envoyee", () => {
    expect(issueConnexion({ porteUnCode: true, verdict: "ignore", dejaAccuse: true })).toBe(
      "silence",
    );
    expect(issueConnexion({ porteUnCode: true, verdict: "verifie", dejaAccuse: true })).toBe(
      "silence",
    );
  });
});

describe("le message envoye dans le fil", () => {
  it("part au bon numero, en texte simple", () => {
    const m = messageConnexion("237677123456", "confirme", "fr");
    expect(m.to).toBe("237677123456");
    expect(m.type).toBe("text");
  });

  /**
   * La session vit dans le navigateur qui a demande le defi. Un lien ouvert
   * depuis WhatsApp s'ouvre dans le navigateur integre, avec ses propres
   * cookies : il montrerait un ecran de connexion vierge a quelqu'un qui
   * vient de se connecter.
   */
  it("ne porte AUCUN lien — la session est dans l'autre navigateur", () => {
    for (const issue of ["confirme", "code_mort"] as const) {
      for (const langue of ["fr", "en", "wes"] as const) {
        expect(messageConnexion("237677123456", issue, langue).text.body).not.toMatch(
          /https?:\/\//,
        );
      }
    }
  });

  it("dit ce qu'il faut FAIRE quand le code est mort", () => {
    const fr = messageConnexion("237677123456", "code_mort", "fr").text.body;
    expect(fr).toMatch(/nouveau message/i);
    expect(fr).toMatch(/ne renvoyez pas/i);
    const en = messageConnexion("237677123456", "code_mort", "en").text.body;
    expect(en).toMatch(/new message/i);
    expect(en).toMatch(/not resend/i);
  });

  it("l'anglais est servi, et il est vraiment anglais", () => {
    expect(messageConnexion("237677123456", "confirme", "en").text.body).toMatch(/signed in/i);
    expect(messageConnexion("237677123456", "confirme", "fr").text.body).toMatch(/confirmée/i);
  });

  /* `wes` est ecrit mais NON SERVI (ADR 0034) : il retombe sur le francais,
     comme tout ce qui n'est pas anglais. Jamais un brouillon non relu. */
  it("le pidgin retombe sur le francais tant qu'il n'est pas relu", () => {
    expect(messageConnexion("237677123456", "confirme", "wes").text.body).toBe(
      messageConnexion("237677123456", "confirme", "fr").text.body,
    );
  });
});
