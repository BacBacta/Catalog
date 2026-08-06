import { describe, expect, it } from "vitest";
import {
  LANGUES_SERVIES,
  type Langue,
  langueDemandee,
  normaliserLangue,
  PIDGIN_RELU,
  TEXTES,
} from "../textes.ts";

/**
 * La bascule du pidgin — ADR 0034.
 *
 * Le catalogue `wes` est ECRIT et NON RELU. Ce fichier tient les deux cotes de
 * la bascule, pour qu'aucun des deux ne puisse etre oublie :
 *
 * - tant que `PIDGIN_RELU` est `false`, **rien n'atteint une acheteuse** ;
 * - le jour ou il passe a `true`, **l'aide francaise et anglaise doit annoncer
 *   la langue**, sinon la suite echoue.
 *
 * On ne peut donc pas ouvrir la langue sans la proposer, ni la proposer sans
 * l'ouvrir. C'est la garantie que le §7.7 d'AGENTS.md demande — un brouillon ne
 * se promeut pas en silence — tenue par une commande plutot que par une
 * intention.
 */

const CLES_PIDGIN = /\b(pidgin|kamtok)\b/i;

describe("le pidgin existe, entier et type", () => {
  it("le catalogue wes a exactement les memes cles que le francais", () => {
    /* La parite est deja tenue par le typage : `Record<Langue, TextesAcheteuse>`
       ne compile pas s'il manque une cle. Ce test attrape l'autre moitie — une
       cle EN TROP, que le typage laisse passer sur un objet nomme. */
    expect(Object.keys(TEXTES.wes).sort()).toEqual(Object.keys(TEXTES.fr).sort());
  });

  it("il ne reste aucune chaine francaise recopiee telle quelle", () => {
    /* Un catalogue traduit a moitie est pire qu'un catalogue absent : il donne
       l'apparence d'une langue servie. On compare les entrees constantes. */
    const identiques = Object.keys(TEXTES.fr).filter((cle) => {
      const a = TEXTES.fr[cle as keyof typeof TEXTES.fr];
      const b = TEXTES.wes[cle as keyof typeof TEXTES.wes];
      return typeof a === "string" && typeof b === "string" && a === b;
    });
    /* « Home » et « Cancel » sont les memes mots en anglais et en pidgin — c'est
       le cas normal, pas un oubli. Le francais, lui, ne doit rien partager. */
    expect(identiques).toEqual([]);
  });

  it("les libelles de boutons tiennent les vingt caracteres de WhatsApp", () => {
    /* Au-dela, l'API refuse le message : ce n'est pas une regle de style, c'est
       une limite du transport. Elle vaut pour les trois langues. */
    const boutons = [
      "btnVoirArticles",
      "btnParlerVendeuse",
      "btnAccueil",
      "btnCommander",
      "btnRetourCatalogue",
      "btnAutreNombre",
      "btnPasserCommande",
      "btnAutreArticle",
      "btnAnnuler",
      "btnLivraison",
      "btnRetrait",
      "btnConfirmer",
      "btnCorriger",
    ] as const;
    for (const [langue, t] of Object.entries(TEXTES)) {
      for (const cle of boutons) {
        expect(t[cle].length, `${langue}.${cle} = « ${t[cle]} »`).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe("tant qu'il n'est pas relu, le pidgin ne sort pas", () => {
  it("PIDGIN_RELU commande la liste des langues servies", () => {
    expect(LANGUES_SERVIES.includes("fr")).toBe(true);
    expect(LANGUES_SERVIES.includes("en")).toBe(true);
    expect(LANGUES_SERVIES.includes("wes")).toBe(PIDGIN_RELU);
  });

  it("une demande de pidgin est comprise, et n'est suivie que s'il est relu", () => {
    for (const mot of ["pidgin", "Pidgin", "  KAMTOK ", "pidgin english"]) {
      expect(langueDemandee(mot)).toBe(PIDGIN_RELU ? "wes" : null);
    }
  });

  it("le francais et l'anglais restent servis quoi qu'il arrive", () => {
    expect(langueDemandee("english")).toBe("en");
    expect(langueDemandee("francais")).toBe("fr");
  });

  it("une conversation persistee en wes retombe au francais si la langue est fermee", () => {
    /* Le vrai danger de la bascule : quelqu'un ouvre la langue, des
       conversations sont ecrites en `wes`, puis on la referme. Sans ce garde,
       elles continueraient a recevoir un brouillon. */
    expect(normaliserLangue("wes")).toBe(PIDGIN_RELU ? "wes" : "fr");
    expect(normaliserLangue("en")).toBe("en");
    expect(normaliserLangue("fr")).toBe("fr");
  });

  it("une langue inconnue, absente ou difforme retombe au francais", () => {
    for (const valeur of [undefined, null, "", "de", "EN", 42, {}, ["fr"]]) {
      expect(normaliserLangue(valeur)).toBe("fr");
    }
  });
});

describe("la bascule ne peut pas etre faite a moitie", () => {
  it("l'aide annonce le pidgin si et seulement si il est servi", () => {
    /* Ouvrir la langue sans l'annoncer la rendrait introuvable : personne ne
       devine qu'il faut ecrire « pidgin ». L'annoncer sans l'ouvrir promettrait
       une langue que le bot refuse. Les deux echouent ici. */
    for (const langue of ["fr", "en"] as const) {
      expect(CLES_PIDGIN.test(TEXTES[langue].aideGestes), `${langue}.aideGestes`).toBe(PIDGIN_RELU);
    }
  });

  it("le message de bascule avertit que la langue n'est pas relue", () => {
    /* §7.7 — « dans le code ET dans l'interface ». Si quelqu'un ouvre la langue
       avant la relecture, l'acheteuse l'apprend des le premier message. */
    if (PIDGIN_RELU) return;
    expect(TEXTES.wes.langueChangee).toMatch(/never pass for correction/i);
  });

  it("le pidgin propose toujours le retour vers une langue servie", () => {
    /* Une acheteuse qui atterrit dans un brouillon doit pouvoir en sortir sans
       connaitre un mot de plus que ce que le message lui montre. */
    expect(TEXTES.wes.langueChangee).toMatch(/français/);
    expect(TEXTES.wes.langueChangee).toMatch(/english/i);
  });

  it("aucun catalogue ne se declare langue officielle du produit", () => {
    /* Le pidgin est un brouillon ; les trois catalogues restent des messages
       sortants, pas des attestations. */
    const langues: Langue[] = ["fr", "en", "wes"];
    for (const l of langues) {
      expect(TEXTES[l].accueilPitch).not.toMatch(/garanti|certifi|guaranteed|certified/i);
    }
  });
});
