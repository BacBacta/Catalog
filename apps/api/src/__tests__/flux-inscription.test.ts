import { describe, expect, it } from "vitest";
import { genreDuJeton, jetonFlux, lireInscriptionFlux } from "../domain/bot/flux.ts";

/**
 * Le formulaire d'inscription vendeuse — tache #60.
 *
 * Le Flow etait publie chez Meta depuis le sprint des Flows, et **aucune ligne
 * de code ne l'appelait**. Ces tests tiennent les trois regles qui rendent le
 * branchement sur, plutot que rapide.
 */

describe("le jeton separe les trois formulaires", () => {
  /**
   * Les trois arrivent par le MEME chemin (`nfm_reply`) : livraison, avis,
   * inscription. Sans le jeton, une reponse d'avis entrerait dans le fil
   * d'inscription — et creerait une boutique nommee « 5 ».
   */
  it("une reponse d'inscription se reconnait, et pas les autres", () => {
    const jeton = jetonFlux("inscription");
    expect(genreDuJeton(JSON.stringify({ flow_token: jeton }))).toBe("inscription");
    expect(genreDuJeton(JSON.stringify({ flow_token: jetonFlux("avis") }))).toBe("avis");
    /* Pas de jeton : la livraison, par compatibilite (un Flow ancien encore
       publie ne doit pas se perdre). */
    expect(genreDuJeton(JSON.stringify({}))).toBe("livraison");
  });
});

describe("ce que le formulaire fait entrer", () => {
  const reponse = (o: Record<string, unknown>) =>
    JSON.stringify({ flow_token: jetonFlux("inscription"), ...o });

  it("lit un formulaire complet", () => {
    expect(
      lireInscriptionFlux(reponse({ boutique: "Chez Bea", ville: "Douala", langue: "fr" })),
    ).toEqual({ nomBoutique: "Chez Bea", ville: "Douala", langue: "fr" });
  });

  /**
   * **Un formulaire ne doit pas faire entrer ce que la question refuse.**
   * C'est la regle qui empeche un Flow — modifiable chez Meta sans toucher au
   * code — de devenir une porte derobee sur les bornes du domaine.
   */
  it("REFUSE ce que la saisie libre refuserait", () => {
    expect(lireInscriptionFlux(reponse({ boutique: "A", ville: "Douala" }))).toBeNull();
    expect(lireInscriptionFlux(reponse({ boutique: "Chez Bea", ville: "" }))).toBeNull();
    expect(lireInscriptionFlux(reponse({ boutique: "Chez Bea", ville: "D" }))).toBeNull();
    expect(
      lireInscriptionFlux(reponse({ boutique: "Chez Bea", ville: "x".repeat(200) })),
    ).toBeNull();
    /* La liste des villes n'est PAS fermee — `villeAcceptable` borne la
       longueur, pas le vocabulaire. C'est voulu : le Cameroun a plus de villes
       qu'aucune liste n'en contiendra, et refuser un nom inconnu enfermerait
       dehors une vendeuse de Foumbot. Le test le dit pour qu'on ne le
       « corrige » pas un jour en fermant la liste. */
    expect(lireInscriptionFlux(reponse({ boutique: "Chez Bea", ville: "Foumbot" }))).not.toBeNull();
    expect(lireInscriptionFlux("pas du json")).toBeNull();
  });

  /**
   * La langue est la seule tolerance : une valeur inconnue retombe sur le
   * francais plutot que de faire echouer une inscription entiere pour un champ
   * de confort.
   */
  it("retombe sur le francais pour une langue inconnue", () => {
    expect(
      lireInscriptionFlux(reponse({ boutique: "Chez Bea", ville: "Douala", langue: "wes" }))
        ?.langue,
    ).toBe("fr");
    expect(lireInscriptionFlux(reponse({ boutique: "Chez Bea", ville: "Douala" }))?.langue).toBe(
      "fr",
    );
    expect(
      lireInscriptionFlux(reponse({ boutique: "Chez Bea", ville: "Douala", langue: "en" }))?.langue,
    ).toBe("en");
  });

  /** Les espaces de bord viennent des claviers, pas des vendeuses. */
  it("nettoie les bords sans toucher au milieu", () => {
    expect(
      lireInscriptionFlux(reponse({ boutique: "  Chez  Bea  ", ville: " Douala " }))?.nomBoutique,
    ).toBe("Chez  Bea");
  });
});
