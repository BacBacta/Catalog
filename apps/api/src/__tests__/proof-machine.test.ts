import type { ProofState } from "@catalog/contracts";
import { describe, expect, it } from "vitest";
import {
  appliquerEvenement,
  canIssueReceipt,
  compteCommeAchatVerifie,
  type EvenementPreuve,
  estBloque,
  peutEncoreAvancer,
  rangPreuve,
} from "../domain/proof/machine.ts";

/**
 * La machine a etats de la preuve, transition par transition.
 *
 * La definition de terminé du lot 7 exige **un test par transition, y compris
 * chacune des transitions interdites**. Le tableau complet est parcouru plus bas :
 * cinq etats fois quatre evenements, plus les variantes du SMS analyse.
 *
 * Ce qui compte ici n'est pas qu'une preuve avance — c'est que les mauvaises
 * n'avancent pas, et que chaque refus soit JOURNALISE. Un refus sans trace est
 * une anomalie invisible.
 */

const NOW = new Date("2026-07-30T10:00:00+01:00");

const TOUS: ProofState[] = ["attendu", "declare_non_trace", "prouve", "contresigne", "conteste"];

const declaration: EvenementPreuve = { type: "declaration_manuelle", par: "vendeuse" };
const contresignature: EvenementPreuve = { type: "contresignature", par: "acheteuse" };
const contestation: EvenementPreuve = { type: "contestation", par: "acheteuse" };

const smsEntrant = (verdict: "accepte" | "accepte_sous_reserve" | "refuse" = "accepte") =>
  ({
    type: "sms_analyse",
    verdict,
    operator: "mtn",
    operatorTxId: "12345678901",
    sens: "entrant",
  }) satisfies EvenementPreuve;

const smsSortant = () =>
  ({
    type: "sms_analyse",
    verdict: "accepte",
    operator: "mtn",
    operatorTxId: "12345678901",
    sens: "sortant",
  }) satisfies EvenementPreuve;

/* ═════════════════════════ rang de solidite ═════════════════════════ */

describe("rangPreuve", () => {
  it("ordonne les quatre degres de preuve", () => {
    expect(rangPreuve("attendu")).toBe(0);
    expect(rangPreuve("declare_non_trace")).toBe(1);
    expect(rangPreuve("prouve")).toBe(2);
    expect(rangPreuve("contresigne")).toBe(3);
  });

  it("ne donne AUCUN rang a conteste — ce n'est pas un degre de preuve", () => {
    // Le litige n'est pas « plus » ou « moins » prouve : c'est un desaccord.
    expect(rangPreuve("conteste")).toBeNull();
  });
});

/* ═════════════════════════ transitions permises ═════════════════════════ */

describe("les transitions permises", () => {
  it("attendu → declare_non_trace, sur declaration de la vendeuse", () => {
    const r = appliquerEvenement("attendu", declaration, NOW);
    expect(r.ok).toBe(true);
    expect(r.etat).toBe("declare_non_trace");
    expect(r.journal).toMatchObject({
      kind: "preuve_avancee",
      de: "attendu",
      vers: "declare_non_trace",
      par: "vendeuse",
      at: NOW,
    });
  });

  it("attendu → prouve, sur SMS entrant accepte", () => {
    const r = appliquerEvenement("attendu", smsEntrant(), NOW);
    expect(r.ok).toBe(true);
    expect(r.etat).toBe("prouve");
    // L'identifiant d'operateur est journalise : c'est la cle du controle n° 5.
    expect(r.journal).toMatchObject({ operator: "mtn", operatorTxId: "12345678901" });
  });

  it("declare_non_trace → prouve : la declaration manuelle n'est pas un cul-de-sac", () => {
    // Une vendeuse qui declare a la main puis retrouve son SMS doit pouvoir
    // obtenir son recu. L'interdire l'y enfermerait pour toujours. Cette
    // transition ne figure pas dans la liste litterale du blueprint — voir
    // l'ADR 0018.
    const r = appliquerEvenement("declare_non_trace", smsEntrant(), NOW);
    expect(r.ok).toBe(true);
    expect(r.etat).toBe("prouve");
  });

  it("prouve → contresigne, sur contresignature de l'acheteuse", () => {
    const r = appliquerEvenement("prouve", contresignature, NOW);
    expect(r.ok).toBe(true);
    expect(r.etat).toBe("contresigne");
    expect(r.journal.par).toBe("acheteuse");
  });

  it("tout etat PORTANT UN PAIEMENT → conteste", () => {
    /* `attendu` a quitte cette liste le 11/08/2026 : on ne conteste pas un
       paiement qui n'existe pas, et le bouton a coute une commande au banc.
       Voir `contestation-sans-paiement.test.ts` et l'ADR 0064. Le reste ne
       bouge pas : des qu'un versement est attribue, il reste desavouable. */
    for (const etat of TOUS.filter((e) => e !== "conteste" && e !== "attendu")) {
      const r = appliquerEvenement(etat, contestation, NOW);
      expect(r.ok, etat).toBe(true);
      expect(r.etat, etat).toBe("conteste");
    }
  });

  it("meme contresigne reste contestable — sinon une collusion serait definitive", () => {
    // C'est l'etat le plus fort du systeme, et il doit rester attaquable : deux
    // voix qui s'accordent peuvent etre deux voix de la meme personne.
    const r = appliquerEvenement("contresigne", contestation, NOW);
    expect(r.ok).toBe(true);
    expect(r.etat).toBe("conteste");
  });

  it("le motif de contestation est journalise quand il est fourni", () => {
    const r = appliquerEvenement(
      "prouve",
      { type: "contestation", par: "acheteuse", motif: "je n'ai jamais commande" },
      NOW,
    );
    expect(r.journal.motif).toBe("je n'ai jamais commande");
  });
});

/* ═════════════════════════ un etat ne recule jamais ═════════════════════════ */

describe("un etat ne RECULE JAMAIS, et le recul est journalise puis ignore", () => {
  it("prouve + declaration manuelle : recul ignore, trace ecrite", () => {
    const r = appliquerEvenement("prouve", declaration, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.raison).toBe("recul_ignore");
    // L'etat rendu est l'etat INCHANGE : la transition est ignoree.
    expect(r.etat).toBe("prouve");
    // Et le journal existe, avec `vers` egal a l'etat courant : rien n'a bouge.
    expect(r.journal).toMatchObject({
      kind: "preuve_refusee",
      de: "prouve",
      vers: "prouve",
      raison: "recul_ignore",
      at: NOW,
    });
  });

  it("contresigne + SMS entrant accepte : recul ignore", () => {
    const r = appliquerEvenement("contresigne", smsEntrant(), NOW);
    expect(r).toMatchObject({ ok: false, raison: "recul_ignore", etat: "contresigne" });
  });

  it("contresigne + declaration manuelle : recul ignore", () => {
    const r = appliquerEvenement("contresigne", declaration, NOW);
    expect(r).toMatchObject({ ok: false, raison: "recul_ignore", etat: "contresigne" });
  });

  it("declare_non_trace + declaration manuelle : meme etat, pas une avancee", () => {
    const r = appliquerEvenement("declare_non_trace", declaration, NOW);
    expect(r).toMatchObject({ ok: false, raison: "recul_ignore" });
  });

  it("prouve + SMS entrant accepte : deja prouve, pas une avancee", () => {
    // Deux SMS pour la meme commande ne la font pas avancer deux fois. L'unicite
    // de l'identifiant est garantie ailleurs, par une contrainte de base.
    const r = appliquerEvenement("prouve", smsEntrant(), NOW);
    expect(r).toMatchObject({ ok: false, raison: "recul_ignore", etat: "prouve" });
  });

  it("conteste + contestation : deja conteste, ignore", () => {
    const r = appliquerEvenement("conteste", contestation, NOW);
    expect(r).toMatchObject({ ok: false, raison: "recul_ignore", etat: "conteste" });
  });

  it("AUCUN refus ne change l'etat, sur tout le tableau", () => {
    for (const etat of TOUS) {
      for (const e of [declaration, smsEntrant(), smsSortant(), contresignature, contestation]) {
        const r = appliquerEvenement(etat, e, NOW);
        if (!r.ok) {
          expect(r.etat, `${etat} + ${e.type}`).toBe(etat);
          expect(r.journal.vers, `${etat} + ${e.type}`).toBe(etat);
        }
      }
    }
  });

  it("TOUTE tentative laisse une entree de journal, refus compris", () => {
    for (const etat of TOUS) {
      for (const e of [declaration, smsEntrant(), smsSortant(), contresignature, contestation]) {
        const r = appliquerEvenement(etat, e, NOW);
        expect(r.journal, `${etat} + ${e.type}`).toBeTruthy();
        expect(r.journal.kind).toBe(r.ok ? "preuve_avancee" : "preuve_refusee");
        expect(r.journal.at).toEqual(NOW);
        expect(r.journal.de).toBe(etat);
      }
    }
  });
});

/* ═════════════════════════ ce qui ne prouve pas ═════════════════════════ */

describe("ce qu'un SMS ne suffit pas a prouver", () => {
  it("REFUSE un SMS de sens SORTANT, meme accepte", () => {
    // Le SMS d'emission de l'acheteuse corrobore ; il ne prouve pas. Seul le
    // message recu par la vendeuse fait autorite : c'est elle qui a l'argent.
    const r = appliquerEvenement("attendu", smsSortant(), NOW);
    expect(r).toMatchObject({ ok: false, raison: "preuve_insuffisante", etat: "attendu" });
  });

  it("REFUSE un verdict « accepte sous reserve »", () => {
    // Il vient d'un motif marque « a confirmer » — le SMS Orange de reception,
    // dont la capture disponible est tronquee.
    const r = appliquerEvenement("attendu", smsEntrant("accepte_sous_reserve"), NOW);
    expect(r).toMatchObject({ ok: false, raison: "preuve_insuffisante" });
  });

  it("REFUSE un verdict refuse", () => {
    const r = appliquerEvenement("attendu", smsEntrant("refuse"), NOW);
    expect(r).toMatchObject({ ok: false, raison: "sms_refuse" });
  });

  it("REFUSE sans identifiant d'operateur — jamais « paye et prouve » sans lui", () => {
    for (const operatorTxId of ["", "   "]) {
      const r = appliquerEvenement(
        "attendu",
        { type: "sms_analyse", verdict: "accepte", operator: "mtn", operatorTxId, sens: "entrant" },
        NOW,
      );
      expect(r, JSON.stringify(operatorTxId)).toMatchObject({
        ok: false,
        raison: "identifiant_operateur_absent",
      });
    }
  });

  it("l'ordre des controles compte : un SMS refuse SANS identifiant dit « refuse »", () => {
    // Le verdict des sept controles passe avant la forme de l'identifiant :
    // annoncer « identifiant absent » sur un SMS que les controles ont rejete
    // enverrait la vendeuse chercher le mauvais probleme.
    const r = appliquerEvenement(
      "attendu",
      {
        type: "sms_analyse",
        verdict: "refuse",
        operator: "mtn",
        operatorTxId: "",
        sens: "entrant",
      },
      NOW,
    );
    expect(r).toMatchObject({ ok: false, raison: "sms_refuse" });
  });
});

describe("la contresignature ne cree pas la preuve", () => {
  it("REFUSE depuis attendu", () => {
    const r = appliquerEvenement("attendu", contresignature, NOW);
    expect(r).toMatchObject({ ok: false, raison: "contresignature_sans_preuve", etat: "attendu" });
  });

  it("REFUSE depuis declare_non_trace", () => {
    // Une voix seule sur un depot que personne n'a constate : un « oui » sans objet.
    const r = appliquerEvenement("declare_non_trace", contresignature, NOW);
    expect(r).toMatchObject({ ok: false, raison: "contresignature_sans_preuve" });
  });

  it("REFUSE depuis contresigne", () => {
    const r = appliquerEvenement("contresigne", contresignature, NOW);
    expect(r).toMatchObject({ ok: false, raison: "contresignature_sans_preuve" });
  });
});

/* ═════════════════════════ le litige bloque ═════════════════════════ */

describe("un litige ouvert bloque toute avancee", () => {
  it("conteste + declaration manuelle, SMS ou contresignature : litige_ouvert", () => {
    for (const e of [declaration, smsEntrant(), smsSortant(), contresignature]) {
      const r = appliquerEvenement("conteste", e, NOW);
      expect(r, e.type).toMatchObject({ ok: false, raison: "litige_ouvert", etat: "conteste" });
    }
  });

  it("estBloque ne l'est que sur conteste", () => {
    for (const etat of TOUS) {
      expect(estBloque(etat), etat).toBe(etat === "conteste");
    }
  });
});

/* ═════════════════════════ le tableau complet ═════════════════════════ */

describe("le tableau complet des transitions", () => {
  /**
   * Vingt-cinq cases : cinq etats fois cinq evenements. Elles sont ecrites a la
   * main plutot que derivees du code — sinon le test decrirait l'implementation
   * au lieu de la contraindre.
   */
  const ATTENDU: Record<string, string> = {
    "attendu|declaration_manuelle": "declare_non_trace",
    "attendu|sms_entrant": "prouve",
    "attendu|sms_sortant": "preuve_insuffisante",
    "attendu|contresignature": "contresignature_sans_preuve",
    /* On ne conteste pas un paiement qui n'existe pas — 11/08/2026, ADR 0064.
       C'est la SEULE case du tableau qui a change depuis le lot 7. */
    "attendu|contestation": "contestation_sans_paiement",

    "declare_non_trace|declaration_manuelle": "recul_ignore",
    "declare_non_trace|sms_entrant": "prouve",
    "declare_non_trace|sms_sortant": "preuve_insuffisante",
    "declare_non_trace|contresignature": "contresignature_sans_preuve",
    "declare_non_trace|contestation": "conteste",

    "prouve|declaration_manuelle": "recul_ignore",
    "prouve|sms_entrant": "recul_ignore",
    "prouve|sms_sortant": "preuve_insuffisante",
    "prouve|contresignature": "contresigne",
    "prouve|contestation": "conteste",

    "contresigne|declaration_manuelle": "recul_ignore",
    "contresigne|sms_entrant": "recul_ignore",
    "contresigne|sms_sortant": "preuve_insuffisante",
    "contresigne|contresignature": "contresignature_sans_preuve",
    "contresigne|contestation": "conteste",

    "conteste|declaration_manuelle": "litige_ouvert",
    "conteste|sms_entrant": "litige_ouvert",
    "conteste|sms_sortant": "litige_ouvert",
    "conteste|contresignature": "litige_ouvert",
    "conteste|contestation": "recul_ignore",
  };

  const EVENEMENTS: Array<[string, EvenementPreuve]> = [
    ["declaration_manuelle", declaration],
    ["sms_entrant", smsEntrant()],
    ["sms_sortant", smsSortant()],
    ["contresignature", contresignature],
    ["contestation", contestation],
  ];

  it("couvre les vingt-cinq cases", () => {
    expect(Object.keys(ATTENDU)).toHaveLength(TOUS.length * EVENEMENTS.length);
  });

  for (const etat of TOUS) {
    for (const [nom, e] of EVENEMENTS) {
      const cle = `${etat}|${nom}`;
      it(`${cle} → ${ATTENDU[cle]}`, () => {
        const r = appliquerEvenement(etat, e, NOW);
        const attendu = ATTENDU[cle] as string;
        if (r.ok) expect(r.etat).toBe(attendu);
        else expect(r.raison).toBe(attendu);
      });
    }
  }
});

/* ═════════════════════════ predicats de sortie ═════════════════════════ */

describe("canIssueReceipt", () => {
  it("est FAUX pour declare_non_trace", () => {
    // C'est ce qui donne sa valeur au recu : un depot declare a la main n'est
    // pas une preuve. Le recu lui-meme est produit au lot 10.
    expect(canIssueReceipt("declare_non_trace")).toBe(false);
  });

  it("est VRAI pour prouve et contresigne", () => {
    expect(canIssueReceipt("prouve")).toBe(true);
    expect(canIssueReceipt("contresigne")).toBe(true);
  });

  it("est faux pour attendu et conteste", () => {
    expect(canIssueReceipt("attendu")).toBe(false);
    expect(canIssueReceipt("conteste")).toBe(false);
  });
});

describe("compteCommeAchatVerifie", () => {
  it("suit exactement la meme regle que le recu", () => {
    // Sans cela, une reputation se batirait sur des declarations, donc
    // s'acheterait.
    for (const etat of TOUS) {
      expect(compteCommeAchatVerifie(etat), etat).toBe(canIssueReceipt(etat));
    }
  });
});

describe("peutEncoreAvancer", () => {
  it("est faux sur contresigne et conteste, vrai ailleurs", () => {
    expect(peutEncoreAvancer("attendu")).toBe(true);
    expect(peutEncoreAvancer("declare_non_trace")).toBe(true);
    expect(peutEncoreAvancer("prouve")).toBe(true);
    expect(peutEncoreAvancer("contresigne")).toBe(false);
    expect(peutEncoreAvancer("conteste")).toBe(false);
  });
});

/* ═════════════════════════ le journal ne fuit rien ═════════════════════════ */

describe("le journal", () => {
  it("ne porte JAMAIS le texte du SMS", () => {
    // Le SMS contient le SOLDE du compte de la vendeuse. Seul l'identifiant de
    // transaction entre au journal.
    const r = appliquerEvenement("attendu", smsEntrant(), NOW);
    const serialise = JSON.stringify(r.journal);
    expect(serialise).not.toMatch(/solde|balance|FCFA/i);
    expect(Object.keys(r.journal)).not.toContain("texte");
    expect(Object.keys(r.journal)).not.toContain("sms");
  });

  it("nomme l'auteur de chaque tentative", () => {
    expect(appliquerEvenement("attendu", declaration, NOW).journal.par).toBe("vendeuse");
    expect(appliquerEvenement("prouve", contresignature, NOW).journal.par).toBe("acheteuse");
    expect(
      appliquerEvenement("prouve", { type: "contestation", par: "support" }, NOW).journal.par,
    ).toBe("support");
    // Un SMS est toujours apporte par la vendeuse : c'est elle qui le colle.
    expect(appliquerEvenement("attendu", smsEntrant(), NOW).journal.par).toBe("vendeuse");
  });
});
