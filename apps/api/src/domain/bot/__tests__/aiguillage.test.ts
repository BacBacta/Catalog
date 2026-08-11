import { describe, expect, it } from "vitest";
import { aiguiller, type ContexteAiguillage } from "../aiguillage.ts";

/**
 * L'aiguillage par geste — ADR 0034. Deux defauts a ne jamais laisser
 * revenir : une vendeuse qui ne peut pas acheter, et une prospect qu'on
 * renvoie au catalogue.
 */

const REPOS: ContexteAiguillage = {
  estVendeuse: false,
  etatVendeuseEnCours: false,
  smsReconnu: false,
  achatEnCours: false,
};
const VENDEUSE: ContexteAiguillage = { ...REPOS, estVendeuse: true };
const txt = (texte: string) => ({ genre: "texte" as const, texte });

describe("aiguiller", () => {
  it("une inscription en cours prime sur TOUT — meme sur un nom qui ressemble a un slug", () => {
    const ctx = { ...REPOS, etatVendeuseEnCours: true };
    expect(aiguiller(txt("chez-amina"), ctx)).toBe("inscription");
    expect(aiguiller(txt("boutique chez-amina"), ctx)).toBe("inscription");
    expect(aiguiller({ genre: "image", texte: undefined }, ctx)).toBe("inscription");
  });

  it("« vendre » ouvre l'inscription d'une prospect", () => {
    for (const mot of [
      "vendre",
      "je veux vendre",
      "ouvrir ma boutique",
      "vendre avec chez-amina",
    ]) {
      expect(aiguiller(txt(mot), REPOS), mot).toBe("inscription");
    }
  });

  it("« vendre » d'une vendeuse installee ne rouvre pas une boutique", () => {
    // Un numero, une boutique : `Seller.phone` est UNIQUE.
    expect(aiguiller(txt("vendre"), VENDEUSE)).toBe("vendeuse");
  });

  it("UNE VENDEUSE PEUT ACHETER — le lien d'une consoeur l'emporte sur son statut", () => {
    expect(aiguiller(txt("boutique chez-amina"), VENDEUSE)).toBe("acheteuse");
    expect(
      aiguiller({ genre: "bouton", id: "catalogue" }, { ...VENDEUSE, achatEnCours: true }),
    ).toBe("acheteuse");
  });

  it("« ma boutique » ramene une vendeuse chez elle, meme en plein achat", () => {
    expect(aiguiller(txt("ma boutique"), { ...VENDEUSE, achatEnCours: true })).toBe("vendeuse");
  });

  it("« congés » et « je reprends » ramenent au fil vendeuse, meme en plein achat", () => {
    /* ADR 0039. C'est le cas NORMAL et non le cas limite : une vendeuse qui
       teste sa propre boutique — ou qui achete a une consoeur — a un achat en
       cours. Sans cette regle, le mot annonce par le menu partirait au fil
       acheteuse, ou il ne veut rien dire. */
    for (const mot of ["congés", "vacances", "je pars", "je reprends", "de retour"]) {
      expect(aiguiller(txt(mot), { ...VENDEUSE, achatEnCours: true }), mot).toBe("vendeuse");
    }
    for (const id of ["conges", "rouvrir"]) {
      expect(aiguiller({ genre: "bouton", id }, { ...VENDEUSE, achatEnCours: true }), id).toBe(
        "vendeuse",
      );
    }
    /* Et pour qui n'est pas vendeuse, ces mots n'existent pas. */
    expect(aiguiller(txt("congés"), REPOS)).toBe("acheteuse");
  });

  it("« ajouter » et le bouton « article » mènent a l'ajout d'article", () => {
    expect(aiguiller(txt("ajouter un article"), VENDEUSE)).toBe("inscription");
    expect(aiguiller(txt("ajouter"), VENDEUSE)).toBe("inscription");
    expect(aiguiller({ genre: "bouton", id: "article" }, VENDEUSE)).toBe("inscription");
    expect(aiguiller({ genre: "bouton", id: "ma_boutique" }, VENDEUSE)).toBe("vendeuse");
  });

  it("un SMS reconnu part au fil vendeuse, meme si un achat trainait", () => {
    expect(
      aiguiller(txt("Vous avez recu 7500 FCFA…"), {
        ...VENDEUSE,
        smsReconnu: true,
        achatEnCours: true,
      }),
    ).toBe("vendeuse");
  });

  it("les gestes vendeuse n'existent pas pour qui n'est pas vendeuse", () => {
    expect(aiguiller(txt("ma boutique"), REPOS)).toBe("acheteuse");
    expect(aiguiller(txt("ajouter"), REPOS)).toBe("acheteuse");
    expect(aiguiller({ genre: "bouton", id: "article" }, REPOS)).toBe("acheteuse");
  });

  it("au repos : la vendeuse chez elle, l'inconnue au fil acheteuse", () => {
    expect(aiguiller(txt("bonjour"), VENDEUSE)).toBe("vendeuse");
    expect(aiguiller(txt("bonjour"), REPOS)).toBe("acheteuse");
  });
});

describe("la photo d'une vendeuse (ADR 0035)", () => {
  it("part a l'inscription — c'est un article qui arrive, pas du bruit", () => {
    expect(
      aiguiller(
        { genre: "image" },
        { estVendeuse: true, etatVendeuseEnCours: false, smsReconnu: false, achatEnCours: false },
      ),
    ).toBe("inscription");
  });

  it("celle d'une acheteuse reste au fil acheteuse, qui l'ignore poliment", () => {
    expect(
      aiguiller(
        { genre: "image" },
        { estVendeuse: false, etatVendeuseEnCours: false, smsReconnu: false, achatEnCours: false },
      ),
    ).toBe("acheteuse");
  });
});

/**
 * Ou part une forme qu'on ne sait pas lire — ADR 0049.
 *
 * Aucune regle nouvelle : les cinq existantes suffisent, et c'est le signe
 * qu'elles sont bien ecrites. Ce bloc FIXE le resultat, pour qu'un
 * remaniement de l'aiguillage ne renvoie pas un vocal au mauvais fil.
 */
describe("une forme non lue suit les regles existantes", () => {
  const base = {
    estVendeuse: false,
    etatVendeuseEnCours: false,
    smsReconnu: false,
    achatEnCours: false,
  };
  const vocal = { genre: "autre" as const };

  it("un formulaire vendeuse en cours la garde — la question se reposera", () => {
    expect(aiguiller(vocal, { ...base, etatVendeuseEnCours: true })).toBe("inscription");
  });

  it("un achat en cours la garde aussi — l'etat de commande ne se perd pas", () => {
    expect(aiguiller(vocal, { ...base, achatEnCours: true })).toBe("acheteuse");
  });

  it("une vendeuse au repos la recoit dans SON fil, pas dans l'inscription", () => {
    /* Une PHOTO d'une vendeuse au repos est un article qui arrive (regle 3).
       Un vocal, non : il ne porte rien qu'on sache publier. */
    expect(aiguiller(vocal, { ...base, estVendeuse: true })).toBe("vendeuse");
  });

  it("une inconnue la recoit au fil acheteuse", () => {
    expect(aiguiller(vocal, base)).toBe("acheteuse");
  });
});
