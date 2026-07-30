import type { ProofState } from "@catalog/contracts";
import { operateurParId } from "@catalog/contracts/ussd";
import { describe, expect, it } from "vitest";
import { RAMPE_DEFAUT } from "../domain/ramp/config.ts";
import {
  type CommandePourRecu,
  emettreRecu,
  marcheAsuivre,
  type PreuvePourRecu,
  porteeDuRecu,
} from "../domain/receipt/recu.ts";

/**
 * Le recu.
 *
 * Trois criteres de la definition de terminé du lot 10 se jouent ici :
 * un paiement `declare_non_trace` n'a pas de recu, une contestation n'efface
 * rien, et le code de verification vient de la configuration de la rampe.
 */

const MTN = operateurParId(RAMPE_DEFAUT, "mtn");
if (!MTN) throw new Error("operateur mtn absent de la configuration");

const preuve = (p: Partial<PreuvePourRecu> = {}): PreuvePourRecu => ({
  operator: "mtn",
  operatorTxId: "17600000002",
  amountXaf: 26800,
  occurredAt: new Date(2026, 5, 23, 9, 50, 32),
  patternAConfirmer: false,
  countersignedAt: null,
  createdAt: new Date(2026, 5, 23, 9, 52, 0),
  ...p,
});

const commande = (p: Partial<CommandePourRecu> = {}): CommandePourRecu => ({
  ref: "CT-1043",
  verificationCode: "ACDE-4679",
  boutique: "Chez Maman Jeanne",
  totalXaf: 26800,
  amountPaidXaf: 26800,
  proofState: "prouve" as ProofState,
  ...p,
});

const recuDe = (c = commande(), p = preuve()) => {
  const r = emettreRecu(c, p, MTN);
  if (!("recu" in r)) throw new Error(`recu attendu, refus ${JSON.stringify(r)}`);
  return r.recu;
};

describe("emission", () => {
  it("porte l'identifiant de l'operateur, le montant, la reference et la date", () => {
    const r = recuDe();
    expect(r.operatorTxId).toBe("17600000002");
    expect(r.montantXaf).toBe(26800);
    expect(r.reference).toBe("CT-1043");
    expect(r.operateur.nom).toBe(MTN.nom);
    expect(r.survenuA).toEqual(new Date(2026, 5, 23, 9, 50, 32));
  });

  it("distingue la date du SMS de la date du constat", () => {
    // Les confondre laisserait croire que Catalog a vu passer le transfert.
    const r = recuDe();
    expect(r.survenuA).not.toEqual(r.constateA);
  });

  it("survit a un identifiant Orange sans date exploitable", () => {
    const r = recuDe(commande(), preuve({ occurredAt: null }));
    expect(r.survenuA).toBeNull();
    expect(r.constateA).toBeTruthy();
  });

  it("existe sur un acompte, avec le reste du", () => {
    const r = recuDe(commande({ amountPaidXaf: 13400 }), preuve({ amountXaf: 13400 }));
    expect(r.montantXaf).toBe(13400);
    expect(r.resteXaf).toBe(13400);
  });

  it("ne rend jamais un reste negatif", () => {
    const r = recuDe(commande({ amountPaidXaf: 30000 }));
    expect(r.resteXaf).toBe(0);
  });

  it("porte la contre-signature quand elle existe", () => {
    const quand = new Date(2026, 5, 23, 18, 0, 0);
    const r = recuDe(commande({ proofState: "contresigne" }), preuve({ countersignedAt: quand }));
    expect(r.contresigneA).toEqual(quand);
    expect(r.etat).toBe("contresigne");
  });
});

describe("quand il n'y a pas de recu", () => {
  it("un depot declare a la main n'en donne PAS", () => {
    // C'est ce qui donne sa valeur au recu. On ne bloque pas le depot direct,
    // on le distingue.
    const r = emettreRecu(commande({ proofState: "declare_non_trace" }), null, MTN);
    expect(r).toEqual({ refus: "declare_non_trace" });
  });

  it("une contestation retire le recu SANS effacer la preuve", () => {
    // La preuve est toujours la, passee en parametre : c'est l'etat qui refuse,
    // pas l'absence de piece.
    const r = emettreRecu(commande({ proofState: "conteste" }), preuve(), MTN);
    expect(r).toEqual({ refus: "conteste" });
  });

  it("la contestation l'emporte sur l'etat de la preuve", () => {
    // Une commande contestee apres contre-signature ne rend pas un recu.
    const r = emettreRecu(commande({ proofState: "conteste" }), preuve({}), MTN);
    expect(r).toEqual({ refus: "conteste" });
  });

  it("une preuve attendue n'en donne pas", () => {
    expect(emettreRecu(commande({ proofState: "attendu" }), null, MTN)).toEqual({
      refus: "preuve_absente",
    });
  });

  it("un etat prouve SANS piece n'en donne pas non plus", () => {
    // Marquer « paye et prouve » sans identifiant d'operateur est un interdit
    // d'AGENTS.md : le recu refuse plutot que d'afficher un identifiant vide.
    expect(emettreRecu(commande({ proofState: "prouve" }), null, MTN)).toEqual({
      refus: "preuve_absente",
    });
  });
});

describe("la marche a suivre vient de la configuration de la rampe", () => {
  it("affiche le code d'entree configure, pas une constante", () => {
    const r = recuDe();
    expect(r.marcheAsuivre.codeOperateur).toBe(MTN.codeEntree.modele);
    expect(r.marcheAsuivre.codeVerifie).toBe(true);
    expect(r.marcheAsuivre.etapes).toEqual(MTN.etapesVerification);
  });

  it("suit l'operateur quand la configuration change", () => {
    // Le jour ou un operateur change son code, le recu change avec lui, sans
    // redeploiement et sans reecriture de gabarit.
    const autre = { ...MTN, codeEntree: { ...MTN.codeEntree, modele: "*127#" } };
    const r = emettreRecu(commande(), preuve(), autre);
    expect("recu" in r && r.recu.marcheAsuivre.codeOperateur).toBe("*127#");
  });

  it("dit qu'un code n'est pas verifie plutot que de le taire", () => {
    const doute = { ...MTN, codeEntree: { ...MTN.codeEntree, verifie: false } };
    expect(marcheAsuivre(doute).codeVerifie).toBe(false);
  });

  it("sans operateur configure, renvoie a l'agence et n'invente rien", () => {
    const m = marcheAsuivre(null);
    expect(m.codeOperateur).toBe("");
    expect(m.etapes.join(" ")).toMatch(/agence/i);
    expect(m.etapes.join(" ")).not.toMatch(/[*#]\d/);
  });

  it("un operateur inconnu de la configuration n'invente pas de nom", () => {
    const r = emettreRecu(commande(), preuve({ operator: "orange" }), null);
    expect("recu" in r && r.recu.operateur.nom).toBe("orange");
  });
});

describe("ce que le recu dit de lui-meme", () => {
  it("n'ecrit JAMAIS « garanti » ni « certifie »", () => {
    // Ce n'est pas une preuve cryptographique, et l'interface doit le dire.
    const textes = [
      porteeDuRecu(recuDe()),
      porteeDuRecu(recuDe(commande({ proofState: "contresigne" }))),
      porteeDuRecu(recuDe(commande(), preuve({ patternAConfirmer: true }))),
      marcheAsuivre(MTN).etapes.join(" "),
      marcheAsuivre(null).etapes.join(" "),
    ];
    for (const t of textes) {
      expect(t, t).not.toMatch(/garanti|certifi|authentifi[ée] par Catalog|infalsifiable/i);
    }
  });

  it("dit d'ou vient l'autorite : l'operateur, pas Catalog", () => {
    expect(porteeDuRecu(recuDe())).toMatch(/l'opérateur peut confirmer/i);
    expect(porteeDuRecu(recuDe())).toMatch(/dont l'argent est en jeu/i);
  });

  it("distingue contresigne et non contresigne", () => {
    expect(porteeDuRecu(recuDe(commande({ proofState: "contresigne" })))).toMatch(
      /deux parties indépendantes/i,
    );
    expect(porteeDuRecu(recuDe())).toMatch(/pas encore confirmé/i);
  });

  it("porte la reserve d'un motif reconstitue", () => {
    const avec = porteeDuRecu(recuDe(commande(), preuve({ patternAConfirmer: true })));
    expect(avec).toMatch(/n'a pas encore été confronté à un message réel/i);
    expect(porteeDuRecu(recuDe())).not.toMatch(/message réel/i);
  });
});
