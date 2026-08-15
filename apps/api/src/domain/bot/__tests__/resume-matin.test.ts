import { describe, expect, it } from "vitest";
import {
  type AFaireAujourdhui,
  demandeResume,
  type FaitsDHier,
  jourEnFrancais,
  jourLocal,
  resumeDuMatin,
} from "../resume-matin.ts";

/**
 * Le resume du matin — ADR 0100 (lot P6). Le composeur, pur : la carte de la
 * maquette, ou RIEN. La demonstration du lot est le test « sans faits →
 * silence ».
 */

const RIEN_HIER: FaitsDHier = {
  commandes: 0,
  paiementsProuves: 0,
  visites: { instrumentees: false, n: 0 },
  avis: [],
};
const RIEN_A_FAIRE: AFaireAujourdhui = { aPreparer: [], smsAttendus: 0, resteAEncaisserXaf: 0 };
const SAMEDI = new Date("2026-08-16T07:30:00+01:00");

const carte = (
  faits: Partial<FaitsDHier>,
  aFaire: Partial<AFaireAujourdhui> = {},
  premier = false,
) =>
  resumeDuMatin({
    nomVendeuse: "Bintou",
    dateDuJour: SAMEDI,
    faits: { ...RIEN_HIER, ...faits },
    aFaire: { ...RIEN_A_FAIRE, ...aFaire },
    premierResume: premier,
  });

describe("resumeDuMatin — la carte, ou RIEN", () => {
  it("SANS FAITS → null : le silence est une sortie de plein droit — la demonstration du lot", () => {
    expect(carte({})).toBeNull();
  });

  it("avec des faits : la carte de la maquette — date, faits, geste suivant", () => {
    const c = carte(
      {
        commandes: 2,
        paiementsProuves: 1,
        avis: [{ note: 5, mot: "Sac solide, livraison rapide" }],
      },
      { aPreparer: ["CT-104305"], smsAttendus: 0, resteAEncaisserXaf: 10750 },
    );
    expect(c).toContain("☀️ *Votre matin · dimanche 16 août*");
    expect(c).toContain("Bonjour Bintou — hier chez vous :");
    expect(c).toContain("🛒 Commandes : 2");
    expect(c).toContain("✅ Paiements prouvés : 1");
    expect(c).toContain("⭐ Avis reçu : « Sac solide, livraison rapide »");
    expect(c).toContain("À faire aujourd'hui : préparer CT-104305");
    expect(c).toContain("Bonne journée 🌞");
  });

  it("les visites N'EXISTENT PAS tant qu'elles ne sont pas comptees (ADR 0022)", () => {
    const c = carte({ commandes: 1, visites: { instrumentees: false, n: 340 } });
    expect(c).not.toContain("Visites");
    const avec = carte({ commandes: 1, visites: { instrumentees: true, n: 340 } });
    expect(avec).toContain("👀 Visites de la boutique : 340");
  });

  it("chaque ligne n'existe que si son fait existe — pas de zero decoratif", () => {
    const c = carte({ commandes: 3 });
    expect(c).toContain("🛒 Commandes : 3");
    expect(c).not.toContain("Paiements prouvés");
    expect(c).not.toContain("Avis");
  });

  it("rien hier mais un reste a faire : la carte part quand meme, sans bloc « hier »", () => {
    const c = carte({}, { aPreparer: ["CT-1", "CT-2"], smsAttendus: 1 });
    expect(c).toContain("préparer CT-1, CT-2");
    expect(c).toContain("1 SMS de paiement attendu");
    expect(c).not.toContain("hier chez vous");
  });

  it("la PREMIERE carte annonce l'opt-out ; les suivantes non", () => {
    expect(carte({ commandes: 1 }, {}, true)).toContain("« stop résumé »");
    expect(carte({ commandes: 1 }, {}, false)).not.toContain("stop résumé");
  });
});

describe("« stop résumé » / « résumé » — l'opt-out reversible", () => {
  it("reconnait les deux mots, accents ou pas, et rien d'autre", () => {
    expect(demandeResume("stop résumé")).toBe(true);
    expect(demandeResume("STOP RESUME")).toBe(true);
    expect(demandeResume("résumé")).toBe(false);
    expect(demandeResume("resume")).toBe(false);
    expect(demandeResume("stop")).toBeNull();
    expect(demandeResume("résumé de ma commande")).toBeNull();
  });
});

describe("les deux horloges du matin", () => {
  it("le jour en francais, heure de Douala", () => {
    expect(jourEnFrancais(SAMEDI)).toBe("dimanche 16 août");
  });

  it("la cle de deduplication est le jour LOCAL vecu", () => {
    expect(jourLocal(SAMEDI)).toBe("2026-08-16");
    /* 23:30 UTC = 00:30 a Douala : c'est deja demain la-bas. */
    expect(jourLocal(new Date("2026-08-16T23:30:00Z"))).toBe("2026-08-17");
  });
});
