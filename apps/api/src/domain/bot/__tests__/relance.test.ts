import { describe, expect, it } from "vitest";
import { type CommandePourRelance, decisionRelance, RELANCE_FENETRE_MAX_MS } from "../relance.ts";

/**
 * La decision de relance d'acompte — ADR 0033. Une seule regle a retenir :
 * on ne relance QUE la ou une relance aide, et jamais hors de la fenetre de
 * service gratuite.
 */

const CREATION = new Date("2026-08-02T10:00:00+01:00");
const BASE: CommandePourRelance = {
  payMode: "acompte",
  totalXaf: 15001,
  amountPaidXaf: 0,
  annuleeA: null,
  creeeA: CREATION,
};
const uneHeureApres = new Date(CREATION.getTime() + 3600_000);

describe("decisionRelance", () => {
  it("relance un acompte attendu et rien recu, avec le montant exact (floor)", () => {
    const d = decisionRelance(BASE, uneHeureApres);
    expect(d).toEqual({ relancer: true, acompteXaf: 7500 }); // floor de 50 % de 15 001
  });

  it("se tait des qu'un franc est arrive — meme un acompte partiel", () => {
    expect(decisionRelance({ ...BASE, amountPaidXaf: 100 }, uneHeureApres)).toEqual({
      relancer: false,
    });
  });

  it("se tait sur une commande annulee ou sans prepaiement", () => {
    expect(decisionRelance({ ...BASE, annuleeA: uneHeureApres }, uneHeureApres)).toEqual({
      relancer: false,
    });
    expect(decisionRelance({ ...BASE, payMode: "sans_prepaiement" }, uneHeureApres)).toEqual({
      relancer: false,
    });
  });

  it("se tait hors de la fenetre de service sure — trop tard ou horloge incoherente", () => {
    const tropTard = new Date(CREATION.getTime() + RELANCE_FENETRE_MAX_MS + 1);
    expect(decisionRelance(BASE, tropTard)).toEqual({ relancer: false });
    const avant = new Date(CREATION.getTime() - 1);
    expect(decisionRelance(BASE, avant)).toEqual({ relancer: false });
  });
});
