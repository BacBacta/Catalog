import { describe, expect, it } from "vitest";
import { CARTE_HAUTEUR, CARTE_LARGEUR, composerCarte } from "../carte-vitrine.ts";
import { lireLegendeArticle } from "../inscription.ts";

/**
 * La carte doit se SCANNER — retour du banc du 10/08/2026, carte « Chez
 * oumar ». Trois defauts distincts, tous visibles sur une seule image :
 * le QR sombre pose sur un fond sombre, sans zone de silence ; la carte
 * reduite a 640 px par le pipeline des photos d'articles ; et un nom
 * d'article qui garde sa virgule.
 */
const CARTE = {
  nomBoutique: "Chez oumar",
  ville: "Maroua",
  lien: "https://wa.me/32451055144?text=boutique%20chez-oumar",
  lienAffiche: "wa.me/32451055144",
  motCle: "boutique chez-oumar",
  reputation: { note: null, nbVerifies: 0 },
  articles: [{ nom: "Eau", prixXaf: 1000, avecPhoto: true }],
  qrChemin: "M0 0h1v1h-1z",
  qrTaille: 29,
};

describe("le QR se detache de son fond", () => {
  const svg = composerCarte(CARTE);

  it("repose sur une plaque CLAIRE, pas sur le vert du bandeau", () => {
    /* Un QR sombre sur un vert sombre ne se scanne pas, quelle que soit sa
       definition : c'est le contraste qui porte la lecture. */
    expect(svg).toMatch(/<rect[^>]*class="qr-plaque"[^>]*fill="#f{3,6}"/i);
  });

  it("garde une zone de silence — la plaque deborde le code", () => {
    const plaque = /class="qr-plaque"[^>]*width="(\d+)"/.exec(svg);
    const code = /class="qr-code"[^>]*data-cote="(\d+)"/.exec(svg);
    expect(plaque?.[1]).toBeDefined();
    expect(code?.[1]).toBeDefined();
    const marge = (Number(plaque?.[1]) - Number(code?.[1])) / 2;
    /* Le standard demande quatre modules ; a 29 modules sur ~240 px, cela
       fait ~33 px de chaque cote. On ne descend pas en dessous. */
    expect(marge).toBeGreaterThanOrEqual(30);
  });

  it("sans QR, aucune plaque vide ne subsiste", () => {
    const { qrChemin: _c, qrTaille: _t, ...sansQr } = CARTE;
    const sans = composerCarte(sansQr);
    expect(sans).not.toContain("qr-plaque");
  });
});

describe("le mot-cle de LA boutique passe devant le numero partage", () => {
  const svg = composerCarte(CARTE);

  it("« boutique chez-oumar » est ecrit plus grand que le wa.me", () => {
    /* Le numero est le meme pour toutes les vendeuses : lu en premier, il
       fait croire qu'on regarde la carte de quelqu'un d'autre. C'est le mot
       cle qui identifie LA boutique. */
    const tailleDe = (texte: string) => {
      const m = new RegExp(`font-size="(\\d+)"[^>]*>[^<]*${texte}`).exec(svg);
      return Number(m?.[1] ?? 0);
    };
    expect(tailleDe("boutique chez-oumar")).toBeGreaterThan(tailleDe("wa.me/32451055144"));
  });
});

describe("la legende d'une photo ne garde pas sa ponctuation", () => {
  it("« Eau, 1000 » donne « Eau », pas « Eau, »", () => {
    expect(lireLegendeArticle("Eau, 1000")).toEqual({ nom: "Eau", prixXaf: 1000 });
  });

  it.each([
    ["Robe wax : 15000", "Robe wax"],
    ["Sac en raphia — 8000", "Sac en raphia"],
    ["Pagne 6 yards; 12000", "Pagne 6 yards"],
    ["Eau . 1000", "Eau"],
  ])("« %s » donne « %s »", (legende, nom) => {
    expect(lireLegendeArticle(legende)?.nom).toBe(nom);
  });

  it("la ponctuation INTERNE reste — elle appartient au nom", () => {
    expect(lireLegendeArticle("Eau, sachet 1000")?.nom).toBe("Eau, sachet");
  });
});

describe("les dimensions de la carte ne bougent pas", () => {
  it("reste en 1080 x 1920 — le format d'un Statut", () => {
    expect([CARTE_LARGEUR, CARTE_HAUTEUR]).toEqual([1080, 1920]);
  });
});
