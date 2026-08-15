import { formatXaf } from "@catalog/contracts/money";
import { describe, expect, it } from "vitest";
import { type EtatVendeuse, normaliserEtatVendeuse, reagirInscription } from "../inscription.ts";
import type { MessageSortant } from "../messages.ts";
import {
  ajouterBrouillon,
  type BrouillonRafale,
  carteRafale,
  FENETRE_RAFALE_MS,
  lireCorrectionRafale,
  RAFALE_MAX,
} from "../rafale.ts";

/**
 * La rafale — ADR 0096, lot P1 de la cible premium (ADR 0095).
 *
 * Le geste reel est la SALVE de photos legendees. Avant ce lot, chaque photo
 * produisait sa carte de confirmation — le mur (ADR 0086) — et la photo
 * suivante ECRASAIT la proposition en attente. Ici : la premiere photo garde
 * le comportement d'aujourd'hui, les suivantes s'accumulent en brouillons,
 * et UNE carte confirme tout.
 */

const VERS = "237690112233";

const corps = (m: MessageSortant): string => JSON.stringify(m);

const photo = (n: number, legende?: string) => ({
  genre: "image" as const,
  mediaId: `media-${n}`,
  ...(legende ? { legende } : {}),
  messageId: `wamid.photo-${n}`,
});

/** Une salve jouee sur la machine, photo par photo. Rend l'etat et les messages. */
function salve(...photos: Array<Parameters<typeof reagirInscription>[1]>): {
  etat: EtatVendeuse | null;
  messages: MessageSortant[][];
} {
  let etat: EtatVendeuse | null = { nom: "article_nom" };
  const messages: MessageSortant[][] = [];
  for (const p of photos) {
    if (!etat) throw new Error("le fil s'est ferme en pleine salve");
    const r = reagirInscription(etat, p, VERS);
    etat = r.etat;
    messages.push(r.messages);
  }
  return { etat, messages };
}

describe("la salve d'UNE photo garde le comportement actuel (ADR 0035)", () => {
  it("une photo legendee → confirmation immediate, « Publier » → creer_article", () => {
    const { etat, messages } = salve(photo(1, "Pagne wax 6 yards 15 000"));
    expect(etat).toMatchObject({
      nom: "article_confirme",
      nomArticle: "Pagne wax 6 yards",
      prixXaf: 15000,
    });
    /* La confirmation part TOUT DE SUITE — pas de carte de rafale pour rien. */
    expect(corps(messages[0]?.[1] as MessageSortant)).toContain("Pagne wax 6 yards");
    const publie = reagirInscription(
      etat as EtatVendeuse,
      { genre: "bouton", id: "publier" },
      VERS,
    );
    expect(publie.effet).toMatchObject({ type: "creer_article", nom: "Pagne wax 6 yards" });
  });
});

describe("la rafale groupe (ADR 0096)", () => {
  it("la deuxieme photo ouvre la rafale : deux brouillons, un 👍 et RIEN d'autre", () => {
    const { etat, messages } = salve(
      photo(1, "Pagne wax 6 yards 15 000"),
      photo(2, "Huile de palme 5 L 4 500"),
    );
    expect(etat).toMatchObject({
      nom: "rafale",
      brouillons: [
        { nom: "Pagne wax 6 yards", prixXaf: 15000, mediaId: "media-1" },
        { nom: "Huile de palme 5 L", prixXaf: 4500, mediaId: "media-2" },
      ],
    });
    /* La photo 2 ne recoit qu'une REACTION — la carte attend la fenetre. */
    const reponse = messages[1] as MessageSortant[];
    expect(reponse).toHaveLength(1);
    expect(corps(reponse[0] as MessageSortant)).toContain('"reaction"');
  });

  it("demonstration — la sequence d'une salve de 3, message par message", () => {
    const { etat, messages } = salve(
      photo(1, "Pagne wax 6 yards 15 000"),
      photo(2, "Huile de palme 5 L 4 500"),
      photo(3, "Bijoux perles 3 000"),
    );
    /* Ce que la vendeuse VOIT, dans l'ordre :
       photo 1 → 👍 + « Pagne wax 6 yards — 15 000 F, je publie ? » (l'actuel)
       photo 2 → 👍 seul
       photo 3 → 👍 seul
       (fenetre echue, par le travail pg-boss) → LA carte : 3 articles. */
    expect(messages.map((m) => m.length)).toEqual([2, 1, 1]);
    const carte = carteRafale(VERS, (etat as Extract<EtatVendeuse, { nom: "rafale" }>).brouillons);
    const rendu = corps(carte);
    expect(rendu).toContain("3 articles prêts à publier");
    expect(rendu).toContain(`1. Pagne wax 6 yards — ${formatXaf(15000)}`);
    expect(rendu).toContain(`2. Huile de palme 5 L — ${formatXaf(4500)}`);
    expect(rendu).toContain(`3. Bijoux perles — ${formatXaf(3000)}`);
    expect(rendu).toContain("Tout publier");
    /* « Tout publier » rend la salve entiere au service, d'un coup. */
    const publie = reagirInscription(
      etat as EtatVendeuse,
      { genre: "bouton", id: "tout_publier" },
      VERS,
    );
    expect(publie.etat).toBeNull();
    expect(publie.effet).toMatchObject({ type: "publier_rafale" });
    expect((publie.effet as { brouillons: unknown[] }).brouillons).toHaveLength(3);
  });

  it("« corriger le 2 » rouvre le SEUL brouillon 2 — les autres ne bougent pas", () => {
    const { etat } = salve(
      photo(1, "Pagne wax 6 yards 15 000"),
      photo(2, "Huile 5 L 4 500"),
      photo(3, "Bijoux perles 3 000"),
    );
    const ouverte = reagirInscription(
      etat as EtatVendeuse,
      { genre: "texte", texte: "corriger le 2" },
      VERS,
    );
    expect(ouverte.etat).toMatchObject({ nom: "rafale_correction", n: 2 });
    /* Le MEME motif que la legende : nom puis prix, en un message. */
    const corrigee = reagirInscription(
      ouverte.etat as EtatVendeuse,
      { genre: "texte", texte: "Huile de palme 5 L 4500" },
      VERS,
    );
    expect(corrigee.etat).toMatchObject({
      nom: "rafale",
      brouillons: [
        { nom: "Pagne wax 6 yards", prixXaf: 15000 },
        { nom: "Huile de palme 5 L", prixXaf: 4500, mediaId: "media-2" },
        { nom: "Bijoux perles", prixXaf: 3000 },
      ],
    });
    /* Le recapitulatif corrige se re-montre : rien ne se publie sans lui. */
    expect(corps(corrigee.messages[0] as MessageSortant)).toContain("Huile de palme 5 L");
  });

  it("une photo SANS legende lisible entre « sans nom » — et Tout publier refuse en le nommant", () => {
    const { etat } = salve(photo(1, "Pagne wax 6 yards 15 000"), photo(2));
    const brouillons = (etat as Extract<EtatVendeuse, { nom: "rafale" }>).brouillons;
    expect(brouillons[1]).toMatchObject({ nom: null, prixXaf: null, mediaId: "media-2" });
    const carte = corps(carteRafale(VERS, brouillons));
    expect(carte).toContain("sans nom");
    expect(carte).toContain("corriger le 2");
    /* On n'invente pas un nom (§7.7) : rien ne part. */
    const refus = reagirInscription(
      etat as EtatVendeuse,
      { genre: "bouton", id: "tout_publier" },
      VERS,
    );
    expect(refus.effet).toBeUndefined();
    expect(refus.etat).toMatchObject({ nom: "rafale" });
    expect(corps(refus.messages[0] as MessageSortant)).toContain("corriger le 2");
  });

  it("idempotence (ADR 0040) : la photo relivree par Meta ne cree pas deux brouillons", () => {
    const { etat } = salve(
      photo(1, "Pagne wax 6 yards 15 000"),
      photo(2, "Huile de palme 5 L 4 500"),
      photo(2, "Huile de palme 5 L 4 500"),
    );
    expect((etat as Extract<EtatVendeuse, { nom: "rafale" }>).brouillons).toHaveLength(2);
  });

  it("la borne a 10 : la photo de trop N'ENTRE PAS, la carte invite a publier", () => {
    const photos = Array.from({ length: RAFALE_MAX + 1 }, (_, i) =>
      photo(i + 1, `Article ${i + 1} 1000`),
    );
    const { etat, messages } = salve(...photos);
    const brouillons = (etat as Extract<EtatVendeuse, { nom: "rafale" }>).brouillons;
    expect(brouillons).toHaveLength(RAFALE_MAX);
    const derniere = messages.at(-1) as MessageSortant[];
    expect(corps(derniere[0] as MessageSortant)).toContain("publiez-les d'abord");
    expect(corps(derniere[1] as MessageSortant)).toContain("10 articles prêts");
  });

  it("le « Publier » perime de la carte unitaire ne publie RIEN : la carte se re-montre", () => {
    const { etat } = salve(photo(1, "Pagne wax 6 yards 15 000"), photo(2, "Huile 5 L 4 500"));
    const r = reagirInscription(etat as EtatVendeuse, { genre: "bouton", id: "publier" }, VERS);
    expect(r.effet).toBeUndefined();
    expect(r.etat).toMatchObject({ nom: "rafale", annonce: true });
    expect(corps(r.messages[0] as MessageSortant)).toContain("2 articles prêts");
  });
});

describe("la mecanique pure du collecteur", () => {
  it("ajouterBrouillon : ajoute, refuse le deja-vu, refuse le trop-plein", () => {
    const un = ajouterBrouillon([], {
      mediaId: "m1",
      lu: { nom: "Pagne", prixXaf: 15000 },
      wamid: "w1",
    });
    expect(un).toMatchObject({ resultat: "ajoute" });
    const brouillons = (un as { brouillons: BrouillonRafale[] }).brouillons;
    expect(ajouterBrouillon(brouillons, { mediaId: "m1b", lu: null, wamid: "w1" })).toEqual({
      resultat: "deja_vu",
    });
    const dix: BrouillonRafale[] = Array.from({ length: 10 }, (_, i) => ({
      nom: `A${i}`,
      prixXaf: 1000,
      mediaId: `m${i}`,
    }));
    expect(ajouterBrouillon(dix, { mediaId: "m11", lu: null })).toEqual({ resultat: "plein" });
  });

  it("lireCorrectionRafale lit « corriger le 2 », « corriger 3 », et refuse le reste", () => {
    expect(lireCorrectionRafale("corriger le 2")).toBe(2);
    expect(lireCorrectionRafale("Corriger 3")).toBe(3);
    expect(lireCorrectionRafale("corriger")).toBeNull();
    expect(lireCorrectionRafale("corriger le pagne")).toBeNull();
  });

  it("l'etat persiste se RELIT — brouillons, annonce, correction — et le difforme vaut null", () => {
    const rafale = normaliserEtatVendeuse({
      nom: "rafale",
      annonce: true,
      brouillons: [
        { nom: "Pagne", prixXaf: 15000, mediaId: "m1", wamid: "w1" },
        { nom: null, prixXaf: null, mediaId: "m2" },
      ],
    });
    expect(rafale).toMatchObject({ nom: "rafale", annonce: true });
    expect(
      normaliserEtatVendeuse({
        nom: "rafale_correction",
        n: 2,
        brouillons: [{ nom: "Pagne", prixXaf: 15000, mediaId: "m1" }],
      }),
      "n hors bornes",
    ).toBeNull();
    expect(normaliserEtatVendeuse({ nom: "rafale", brouillons: [] })).toBeNull();
    expect(normaliserEtatVendeuse({ nom: "rafale", brouillons: [{ nom: "x" }] })).toBeNull();
  });

  it("la fenetre est une constante NOMMEE, portee par l'appelant — pas d'horloge ici", () => {
    expect(FENETRE_RAFALE_MS).toBe(30_000);
  });
});
