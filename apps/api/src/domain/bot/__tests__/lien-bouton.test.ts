import { describe, expect, it } from "vitest";
import { LIEN_LIBELLE_MAX, lienBouton } from "../messages.ts";

/**
 * Le bouton-lien `cta_url` — ADR 0097, et la regle qui le borne.
 *
 * ── Ce qu'il remplace, et ce qu'il ne remplace PAS ────────────────────────
 *
 * Un lien devient un bouton quand le lecteur doit l'OUVRIR. Il reste du texte
 * quand le lecteur doit le COPIER, le PARTAGER ou le TRANSMETTRE : **un bouton
 * ne se copie pas**. C'est la frontiere qui decide, et elle n'est pas
 * esthetique — convertir le lien de boutique de la vendeuse (« partagez-le,
 * mettez-le en Statut ») le rendrait inutilisable pour son seul usage.
 *
 * S'y ajoute la frontiere de l'ADR 0088 : `cta_url` sert « va voir cette
 * page », jamais « prends cette decision ».
 */

describe("le bouton-lien", () => {
  const URL = "https://boutique.test/suivi/abc";

  it("porte le corps, le libelle et l'URL, en forme `cta_url`", () => {
    const m = lienBouton("237690000001", "Votre suivi vit ici.", "Suivre ma commande", URL);
    expect(m).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "237690000001",
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: "Votre suivi vit ici." },
        action: {
          name: "cta_url",
          parameters: { display_text: "Suivre ma commande", url: URL },
        },
      },
    });
  });

  /**
   * ── Le garde qui compte : `https://` et rien d'autre ───────────────────
   *
   * La rampe de paiement est un lien `tel:` portant une chaine USSD (lot 9).
   * En faire un bouton le rendrait inerte — le composeur ne s'ouvrirait pas —
   * et la panne serait SILENCIEUSE : l'API accepterait peut-etre le message,
   * l'acheteuse verrait un bouton, et il ne se passerait rien.
   *
   * C'est le seul chemin par lequel cette conversion pourrait casser le geste
   * n° 1 du produit. Il est ferme par une levee, pas par une convention.
   */
  it("REFUSE tout ce qui n'est pas https — la rampe `tel:` en premier", () => {
    expect(() => lienBouton("237690000001", "corps", "Payer", "tel:*126%23")).toThrow(/https/);
    expect(() => lienBouton("237690000001", "corps", "Ouvrir", "http://boutique.test")).toThrow(
      /https/,
    );
    expect(() => lienBouton("237690000001", "corps", "Ouvrir", "boutique.test")).toThrow(/https/);
  });

  it("refuse un libelle vide : un bouton sans mot ne se tape pas", () => {
    expect(() => lienBouton("237690000001", "corps", "   ", URL)).toThrow(/libell/i);
  });

  it("tronque un libelle trop long au lieu de laisser Meta le refuser", () => {
    const m = lienBouton("237690000001", "corps", "Suivre ma commande et mon reçu vérifiable", URL);
    expect(m.interactive.action.parameters.display_text.length).toBeLessThanOrEqual(
      LIEN_LIBELLE_MAX,
    );
  });

  it("refuse un corps vide : le texte doit rester autosuffisant sans le bouton", () => {
    /* AGENTS.md : le lien est un confort, jamais le seul porteur. Un bouton
       l'est encore moins — il ne se copie pas, et il peut ne pas s'ouvrir sur
       un forfait bride. Un message reduit a un bouton ne dirait plus rien. */
    expect(() => lienBouton("237690000001", "", "Suivre", URL)).toThrow();
  });
});
