import { formatXaf } from "@catalog/contracts/money";
import { describe, expect, it } from "vitest";
import { aiguiller } from "../aiguillage.ts";
import type { CommandeOuverte } from "../conversation.ts";
import { detailCommandeVendeuse, reagirVendeuse } from "../conversation.ts";
import { demandeRegistre } from "../inscription.ts";
import type { MessageListe, MessageTexte } from "../messages.ts";

/**
 * Le registre des commandes — ADR 0107, la moitie « retrouver » de
 * l'ADR 0105 : la notification informe, le registre retrouve.
 *
 * Un mot (« commandes ») rend la liste des commandes ouvertes ; une ligne
 * ouvre le detail. Le fil vendeuse est en francais (ADR 0033).
 */

const VERS = "237677123456";
const ctx = (commandes: CommandeOuverte[], soldes?: number) => ({
  smsReconnu: false,
  commandesOuvertes: commandes,
  soldesXaf: soldes ?? commandes.reduce((s, c) => s + c.resteXaf, 0),
  boutique: {
    nom: "Chez Béa",
    nbArticles: 3,
    lienBoutique: "https://wa.me/x",
    lienEspace: "https://app.catalog.cm",
  },
});
const cmd = (n: number, etape: CommandeOuverte["etape"] = "recue"): CommandeOuverte => ({
  id: `id-${n}`,
  reference: `CT-88${String(n).padStart(4, "0")}`,
  resteXaf: 7500,
  etape,
  totalXaf: 15000,
});

describe("le mot « commandes » rend le registre", () => {
  it("est reconnu, barre oblique comprise, et route au fil vendeuse", () => {
    for (const forme of ["commandes", "mes commandes", "/commandes", "COMMANDES", "registre"]) {
      expect(demandeRegistre(forme), forme).toBe(true);
    }
    expect(
      aiguiller(
        { genre: "texte", texte: "commandes" },
        {
          estVendeuse: true,
          etatVendeuseEnCours: false,
          smsReconnu: false,
          /* Le cas qui coute : un achat en cours avalerait le mot sans la
             regle 3 — c'est le piege de « solde » (banc du 10/08). */
          achatEnCours: true,
        },
      ),
    ).toBe("vendeuse");
  });

  it("une valeur reste une valeur : « commandes » n'est pas un nom d'article volé", () => {
    /* Une acheteuse (non vendeuse) qui tape « commandes » part au fil
       acheteuse, ou `demandeStatut` sait deja lui repondre. */
    expect(
      aiguiller(
        { genre: "texte", texte: "commandes" },
        { estVendeuse: false, etatVendeuseEnCours: false, smsReconnu: false, achatEnCours: false },
      ),
    ).toBe("acheteuse");
  });

  it("trois commandes : une liste, la plus récente en tête, étape et reste par ligne", () => {
    const r = reagirVendeuse(
      { genre: "texte", texte: "commandes" },
      VERS,
      ctx([cmd(3, "preparee"), cmd(2), cmd(1, "livree")]),
    );
    const m = r.messages[0] as MessageListe;
    expect(m.interactive.type).toBe("list");
    const rows = m.interactive.action.sections[0]?.rows ?? [];
    expect(rows.map((l) => l.title)).toEqual(["CT-880003", "CT-880002", "CT-880001"]);
    expect(rows[0]?.id).toBe("reg:id-3");
    expect(rows[0]?.description).toContain("préparée");
    expect(rows[0]?.description).toContain(formatXaf(7500));
    expect(m.interactive.body.text).toContain("3");
  });

  it("sans commande ouverte : une phrase, jamais une liste vide qui lèverait", () => {
    const r = reagirVendeuse({ genre: "texte", texte: "commandes" }, VERS, ctx([]));
    expect((r.messages[0] as MessageTexte).text.body).toContain("tout est soldé");
  });

  it("douze commandes : neuf lignes, puis « Voir tout » — le débordement est dit", () => {
    const beaucoup = Array.from({ length: 12 }, (_, i) => cmd(i + 1));
    const r = reagirVendeuse({ genre: "texte", texte: "commandes" }, VERS, ctx(beaucoup));
    const rows = (r.messages[0] as MessageListe).interactive.action.sections[0]?.rows ?? [];
    expect(rows).toHaveLength(10);
    expect(rows[9]?.id).toBe("registre_espace");
    expect(rows[9]?.description).toContain("3 de plus");
  });

  it("une ligne touchée demande le DÉTAIL au service — la machine ne charge rien", () => {
    const r = reagirVendeuse({ genre: "liste", id: "reg:id-2" }, VERS, ctx([cmd(2)]));
    expect(r.messages).toEqual([]);
    expect(r.effet).toEqual({ type: "detail_commande", id: "id-2" });
  });

  it("« Voir tout » rend le lien de l'espace vendeuse", () => {
    const r = reagirVendeuse({ genre: "liste", id: "registre_espace" }, VERS, ctx([cmd(1)]));
    expect((r.messages[0] as MessageTexte).text.body).toContain("https://app.catalog.cm");
  });
});

describe("detailCommandeVendeuse — le détail dit l'état ET le geste suivant", () => {
  const base = {
    reference: "CT-880001",
    etape: "recue" as const,
    lignes: [{ nom: "Robe wax", quantite: 1, prixUnitaireXaf: 15000 }],
    totalXaf: 15000,
    payeXaf: 7500,
    resteXaf: 7500,
    preuve: "prouve" as const,
    destination: "retrait : Marché central",
    telephoneLivraison: "+237690112233",
  };

  it("commande reçue, acompte prouvé : lignes, montants, destination, et le geste", () => {
    const d = detailCommandeVendeuse(base);
    expect(d).toContain("*CT-880001* — reçue");
    expect(d).toContain("1× Robe wax");
    expect(d).toContain(`reste ${formatXaf(7500)}`);
    expect(d).toContain("l'encaissé a son reçu");
    expect(d).toContain("Marché central");
    expect(d).toContain("livrée CT-880001");
  });

  it("un paiement contesté gèle : l'avertissement remplace le geste de remise", () => {
    const d = detailCommandeVendeuse({ ...base, preuve: "conteste" });
    expect(d).toContain("⚠️");
    expect(d).toContain("gelée");
    expect(d).not.toContain("livrée CT-880001");
  });

  it("un dépôt déclaré à la main reste marqué NON TRACÉ — jamais promu (AGENTS.md §2)", () => {
    const d = detailCommandeVendeuse({ ...base, preuve: "declare_non_trace" });
    expect(d).toContain("non tracé");
  });

  it("livrée mais non soldée : plus de geste de remise, l'encaissement reste", () => {
    const d = detailCommandeVendeuse({ ...base, etape: "livree" });
    expect(d).toContain("l'encaissement");
    expect(d).not.toContain("écrivez");
  });
});
