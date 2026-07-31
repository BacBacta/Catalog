import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  aire,
  empiler,
  graduations,
  hautDEchelle,
  indicesAEtiqueter,
  jourCourt,
  ligne,
  projeter,
} from "../charts/echelle.ts";
import { Graphique } from "../charts/Graphique.tsx";
import { BarreEmpilee, Barres, Courbe } from "../charts/traces.tsx";

const CADRE = {
  largeur: 320,
  hauteur: 128,
  margeGauche: 34,
  margeDroite: 10,
  margeHaut: 12,
  margeBas: 22,
};

/* ═════════════════ echelle ═════════════════ */

describe("le haut d'echelle monte a une valeur ronde", () => {
  it.each([
    [1, 1],
    [7, 10],
    [12, 20],
    [28, 50],
    [137, 200],
    [200, 200],
    [1001, 2000],
  ])("max %i → %i", (max, attendu) => {
    expect(hautDEchelle(max)).toBe(attendu);
  });

  /**
   * Le cas qui casserait tout le reste : une vendeuse sans une seule vue. Un
   * haut d'echelle a zero divise par zero dans `projeter`, et l'ecran affiche
   * `NaN` a la place d'une courbe plate. Or une courbe plate a zero est la
   * verite, et elle doit s'afficher.
   */
  it("ne renvoie jamais zero, meme sur une serie entierement vide", () => {
    for (const max of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(hautDEchelle(max)).toBeGreaterThan(0);
    }
  });

  it("le haut d'echelle est toujours >= au maximum", () => {
    for (let max = 1; max < 3000; max += 7) {
      expect(hautDEchelle(max)).toBeGreaterThanOrEqual(max);
    }
  });
});

describe("graduations", () => {
  it("va de zero au haut d'echelle, inclus", () => {
    expect(graduations(200)).toEqual([0, 100, 200]);
    expect(graduations(50, 6)).toEqual([0, 10, 20, 30, 40, 50]);
  });

  /**
   * Le cas de la vendeuse qui recoit au plus une commande par jour. Trois
   * graduations donneraient `[0, 1, 1]` : deux traits etiquetes « 1 », dont un
   * a MI-HAUTEUR. On lit la courbe sur ces reperes — un faux est pire qu'un
   * manquant.
   */
  it("n'etiquette jamais deux fois la meme valeur sur une echelle basse", () => {
    expect(graduations(1)).toEqual([0, 1]);
    expect(graduations(2)).toEqual([0, 1, 2]);
    for (const haut of [1, 2, 3, 5, 10, 20, 50, 137]) {
      const g = graduations(haut);
      expect(new Set(g).size, `doublon pour ${haut}`).toBe(g.length);
      expect(
        [...g].sort((a, b) => a - b),
        `desordre pour ${haut}`,
      ).toEqual(g);
      expect(g[0]).toBe(0);
      expect(g[g.length - 1]).toBe(haut);
    }
  });

  it("refuse moins de deux graduations : une seule ne gradue rien", () => {
    expect(() => graduations(100, 1)).toThrow();
  });
});

/* ═════════════════ projection ═════════════════ */

describe("projeter", () => {
  it("pose la valeur nulle sur la ligne de base et le maximum sous la marge haute", () => {
    const p = projeter([0, 10], 10, CADRE);
    expect(p[0]?.y).toBe(CADRE.hauteur - CADRE.margeBas);
    expect(p[1]?.y).toBe(CADRE.margeHaut);
  });

  it("etale la serie d'un bord a l'autre du cadre utile", () => {
    const p = projeter([1, 2, 3], 3, CADRE);
    expect(p[0]?.x).toBe(CADRE.margeGauche);
    expect(p[2]?.x).toBe(CADRE.largeur - CADRE.margeDroite);
  });

  /**
   * Un point unique au bord gauche suggererait le debut d'une suite. Une seule
   * journee n'est pas une tendance : elle se centre.
   */
  it("centre un point unique", () => {
    const p = projeter([5], 10, CADRE);
    const utile = CADRE.largeur - CADRE.margeGauche - CADRE.margeDroite;
    expect(p[0]?.x).toBe(CADRE.margeGauche + utile / 2);
  });

  it("ne sort jamais du cadre, meme sur une valeur au-dela du haut d'echelle", () => {
    for (const p of projeter([0, 5, 999], 10, CADRE)) {
      expect(p.y).toBeGreaterThanOrEqual(CADRE.margeHaut);
      expect(p.y).toBeLessThanOrEqual(CADRE.hauteur - CADRE.margeBas);
    }
  });

  it("rend une serie vide sans exploser", () => {
    expect(projeter([], 10, CADRE)).toEqual([]);
    expect(ligne([])).toBe("");
    expect(aire([], 100)).toBe("");
  });
});

describe("aire", () => {
  it("referme le trace sur la ligne de base, aux deux extremites", () => {
    const points = projeter([1, 2], 2, CADRE);
    const d = aire(points, 106);
    expect(d.endsWith("310,106 34,106")).toBe(true);
  });
});

/* ═════════════════ etiquettes selectives ═════════════════ */

describe("les etiquettes sont selectives, jamais sur chaque point", () => {
  it("garde le premier, le dernier et le maximum", () => {
    const v = [1, 2, 3, 40, 5, 6, 7, 8, 9, 10];
    expect(indicesAEtiqueter(v)).toEqual([0, 3, 9]);
  });

  it("ecarte un maximum trop proche d'une extremite : les etiquettes se marcheraient dessus", () => {
    expect(indicesAEtiqueter([1, 99, 2, 3, 4, 5, 6])).toEqual([0, 6]);
    expect(indicesAEtiqueter([1, 2, 3, 4, 5, 99, 6])).toEqual([0, 6]);
  });

  it("n'etiquette pas un maximum nul : une serie plate n'a pas de sommet", () => {
    expect(indicesAEtiqueter([0, 0, 0, 0, 0, 0, 0])).toEqual([0, 6]);
  });

  it("etiquette tout quand il y a au plus deux points", () => {
    expect(indicesAEtiqueter([])).toEqual([]);
    expect(indicesAEtiqueter([4])).toEqual([0]);
    expect(indicesAEtiqueter([4, 9])).toEqual([0, 1]);
  });

  it("sur trente jours, n'etiquette jamais plus de trois points", () => {
    for (let graine = 0; graine < 200; graine++) {
      const v = Array.from({ length: 30 }, (_, i) => (graine * 31 + i * 17) % 40);
      expect(indicesAEtiqueter(v).length).toBeLessThanOrEqual(3);
    }
  });
});

/* ═════════════════ barre empilee ═════════════════ */

describe("empiler ne perd pas de reste a l'arrondi", () => {
  /**
   * La meme discipline que `splitDeposit` sur les montants : arrondir chaque
   * part separement laisse une barre a 99,7 % ou a 100,4 %, c'est-a-dire un
   * trou ou un debordement visible sur un ecran de telephone.
   */
  it("les segments se touchent bout a bout, et le dernier finit a cent", () => {
    for (const parts of [
      [3, 3, 3],
      [1, 1, 1],
      [7, 11, 13],
      [1, 0, 2],
      [999, 1, 1],
    ]) {
      const segments = empiler(parts.map((valeur, i) => ({ cle: `s${i}`, valeur })));
      let attendu = 0;
      for (const s of segments) {
        expect(s.debut).toBeCloseTo(attendu, 6);
        attendu = s.debut + s.largeur;
      }
      expect(attendu).toBeCloseTo(100, 6);
    }
  });

  it("aucune largeur n'est negative", () => {
    for (const s of empiler([
      { cle: "a", valeur: 0 },
      { cle: "b", valeur: 5 },
    ])) {
      expect(s.largeur).toBeGreaterThanOrEqual(0);
    }
  });

  it("un total nul ne divise pas par zero", () => {
    const segments = empiler([
      { cle: "a", valeur: 0 },
      { cle: "b", valeur: 0 },
    ]);
    expect(segments.every((s) => s.largeur === 0 && Number.isFinite(s.debut))).toBe(true);
  });
});

describe("jourCourt", () => {
  it("rend JJ/MM, l'ordre francais", () => {
    expect(jourCourt("2026-07-04")).toBe("04/07");
  });
});

/* ═════════════════ rendu ═════════════════ */

const LIGNES = [
  { cle: "a", entete: "Lundi", cellules: [12] },
  { cle: "b", entete: "Mardi", cellules: [0] },
];

describe("Graphique", () => {
  const rendu = renderToStaticMarkup(
    <Graphique
      titre="Vues par jour"
      resume="30 jours, 214 vues"
      colonnes={["Jour", "Vues"]}
      lignes={LIGNES}
      traceMuet
    >
      <svg viewBox="0 0 10 10" aria-hidden="true" />
    </Graphique>,
  );

  it("porte sa vue tableau, avec en-tetes de colonne ET de ligne", () => {
    expect(rendu).toContain("<table");
    expect(rendu).toContain('scope="col"');
    expect(rendu).toContain('scope="row"');
    expect(rendu).toContain("Lundi");
    expect(rendu).toContain("Mardi");
  });

  it("le tableau s'ouvre sans JavaScript : c'est un <details>", () => {
    expect(rendu).toContain("<details");
    expect(rendu).toContain("<summary");
  });

  it("le resume precede le trace, pour qui ne voit pas le trace", () => {
    expect(rendu).toContain("30 jours, 214 vues");
    expect(rendu.indexOf("30 jours")).toBeLessThan(rendu.indexOf('data-slot="trace"'));
  });

  it("le trace muet est masque aux lecteurs d'ecran", () => {
    expect(rendu).toMatch(/data-slot="trace"[^>]*aria-hidden="true"/);
  });

  it("un trace parlant — des barres en CSS — n'est PAS masque", () => {
    const parlant = renderToStaticMarkup(
      <Graphique titre="T" resume="r" colonnes={["A"]} lignes={LIGNES}>
        <p>du texte reel</p>
      </Graphique>,
    );
    expect(parlant).not.toMatch(/data-slot="trace"[^>]*aria-hidden/);
  });

  it("la commande d'ouverture atteint la cible tactile de 44px", () => {
    expect(rendu).toContain("min-h-[var(--size-touch)]");
  });
});

describe("Courbe", () => {
  const points = Array.from({ length: 30 }, (_, i) => ({
    jour: `2026-07-${String(i + 1).padStart(2, "0")}`,
    valeur: i === 12 ? 28 : i % 5,
  }));
  const rendu = renderToStaticMarkup(<Courbe points={points} />);

  it("trace une ligne et son lavis, sans jamais d'aplat sature", () => {
    expect(rendu).toContain("<polyline");
    expect(rendu).toContain('fill-opacity="0.1"');
  });

  it("la grille est en filet PLEIN — aucun pointille", () => {
    expect(rendu).not.toContain("stroke-dasharray");
  });

  it("le point final porte un anneau de surface", () => {
    expect(rendu).toMatch(/<circle[^>]*stroke="var\(--color-surface\)"/);
  });

  it("n'ecrit pas une date sur chaque point", () => {
    const dates = rendu.match(/\d{2}\/\d{2}/g) ?? [];
    expect(dates.length).toBeLessThanOrEqual(3);
  });

  it("une serie entierement a zero se trace quand meme, a plat", () => {
    const plat = renderToStaticMarkup(<Courbe points={points.map((p) => ({ ...p, valeur: 0 }))} />);
    expect(plat).toContain("<polyline");
    expect(plat).not.toContain("NaN");
  });

  it("une periode vide le dit, au lieu de rendre un cadre nu", () => {
    const vide = renderToStaticMarkup(<Courbe points={[]} />);
    expect(vide).toContain("Aucun jour");
  });
});

describe("Barres", () => {
  it("sans rampe, toutes les barres prennent la teinte de serie unique", () => {
    const rendu = renderToStaticMarkup(
      <Barres
        items={[
          { cle: "a", libelle: "Pagne", valeur: 30 },
          { cle: "b", libelle: "Foulard", valeur: 10 },
        ]}
        unite="vues"
      />,
    );
    const teintes = rendu.match(/var\(--color-serie\)/g) ?? [];
    expect(teintes.length).toBe(2);
    // Des categories nominales ne se colorent pas par leur valeur : ce serait
    // redire en couleur ce que la longueur dit deja.
    expect(rendu).not.toContain("--color-etape");
  });

  it("le libelle et la valeur sont du TEXTE, pas seulement une longueur", () => {
    const rendu = renderToStaticMarkup(
      <Barres items={[{ cle: "a", libelle: "Pagne", valeur: 1234 }]} unite="vues" />,
    );
    expect(rendu).toContain("Pagne");
    // Espace insecable etroit : le separateur de milliers francais.
    expect(rendu).toMatch(/1[\s  ]234/);
  });
});

describe("BarreEmpilee", () => {
  const segments = [
    {
      cle: "c",
      libelle: "Contresigné",
      valeur: 4,
      couleur: "var(--color-preuve-contresigne)",
      pourcent: 40,
      debut: 0,
    },
    {
      cle: "p",
      libelle: "Prouvé",
      valeur: 3,
      couleur: "var(--color-preuve-prouve)",
      pourcent: 30,
      debut: 40,
    },
    {
      cle: "n",
      libelle: "Non tracé",
      valeur: 3,
      couleur: "var(--color-preuve-non-trace)",
      pourcent: 30,
      debut: 70,
    },
  ];

  it("porte une legende avec la valeur en clair : personne n'estime une longueur", () => {
    const rendu = renderToStaticMarkup(<BarreEmpilee segments={segments} />);
    for (const s of segments) expect(rendu).toContain(s.libelle);
    // Espace INSECABLE avant le pour-cent : la typographie francaise ne coupe
    // jamais un nombre de son unite en fin de ligne.
    expect(rendu).toContain("40\u00a0%");
  });

  it("separe les segments par un vide de surface, pas par un contour", () => {
    const rendu = renderToStaticMarkup(<BarreEmpilee segments={segments} />);
    expect(rendu).toContain("gap-[2px]");
    expect(rendu).not.toContain("border-");
  });

  it("un total nul rend une piste vide plutot qu'une division par zero", () => {
    const rendu = renderToStaticMarkup(
      <BarreEmpilee segments={segments.map((s) => ({ ...s, valeur: 0, pourcent: 0 }))} />,
    );
    expect(rendu).not.toContain("NaN");
  });
});

/* ═════════════════ la regle qui tient tout ═════════════════ */

describe("aucune bibliotheque de graphiques", () => {
  const CHARTS = join(dirname(fileURLToPath(import.meta.url)), "..", "charts");

  it("les traces n'importent que du local et React", () => {
    for (const f of readdirSync(CHARTS)) {
      const src = readFileSync(join(CHARTS, f), "utf8");
      for (const m of src.matchAll(/from\s+"([^"]+)"/g)) {
        const cible = m[1] as string;
        expect(
          cible.startsWith(".") || cible === "react",
          `${f} importe ${cible} — un graphique ne depend de rien d'autre`,
        ).toBe(true);
      }
    }
  });
});
