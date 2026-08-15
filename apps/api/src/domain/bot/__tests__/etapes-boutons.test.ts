import { formatXaf } from "@catalog/contracts/money";
import { describe, expect, it } from "vitest";
import { ETAT_INITIAL, reagirVendeuse } from "../conversation.ts";
import { demandeListeCommandes } from "../inscription.ts";
import {
  boutonsNouvelleCommande,
  carteAbsence,
  corpsEtapeFranchie,
  corpsListeCommandes,
  corpsRefusSoldeOuvert,
  lireBoutonEcrire,
  lireBoutonEtape,
  suiteEtape,
} from "../notifications.ts";

/**
 * Les etapes en boutons — ADR 0098 (lot P4). Le domaine seul : les boutons
 * de la notification, la sequence par mode, la garde du solde, la carte
 * d'absence et le mot-cle « commandes ». La transaction et le journal se
 * prouvent contre une vraie base dans `bot-etapes.test.ts`.
 */

describe("les boutons de la notification de commande", () => {
  it("portent la reference dans l'identifiant — c'est aussi la cle de la compilation", () => {
    const b = boutonsNouvelleCommande("CT-104312");
    expect(b.map((x) => x.id)).toEqual(["etape:preparee:CT-104312", "ecrire:CT-104312"]);
  });

  it("les titres tiennent dans la borne des 20 caracteres", () => {
    for (const b of boutonsNouvelleCommande("CT-104312")) {
      expect(b.titre.length, b.titre).toBeLessThanOrEqual(20);
    }
  });

  it("l'identifiant se relit — et un identifiant fabrique ne vise jamais une etape inconnue", () => {
    expect(lireBoutonEtape("etape:preparee:CT-104312")).toEqual({
      vers: "preparee",
      reference: "CT-104312",
    });
    expect(lireBoutonEtape("etape:recue:CT-104312")).toBeNull();
    expect(lireBoutonEtape("etape:annulee:CT-104312")).toBeNull();
    expect(lireBoutonEtape("article")).toBeNull();
    expect(lireBoutonEcrire("ecrire:CT-104312")).toBe("CT-104312");
    expect(lireBoutonEcrire("etape:preparee:CT-104312")).toBeNull();
  });
});

describe("suiteEtape — le bouton suivant suit l'etape, l'argent garde la porte", () => {
  it("livraison : preparee → chez le livreur → remise faite", () => {
    const s1 = suiteEtape({ etape: "preparee", modeLivraison: "livraison", balanceXaf: 0 }, "CT-1");
    expect(s1).toEqual({
      bouton: { id: "etape:chez_le_livreur:CT-1", titre: "🛵 Chez le livreur" },
    });
    const s2 = suiteEtape(
      { etape: "chez_le_livreur", modeLivraison: "livraison", balanceXaf: 0 },
      "CT-1",
    );
    expect(s2).toEqual({ bouton: { id: "etape:livree:CT-1", titre: "📦 Remise faite" } });
  });

  it("retrait : preparee → remise faite, JAMAIS d'etape de livreur (ADR 0005)", () => {
    const s = suiteEtape({ etape: "preparee", modeLivraison: "retrait", balanceXaf: 0 }, "CT-1");
    expect(s).toEqual({ bouton: { id: "etape:livree:CT-1", titre: "📦 Remise faite" } });
  });

  it("solde OUVERT : pas de bouton « Remise faite » — le rappel a la place", () => {
    const s = suiteEtape(
      { etape: "chez_le_livreur", modeLivraison: "livraison", balanceXaf: 10750 },
      "CT-1",
    );
    expect(s).toEqual({ rappelSoldeXaf: 10750 });
  });

  it("livree : plus rien a proposer", () => {
    expect(
      suiteEtape({ etape: "livree", modeLivraison: "livraison", balanceXaf: 0 }, "CT-1"),
    ).toBeNull();
  });
});

describe("les cartes", () => {
  it("l'etape franchie, copie de la maquette", () => {
    expect(corpsEtapeFranchie("CT-104312", "preparee")).toBe("🧺 *CT-104312 → préparée*");
    expect(corpsEtapeFranchie("CT-104312", "chez_le_livreur")).toBe(
      "🛵 *CT-104312 → chez le livreur*",
    );
  });

  it("le refus solde_ouvert dit CE QUI MANQUE : le montant, et le collage", () => {
    const corps = corpsRefusSoldeOuvert("CT-104312", 10750);
    /* Le montant passe par `formatXaf` — LE format du produit, jamais un
       espace recopie a la main (l'espace fine insecable ne se voit pas). */
    expect(corps).toContain(formatXaf(10750));
    expect(corps).toContain("Collez ici le SMS");
    expect(corps).toContain("rien n'a bougé");
  });

  it("la carte d'absence — copie de la maquette, et elle enseigne « commandes »", () => {
    const corps = carteAbsence([
      { reference: "CT-104298", totalXaf: 9500 },
      { reference: "CT-104305", totalXaf: 12000 },
    ]);
    expect(corps).toBe(
      `*Pendant votre absence*\n2 commandes : CT-104298 (${formatXaf(9500)}) · CT-104305 (${formatXaf(12000)}).\nÉcrivez « commandes » pour le détail.`,
    );
  });

  it("le detail « commandes » : reference, total, etape, reste", () => {
    const corps = corpsListeCommandes([
      { reference: "CT-104312", resteXaf: 10750, totalXaf: 21500, etape: "preparee" },
      { reference: "CT-104305", resteXaf: 0, totalXaf: 12000, etape: "chez_le_livreur" },
    ]);
    expect(corps).toContain(
      `CT-104312 · ${formatXaf(21500)} · préparée · reste ${formatXaf(10750)}`,
    );
    expect(corps).toContain(`CT-104305 · ${formatXaf(12000)} · chez le livreur · soldée`);
    expect(corpsListeCommandes([])).toContain("Aucune commande en cours");
  });
});

describe("les gestes du fil vendeuse", () => {
  const contexte = { smsReconnu: false, commandesOuvertes: [], soldesXaf: 0, boutique: null };

  it("le bouton d'etape devient l'effet — le moteur reste au service", () => {
    const r = reagirVendeuse(
      { genre: "bouton", id: "etape:preparee:CT-104312" },
      "237699000001",
      contexte,
    );
    expect(r.effet).toEqual({ type: "avancer_etape", reference: "CT-104312", vers: "preparee" });
    expect(r.etat).toEqual(ETAT_INITIAL);
  });

  it("« Écrire à la cliente » devient l'effet", () => {
    const r = reagirVendeuse({ genre: "bouton", id: "ecrire:CT-104312" }, "237699000001", contexte);
    expect(r.effet).toEqual({ type: "ecrire_cliente", reference: "CT-104312" });
  });

  it("« commandes » tape rend le detail depuis le contexte charge", () => {
    expect(demandeListeCommandes("commandes")).toBe(true);
    expect(demandeListeCommandes("Mes commandes")).toBe(true);
    expect(demandeListeCommandes("commande CT-1")).toBe(false);
    const r = reagirVendeuse({ genre: "texte", texte: "commandes" }, "237699000001", {
      ...contexte,
      commandesOuvertes: [
        { id: "o1", reference: "CT-104312", resteXaf: 10750, totalXaf: 21500, etape: "recue" },
      ],
    });
    expect((r.messages[0] as { text: { body: string } }).text.body).toContain("CT-104312");
    expect(r.effet).toBeUndefined();
  });

  it("« livrée CT-… » tape reste l'effet d'avant — le bouton n'est qu'un raccourci", () => {
    const r = reagirVendeuse(
      { genre: "texte", texte: "livrée CT-104312" },
      "237699000001",
      contexte,
    );
    expect(r.effet).toEqual({ type: "marquer_livree", reference: "CT-104312" });
  });
});
