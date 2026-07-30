import type { CheckResult } from "@catalog/contracts";
import { describe, expect, it } from "vitest";
import {
  appliquerControles,
  type CommandePourControles,
  controle6AutoCoherence,
  finaliserAvecUnicite,
  verdictDe,
} from "../domain/proof/controles.ts";
import { analyserSms } from "../domain/proof/motifs.ts";
import {
  MTN_PAIEMENT_SORTANT,
  MTN_RECEPTION,
  MTN_TRANSFERT_SORTANT,
  ORANGE_RECEPTION_ID_IMPOSSIBLE,
  ORANGE_RECEPTION_RECONSTITUE,
  ORANGE_RECHARGEMENT,
} from "./fixtures-sms.ts";

/**
 * Les sept controles, selon `docs/formats-sms-operateurs.md` §5.
 *
 * Trois points dont depend la justesse du produit, et que ces tests fixent :
 *
 * 1. **le controle 3 depend du SENS du message.** Le SMS d'emission nomme le
 *    destinataire, celui de reception nomme l'expediteur. Les comparer au meme
 *    numero de reference rejetterait TOUS les paiements legitimes ;
 * 2. **un numero qui ne correspond pas est un AVERTISSEMENT**, jamais un refus ;
 * 3. **le controle 5 revient toujours `pending` dans le domaine** : c'est la
 *    contrainte UNIQUE qui tranche, a l'INSERT.
 */

const analyse = (texte: string) => {
  const r = analyserSms(texte);
  if (!r.reconnu) throw new Error(`non reconnu : ${r.raison}`);
  return r;
};

/** La commande MTN de reference : 26 800 F, creee juste avant le SMS. */
const commande = (p: Partial<CommandePourControles> = {}): CommandePourControles => ({
  totalXaf: 26800,
  attenduXaf: 26800,
  creeA: new Date("2026-06-23T09:00:00+01:00"),
  reversementVendeuse: "+237699000111",
  telephoneAcheteuse: "+237652000001",
  contresigneeParAcheteuse: false,
  ...p,
});

const NOW = new Date("2026-06-23T10:00:00+01:00");

const par = (checks: readonly CheckResult[], n: number): CheckResult | undefined =>
  checks.find((c) => c.n === n);

/* ═════════════════════════ 1. format ═════════════════════════ */

describe("controle 1 — format operateur", () => {
  it("PASSE sur un motif confirme", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({ pattern, sms, commande: commande(), now: NOW });
    expect(par(checks, 1)).toMatchObject({ state: "pass" });
  });

  it("AVERTIT sur un motif reconstitue, et l'explication le dit", () => {
    const { pattern, sms } = analyse(ORANGE_RECEPTION_RECONSTITUE);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 17000, telephoneAcheteuse: "+237677000001" }),
      now: NOW,
    });
    const un = par(checks, 1);
    expect(un?.state).toBe("warn");
    expect(un?.explanation).toMatch(/sous réserve/);
  });
});

/* ═════════════════════════ 2. montant ═════════════════════════ */

describe("controle 2 — montant", () => {
  it("PASSE quand le montant correspond a ce qui est attendu", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({ pattern, sms, commande: commande(), now: NOW });
    expect(par(checks, 2)).toMatchObject({ state: "pass" });
  });

  it("ECHOUE sur un sous-paiement, et dit combien il manque", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 30000 }),
      now: NOW,
    });
    const deux = par(checks, 2);
    expect(deux?.state).toBe("fail");
    expect(deux?.explanation).toContain("3200");
  });

  it("ECHOUE aussi sur un sur-paiement", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 20000 }),
      now: NOW,
    });
    expect(par(checks, 2)?.state).toBe("fail");
  });

  it("compare a `attenduXaf`, pas au total — un acompte est conforme", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ totalXaf: 53600, attenduXaf: 26800 }),
      now: NOW,
    });
    expect(par(checks, 2)?.state).toBe("pass");
  });
});

/* ═════════════════════════ 3. contrepartie ═════════════════════════ */

describe("controle 3 — contrepartie, selon le SENS du message", () => {
  it("ENTRANT : compare a l'acheteuse, et passe quand elle correspond", () => {
    // Le SMS de reception nomme l'EXPEDITEUR. Le comparer au reversement de la
    // vendeuse rejetterait tous les paiements legitimes.
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({ pattern, sms, commande: commande(), now: NOW });
    expect(par(checks, 3)).toMatchObject({ state: "pass" });
  });

  it("ENTRANT : un autre numero est un AVERTISSEMENT, jamais un refus", () => {
    // Double SIM et paiement par un proche sont la norme au Cameroun. C'est la
    // contre-signature qui tranche.
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ telephoneAcheteuse: "+237699999999" }),
      now: NOW,
    });
    const trois = par(checks, 3);
    expect(trois?.state).toBe("warn");
    expect(trois?.explanation).toMatch(/deuxième puce|proche/i);
  });

  it("SORTANT : compare au REVERSEMENT de la vendeuse, et passe quand il correspond", () => {
    const { pattern, sms } = analyse(MTN_TRANSFERT_SORTANT);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 17000, reversementVendeuse: "+237688000001" }),
      now: NOW,
    });
    expect(par(checks, 3)).toMatchObject({ state: "pass" });
  });

  it("SORTANT : un autre destinataire ECHOUE — l'argent est parti ailleurs", () => {
    // C'est le seul echec possible du controle 3, et ce n'est pas une question
    // de puce : l'argent n'est pas arrive chez la vendeuse.
    const { pattern, sms } = analyse(MTN_TRANSFERT_SORTANT);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 17000, reversementVendeuse: "+237699000111" }),
      now: NOW,
    });
    expect(par(checks, 3)?.state).toBe("fail");
  });

  it("le meme numero compare aux DEUX references donne des verdicts opposes", () => {
    // C'est l'erreur que la specification signale comme la plus facile a
    // commettre. Ce test la rend impossible a reintroduire sans le voir.
    const { pattern, sms } = analyse(MTN_TRANSFERT_SORTANT);
    const bon = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 17000, reversementVendeuse: "688000001" }),
      now: NOW,
    });
    const inverse = appliquerControles({
      pattern,
      sms,
      // Le numero est ici celui de l'acheteuse : pour un message SORTANT, ce
      // n'est pas la reference.
      commande: commande({
        attenduXaf: 17000,
        reversementVendeuse: "+237699000111",
        telephoneAcheteuse: "688000001",
      }),
      now: NOW,
    });
    expect(par(bon.checks, 3)?.state).toBe("pass");
    expect(par(inverse.checks, 3)?.state).toBe("fail");
  });

  it("numero NON EXPLOITABLE : avertissement", () => {
    // « Transfer To non MoMo Account » est une chaine libre, pas un numero.
    const { pattern, sms } = analyse(MTN_PAIEMENT_SORTANT);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 17000 }),
      now: NOW,
    });
    expect(par(checks, 3)).toMatchObject({ state: "warn" });
  });

  it("RECHARGEMENT : aucune contrepartie, et le dit", () => {
    const { pattern, sms } = analyse(ORANGE_RECHARGEMENT);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 650, creeA: new Date("2024-12-04T15:00:00+01:00") }),
      now: NOW,
    });
    const trois = par(checks, 3);
    expect(trois?.state).toBe("warn");
    expect(trois?.explanation).toMatch(/rechargement/i);
  });

  it("aucune reference enregistree : avertissement, pas un refus", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ telephoneAcheteuse: null }),
      now: NOW,
    });
    expect(par(checks, 3)?.state).toBe("warn");
  });
});

/* ═════════════════════════ 4. horodatage ═════════════════════════ */

describe("controle 4 — horodatage", () => {
  it("PASSE quand le paiement suit la commande, sous 48 h", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({ pattern, sms, commande: commande(), now: NOW });
    expect(par(checks, 4)).toMatchObject({ state: "pass" });
  });

  it("ECHOUE si le paiement est ANTERIEUR a la commande", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ creeA: new Date("2026-06-23T12:00:00+01:00") }),
      now: NOW,
    });
    const quatre = par(checks, 4);
    expect(quatre?.state).toBe("fail");
    expect(quatre?.explanation).toMatch(/AVANT la commande/);
  });

  it("ECHOUE au-dela de 48 h — le SMS recycle d'une autre vente", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ creeA: new Date("2026-06-20T09:00:00+01:00") }),
      now: NOW,
    });
    expect(par(checks, 4)?.state).toBe("fail");
  });

  it("ECHOUE quand l'identifiant Orange annonce une DATE IMPOSSIBLE", () => {
    // Chez Orange, `at` vient du decodage de l'identifiant, pas du texte.
    const { pattern, sms } = analyse(ORANGE_RECEPTION_ID_IMPOSSIBLE);
    expect(sms.at).toBeNull();
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 17000 }),
      now: NOW,
    });
    const quatre = par(checks, 4);
    expect(quatre?.state).toBe("fail");
    expect(quatre?.explanation).toMatch(/aucun horodatage exploitable/i);
  });

  it("ne formate JAMAIS une date nulle", () => {
    // « Ne jamais appeler toLocaleString sans avoir verifie at instanceof Date. »
    const { pattern, sms } = analyse(ORANGE_RECEPTION_ID_IMPOSSIBLE);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 17000 }),
      now: NOW,
    });
    expect(par(checks, 4)?.explanation).not.toMatch(/Invalid Date|null|NaN/);
  });
});

/* ═════════════════════════ 5. unicite ═════════════════════════ */

describe("controle 5 — unicite reseau", () => {
  it("revient TOUJOURS `pending` dans le domaine", () => {
    // Le domaine ne touche pas la base : il ne peut pas savoir si un identifiant
    // est libre. Un SELECT suivi d'un `if` perdrait la course entre deux
    // vendeuses collant le meme identifiant a la meme seconde.
    for (const texte of [MTN_RECEPTION, MTN_TRANSFERT_SORTANT, ORANGE_RECHARGEMENT]) {
      const { pattern, sms } = analyse(texte);
      const { checks } = appliquerControles({
        pattern,
        sms,
        commande: commande({ attenduXaf: sms.amountXaf }),
        now: NOW,
      });
      expect(par(checks, 5), texte.slice(0, 20)).toMatchObject({ state: "pending" });
    }
  });

  it("`finaliserAvecUnicite` remplace le pending par le verdict de la base", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const brut = appliquerControles({ pattern, sms, commande: commande(), now: NOW });

    const libre = finaliserAvecUnicite(brut, true);
    expect(par(libre.checks, 5)).toMatchObject({ state: "pass" });
    expect(libre.verdict).toBe("accepte");

    const deja = finaliserAvecUnicite(brut, false);
    expect(par(deja.checks, 5)).toMatchObject({ state: "fail" });
    expect(deja.verdict).toBe("refuse");
    expect(par(deja.checks, 5)?.explanation).toMatch(/déjà servi/i);
  });

  it("finaliser ne touche QUE le controle 5", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const brut = appliquerControles({ pattern, sms, commande: commande(), now: NOW });
    const apres = finaliserAvecUnicite(brut, true);
    for (const c of brut.checks) {
      if (c.n === 5) continue;
      expect(apres.checks.find((x) => x.n === c.n)).toEqual(c);
    }
  });
});

/* ═════════════════════════ 6. auto-coherence ═════════════════════════ */

describe("controle 6 — auto-coherence Orange", () => {
  it("est ABSENT chez MTN — il ne figure pas dans la liste", () => {
    // Un controle qui n'existe pas ne doit pas ressembler a un controle reussi.
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({ pattern, sms, commande: commande(), now: NOW });
    expect(par(checks, 6)).toBeUndefined();
    expect(controle6AutoCoherence(sms)).toBeNull();
  });

  it("PASSE sur un identifiant Orange coherent", () => {
    const { pattern, sms } = analyse(ORANGE_RECHARGEMENT);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 650, creeA: new Date("2024-12-04T15:00:00+01:00") }),
      now: NOW,
    });
    expect(par(checks, 6)).toMatchObject({ state: "pass" });
  });

  it("ECHOUE sur le mois 99", () => {
    const { pattern, sms } = analyse(ORANGE_RECEPTION_ID_IMPOSSIBLE);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 17000 }),
      now: NOW,
    });
    expect(par(checks, 6)).toMatchObject({ state: "fail" });
  });
});

/* ═════════════════════════ 7. contre-signature ═════════════════════════ */

describe("controle 7 — contre-signature", () => {
  it("est `pending` tant que l'acheteuse n'a pas tape", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({ pattern, sms, commande: commande(), now: NOW });
    expect(par(checks, 7)).toMatchObject({ state: "pending" });
  });

  it("PASSE quand elle a confirme", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ contresigneeParAcheteuse: true }),
      now: NOW,
    });
    expect(par(checks, 7)).toMatchObject({ state: "pass" });
  });

  it("son absence n'empeche RIEN — pending ne refuse pas", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const brut = appliquerControles({ pattern, sms, commande: commande(), now: NOW });
    expect(finaliserAvecUnicite(brut, true).verdict).toBe("accepte");
  });
});

/* ═════════════════════════ le verdict ═════════════════════════ */

describe("le verdict", () => {
  it("un seul `fail` REFUSE", () => {
    expect(
      verdictDe([
        { n: 1, id: "a", state: "pass", explanation: "x" },
        { n: 2, id: "b", state: "fail", explanation: "x" },
        { n: 3, id: "c", state: "warn", explanation: "x" },
      ]),
    ).toBe("refuse");
  });

  it("un `warn` fait passer en ACCEPTE SOUS RESERVE", () => {
    expect(
      verdictDe([
        { n: 1, id: "a", state: "pass", explanation: "x" },
        { n: 3, id: "c", state: "warn", explanation: "x" },
      ]),
    ).toBe("accepte_sous_reserve");
  });

  it("`pending` seul n'empeche pas d'accepter", () => {
    expect(
      verdictDe([
        { n: 1, id: "a", state: "pass", explanation: "x" },
        { n: 7, id: "g", state: "pending", explanation: "x" },
      ]),
    ).toBe("accepte");
  });

  it("un motif `aConfirmer` ne peut JAMAIS produire « accepte »", () => {
    // C'est le critere central : le drapeau n'est pas un commentaire. Meme avec
    // tous les autres controles au vert, le verdict plafonne.
    const { pattern, sms } = analyse(ORANGE_RECEPTION_RECONSTITUE);
    const brut = appliquerControles({
      pattern,
      sms,
      commande: commande({
        attenduXaf: 17000,
        telephoneAcheteuse: "+237677000001",
        creeA: new Date("2026-06-23T13:00:00+01:00"),
        contresigneeParAcheteuse: true,
      }),
      now: NOW,
    });
    // Tout le reste passe...
    expect(brut.checks.filter((c) => c.state === "fail")).toEqual([]);
    // ...et pourtant le verdict plafonne, avant ET apres la base.
    expect(brut.verdict).toBe("accepte_sous_reserve");
    expect(finaliserAvecUnicite(brut, true).verdict).toBe("accepte_sous_reserve");
  });

  it("un SMS parfait chez MTN produit « accepte » une fois la base consultee", () => {
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const brut = appliquerControles({ pattern, sms, commande: commande(), now: NOW });
    expect(brut.verdict).toBe("accepte");
    expect(finaliserAvecUnicite(brut, true).verdict).toBe("accepte");
  });
});

/* ═════════════════════════ les explications ═════════════════════════ */

describe("les explications destinees a la vendeuse", () => {
  it("chaque controle en porte une, non vide", () => {
    // La vendeuse doit comprendre POURQUOI un paiement est refuse, sinon elle
    // expedie quand meme.
    const { pattern, sms } = analyse(MTN_RECEPTION);
    const { checks } = appliquerControles({ pattern, sms, commande: commande(), now: NOW });
    for (const c of checks) {
      expect(c.explanation.length, `controle ${c.n}`).toBeGreaterThan(20);
      expect(c.id.length, `controle ${c.n}`).toBeGreaterThan(0);
    }
  });

  it("aucune explication ne porte de jargon technique", () => {
    const { pattern, sms } = analyse(ORANGE_RECEPTION_ID_IMPOSSIBLE);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 17000 }),
      now: NOW,
    });
    for (const c of checks) {
      expect(c.explanation).not.toMatch(/regex|null|undefined|parse|NaN|UNIQUE|SELECT/i);
    }
  });

  it("aucune explication ne porte le SOLDE du compte", () => {
    // Le SMS contient le solde de la vendeuse : il ne doit apparaitre ni dans un
    // log, ni dans une trace, ni dans un message.
    const { pattern, sms } = analyse(MTN_PAIEMENT_SORTANT);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 17000 }),
      now: NOW,
    });
    for (const c of checks) {
      expect(c.explanation).not.toContain("12020");
    }
  });

  it("la numerotation est canonique : 1 a 7, sans trou ni doublon", () => {
    const { pattern, sms } = analyse(ORANGE_RECHARGEMENT);
    const { checks } = appliquerControles({
      pattern,
      sms,
      commande: commande({ attenduXaf: 650, creeA: new Date("2024-12-04T15:00:00+01:00") }),
      now: NOW,
    });
    const numeros = checks.map((c) => c.n);
    expect(numeros).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(numeros).size).toBe(numeros.length);
  });
});
