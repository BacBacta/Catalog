import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chaineUssd,
  cheminsDePaiement,
  lienTel,
  montantAcceptable,
  operateurParId,
} from "@catalog/contracts/ussd";
import { describe, expect, it } from "vitest";
import { modeleValide, RAMPE_DEFAUT, rampeDepuisEnv } from "../domain/ramp/config.ts";

/**
 * La configuration de la rampe, et la garde qui la protege.
 *
 * Deux criteres de la definition de terminé du lot 9 se jouent ici :
 *
 * 1. **la construction de la chaine pour chaque operateur**, encodage du diese
 *    compris ;
 * 2. **aucun code n'est ecrit en dur hors de la configuration** — verifie par un
 *    parcours du depot, pas par relecture.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const VERSEMENT = { numero: "677123456", montantXaf: 7500 };

const mtn = () => {
  const op = operateurParId(RAMPE_DEFAUT, "mtn");
  if (!op) throw new Error("operateur mtn absent de la configuration");
  return op;
};
const orange = () => {
  const op = operateurParId(RAMPE_DEFAUT, "orange");
  if (!op) throw new Error("operateur orange absent de la configuration");
  return op;
};

describe("configuration par defaut", () => {
  it("porte les deux operateurs du marche camerounais", () => {
    expect(RAMPE_DEFAUT.operateurs.map((o) => o.id)).toEqual(["mtn", "orange"]);
  });

  it("les codes d'entree sont verifies, les raccourcis ne le sont PAS", () => {
    // C'est la regle du lot, et elle vient du terrain : les codes d'entree ont
    // ete releves le 29/07/2026 dans la reponse de l'operateur ; les raccourcis
    // parametres n'ont jamais ete composes sur un telephone a Douala.
    for (const op of RAMPE_DEFAUT.operateurs) {
      expect(op.codeEntree.verifie, op.id).toBe(true);
      for (const r of op.raccourcis) expect(r.verifie, `${op.id}/${r.id}`).toBe(false);
    }
  });

  it("chaque operateur porte ses etapes ecrites, marquees a confirmer", () => {
    for (const op of RAMPE_DEFAUT.operateurs) {
      expect(op.etapes.length, op.id).toBeGreaterThanOrEqual(3);
      // Les intitules de menu n'ont pas ete releves : l'interface doit le dire.
      expect(op.etapesAConfirmer, op.id).toBe(true);
    }
  });

  it("les etapes rappellent que le code secret se tape chez l'operateur", () => {
    for (const op of RAMPE_DEFAUT.operateurs) {
      expect(op.etapes.join(" "), op.id).toMatch(/chez l'operateur/i);
    }
  });

  it("tous les gabarits sont composables", () => {
    for (const op of RAMPE_DEFAUT.operateurs) {
      for (const canal of [op.codeEntree, ...op.raccourcis]) {
        expect(modeleValide(canal.modele), `${op.id}/${canal.id}`).toBe(true);
      }
    }
  });
});

describe("construction par operateur", () => {
  it("MTN : la chaine complete, et le diese encode dans le lien", () => {
    const chemins = cheminsDePaiement(mtn(), VERSEMENT);
    const raccourci = chemins.find((c) => c.type === "raccourci");
    const entree = chemins.find((c) => c.type === "code_entree");

    expect(raccourci?.ussd).toBe("*126*1*1*677123456*7500#");
    expect(raccourci?.tel).toBe("tel:*126*1*1*677123456*7500%23");
    expect(entree?.ussd).toBe("*126#");
    expect(entree?.tel).toBe("tel:*126%23");
  });

  it("Orange : le diese de tete est encode lui aussi", () => {
    const chemins = cheminsDePaiement(orange(), VERSEMENT);
    const raccourci = chemins.find((c) => c.type === "raccourci");
    const entree = chemins.find((c) => c.type === "code_entree");

    expect(raccourci?.ussd).toBe("#150*50*677123456*7500#");
    expect(raccourci?.tel).toBe("tel:%23150*50*677123456*7500%23");
    expect(entree?.ussd).toBe("#150*50#");
    expect(entree?.tel).toBe("tel:%23150*50%23");
  });

  it("aucun lien tel: ne laisse passer un diese brut", () => {
    // Un diese non encode est traite comme une ancre : le composeur s'ouvre sur
    // une chaine tronquee et la session ne part jamais. C'est la panne la plus
    // discrete du parcours — le lien s'ouvre, rien ne se passe.
    for (const op of RAMPE_DEFAUT.operateurs) {
      for (const c of cheminsDePaiement(op, VERSEMENT)) {
        expect(c.tel, c.id).not.toContain("#");
        expect(c.tel.startsWith("tel:"), c.id).toBe(true);
      }
    }
  });

  it("les deux chemins sont proposes chez chaque operateur", () => {
    for (const op of RAMPE_DEFAUT.operateurs) {
      const types = cheminsDePaiement(op, VERSEMENT).map((c) => c.type);
      expect(types, op.id).toContain("raccourci");
      expect(types, op.id).toContain("code_entree");
    }
  });

  it("connait le minimum de chaque operateur", () => {
    // Mesure le 29/07/2026 : Orange refuse 5 F (ER201), MTN l'accepte.
    expect(montantAcceptable(mtn(), 5)).toBe(true);
    expect(montantAcceptable(orange(), 5)).toBe(false);
    expect(montantAcceptable(orange(), 10)).toBe(true);
  });
});

describe("surcharge par l'environnement", () => {
  it("remplace un code d'entree sans redeploiement", () => {
    const config = rampeDepuisEnv({ RAMPE_MTN_ENTREE_MODELE: "*127#" });
    expect(operateurParId(config, "mtn")?.codeEntree.modele).toBe("*127#");
    // Et l'autre operateur n'a pas bouge.
    expect(operateurParId(config, "orange")?.codeEntree.modele).toBe(orange().codeEntree.modele);
  });

  it("IGNORE une valeur mal formee au profit du defaut", () => {
    // Une faute de frappe ne doit pas fabriquer une chaine qui ne compose rien.
    for (const mauvais of ["", "   ", "*126 #", "126", "tel:*126#", "*126#;*111#"]) {
      const config = rampeDepuisEnv({ RAMPE_MTN_ENTREE_MODELE: mauvais });
      expect(operateurParId(config, "mtn")?.codeEntree.modele, mauvais).toBe(
        mtn().codeEntree.modele,
      );
    }
  });

  it("le drapeau ne suit PAS le gabarit : le poser est un acte separe", () => {
    // Changer une chaine ne la rend pas verifiee. Seule une personne qui l'a
    // composee a Douala pose le drapeau.
    const change = rampeDepuisEnv({ RAMPE_MTN_RACCOURCI_MODELE: "*126*1*{numero}*{montant}#" });
    expect(operateurParId(change, "mtn")?.raccourcis[0]?.verifie).toBe(false);

    const teste = rampeDepuisEnv({ RAMPE_MTN_RACCOURCI_VERIFIE: "true" });
    expect(operateurParId(teste, "mtn")?.raccourcis[0]?.verifie).toBe(true);
  });

  it("un drapeau qui n'est ni true ni false est ignore", () => {
    for (const flou of ["oui", "1", "TRUE!", ""]) {
      const config = rampeDepuisEnv({ RAMPE_MTN_RACCOURCI_VERIFIE: flou });
      expect(operateurParId(config, "mtn")?.raccourcis[0]?.verifie, flou).toBe(false);
    }
    expect(
      operateurParId(rampeDepuisEnv({ RAMPE_MTN_RACCOURCI_VERIFIE: "false" }), "mtn")?.codeEntree
        .verifie,
    ).toBe(true);
  });

  it("remplace un minimum, et ignore un minimum absurde", () => {
    expect(
      operateurParId(rampeDepuisEnv({ RAMPE_ORANGE_MIN_XAF: "25" }), "orange")?.montantMinXaf,
    ).toBe(25);
    for (const mauvais of ["0", "-5", "10.5", "beaucoup"]) {
      expect(
        operateurParId(rampeDepuisEnv({ RAMPE_ORANGE_MIN_XAF: mauvais }), "orange")?.montantMinXaf,
        mauvais,
      ).toBe(10);
    }
  });

  it("un environnement vide rend la configuration par defaut", () => {
    expect(rampeDepuisEnv({})).toEqual(RAMPE_DEFAUT);
  });

  it("surcharge un second raccourci par son rang", () => {
    const base = {
      version: 1,
      operateurs: [
        {
          ...mtn(),
          raccourcis: [
            { id: "a", libelle: "a", modele: "*1*{numero}#", verifie: false },
            { id: "b", libelle: "b", modele: "*2*{numero}#", verifie: false },
          ],
        },
      ],
    };
    const config = rampeDepuisEnv({ RAMPE_MTN_RACCOURCI_2_MODELE: "*3*{numero}#" }, base);
    expect(config.operateurs[0]?.raccourcis.map((r) => r.modele)).toEqual([
      "*1*{numero}#",
      "*3*{numero}#",
    ]);
  });

  it("une chaine surchargee reste composable de bout en bout", () => {
    const config = rampeDepuisEnv({
      RAMPE_ORANGE_RACCOURCI_MODELE: "#150*50*1*{numero}*{montant}#",
    });
    const op = operateurParId(config, "orange");
    if (!op) throw new Error("operateur absent");
    const chaine = chaineUssd(op.raccourcis[0] as (typeof op.raccourcis)[number], VERSEMENT);
    expect(chaine).toBe("#150*50*1*677123456*7500#");
    expect(lienTel(chaine)).toBe("tel:%23150*50*1*677123456*7500%23");
  });
});

/* ───────────────────── la garde : aucun code en dur ─────────────────────── */

/**
 * Une chaine composable : etoile ou diese, des chiffres, un diese final. C'est
 * la forme d'un code d'operateur, et elle n'a le droit d'apparaitre que dans la
 * configuration.
 */
const CODE_USSD = /["'`][*#]\d[\d*#{}a-z]*#/i;

/**
 * Le seul emplacement ou un code d'operateur a le droit d'exister.
 *
 * Les fichiers de TEST sont hors du parcours : ils affirment les valeurs
 * attendues, c'est leur travail, et un code n'y atteint jamais une acheteuse.
 * L'adaptateur en dormance (ADR 0009) et ses tests sont dans ce cas : ce sont
 * eux qui ont RELEVE les codes, dans une reponse de l'agregateur du 29/07/2026.
 */
const AUTORISES = ["apps/api/src/domain/ramp/config.ts"];

const EST_TEST = /(^|[./])(__tests__|e2e)[/]|\.(test|spec)\.[jt]sx?$/;

function sources(dir: string): string[] {
  const entrees = readdirSync(dir, { withFileTypes: true });
  return entrees.flatMap((e) => {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) return [];
    const chemin = join(dir, e.name);
    if (e.isDirectory()) return sources(chemin);
    if (!/\.(ts|tsx|astro|mjs|js)$/.test(e.name)) return [];
    return EST_TEST.test(chemin) ? [] : [chemin];
  });
}

describe("aucun code USSD hors de la configuration", () => {
  const fichiers = [
    ...sources(join(RACINE, "apps/api/src")),
    ...sources(join(RACINE, "apps/shop/src")),
    ...sources(join(RACINE, "apps/seller/src")),
    ...sources(join(RACINE, "packages/contracts/src")),
  ];

  it("parcourt bien les quatre arbres, tests exclus", () => {
    expect(fichiers.length).toBeGreaterThan(30);
    expect(fichiers.some((f) => EST_TEST.test(f))).toBe(false);
  });

  it("ne trouve aucune chaine composable ailleurs", () => {
    const coupables = fichiers
      .map((f) => relative(RACINE, f))
      .filter((f) => !AUTORISES.includes(f))
      .filter((f) => {
        // Les commentaires citent des codes pour expliquer : ce qui compte est
        // qu'aucun n'atteigne le code execute.
        const code = readFileSync(join(RACINE, f), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*(\/\/|\*).*$/gm, "");
        return CODE_USSD.test(code);
      });
    expect(coupables).toEqual([]);
  });

  it("le motif attrape vraiment un code en dur", () => {
    // Un test de garde qui ne detecte rien est pire qu'absent.
    expect(CODE_USSD.test('const code = "*126#";')).toBe(true);
    expect(CODE_USSD.test("const code = '#150*50#';")).toBe(true);
    expect(CODE_USSD.test('modele: "*126*1*1*{numero}*{montant}#"')).toBe(true);
    // Et il ne se declenche pas sur du texte ordinaire.
    expect(CODE_USSD.test('const t = "Total : 7500 FCFA";')).toBe(false);
    expect(CODE_USSD.test("const h = '#hashtag';")).toBe(false);
  });
});
