import { formatXaf } from "@catalog/contracts/money";
import { describe, expect, it } from "vitest";
import {
  corpsLivraisonMarquee,
  corpsLivraisonRefusee,
  corpsNouvelleCommande,
  decisionRemise,
  FENETRE_SERVICE_MS,
} from "../notifications.ts";

/**
 * Les notifications du bot — ADR 0035. La regle a retenir : notre bot
 * n'initie jamais, donc tout ce qui n'est pas SUREMENT dans la fenetre de
 * service attend en base — jamais d'envoi a l'aveugle, jamais de perte.
 */

const MAINTENANT = new Date("2026-08-02T15:00:00+01:00");
const ilYa = (ms: number) => new Date(MAINTENANT.getTime() - ms);

describe("decisionRemise — envoyer ou attendre", () => {
  it("envoie quand la conversation a ete active sous 24 h", () => {
    expect(decisionRemise(ilYa(60_000), MAINTENANT)).toBe("envoyer");
    expect(decisionRemise(ilYa(FENETRE_SERVICE_MS - 1), MAINTENANT)).toBe("envoyer");
  });

  it("attend au-dela de 24 h, sur une conversation jamais vue, et sur une horloge incoherente", () => {
    expect(decisionRemise(ilYa(FENETRE_SERVICE_MS), MAINTENANT)).toBe("attendre");
    expect(decisionRemise(null, MAINTENANT)).toBe("attendre");
    expect(decisionRemise(ilYa(-60_000), MAINTENANT)).toBe("attendre");
  });
});

describe("les corps vendeuse", () => {
  it("la nouvelle commande prepare le rapprochement : quel SMS attendre, quoi en faire", () => {
    const corps = corpsNouvelleCommande({
      reference: "CT-522801",
      lignes: [{ nom: "Sac en raphia", quantite: 2 }],
      totalXaf: 16000,
      duAvantXaf: 8000,
      telephoneLivraison: "6 77 88 99 00",
    });
    expect(corps).toContain("CT-522801");
    expect(corps).toContain("Sac en raphia × 2");
    expect(corps).toContain(formatXaf(8000));
    expect(corps).toMatch(/collez-le ici/i);
    expect(corps).toContain("6 77 88 99 00");
  });

  it("sans prepaiement, la commande le dit — aucun SMS n'est promis", () => {
    const corps = corpsNouvelleCommande({
      reference: "CT-522802",
      lignes: [{ nom: "Pagne", quantite: 1 }],
      totalXaf: 15000,
      duAvantXaf: 0,
      telephoneLivraison: "6 77 88 99 00",
    });
    expect(corps).toMatch(/sans prépaiement/i);
    expect(corps).not.toMatch(/collez/i);
  });

  it("la livraison marquee et ses refus parlent en langue simple", () => {
    expect(corpsLivraisonMarquee("CT-522801")).toContain("CT-522801");
    expect(corpsLivraisonRefusee("CT-522801", "recul_ignore")).toMatch(/déjà/);
    expect(corpsLivraisonRefusee("CT-522801", "commande_introuvable")).toMatch(/aucune commande/i);
    expect(corpsLivraisonRefusee("CT-522801", "autre_chose")).toMatch(/étape/);
  });
});

/**
 * La vendeuse voit ENFIN ou livrer — ADR 0050.
 *
 * Defaut mesure le 07/08/2026 : `corpsNouvelleCommande` ne portait que
 * « Numéro à appeler pour la remise ». L'acheteuse saisissait un quartier et
 * un repere — tous deux OBLIGATOIRES (AGENTS.md §2, il n'existe pas
 * d'adresse au Cameroun) — et AUCUNE surface vendeuse ne les affichait :
 * ni ce message, ni l'app (`livraison: unknown`, jamais consomme).
 */
describe("la destination dans la notification vendeuse", () => {
  const base = {
    reference: "CT-482910",
    lignes: [{ nom: "Pagne wax", quantite: 1 }],
    totalXaf: 15000,
    duAvantXaf: 0,
    telephoneLivraison: "6 90 11 22 33",
  };

  it("porte la ville, le quartier et le REPERE", () => {
    const c = corpsNouvelleCommande({
      ...base,
      destination: "Livraison : Bafoussam, Banengo, en face du marché A",
    });
    expect(c).toContain("Bafoussam");
    expect(c).toContain("Banengo");
    expect(c).toContain("en face du marché A");
  });

  it("sans destination, le message reste celui d'avant — rien ne casse", () => {
    const c = corpsNouvelleCommande(base);
    expect(c).toContain("CT-482910");
    expect(c).toContain("6 90 11 22 33");
    expect(c).not.toContain("📍");
  });
});
