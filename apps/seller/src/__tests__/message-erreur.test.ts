import { describe, expect, it } from "vitest";
import { messageDErreur } from "../lib/api.ts";

/**
 * Un 401 se dit pour ce qu'il est.
 *
 * Banc du 11/08/2026 : « L'article n'a pas pu etre cree. » s'affiche sous un
 * formulaire correctement rempli. L'article n'etait pas en cause — la session
 * l'etait. La vendeuse a cherche le defaut dans son article, puis a renvoye
 * QUATRE codes de connexion. Les trois sessions creees en base le disent : la
 * connexion marchait, c'est le message qui mentait.
 */
const reponse = (statut: number, message: string | null = null) => ({
  ok: false as const,
  statut,
  donnees: null,
  message,
  erreur: null,
});

describe("le message d'erreur nomme la vraie cause", () => {
  it("un 401 parle de la SESSION, jamais du geste tente", () => {
    const m = messageDErreur(reponse(401), "L'article n'a pas pu etre cree.");
    expect(m).toMatch(/session|reconnect/i);
    expect(m).not.toContain("article");
  });

  it("mais un refus METIER redige par l'API garde ses mots", () => {
    /* L'API ecrit deja ses refus en francais simple ; les reecrire ici ferait
       diverger deux formulations. */
    const m = messageDErreur(
      reponse(422, "Ce prix depasse ce qu'un article peut valoir."),
      "repli",
    );
    expect(m).toBe("Ce prix depasse ce qu'un article peut valoir.");
  });

  it("les autres statuts ne bougent pas", () => {
    expect(messageDErreur(reponse(429), "repli")).toMatch(/tentatives/i);
    expect(messageDErreur(reponse(503), "repli")).toMatch(/ne repond pas/i);
    expect(messageDErreur(reponse(422), "repli")).toBe("repli");
  });
});
