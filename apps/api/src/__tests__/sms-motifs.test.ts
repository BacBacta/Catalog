import { describe, expect, it } from "vitest";
import { analyserSms, PATTERNS, type SmsPattern } from "../domain/proof/motifs.ts";
import { decodeOrangeId, local9, normalizeSms, xafInt } from "../domain/proof/outils.ts";
import {
  MTN_PAIEMENT_SORTANT,
  MTN_RECEPTION,
  MTN_RECEPTION_SALE,
  MTN_TRANSFERT_SORTANT,
  ORANGE_RECEPTION_ID_IMPOSSIBLE,
  ORANGE_RECEPTION_ID_MINUSCULES,
  ORANGE_RECEPTION_MONTANT_VIRGULE,
  ORANGE_RECEPTION_RECONSTITUE,
  ORANGE_RECHARGEMENT,
  ORANGE_TRONQUE,
  TEXTE_LIBRE,
} from "./fixtures-sms.ts";

/**
 * Les analyseurs de SMS, contre les fixtures obligatoires de la specification.
 *
 * `docs/formats-sms-operateurs.md` §6 fixe la liste et les attentes. Ce sont ces
 * tests qui empechent une regression silencieuse le jour ou quelqu'un
 * « nettoiera » une expression reguliere.
 */

/* ═════════════════════════ le fuseau ═════════════════════════ */

describe("le fuseau horaire", () => {
  it("est Africa/Douala", () => {
    // Les dates lues dans les SMS sont en heure locale du Cameroun. Sans ce
    // reglage, la fenetre de 48 h du controle n° 4 derive d'une heure : le test
    // passe en local et echoue en CI.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Africa/Douala");
  });
});

/* ═════════════════════════ les outils ═════════════════════════ */

describe("local9", () => {
  it("retire l'indicatif 237 des douze chiffres", () => {
    // Le piege numero un de la specification : reception en douze chiffres,
    // emission en neuf. Comparer sans normaliser rejette un paiement legitime.
    expect(local9("237652000001")).toBe("652000001");
    expect(local9("688000001")).toBe("688000001");
    expect(local9("+237 652 00 00 01")).toBe("652000001");
  });

  it("rend une chaine vide sur une entree vide ou nulle", () => {
    expect(local9(null)).toBe("");
    expect(local9(undefined)).toBe("");
    expect(local9("")).toBe("");
  });
});

describe("xafInt", () => {
  it("ramene un solde Orange decimal a l'entier", () => {
    // Le franc CFA n'a pas de subdivision, mais Orange affiche 108762.45.
    expect(xafInt("108762.45")).toBe(108762);
  });

  it("traite espaces et virgules comme des separateurs de milliers", () => {
    expect(xafInt("1 500")).toBe(1500);
    expect(xafInt("1,500")).toBe(1500);
    expect(xafInt("1 500")).toBe(1500);
    expect(xafInt("1 500")).toBe(1500);
  });

  it("LEVE sur un montant illisible plutot que de rendre NaN", () => {
    // Un NaN passerait la validation en `number` et deviendrait zero en base :
    // un paiement de zero franc marque comme prouve.
    expect(() => xafInt("abc")).toThrow(/illisible/);
  });

  it('LEVE sur un montant SANS CHIFFRE — `Number("")` vaut zero, pas NaN', () => {
    // Le trou reel : sans ce controle, `You have received  ,  FCFA of …` est
    // reconnu et produit un paiement de ZERO franc, identifiant valide et
    // contrepartie correcte. Un faux paiement parfaitement forme. Voir ADR 0019.
    for (const vide of ["", "   ", ",", " , ", "\u202f"]) {
      expect(() => xafInt(vide), JSON.stringify(vide)).toThrow(/illisible/);
    }
  });

  it("le message d'erreur ne porte PAS le montant", () => {
    // Il remonterait dans une trace, et un fragment de SMS y entrainerait le
    // solde du compte de la vendeuse.
    try {
      xafInt("108762.45zz");
      throw new Error("aurait du lever");
    } catch (e) {
      expect((e as Error).message).not.toContain("108762");
    }
  });

  it("rend TOUJOURS un entier", () => {
    for (const s of ["0", "1", "650", "108762.45", "108762.55", "1,500", "17000"]) {
      expect(Number.isInteger(xafInt(s)), s).toBe(true);
    }
  });
});

describe("normalizeSms", () => {
  it("absorbe espaces insecables, retours a la ligne et doublons", () => {
    expect(normalizeSms("  a  b\n\n  c  ")).toBe("a b c");
  });
});

describe("decodeOrangeId", () => {
  it("decode un identifiant valide et en tire la DATE", () => {
    const d = decodeOrangeId("RC241204.1533.B00001");
    expect(d).toMatchObject({ prefix: "RC", kind: "rechargement", seq: "B00001", valid: true });
    // 4 decembre 2024 a 15 h 33, en heure locale du Cameroun.
    expect(d?.at?.getFullYear()).toBe(2024);
    expect(d?.at?.getMonth()).toBe(11);
    expect(d?.at?.getDate()).toBe(4);
    expect(d?.at?.getHours()).toBe(15);
    expect(d?.at?.getMinutes()).toBe(33);
  });

  it("NORMALISE la casse avant de decoder", () => {
    // Les motifs Orange portent le drapeau `i` : un identifiant peut arriver en
    // minuscules. Sans normalisation, le controle n° 6 disparaitrait
    // silencieusement au lieu de s'appliquer.
    expect(decodeOrangeId("mp260623.1403.c73941")).toMatchObject({ prefix: "MP", valid: true });
  });

  it("marque INVALIDE un mois qui n'existe pas", () => {
    const d = decodeOrangeId("MP269932.1403.C73941");
    expect(d?.valid).toBe(false);
    expect(d?.at).toBeNull();
  });

  it("marque invalide une heure impossible", () => {
    expect(decodeOrangeId("MP260623.9999.C73941")?.valid).toBe(false);
    expect(decodeOrangeId("MP260623.2560.C73941")?.valid).toBe(false);
  });

  it("rend NULL sur un identifiant MTN — c'est ainsi que le controle 6 disparait", () => {
    // Les onze chiffres de MTN sont opaques : ils ne peuvent pas se contredire.
    expect(decodeOrangeId("17600000001")).toBeNull();
    expect(decodeOrangeId("")).toBeNull();
    expect(decodeOrangeId("pas un identifiant")).toBeNull();
  });

  it("accepte un prefixe inconnu sans invalider", () => {
    // Un prefixe inconnu n'invalide rien : on affiche le prefixe brut.
    const d = decodeOrangeId("ZZ260623.1403.C73941");
    expect(d?.valid).toBe(true);
    expect(d?.kind).toBeNull();
    expect(d?.prefix).toBe("ZZ");
  });
});

/* ═════════════════════════ les fixtures obligatoires ═════════════════════════ */

const reconnu = (texte: string) => {
  const r = analyserSms(texte);
  if (!r.reconnu) throw new Error(`non reconnu : ${r.raison}`);
  return r;
};

describe("fixtures obligatoires — ce qui doit etre reconnu", () => {
  it("MTN paiement sortant → mtn.sortant.paiement", () => {
    const { pattern, sms } = reconnu(MTN_PAIEMENT_SORTANT);
    expect(pattern.id).toBe("mtn.sortant.paiement");
    expect(sms.amountXaf).toBe(17000);
    expect(sms.txId).toBe("17600000001");
    expect(sms.feeXaf).toBe(378);
    // La contrepartie est une chaine libre NON EXPLOITABLE, pas un numero.
    expect(sms.counterparty).toBeNull();
    expect(sms.counterpartyName).toBe("Transfer To non MoMo Account");
    // Les frais mesures : 378 F sur 17 000, soit 2,22 % hors reseau.
    expect(((sms.feeXaf as number) / sms.amountXaf) * 100).toBeCloseTo(2.22, 2);
  });

  it("MTN transfert sortant → mtn.sortant.transfert, espace avant le point gere", () => {
    const { pattern, sms } = reconnu(MTN_TRANSFERT_SORTANT);
    expect(pattern.id).toBe("mtn.sortant.transfert");
    expect(sms.amountXaf).toBe(17000);
    // Neuf chiffres, sans indicatif.
    expect(sms.counterparty).toBe("688000001");
    expect(sms.txId).toBe("17600000001");
    // `via Orange Cameroun` : le transfert MTN → Orange fonctionne.
    expect(sms.reseauCible).toBe("Orange Cameroun");
  });

  it("MTN reception → mtn.entrant, douze chiffres normalises, raison sociale extraite", () => {
    const { pattern, sms } = reconnu(MTN_RECEPTION);
    expect(pattern.id).toBe("mtn.entrant");
    expect(pattern.sens).toBe("entrant");
    expect(sms.amountXaf).toBe(26800);
    // Le piege : 237652000001 devient 652000001.
    expect(sms.counterparty).toBe("652000001");
    // L'expediteur peut etre une raison sociale avec des espaces.
    expect(sms.counterpartyName).toBe("ALPHA TRADING SARL");
    expect(sms.txId).toBe("17600000002");
    expect(sms.at?.getFullYear()).toBe(2026);
    expect(sms.at?.getHours()).toBe(9);
  });

  it("Orange rechargement → om.rechargement, montant entier, date lue dans l'ID", () => {
    const { pattern, sms } = reconnu(ORANGE_RECHARGEMENT);
    expect(pattern.id).toBe("om.rechargement");
    expect(sms.amountXaf).toBe(650);
    expect(sms.txId).toBe("RC241204.1533.B00001");
    expect(sms.feeXaf).toBe(0);
    // `commissionXaf` est le champ OPERATEUR, pas une commission Catalog.
    expect(sms.commissionXaf).toBe(0);
    // Le solde decimal est signale en BRUT, jamais converti ni persiste.
    expect(sms.soldeBrut).toBe("108762.45");
    // La date vient de l'identifiant, pas du texte : decembre 2024.
    expect(sms.at?.getFullYear()).toBe(2024);
    expect(sms.at?.getMonth()).toBe(11);
  });

  it("Orange reception reconstitue → om.entrant, avec aConfirmer", () => {
    const { pattern, sms } = reconnu(ORANGE_RECEPTION_RECONSTITUE);
    expect(pattern.id).toBe("om.entrant");
    expect(pattern.aConfirmer).toBe(true);
    expect(sms.amountXaf).toBe(17000);
    expect(sms.counterparty).toBe("677000001");
    expect(sms.txId).toBe("MP260623.1403.C73941");
  });

  it("Orange identifiant impossible → reconnu, mais `at` est null", () => {
    const { pattern, sms } = reconnu(ORANGE_RECEPTION_ID_IMPOSSIBLE);
    expect(pattern.id).toBe("om.entrant");
    // Le message est bien reconnu — c'est le controle 6 qui le rejettera, pas
    // l'analyseur. Distinguer les deux est ce qui permet d'expliquer pourquoi.
    expect(sms.at).toBeNull();
    expect(decodeOrangeId(sms.txId)?.valid).toBe(false);
  });

  it("identifiant en MINUSCULES → normalise en majuscules, controle 6 applicable", () => {
    const { sms } = reconnu(ORANGE_RECEPTION_ID_MINUSCULES);
    // Sans cette normalisation, `mp260623…` et `MP260623…` coexisteraient dans
    // la colonne UNIQUE et le controle n° 5 se contournerait d'une majuscule.
    expect(sms.txId).toBe("MP260623.1403.C73941");
    expect(decodeOrangeId(sms.txId)?.valid).toBe(true);
  });

  it("montant `1,500` avec virgule de milliers → 1500, jamais NaN", () => {
    const { sms } = reconnu(ORANGE_RECEPTION_MONTANT_VIRGULE);
    expect(sms.amountXaf).toBe(1500);
    expect(Number.isInteger(sms.amountXaf)).toBe(true);
  });

  it("SMS avec espaces insecables et retours a la ligne → inchange", () => {
    const sale = reconnu(MTN_RECEPTION_SALE);
    const propre = reconnu(MTN_RECEPTION);
    expect(sale.pattern.id).toBe(propre.pattern.id);
    expect(sale.sms).toEqual(propre.sms);
  });
});

describe("fixtures obligatoires — ce qui NE DOIT PAS etre reconnu", () => {
  it("la capture TRONQUEE ne passe pas", () => {
    // « You have received 650 FCFA of » seul : la troncature ne doit pas passer.
    // Sans identifiant, il n'y a rien de controlable.
    const r = analyserSms(ORANGE_TRONQUE);
    expect(r.reconnu).toBe(false);
    if (r.reconnu) return;
    expect(r.raison).toBe("aucun_motif");
  });

  it("le texte libre tape a la main ne passe pas", () => {
    expect(analyserSms(TEXTE_LIBRE).reconnu).toBe(false);
  });

  it("une chaine vide ne passe pas", () => {
    expect(analyserSms("").reconnu).toBe(false);
    expect(analyserSms("   \n  ").reconnu).toBe(false);
  });

  it("un SMS AMPUTE de son identifiant ne passe pas", () => {
    const sans = MTN_RECEPTION.replace(/Transaction ID:\s*\d+/, "Transaction ID:");
    expect(analyserSms(sans).reconnu).toBe(false);
  });

  it("un montant fait de SEPARATEURS ne produit pas un paiement de zero franc", () => {
    // Le trou trouve en ecrivant ces tests : identifiant valide, contrepartie
    // correcte, montant zero. Un faux paiement parfaitement forme.
    const zero =
      "You have received  ,  FCFA of 237677000001, ID transaction: MP260623.1403.C73941, Frais: 0 FCFA";
    const r = analyserSms(zero);
    expect(r.reconnu).toBe(false);
    if (r.reconnu) return;
    expect(r.raison).toBe("montant_illisible");
  });

  it("un montant illisible produit un refus explicable, PAS une exception", () => {
    // Et surtout : le message d'erreur ne doit pas porter le texte du SMS, qui
    // contient le solde du compte de la vendeuse.
    const casse = ORANGE_RECHARGEMENT.replace("650 FCFA", "..... FCFA");
    const r = analyserSms(casse);
    expect(r.reconnu).toBe(false);
    expect(JSON.stringify(r)).not.toContain("108762");
  });
});

/* ═════════════════════════ l'ordre des motifs ═════════════════════════ */

describe("l'ordre des motifs est VERROUILLE", () => {
  /**
   * Les cinq motifs sont aujourd'hui mutuellement exclusifs, donc l'ordre n'a
   * aucun effet observable. Ce test existe pour le jour ou un sixieme motif
   * s'ajoutera — le SMS Orange d'envoi, par exemple : rien ne garantit qu'il
   * restera disjoint des autres. Il verrouille l'appariement attendu de chaque
   * fixture, de sorte qu'un motif trop large fasse ECHOUER LA CI au lieu
   * d'intercepter silencieusement les messages d'un motif existant.
   */
  it("l'ordre declare est exactement celui de la specification", () => {
    expect(PATTERNS.map((p: SmsPattern) => p.id)).toEqual([
      "mtn.entrant",
      "mtn.sortant.transfert",
      "mtn.sortant.paiement",
      "om.rechargement",
      "om.entrant",
    ]);
  });

  it("la reception MTN passe AVANT le transfert", () => {
    const i = PATTERNS.findIndex((p) => p.id === "mtn.entrant");
    const j = PATTERNS.findIndex((p) => p.id === "mtn.sortant.transfert");
    expect(i).toBeLessThan(j);
  });

  it("chaque fixture s'apparie a UN SEUL motif", () => {
    const cas: Array<[string, string]> = [
      [MTN_PAIEMENT_SORTANT, "mtn.sortant.paiement"],
      [MTN_TRANSFERT_SORTANT, "mtn.sortant.transfert"],
      [MTN_RECEPTION, "mtn.entrant"],
      [ORANGE_RECHARGEMENT, "om.rechargement"],
      [ORANGE_RECEPTION_RECONSTITUE, "om.entrant"],
    ];
    for (const [texte, attendu] of cas) {
      const t = normalizeSms(texte);
      const apparies = PATTERNS.filter((p) => p.re.test(t)).map((p) => p.id);
      expect(apparies, attendu).toEqual([attendu]);
    }
  });

  it("aucun motif n'est global — un `g` rendrait `test` dependant de l'appel precedent", () => {
    // `RegExp.prototype.test` avec le drapeau `g` avance `lastIndex` : deux
    // appels de suite sur le meme motif donnent des resultats differents.
    for (const p of PATTERNS) {
      expect(p.re.global, p.id).toBe(false);
    }
  });

  it("chaque motif declare une cle d'operateur PERSISTABLE, distincte du libelle", () => {
    for (const p of PATTERNS) {
      expect(["mtn", "orange"], p.id).toContain(p.operatorKey);
      // `operateur` est un libelle d'affichage : il ne va jamais en base.
      expect(p.operateur, p.id).not.toBe(p.operatorKey);
    }
  });

  it("SEUL `om.entrant` porte aConfirmer", () => {
    const reconstitues = PATTERNS.filter((p) => p.aConfirmer).map((p) => p.id);
    expect(reconstitues).toEqual(["om.entrant"]);
  });
});

/* ═════════════════════════ propriete : aucun flottant ═════════════════════════ */

describe("aucun flottant ne sort d'un analyseur", () => {
  it("tout montant satisfait Number.isInteger, sur toutes les fixtures", () => {
    const textes = [
      MTN_PAIEMENT_SORTANT,
      MTN_TRANSFERT_SORTANT,
      MTN_RECEPTION,
      MTN_RECEPTION_SALE,
      ORANGE_RECHARGEMENT,
      ORANGE_RECEPTION_RECONSTITUE,
      ORANGE_RECEPTION_ID_IMPOSSIBLE,
      ORANGE_RECEPTION_ID_MINUSCULES,
      ORANGE_RECEPTION_MONTANT_VIRGULE,
    ];
    for (const texte of textes) {
      const { sms } = reconnu(texte);
      for (const [champ, valeur] of Object.entries(sms)) {
        if (!champ.endsWith("Xaf")) continue;
        if (valeur === undefined) continue;
        expect(Number.isInteger(valeur), `${champ} de ${texte.slice(0, 30)}`).toBe(true);
      }
    }
  });

  it("propriete sur mille montants engendres", () => {
    // Toute forme decimale, a espaces ou a virgules, ressort entiere.
    for (let i = 0; i < 1000; i++) {
      const entier = (i * 137) % 1_000_000;
      const decimales = String(i % 100).padStart(2, "0");
      for (const forme of [
        `${entier}`,
        `${entier}.${decimales}`,
        entier.toLocaleString("fr-FR").replace(/ /g, " "),
      ]) {
        const v = xafInt(forme);
        expect(Number.isInteger(v), forme).toBe(true);
        expect(Number.isFinite(v), forme).toBe(true);
      }
    }
  });
});

/* ═════════════════════════ le solde ne sort jamais ═════════════════════════ */

describe("le solde du compte de la vendeuse", () => {
  it("n'est capture que par les motifs qui l'affichent, et jamais autrement", () => {
    // Il existe parce que le motif le capture, et sert au seul diagnostic
    // d'analyse EN MEMOIRE. Le lot 3 ne lui donne aucune colonne, deliberement.
    const paiement = reconnu(MTN_PAIEMENT_SORTANT);
    expect(paiement.sms.soldeXaf).toBe(12020);
    const rechargement = reconnu(ORANGE_RECHARGEMENT);
    expect(rechargement.sms.soldeBrut).toBe("108762.45");
    // Le SMS entrant, celui qui fait autorite, n'en expose pas.
    expect(reconnu(MTN_RECEPTION).sms.soldeXaf).toBeUndefined();
  });
});
