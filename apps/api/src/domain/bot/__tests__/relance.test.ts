import { describe, expect, it } from "vitest";
import {
  type CommandePourRelance,
  decisionRelance,
  decisionRelanceReversement,
  RELANCE_FENETRE_MAX_MS,
} from "../relance.ts";

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

  it("redit le montant FIGE a la creation quand la commande le porte — ADR 0094", () => {
    /* Non-retour du constat A4 : la relance recalculait depuis la constante,
       et redisait donc un montant que la commande n'avait jamais demande si
       le pourcentage avait change entre-temps. */
    const d = decisionRelance({ ...BASE, duAvantXaf: 5000 }, uneHeureApres);
    expect(d).toEqual({ relancer: true, acompteXaf: 5000 });
    /* `null` — commande d'avant la colonne : l'ancien recalcul, pour elle seule. */
    expect(decisionRelance({ ...BASE, duAvantXaf: null }, uneHeureApres)).toEqual({
      relancer: true,
      acompteXaf: 7500,
    });
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

describe("decisionRelanceReversement — le moteur de confiance se rallume (ADR 0035)", () => {
  const CREEE = new Date("2026-08-02T09:00:00+01:00");
  const apres = (heures: number) => new Date(CREEE.getTime() + heures * 3600_000);

  it("relance a ~20 h une boutique toujours sans reversement", () => {
    expect(
      decisionRelanceReversement({ reversementPose: false, creeeA: CREEE }, apres(20)),
    ).toEqual({ relancer: true });
  });

  it("se tait si le reversement a ete pose entre-temps", () => {
    expect(decisionRelanceReversement({ reversementPose: true, creeeA: CREEE }, apres(20))).toEqual(
      { relancer: false },
    );
  });

  it("se tait hors de la fenetre sure — et sur une horloge incoherente", () => {
    expect(
      decisionRelanceReversement({ reversementPose: false, creeeA: CREEE }, apres(25)),
    ).toEqual({ relancer: false });
    expect(
      decisionRelanceReversement({ reversementPose: false, creeeA: CREEE }, apres(-1)),
    ).toEqual({ relancer: false });
  });
});
