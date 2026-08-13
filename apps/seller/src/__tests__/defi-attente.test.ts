import { describe, expect, it } from "vitest";
import { enMinutesSecondes, secondesRestantes } from "../lib/defi-attente.ts";

/**
 * Une echeance est un INSTANT, pas une duree.
 *
 * Banc du 13/08/2026 : la page d'attente rechargee affichait « expire dans
 * 5:00 » sur un code mort. Le porteur du produit l'a envoye trois fois ; la
 * sonde de preproduction n'a vu aucun defi cree pendant ces essais. Le
 * serveur n'y etait pour rien — l'ecran mentait.
 */
const DEFI = { expireDansS: 300, creeA: 1_000_000 };

describe("le temps restant d'un defi se recalcule, il ne se decremente pas", () => {
  it("a la creation, tout le temps est la", () => {
    expect(secondesRestantes(DEFI, DEFI.creeA)).toBe(300);
  });

  it("apres deux minutes, il en reste trois", () => {
    expect(secondesRestantes(DEFI, DEFI.creeA + 120_000)).toBe(180);
  });

  /* LE cas du 13/08 : la page rechargee bien apres l'echeance. Avant, elle
     repartait a 300 et invitait a envoyer un code mort. */
  it("une page rechargee APRES l'echeance ne rend jamais de temps", () => {
    expect(secondesRestantes(DEFI, DEFI.creeA + 900_000)).toBe(0);
  });

  it("le zero est un plancher, jamais un negatif", () => {
    expect(secondesRestantes(DEFI, DEFI.creeA + 10_000_000)).toBe(0);
  });

  /* Un etat ecrit par un paquet anterieur n'a pas de date de creation. On
     n'invente pas de verdict ici : c'est le serveur, interroge des le
     montage, qui dit « inconnu ». */
  it("sans date de creation, le repli rend la duree annoncee", () => {
    expect(secondesRestantes({ expireDansS: 300 }, 1_000_000)).toBe(300);
    expect(secondesRestantes({ expireDansS: 300, creeA: Number.NaN }, 1_000_000)).toBe(300);
  });

  it("la forme affichee tient la seconde et la minute", () => {
    expect(enMinutesSecondes(300)).toBe("5:00");
    expect(enMinutesSecondes(247)).toBe("4:07");
    expect(enMinutesSecondes(9)).toBe("0:09");
    expect(enMinutesSecondes(0)).toBe("0:00");
  });
});
