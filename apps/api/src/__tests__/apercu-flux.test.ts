import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Flux, Noeud } from "../../scripts/apercu-flux.ts";
import {
  COMPOSANTS,
  construirePage,
  echapper,
  lireFlux,
  mesurer,
  SORTIE_PAR_DEFAUT,
  typesUtilises,
} from "../../scripts/apercu-flux.ts";

/**
 * L'apercu ne peut pas mentir sur les definitions.
 *
 * Les maquettes de `docs/terrain/` sont ecrites a la main : rien ne dit quand
 * elles cessent de decrire les Flows deposes. `flux-spec.test.ts` ferme cette
 * derive pour les NOMS de champs ; ces tests la ferment pour ce qu'une vendeuse
 * VOIT, et pour le fichier lui-meme, qui est genere et versionne.
 *
 * Deux pannes possibles, et un test pour chacune :
 *
 * 1. un composant NEUF dans un JSON, inconnu du rendu — il rendrait un bloc
 *    rouge, ou pire, quelqu'un le retirerait et il ne rendrait rien ;
 * 2. le HTML versionne qui prend du retard sur le JSON — la derive meme que ce
 *    script existe pour supprimer.
 */
const FLUX = lireFlux();

/**
 * Un Flow par sa cle. Il LANCE plutot que d'affirmer : une definition absente
 * doit nommer son fichier, pas produire un `undefined` qui echoue deux lignes
 * plus loin sur un message sans rapport.
 */
function flux(cle: string): Flux {
  const f = FLUX.find((x) => x.cle === cle);
  if (!f) throw new Error(`docs/flux-${cle}.json est absent`);
  return f;
}

describe("l'apercu couvre le vocabulaire reellement utilise", () => {
  it("lit les six definitions", () => {
    /* Une lecture qui rendrait une liste vide ferait passer tous les autres
       tests pour de mauvaises raisons — la lecon du harnais de l'ADR 0105. */
    expect(FLUX.length).toBeGreaterThanOrEqual(6);
    for (const f of FLUX) expect(f.spec.screens.length, f.cle).toBeGreaterThan(0);
  });

  it("connait CHAQUE type de composant present dans un JSON", () => {
    const connus = new Set(Object.keys(COMPOSANTS));
    for (const f of FLUX) {
      for (const t of typesUtilises(f.spec)) {
        expect(connus, `${f.cle} utilise « ${t} »`).toContain(t);
      }
    }
  });

  it("ne compte ni les schemas `data` ni les cibles `next` comme des composants", () => {
    /* Deux faux positifs du premier inventaire : `type: "string"` sous `data`
       et `type: "screen"` sous `next`. Ni l'un ni l'autre ne se dessine. */
    /* L'ouverture est celle qui porte les deux : un schema `data` et un `next`. */
    const types = typesUtilises(flux("ouverture").spec);
    expect(types).not.toContain("string");
    expect(types).not.toContain("screen");
    expect(types).toContain("PhotoPicker");
  });

  it("ne rend AUCUN bloc « non pris en charge »", () => {
    /* La verification directe de la panne visible, en plus de celle du
       vocabulaire : si le rendu d'un type existe mais echoue, ceci le voit. */
    expect(construirePage(FLUX)).not.toMatch(/class="inconnu"/);
  });
});

describe("l'apercu montre exactement ce que le JSON dit", () => {
  const page = construirePage(FLUX);

  /** Tous les textes qu'une vendeuse lit, extraits des definitions elles-memes. */
  const textes: Array<{ flux: string; texte: string }> = [];
  for (const f of FLUX) {
    for (const ecran of f.spec.screens) {
      textes.push({ flux: f.cle, texte: ecran.title });
      const descendre = (n: Noeud): void => {
        for (const v of [n.label, n.text, n["helper-text"], n.description]) {
          if (v !== undefined && v.length > 0) textes.push({ flux: f.cle, texte: v });
        }
        for (const o of n["data-source"] ?? []) textes.push({ flux: f.cle, texte: o.title });
        for (const e of n.children ?? []) descendre(e);
      };
      descendre(ecran.layout);
    }
  }

  it("extrait de quoi juger — un corpus vide ne prouverait rien", () => {
    expect(textes.length).toBeGreaterThan(60);
  });

  it("affiche chaque titre, etiquette, aide et option", () => {
    for (const { flux, texte } of textes) {
      expect(page, `${flux} : « ${texte} »`).toContain(echapper(texte));
    }
  });

  it("marque l'obligation la ou le JSON la declare, et nulle part ailleurs", () => {
    /* Le compte des points verts doit egaler le compte des `required: true`.
       Un marqueur de trop est une promesse fausse ; un de moins, un champ
       qu'une vendeuse decouvre bloquant au moment de valider. */
    const declares = FLUX.reduce((n, f) => n + mesurer(f.spec).obligatoires, 0);
    const rendus = page.match(/class="obligatoire"/g)?.length ?? 0;
    /* Un marqueur de plus, et un seul : celui de la legende. */
    expect(rendus).toBe(declares + 1);
  });

  /**
   * Le pied se cherche EN PROFONDEUR, pas en premiere position.
   *
   * Premiere version : `layout.children[0].children`. Elle supposait le
   * formulaire d'abord, ce qui est vrai de cinq Flows sur six — l'ouverture
   * commence par un `TextSubheading`. La supposition tenait jusqu'au moment ou
   * elle ne tenait plus, en silence si le test avait ete plus permissif.
   */
  const trouverPied = (n: Noeud): Noeud | undefined => {
    if (n.type === "Footer") return n;
    for (const e of n.children ?? []) {
      const t = trouverPied(e);
      if (t) return t;
    }
    return undefined;
  };

  it("rend la charge utile de chaque pied — c'est le contrat avec le domaine", () => {
    for (const f of FLUX) {
      for (const ecran of f.spec.screens) {
        const pied = trouverPied(ecran.layout);
        expect(pied, `${f.cle}/${ecran.id} n'a pas de pied`).toBeDefined();
        for (const cle of Object.keys(pied?.["on-click-action"]?.payload ?? {})) {
          expect(page, `${f.cle}/${ecran.id} : ${cle}`).toContain(`<code>${cle}</code>`);
        }
      }
    }
  });
});

describe("le fichier versionne ne prend pas de retard", () => {
  it("est identique a une regeneration", () => {
    /* `node apps/api/scripts/apercu-flux.ts` repare cet echec. */
    expect(readFileSync(SORTIE_PAR_DEFAUT, "utf8")).toBe(construirePage(FLUX));
  });

  it("est deterministe — ni date ni alea, sinon ce test echouerait demain", () => {
    expect(construirePage(FLUX)).toBe(construirePage(lireFlux()));
  });
});

describe("la mesure des gestes", () => {
  it("compte les champs obligatoires plus une pression par ecran", () => {
    /* Mesure du 17/08/2026 : ville, quartier, repere, telephone obligatoires,
       la position facultative, un seul ecran. */
    expect(mesurer(flux("livraison").spec)).toEqual({
      obligatoires: 4,
      facultatifs: 1,
      taps: 1,
      gestes: 5,
    });
  });

  it("additionne les ecrans d'un Flow qui en enchaine deux", () => {
    const m = mesurer(flux("ouverture").spec);
    /* Ecran 1 : boutique, ville, langue obligatoires. Ecran 2 : tout est
       facultatif — c'est voulu, une boutique s'ouvre sans article (ADR 0087). */
    expect(m.obligatoires).toBe(3);
    expect(m.taps).toBe(2);
    expect(m.gestes).toBe(5);
  });

  it("ne compte pas le formulaire lui-meme comme un champ", () => {
    /* `Form` porte un `name` (« formulaire ») : sans exclusion explicite, il
       gonflerait le compte de un par ecran, silencieusement. */
    const m = mesurer(flux("avis").spec);
    expect(m.obligatoires + m.facultatifs).toBe(2);
  });
});
