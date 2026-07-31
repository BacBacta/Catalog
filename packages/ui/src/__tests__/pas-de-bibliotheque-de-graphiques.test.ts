import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Aucune bibliotheque de graphiques dans les dependances.** C'est un critere
 * de la definition de terminé du lot 13, et il est ici parce qu'un critere qui
 * ne s'execute pas se perd au troisieme lot suivant.
 *
 * La raison n'est pas doctrinale, elle est mesurable : la plus legere des
 * bibliotheques de graphiques pese plus que le budget JS ENTIER de la boutique
 * publique — 30 Ko compresses pour tout le chemin critique. Meme du cote
 * vendeuse, ou le budget est plus large, elle apporterait un moteur de rendu
 * complet pour tracer quatre formes qu'on ecrit en deux cents lignes.
 *
 * Le controle est en deux temps :
 *
 * 1. **une liste nommee** des paquets connus, celle qu'un agent presse
 *    installerait de reflexe ;
 * 2. **un motif de nom**, pour ceux qui n'existent pas encore. Une dependance
 *    qui s'appelle `quelquechose-charts` sera refusee sans qu'il faille avoir
 *    prevu son nom.
 *
 * Le second attrape ce que le premier ne peut pas prevoir. Le premier attrape ce
 * que le second laisse passer — `d3`, `victory`, `visx` ne portent aucun mot
 * revelateur dans leur nom.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const NOMMEES = [
  "chart.js",
  "react-chartjs-2",
  "recharts",
  "victory",
  "@nivo/core",
  "apexcharts",
  "react-apexcharts",
  "echarts",
  "plotly.js",
  "react-plotly.js",
  "@visx/visx",
  "chartist",
  "highcharts",
  "uplot",
  "billboard.js",
  "frappe-charts",
  "britecharts",
  "c3",
  "d3",
  "@observablehq/plot",
  "vega",
  "vega-lite",
  "react-vega",
  "@amcharts/amcharts5",
  "lightweight-charts",
];

/** Ce que le nom trahit, pour les paquets qui n'existent pas encore. */
const MOTIF = /(^|[-/@.])(charts?|graphs?|plotly|dataviz|d3)([-.]|$)/i;

/** Tous les `package.json` du depot, hors `node_modules`. */
function manifestes(dossier: string, trouves: string[] = []): string[] {
  for (const nom of readdirSync(dossier)) {
    if (nom === "node_modules" || nom === ".git" || nom === "dist" || nom === ".astro") continue;
    const p = join(dossier, nom);
    if (statSync(p).isDirectory()) manifestes(p, trouves);
    else if (nom === "package.json") trouves.push(p);
  }
  return trouves;
}

const MANIFESTES = manifestes(RACINE);

interface Dependance {
  manifeste: string;
  paquet: string;
}

const TOUTES: Dependance[] = MANIFESTES.flatMap((m) => {
  const json = JSON.parse(readFileSync(m, "utf8")) as Record<string, Record<string, string>>;
  const relatif = m.slice(RACINE.length + 1);
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap(
    (bloc) => Object.keys(json[bloc] ?? {}).map((paquet) => ({ manifeste: relatif, paquet })),
  );
});

describe("aucune bibliotheque de graphiques dans les dependances", () => {
  it("trouve bien des manifestes a inspecter", () => {
    // Sans ce garde, un chemin casse ferait passer les deux controles suivants
    // sur une liste vide — et le test le plus dangereux est celui qui ne teste
    // rien.
    expect(MANIFESTES.length).toBeGreaterThanOrEqual(7);
    expect(TOUTES.length).toBeGreaterThan(30);
  });

  it("aucun paquet de la liste nommee", () => {
    const coupables = TOUTES.filter((d) => NOMMEES.includes(d.paquet)).map(
      (d) => `${d.paquet} (${d.manifeste})`,
    );
    expect(coupables, `bibliotheque de graphiques installee : ${coupables.join(", ")}`).toEqual([]);
  });

  it("aucun paquet dont le nom trahit un moteur de graphiques", () => {
    const coupables = TOUTES.filter((d) => MOTIF.test(d.paquet)).map(
      (d) => `${d.paquet} (${d.manifeste})`,
    );
    expect(coupables, `nom suspect : ${coupables.join(", ")}`).toEqual([]);
  });

  it("les deux controles attrapent bien des cas connus", () => {
    // Le garde du garde : un motif casse ferait passer les tests ci-dessus en
    // silence, sur tout le depot.
    for (const nom of ["recharts", "d3", "chart.js"]) {
      expect(NOMMEES.includes(nom), nom).toBe(true);
    }
    for (const nom of ["maison-charts", "@acme/chart", "super-graph", "vue-dataviz", "d3-scale"]) {
      expect(MOTIF.test(nom), nom).toBe(true);
    }
    // Et ils ne se declenchent pas sur les dependances legitimes du depot.
    for (const nom of ["react", "astro", "hono", "zod", "prisma", "@base-ui/react", "sharp"]) {
      expect(MOTIF.test(nom) || NOMMEES.includes(nom), nom).toBe(false);
    }
  });
});
