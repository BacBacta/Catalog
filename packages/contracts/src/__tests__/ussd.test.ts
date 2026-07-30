import { describe, expect, it } from "vitest";
import {
  type CanalUssd,
  chaineUssd,
  cheminsDePaiement,
  lienTel,
  montantAcceptable,
  numeroLocal,
  type OperateurRampe,
  operateurParId,
} from "../ussd.ts";

/**
 * La construction des chaines USSD.
 *
 * Les gabarits utilises ici sont ceux des TESTS, pas ceux de la production : le
 * module ne connait aucun code, il ne sait que remplir un gabarit. C'est
 * precisement ce que le dernier test de ce fichier verifie.
 */

const canal = (p: Partial<CanalUssd>): CanalUssd => ({
  id: "test",
  libelle: "essai",
  modele: "*000*{numero}*{montant}#",
  verifie: false,
  ...p,
});

const operateur = (p: Partial<OperateurRampe>): OperateurRampe => ({
  id: "essai",
  nom: "Operateur d'essai",
  codeEntree: canal({ id: "entree", modele: "*000#", verifie: true }),
  raccourcis: [canal({ id: "raccourci" })],
  etapes: ["Ouvrez le menu.", "Suivez les options."],
  etapesAConfirmer: true,
  montantMinXaf: 5,
  ...p,
});

const VERSEMENT = { numero: "677123456", montantXaf: 7500 };

describe("chaineUssd", () => {
  it("remplit le numero et le montant", () => {
    expect(chaineUssd(canal({ modele: "*1*{numero}*{montant}#" }), VERSEMENT)).toBe(
      "*1*677123456*7500#",
    );
  });

  it("rend un code d'entree tel quel : il n'a rien a pre-remplir", () => {
    expect(chaineUssd(canal({ modele: "*126#" }), VERSEMENT)).toBe("*126#");
  });

  it("accepte un gabarit commencant par un diese", () => {
    // Orange entre par un diese, MTN par une etoile. Les deux formes doivent
    // traverser la construction sans traitement particulier.
    expect(chaineUssd(canal({ modele: "#150*50*{numero}*{montant}#" }), VERSEMENT)).toBe(
      "#150*50*677123456*7500#",
    );
  });

  it("normalise un numero ecrit comme on l'ecrit vraiment", () => {
    for (const n of ["+237 677 12 34 56", "237677123456", "6 77 12 34 56", "677123456"]) {
      expect(chaineUssd(canal({ modele: "*1*{numero}#" }), { numero: n, montantXaf: 500 })).toBe(
        "*1*677123456#",
      );
    }
  });

  it("refuse un montant qui n'est pas un entier de francs", () => {
    // Le franc CFA n'a pas de sous-unite : 7500,5 F n'existe pas, et une chaine
    // USSD portant une virgule ne compose rien.
    for (const m of [7500.5, 0, -100, Number.NaN]) {
      expect(() => chaineUssd(canal({}), { numero: "677123456", montantXaf: m })).toThrow(
        /montant/,
      );
    }
  });

  it("refuse un numero non camerounais", () => {
    expect(() => chaineUssd(canal({}), { numero: "0612345678", montantXaf: 500 })).toThrow(
      /numero/,
    );
  });

  it("refuse un gabarit qui ferait passer autre chose qu'un appel", () => {
    // Une configuration mal remplie ne doit pas pouvoir glisser un separateur
    // dans un lien tel:.
    expect(() => chaineUssd(canal({ modele: "*1*{numero}#,,123" }), VERSEMENT)).toThrow(/USSD/);
    expect(() => chaineUssd(canal({ modele: "*1*{numero}# " }), VERSEMENT)).toThrow(/USSD/);
  });
});

describe("lienTel", () => {
  it("encode le diese en %23 — sinon le navigateur tronque la chaine", () => {
    expect(lienTel("*126*1*1*677123456*7500#")).toBe("tel:*126*1*1*677123456*7500%23");
  });

  it("encode TOUS les dieses, y compris celui de tete", () => {
    expect(lienTel("#150*50*677123456*7500#")).toBe("tel:%23150*50*677123456*7500%23");
  });

  it("laisse l'etoile intacte : elle est valide dans un URI tel:", () => {
    expect(lienTel("*126#")).toContain("*126");
  });

  it("ne contient plus aucun diese brut", () => {
    for (const u of ["*126#", "#150*50#", "*126*1*1*677123456*7500#"]) {
      expect(lienTel(u).includes("#")).toBe(false);
    }
  });

  it("refuse une chaine qui n'est pas une chaine USSD", () => {
    expect(() => lienTel("tel:+237677123456")).toThrow(/USSD/);
  });
});

describe("cheminsDePaiement", () => {
  it("propose LES DEUX chemins quand le raccourci n'est pas verifie", () => {
    const chemins = cheminsDePaiement(
      operateur({
        codeEntree: canal({ id: "entree", modele: "*126#", verifie: true }),
        raccourcis: [
          canal({ id: "court", modele: "*126*1*1*{numero}*{montant}#", verifie: false }),
        ],
      }),
      VERSEMENT,
    );

    expect(chemins.map((c) => c.type)).toEqual(["raccourci", "code_entree"]);
    // Le raccourci d'abord — c'est le chemin rapide —, le code d'entree ensuite,
    // et il est toujours la. Un raccourci non verifie ne REMPLACE jamais rien.
    expect(chemins[0]?.verifie).toBe(false);
    expect(chemins[1]?.verifie).toBe(true);
    expect(chemins[1]?.ussd).toBe("*126#");
  });

  it("rend le seul code d'entree quand aucun raccourci n'est connu", () => {
    // On n'invente pas un raccourci pour meubler.
    const chemins = cheminsDePaiement(operateur({ raccourcis: [] }), VERSEMENT);
    expect(chemins).toHaveLength(1);
    expect(chemins[0]?.type).toBe("code_entree");
  });

  it("chaque chemin porte son lien tel: pret a poser sur un href", () => {
    for (const c of cheminsDePaiement(operateur({}), VERSEMENT)) {
      expect(c.tel.startsWith("tel:")).toBe(true);
      expect(c.tel).not.toContain("#");
    }
  });
});

describe("montantAcceptable", () => {
  it("connait le minimum de chaque operateur", () => {
    const orange = operateur({ montantMinXaf: 10 });
    const mtn = operateur({ montantMinXaf: 5 });
    // Mesure le 29/07/2026 : Orange refuse 5 F (ER201), MTN l'accepte.
    expect(montantAcceptable(orange, 5)).toBe(false);
    expect(montantAcceptable(mtn, 5)).toBe(true);
    expect(montantAcceptable(orange, 10)).toBe(true);
  });

  it("refuse un montant non entier", () => {
    expect(montantAcceptable(operateur({}), 10.5)).toBe(false);
  });
});

describe("operateurParId", () => {
  it("rend null sur un identifiant inconnu plutot que le premier venu", () => {
    const config = { version: 1, operateurs: [operateur({ id: "mtn" })] };
    expect(operateurParId(config, "mtn")?.id).toBe("mtn");
    expect(operateurParId(config, "moov")).toBeNull();
  });
});

describe("numeroLocal", () => {
  it("rend neuf chiffres, sans indicatif", () => {
    expect(numeroLocal("+237677123456")).toBe("677123456");
  });
});

/**
 * **Le critere du lot : aucun code USSD n'est ecrit en dur hors de la
 * configuration.**
 *
 * La verification vit dans `apps/api/src/__tests__/rampe-config.test.ts`, qui
 * parcourt les quatre arbres de sources — celui-ci compris. Elle n'est pas ici
 * parce que ce paquet est compile SANS les types de plateforme : y faire entrer
 * `node:fs` ferait dependre la source de verite des types d'un environnement
 * d'execution, pour un test qui existe deja ailleurs.
 */
