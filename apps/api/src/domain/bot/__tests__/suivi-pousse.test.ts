import { describe, expect, it } from "vitest";
import {
  ETAT_INITIAL,
  lignesSuivi,
  reagirAcheteuse,
  type StatutDerniereCommande,
} from "../conversation.ts";
import { lien } from "../messages.ts";
import { TEXTES } from "../textes.ts";

/**
 * Le suivi pousse — ADR 0099 (lot P5). Le domaine seul : le rendu partage
 * (`lignesSuivi`, un seul vocabulaire pour « suivi » et pour la carte
 * poussee), la bulle de contre-signature qui installe le suivi, et la forme
 * du bouton-lien. La politique de fenetre se prouve contre une vraie base
 * dans `bot-suivi.test.ts`.
 */

const COMMANDE: StatutDerniereCommande = {
  reference: "CT-104312",
  boutique: "Chez Bintou",
  libelle: "Preparee, prete a partir",
  resteXaf: 10750,
  etapes: [
    { libelle: "Commande recue par la vendeuse", faite: true, courante: false },
    { libelle: "Preparee, prete a partir", faite: true, courante: true },
    { libelle: "Confiee au livreur — il vous appellera", faite: false, courante: false },
    { libelle: "Livree", faite: false, courante: false },
  ],
  preuve: "prouve",
  contresignable: true,
};

describe("lignesSuivi — UN rendu pour les deux porteurs", () => {
  it("dessine le chemin : ✓ fait, ➔ en cours, ○ a venir — puis le reste et la preuve", () => {
    const lignes = lignesSuivi(COMMANDE, TEXTES.fr);
    expect(lignes[0]).toBe("*CT-104312 — Chez Bintou*");
    expect(lignes[1]).toBe("✓ Commande recue par la vendeuse");
    expect(lignes[2]).toBe("➔ Preparee, prete a partir");
    expect(lignes[3]).toBe("○ Confiee au livreur — il vous appellera");
    expect(lignes.join("\n")).toContain(TEXTES.fr.statutResteAPayer(10750));
    expect(lignes.join("\n")).toContain(TEXTES.fr.statutPreuveProuvee);
  });

  it("solde regle : la ligne le dit ; sans etapes, le libelle seul", () => {
    const lignes = lignesSuivi({ ...COMMANDE, resteXaf: 0 }, TEXTES.fr);
    expect(lignes.join("\n")).toContain(TEXTES.fr.statutRegle);
    const { etapes: _e, ...sansEtapes } = COMMANDE;
    const sans = lignesSuivi({ ...sansEtapes, libelle: "Commande annulée." }, TEXTES.fr);
    expect(sans).toContain("Commande annulée.");
  });

  it("existe en anglais — la parite est tenue par le typage", () => {
    const lignes = lignesSuivi(COMMANDE, TEXTES.en);
    expect(lignes.join("\n")).toContain(TEXTES.en.statutResteAPayer(10750));
    expect(TEXTES.en.suiviIntro).not.toBe(TEXTES.fr.suiviIntro);
    expect(TEXTES.en.suiviMisAJour).not.toBe(TEXTES.fr.suiviMisAJour);
  });
});

describe("la contre-signature installe le suivi — ADR 0099, decision 4", () => {
  it("UNE bulle : le merci existant, puis « Voici votre suivi » et le chemin", () => {
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "contresigner" },
      { vers: "237699000001", boutique: null, derniereCommande: COMMANDE },
    );
    expect(r.effet).toEqual({ type: "contresigner" });
    expect(r.messages).toHaveLength(1);
    const corps = (r.messages[0] as { text: { body: string } }).text.body;
    expect(corps).toContain("votre confirmation est enregistrée");
    expect(corps).toContain(TEXTES.fr.suiviIntro);
    expect(corps).toContain("➔ Preparee, prete a partir");
  });

  it("sans chemin charge, le merci reste entier — rien n'invente un suivi", () => {
    const { etapes: _e, ...sansEtapes } = COMMANDE;
    const r = reagirAcheteuse(
      ETAT_INITIAL,
      { genre: "bouton", id: "contresigner" },
      {
        vers: "237699000001",
        boutique: null,
        derniereCommande: sansEtapes,
      },
    );
    const corps = (r.messages[0] as { text: { body: string } }).text.body;
    expect(corps).toContain("votre confirmation est enregistrée");
    expect(corps).not.toContain(TEXTES.fr.suiviIntro);
  });
});

describe("le bouton-lien `cta_url` — l'usage mesure de l'ADR 0087", () => {
  it("porte le corps, le libelle et l'URL — et refuse une URL non https", () => {
    const m = lien("237699000001", "corps", "Voir le suivi", "https://boutique.test/suivi/abc");
    expect(m.interactive.type).toBe("cta_url");
    expect(m.interactive.action.parameters).toEqual({
      display_text: "Voir le suivi",
      url: "https://boutique.test/suivi/abc",
    });
    expect(() => lien("2376", "corps", "Voir", "http://pas-sur.test")).toThrow();
  });
});
