import { describe, expect, it } from "vitest";
import { fenetreGlissante, jourDeColonneDate, jourDeDouala } from "../domain/stats/periode.ts";

/**
 * La fenetre glissante, sur le seul bord qui casse : minuit.
 *
 * `Africa/Douala` est UTC+1 sans heure d'ete. Tout ce fichier existe pour le
 * cas ou quelqu'un « corrigerait » ce decalage en appelant `toLocaleDateString`
 * — ce qui marcherait sur une machine de developpement et deviendrait faux dans
 * un conteneur `small-icu`, en silence.
 */

describe("jourDeDouala", () => {
  it("23 h 30 a Douala est encore le jour meme", () => {
    // 22:30 UTC = 23:30 a Douala.
    expect(jourDeDouala(new Date("2026-07-30T22:30:00Z"))).toBe("2026-07-30");
  });

  it("23 h 30 UTC est DEJA le lendemain a Douala", () => {
    expect(jourDeDouala(new Date("2026-07-30T23:30:00Z"))).toBe("2026-07-31");
  });

  it("minuit pile a Douala ouvre le jour, il ne le ferme pas", () => {
    expect(jourDeDouala(new Date("2026-07-30T23:00:00Z"))).toBe("2026-07-31");
    expect(jourDeDouala(new Date("2026-07-30T22:59:59.999Z"))).toBe("2026-07-30");
  });

  it("refuse un instant invalide plutot que de rendre « NaN-aN-aN »", () => {
    // `new Date("n'importe quoi")` ne leve pas : il produit une date invalide,
    // dont `toISOString` leve plus loin, avec un message qui ne dit pas d'ou
    // vient le probleme. On echoue ici, au point d'entree.
    expect(() => jourDeDouala(new Date("pas une date"))).toThrow(/instant invalide/);
  });

  it("ne bascule pas au changement d'heure europeen — le Cameroun n'en a pas", () => {
    // Derniers dimanches d'octobre et de mars : l'Europe change, Douala non.
    expect(jourDeDouala(new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25");
    expect(jourDeDouala(new Date("2027-03-27T23:30:00Z"))).toBe("2027-03-28");
  });
});

describe("fenetreGlissante", () => {
  const MIDI = new Date("2026-07-30T11:00:00Z"); // 12 h a Douala

  it("compte le jour courant : trente jours finit AUJOURD'HUI", () => {
    const f = fenetreGlissante(MIDI, 30);
    expect(f.au).toBe("2026-07-30");
    expect(f.du).toBe("2026-07-01");
    expect(f.jours).toBe(30);
  });

  it("une fenetre d'un jour tient sur le jour courant", () => {
    const f = fenetreGlissante(MIDI, 1);
    expect(f.du).toBe("2026-07-30");
    expect(f.au).toBe("2026-07-30");
  });

  it("la borne basse est minuit a DOUALA, pas minuit UTC", () => {
    const f = fenetreGlissante(MIDI, 1);
    expect(f.debut.toISOString()).toBe("2026-07-29T23:00:00.000Z");
  });

  /**
   * La borne haute est EXCLUE. Une commande a `23:59:59.9995` existe — les
   * horloges de base ont plus de precision qu'une milliseconde — et une borne
   * fermee a `.999` la perdrait sans rien signaler.
   */
  it("la borne haute est exclue et couvre la derniere fraction de la journee", () => {
    const f = fenetreGlissante(MIDI, 1);
    expect(f.fin.toISOString()).toBe("2026-07-30T23:00:00.000Z");
    expect(new Date("2026-07-30T22:59:59.9995Z").getTime()).toBeLessThan(f.fin.getTime());
  });

  it("l'intervalle contient exactement `jours` fois vingt-quatre heures", () => {
    for (const jours of [1, 7, 30, 90, 365]) {
      const f = fenetreGlissante(MIDI, jours);
      expect((f.fin.getTime() - f.debut.getTime()) / 86_400_000).toBe(jours);
    }
  });

  it("traverse un changement de mois et une annee bissextile sans decaler", () => {
    const f = fenetreGlissante(new Date("2028-03-01T11:00:00Z"), 2);
    expect(f.du).toBe("2028-02-29");
    expect(f.au).toBe("2028-03-01");
  });

  it("refuse une fenetre absurde plutot que de rendre une periode vide", () => {
    for (const jours of [0, -1, 1.5, 400, Number.NaN]) {
      expect(() => fenetreGlissante(MIDI, jours)).toThrow();
    }
  });
});

/**
 * Le piege que ce test existe pour empecher : reutiliser `jourDeDouala` sur une
 * colonne SQL `DATE`. PostgreSQL n'y attache aucun fuseau et le pilote la rend a
 * minuit UTC ; lui appliquer le decalage la ferait basculer au LENDEMAIN, et
 * toutes les vues d'articles seraient comptees un jour trop tard.
 */
describe("jourDeColonneDate", () => {
  it("lit un jour SQL tel quel, sans lui appliquer de decalage", () => {
    expect(jourDeColonneDate(new Date("2026-07-25T00:00:00Z"))).toBe("2026-07-25");
  });

  it("ne se confond pas avec la lecture d'un instant", () => {
    const minuitUtc = new Date("2026-07-25T00:00:00Z");
    expect(jourDeColonneDate(minuitUtc)).toBe("2026-07-25");
    expect(jourDeDouala(minuitUtc)).toBe("2026-07-25");
    // La difference se voit sur la derniere heure de la journee UTC.
    const tard = new Date("2026-07-25T23:30:00Z");
    expect(jourDeColonneDate(tard)).toBe("2026-07-25");
    expect(jourDeDouala(tard)).toBe("2026-07-26");
  });
});
