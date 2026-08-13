import { type MessageTexte, texte } from "./messages.ts";
import type { Langue } from "./textes.ts";

/**
 * Ce que le fil WhatsApp REPOND a un message de connexion — ADR 0027.
 *
 * ── Le defaut du 13/08/2026 ───────────────────────────────────────────────
 *
 * Le message « Connexion Catalog : AAAA-BB » etait traite en silence : le bot
 * le saute exprès (c'est la connexion, pas une conversation), et la connexion,
 * elle, ne parlait qu'a la page web. Cote WhatsApp, rien. Le porteur du
 * produit l'a dit dans ces mots : « ça reste muet, et ce n'est que lorsque je
 * retourne sur la page que je constate que la connexion est établie. »
 *
 * Un canal qui ne repond pas ne dit pas « ça a marché » ; il dit « je suis
 * peut-etre mort ». Et quand le code est perime, le silence est pire encore :
 * rien ne distingue « trop tard » de « en cours ». C'est exactement ce qui a
 * coute une matinee.
 *
 * ── Pourquoi AUCUN LIEN dans ces messages ─────────────────────────────────
 *
 * La session vit dans le navigateur qui a DEMANDE le defi. Un lien ouvert
 * depuis WhatsApp s'ouvre dans le navigateur integre, qui a ses propres
 * cookies : il afficherait un ecran de connexion vierge a quelqu'un qui vient
 * de se connecter. On renvoie donc a la page deja ouverte, jamais a une URL.
 *
 * ── Le pidgin n'est pas ici, et c'est voulu ───────────────────────────────
 *
 * `TEXTES.wes` existe mais n'est servi par personne tant que `PIDGIN_RELU`
 * vaut `false` (ADR 0034). Ecrire ici un pidgin que personne n'a relu serait
 * la demi-bascule que cet ADR interdit. Le jour ou une locutrice relit,
 * cette table grandit d'une entree — pas avant.
 */

/** L'issue d'un message entrant, du point de vue du FIL. */
export type IssueConnexion = "confirme" | "code_mort" | "silence";

export function issueConnexion(entree: {
  /** Le message porte-t-il un code de defi ? Sinon, c'est une conversation. */
  porteUnCode: boolean;
  /** Ce qu'a repondu `appliquerMessageEntrant`. */
  verdict: "verifie" | "ignore";
  /**
   * Ce code a-t-il DEJA recu sa reponse ?
   *
   * Meta relivre : sans ce garde, la relivraison d'un message REUSSI tombe
   * sur un code deja consomme — donc `ignore` — et annoncerait « ce code
   * n'est plus valable » a quelqu'un qui vient de se connecter.
   */
  dejaAccuse: boolean;
}): IssueConnexion {
  if (!entree.porteUnCode) return "silence";
  if (entree.dejaAccuse) return "silence";
  return entree.verdict === "verifie" ? "confirme" : "code_mort";
}

const TEXTES_CONNEXION = {
  fr: {
    confirme:
      "✅ *Connexion confirmée.*\n\n" +
      "Votre espace Catalog est ouvert. Revenez sur la page déjà ouverte dans " +
      "votre navigateur : elle a basculé toute seule.\n\n" +
      "Ce code a servi — il ne vaut plus rien, et c'est normal.",
    code_mort:
      "⏳ *Ce code n'est plus valable.*\n\n" +
      "Un code de connexion vit cinq minutes, et ne sert qu'une fois.\n\n" +
      "Retournez sur la page de connexion Catalog et demandez un nouveau " +
      "message. Ne renvoyez pas celui-ci : il ne marchera plus.",
  },
  en: {
    confirme:
      "✅ *You are signed in.*\n\n" +
      "Your Catalog space is open. Go back to the page already open in your " +
      "browser — it switched on its own.\n\n" +
      "This code has been used; it no longer works, and that is normal.",
    code_mort:
      "⏳ *This code is no longer valid.*\n\n" +
      "A sign-in code lasts five minutes, and works only once.\n\n" +
      "Go back to the Catalog sign-in page and ask for a new message. Do not " +
      "resend this one: it will not work.",
  },
} as const;

export function messageConnexion(
  vers: string,
  issue: "confirme" | "code_mort",
  langue: Langue,
): MessageTexte {
  /* `wes` n'est servi par personne (voir l'en-tete) : il retombe sur le
     francais, comme tout ce qui n'est pas anglais. */
  return texte(vers, TEXTES_CONNEXION[langue === "en" ? "en" : "fr"][issue]);
}
