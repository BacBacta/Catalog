import { describe, expect, it } from "vitest";
import { GABARITS, gabaritPour, type SujetNotification, variablesManquantes } from "../gabarits.ts";
import { gabarit, type MessageGabarit } from "../messages.ts";
import { decisionRemise } from "../notifications.ts";

/**
 * Les gabarits utilitaires — ADR 0054.
 *
 * Jusqu'ici, notre bot ne pouvait ecrire que dans la fenetre de 24 h ouverte
 * par un message entrant. Hors fenetre, une notification ATTENDAIT en base
 * jusqu'a la prochaine interaction : elle n'etait jamais perdue, mais une
 * commande arrivee a 21 h un vendredi n'etait pas remise avant que la
 * vendeuse ne reecrive — et elle ne peut PAS provoquer l'ouverture d'une
 * fenetre dont elle ignore l'existence.
 *
 * Le gabarit est la seule facon d'ouvrir cette porte, et Meta le facture.
 * D'ou une liste FERMEE : seuls les evenements qui ont deja de la valeur.
 */

describe("la fenetre decide, et le gabarit devient une troisieme issue", () => {
  const MAINTENANT = new Date("2026-08-08T20:00:00+01:00");
  const RECENT = new Date("2026-08-08T19:00:00+01:00");
  const VIEUX = new Date("2026-08-06T19:00:00+01:00");

  it("dans la fenetre : on ecrit librement, aucun gabarit facture", () => {
    expect(decisionRemise(RECENT, MAINTENANT, "nouvelle_commande")).toBe("envoyer");
  });

  it("hors fenetre AVEC gabarit : on ouvre la porte", () => {
    expect(decisionRemise(VIEUX, MAINTENANT, "nouvelle_commande")).toBe("gabarit");
  });

  it("hors fenetre SANS sujet : on attend, comme avant — rien ne se perd", () => {
    expect(decisionRemise(VIEUX, MAINTENANT)).toBe("attendre");
  });

  it("jamais vue : aucune fenetre, mais un gabarit reste possible", () => {
    expect(decisionRemise(null, MAINTENANT, "nouvelle_commande")).toBe("gabarit");
    expect(decisionRemise(null, MAINTENANT)).toBe("attendre");
  });

  it("une horloge qui recule ne fait pas payer un gabarit par erreur", () => {
    const futur = new Date("2026-08-09T20:00:00+01:00");
    expect(decisionRemise(futur, MAINTENANT, "nouvelle_commande")).toBe("gabarit");
  });
});

describe("le catalogue de gabarits", () => {
  it("chaque gabarit est de categorie UTILITY — jamais marketing", () => {
    /* Meta refuse un gabarit utilitaire qui fait de la promotion, et une
       serie de refus abime la note de qualite du numero. */
    for (const g of Object.values(GABARITS)) {
      expect(g.categorie, g.nom).toBe("utility");
    }
  });

  it("les noms suivent la convention Meta : minuscules, chiffres, soulignes", () => {
    for (const g of Object.values(GABARITS)) {
      expect(g.nom, g.nom).toMatch(/^[a-z0-9_]{1,512}$/);
    }
  });

  it("le francais et l'anglais existent pour chacun", () => {
    for (const g of Object.values(GABARITS)) {
      expect(Object.keys(g.corps).sort(), g.nom).toEqual(["en", "fr"]);
    }
  });

  it("les variables sont numerotees SANS TROU, et de 1 — Meta refuse le reste", () => {
    for (const g of Object.values(GABARITS)) {
      for (const [langue, texte] of Object.entries(g.corps)) {
        const vus = [...texte.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
        const attendus = Array.from({ length: g.variables }, (_, i) => i + 1);
        expect(
          [...new Set(vus)].sort((a, b) => a - b),
          `${g.nom}/${langue}`,
        ).toEqual(attendus);
      }
    }
  });

  it("aucun gabarit ne commence ni ne finit par une variable — Meta le refuse", () => {
    for (const g of Object.values(GABARITS)) {
      for (const [langue, texte] of Object.entries(g.corps)) {
        expect(texte.trim().startsWith("{{"), `${g.nom}/${langue}`).toBe(false);
        expect(texte.trim().endsWith("}}"), `${g.nom}/${langue}`).toBe(false);
      }
    }
  });

  it("aucun saut de ligne double ni espace en fin de ligne — Meta le refuse", () => {
    for (const g of Object.values(GABARITS)) {
      for (const [langue, texte] of Object.entries(g.corps)) {
        expect(/\n\n\n/.test(texte), `${g.nom}/${langue}`).toBe(false);
        expect(/[ \t]\n/.test(texte), `${g.nom}/${langue}`).toBe(false);
      }
    }
  });
});

describe("le choix du gabarit pour un sujet", () => {
  it("chaque sujet notifiable a le sien", () => {
    const sujets: SujetNotification[] = [
      "nouvelle_commande",
      "paiement_prouve",
      "commande_livree",
      "acompte_attendu",
      "reversement_absent",
    ];
    for (const s of sujets) expect(gabaritPour(s), s).not.toBeNull();
  });

  it("un sujet inconnu ne rend rien — on n'invente pas un gabarit", () => {
    expect(gabaritPour("inconnu" as SujetNotification)).toBeNull();
  });

  it("il manque une variable : on le DIT au lieu d'envoyer un trou", () => {
    const g = GABARITS.nouvelle_commande;
    expect(variablesManquantes(g, ["CT-482910"])).toBe(g.variables - 1);
    expect(variablesManquantes(g, Array(g.variables).fill("x"))).toBe(0);
  });
});

describe("le message de gabarit, au format de la Cloud API", () => {
  it("porte son nom, sa langue et ses parametres dans l'ordre", () => {
    const m = gabarit("237690112233", GABARITS.nouvelle_commande, "fr", [
      "CT-482910",
      "15 000 FCFA",
    ]) as MessageGabarit;
    expect(m.type).toBe("template");
    expect(m.template.name).toBe(GABARITS.nouvelle_commande.nom);
    expect(m.template.language.code).toBe("fr");
    expect(m.template.components[0]?.parameters.map((p) => p.text)).toEqual([
      "CT-482910",
      "15 000 FCFA",
    ]);
  });

  it("un parametre ne porte JAMAIS de saut de ligne — Meta rejette l'envoi", () => {
    const m = gabarit("237690112233", GABARITS.nouvelle_commande, "fr", [
      "CT-482910\nligne 2",
      "15 000 FCFA",
    ]) as MessageGabarit;
    for (const p of m.template.components[0]?.parameters ?? []) {
      expect(p.text).not.toContain("\n");
    }
  });
});

/**
 * Les exemples — ADR 0054, ajoutes apres le refus du 08/08/2026.
 *
 * Les dix gabarits ont ete refuses d'un coup avec `INVALID_FORMAT`, sans un
 * mot de plus. Deux essais temoins ont isole la cause : celui qui portait un
 * exemple est passe en examen, l'autre non. Meta ne peut pas juger « {{1}} ».
 */
describe("chaque variable a son exemple", () => {
  it("autant d'exemples que de variables — ni plus, ni moins", () => {
    for (const g of Object.values(GABARITS)) {
      expect(g.exemples.length, g.nom).toBe(g.variables);
    }
  });

  it("aucun exemple vide : Meta refuse un echantillon qui ne montre rien", () => {
    for (const g of Object.values(GABARITS)) {
      for (const e of g.exemples) expect(e.trim(), g.nom).not.toBe("");
    }
  });

  it("aucun exemple ne porte de saut de ligne", () => {
    for (const g of Object.values(GABARITS)) {
      for (const e of g.exemples) expect(e, g.nom).not.toContain("\n");
    }
  });
});

/**
 * Le suffixe « _v2 » — ADR 0054, 08/08/2026.
 *
 * Il n'y a jamais eu de v1. Les premiers depots ont ete refuses faute
 * d'exemples, puis supprimes — et Meta retient un nom supprime jusqu'a
 * 30 jours. Le nom etant un identifiant technique que personne ne lit, le
 * suffixe est le prix d'une manoeuvre ratee, pas la trace d'une version.
 */
describe("les noms deposes", () => {
  /**
   * Les noms BRULES le 08/08/2026 : deposes, refuses faute d'exemples, puis
   * supprimes. Chez Meta la suppression est asynchrone et le nom reste retenu
   * jusqu'a 30 jours — ceux-la ont du reprendre un suffixe pour repasser.
   */
  const BRULES = [
    "catalog_nouvelle_commande",
    "catalog_paiement_prouve",
    "catalog_commande_livree",
    "catalog_acompte_attendu",
    "catalog_reversement_absent",
  ];

  it("aucun gabarit ne reprend un nom BRULE", () => {
    /* La regle reelle, et la seule qui protege quelque chose. Elle disait
       avant « tous les noms finissent par _v2 », ce qui confondait l'accident
       avec la convention : le module l'ecrit noir sur blanc, le suffixe est le
       prix d'une manoeuvre ratee et ne se cherche pas de v1. Un gabarit neuf
       qui l'aurait porte aurait menti sur son histoire. */
    for (const g of Object.values(GABARITS)) {
      expect(BRULES, g.nom).not.toContain(g.nom);
    }
  });

  it("les cinq noms redeposes gardent le suffixe qui les a debloques", () => {
    for (const nom of BRULES) {
      const repris = Object.values(GABARITS).filter((g) => g.nom.startsWith(`${nom}_`));
      expect(repris.length, nom).toBe(1);
      expect(repris[0]?.nom, nom).toBe(`${nom}_v2`);
    }
  });

  it("restent uniques — deux sujets ne peuvent pas partager un nom", () => {
    const noms = Object.values(GABARITS).map((g) => g.nom);
    expect(new Set(noms).size).toBe(noms.length);
  });
});
