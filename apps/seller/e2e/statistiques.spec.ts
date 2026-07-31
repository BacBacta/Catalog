import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { connecter } from "./aide.ts";

/**
 * L'ecran statistiques, tel qu'il est rendu.
 *
 * ── Ce que ce fichier couvre, et ce qu'il ne couvre PAS ──────────────────
 *
 * Le serveur est deja couvert contre une VRAIE base par `stats-route.test.ts` :
 * cloisonnement entre vendeuses, bornes de la fenetre, comblement des jours
 * creux, `null` plutot que zero sur une boutique vide, conformite au schema
 * partage. Rien de tout cela n'est reteste ici.
 *
 * Ce fichier verifie les quatre criteres de la definition de terminé du lot 13,
 * qui portent tous sur l'INTERFACE et qu'aucun test de serveur ne peut voir :
 *
 * 1. chaque graphique a une vue tableau consultable ;
 * 2. aucune bibliotheque de graphiques n'est chargee a l'execution ;
 * 3. l'ecran respecte son budget JS — mesure par `scripts/budget.mjs`, et
 *    verifie ici sous l'angle « le paquet est bien charge a la demande » ;
 * 4. axe-core ne trouve aucune violation bloquante, **vues tableau ouvertes
 *    comprises** — c'est le point que le lot souligne, et une suite qui ne
 *    testerait que l'etat ferme laisserait les tableaux hors controle.
 *
 * Les reponses de l'API sont simulees : ce qui est mesure — ce que l'ecran dit,
 * ce qu'il n'invente pas, et son accessibilite — n'en depend pas, et les
 * fixtures permettent de fixer les cas penibles (une boutique vide, une serie
 * plate) qu'une vraie base ne produirait pas a la demande.
 */

const JOURS = 30;

/** Trente jours, un sommet au douzieme, quelques creux — de quoi tracer. */
function serie(valeurs: number[]) {
  return valeurs.map((valeur, i) => ({
    jour: `2026-07-${String(i + 1).padStart(2, "0")}`,
    valeur,
  }));
}

const VUES = serie(
  Array.from({ length: JOURS }, (_, i) => (i === 12 ? 28 : i % 7 === 0 ? 0 : (i % 5) + 1)),
);
const COMMANDES = serie(Array.from({ length: JOURS }, (_, i) => (i % 6 === 0 ? 1 : 0)));

const STATS = {
  periode: { du: "2026-07-01", au: "2026-07-30", jours: JOURS },
  partVentesProuvees: { prouve: 5, contresigne: 3, nonTrace: 4, total: 12, pourcent: 67 },
  vuesParJour: VUES,
  commandesParJour: COMMANDES,
  entonnoir: [
    { cle: "vues", libelle: "Articles vus", valeur: 214, pourcentPrecedent: null },
    { cle: "commandes", libelle: "Commandes passées", valeur: 18, pourcentPrecedent: 8 },
    { cle: "payees", libelle: "Commandes payées", valeur: 12, pourcentPrecedent: 67 },
    { cle: "prouvees", libelle: "Paiements prouvés", valeur: 8, pourcentPrecedent: 67 },
  ],
  articlesLesPlusVus: [
    { id: "a1", nom: "Pagne wax 6 yards", vues: 96 },
    { id: "a2", nom: "Foulard imprimé", vues: 54 },
    { id: "a3", nom: "Sac raphia", vues: 38 },
  ],
  instrumentation: { vuesInstrumentees: false },
};

const VIDE = {
  ...STATS,
  partVentesProuvees: { prouve: 0, contresigne: 0, nonTrace: 0, total: 0, pourcent: null },
  vuesParJour: serie(Array.from({ length: JOURS }, () => 0)),
  commandesParJour: serie(Array.from({ length: JOURS }, () => 0)),
  entonnoir: [
    { cle: "vues", libelle: "Articles vus", valeur: 0, pourcentPrecedent: null },
    { cle: "commandes", libelle: "Commandes passées", valeur: 0, pourcentPrecedent: 0 },
    { cle: "payees", libelle: "Commandes payées", valeur: 0, pourcentPrecedent: 0 },
    { cle: "prouvees", libelle: "Paiements prouvés", valeur: 0, pourcentPrecedent: 0 },
  ],
  articlesLesPlusVus: [],
};

async function servir(page: Page, stats: unknown = STATS) {
  await page.route("**/api/statistiques*", async (route) => {
    await route.fulfill({ json: stats });
  });
}

async function ouvrir(page: Page, graine: number, stats: unknown = STATS) {
  await connecter(page, graine, `Boutique stats ${graine}`);
  await servir(page, stats);
  await page.goto("/statistiques");
  await expect(page.getByRole("heading", { name: "Vos chiffres", level: 1 })).toBeVisible();
  /**
   * Attendre le TITRE ne suffit pas : `Ecran` le peint des l'etat de chargement.
   * Les assertions de contenu se reessaient toutes seules et masquaient le
   * probleme ; un `count()` ne se reessaie pas et lisait zero graphique. On
   * attend donc le premier trace.
   */
  await expect(page.locator("[data-slot='graphique']").first()).toBeVisible();
}

const graineDe = (info: { workerIndex: number }, decalage: number) =>
  (Date.now() % 9000000) + decalage + info.workerIndex * 1000;

/* ══════════════ ce que l'ecran raconte ══════════════ */

test.describe("l'ecran statistiques", () => {
  test("ouvre sur la part des ventes prouvees, decomposee en trois", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 7_100_000));

    // Le chiffre qui mesure le produit lui-meme, en premier et en grand.
    await expect(page.getByTestId("tuile-part-prouvee")).toContainText("67");

    // Trois classes, chacune nommee ET chiffree : la couleur ne porte jamais
    // l'information seule.
    const carte = page.getByTestId("tuile-part-prouvee").locator("..");
    await expect(carte).toContainText("Contresigné par l'acheteuse");
    await expect(carte).toContainText("Prouvé par SMS");
    await expect(carte).toContainText("Non tracé");
  });

  /**
   * Une boutique sans vente lit « rien a mesurer », jamais « 0 % ». Zero se
   * lirait « aucune de mes ventes n'est prouvee » — une accusation, sur une
   * vendeuse qui n'a simplement encore rien vendu.
   */
  test("une boutique vide ne dit jamais zero pour cent", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 7_200_000), VIDE);
    const tuile = page.getByTestId("tuile-part-prouvee");
    await expect(tuile).toContainText("Rien à mesurer");
    await expect(tuile).not.toContainText("0 %");
  });

  test("l'entonnoir nomme la marche ou ca fuit le plus", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 7_300_000));
    // 8 % de vues → commandes est la pire des trois transitions.
    await expect(page.getByTestId("marche-faible")).toContainText("commandes passées");
    await expect(page.getByTestId("marche-faible")).toContainText("8");
  });

  /**
   * Le point qui distingue un chiffre honnete d'un chiffre faux. La boutique
   * publique est statique : rien ne compte ses pages vues. Une vendeuse qui
   * lirait « 0 vue » sans cet avertissement arbitrerait son budget dessus.
   */
  test("dit que les vues ne sont pas encore comptees", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 7_400_000));
    await expect(page.getByTestId("vues-non-instrumentees")).toContainText("pas encore comptées");
  });

  test("dit qu'il ne mesure pas les sources de trafic, au lieu d'en inventer", async ({
    page,
  }, info) => {
    await ouvrir(page, graineDe(info, 7_500_000));
    await expect(page.getByTestId("sources-de-trafic-absentes")).toContainText(
      "Nous ne le mesurons pas encore",
    );
  });

  test("le selecteur de periode cadre TOUS les graphiques a la fois", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 7_600_000));

    const demandes: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/statistiques")) demandes.push(r.url());
    });

    await page.getByRole("button", { name: "7 jours" }).click();
    await expect
      .poll(() => demandes.filter((u) => u.includes("jours=7")).length)
      .toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "7 jours" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Une seule rangee de filtres, en dehors de tout graphique : aucun filtre
    // par carte, sinon deux chiffres de deux fenetres se liraient cote a cote.
    await expect(page.getByRole("group", { name: "Période observée" })).toHaveCount(1);
  });
});

/* ══════════════ la vue tableau ══════════════ */

test.describe("chaque graphique a sa vue tableau", () => {
  test("il y a autant de tableaux que de graphiques, et ils s'ouvrent", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 7_700_000));

    const graphiques = page.locator("[data-slot='graphique']");
    const tableaux = page.locator("[data-slot='graphique'] details");
    const n = await graphiques.count();
    expect(n, "l'ecran doit porter plusieurs graphiques").toBeGreaterThanOrEqual(4);
    expect(await tableaux.count(), "un graphique sans vue tableau").toBe(n);

    for (let i = 0; i < n; i++) {
      const details = tableaux.nth(i);
      await expect(details.locator("table")).toBeHidden();
      await details.locator("summary").click();
      await expect(details.locator("table")).toBeVisible();
    }
  });

  test("les tableaux portent des en-tetes de colonne ET de ligne", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 7_800_000));
    await ouvrirTousLesTableaux(page);

    const tables = page.locator("[data-slot='graphique'] table");
    for (let i = 0; i < (await tables.count()); i++) {
      await expect(tables.nth(i).locator("th[scope='col']").first()).toBeVisible();
      await expect(tables.nth(i).locator("th[scope='row']").first()).toBeVisible();
    }
  });

  test("le tableau porte les valeurs que le trace ne nomme pas", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 7_900_000));
    await ouvrirTousLesTableaux(page);
    // Le sommet des vues — 28 le 13/07 — n'est etiquete qu'une fois sur la
    // courbe, mais chaque jour actif est dans le tableau.
    const tableauVues = page
      .locator("[data-slot='graphique']", { hasText: "Vues de vos articles" })
      .locator("table");
    await expect(tableauVues).toContainText("13/07");
    await expect(tableauVues).toContainText("28");
  });

  test("la commande d'ouverture atteint la cible tactile de 44px", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 8_000_000));
    const resumes = page.locator("[data-slot='graphique'] summary");
    const trop_petites: string[] = [];
    for (let i = 0; i < (await resumes.count()); i++) {
      const box = await resumes.nth(i).boundingBox();
      if (box && box.height < 44)
        trop_petites.push(`${await resumes.nth(i).innerText()} h=${box.height}`);
    }
    expect(trop_petites, `commandes sous 44px : ${trop_petites.join(", ")}`).toEqual([]);
  });
});

/* ══════════════ les traces ══════════════ */

test.describe("les regles de trace", () => {
  test("la grille est en filet plein — aucun pointille", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 8_100_000));
    expect(await page.locator("svg line[stroke-dasharray]").count()).toBe(0);
  });

  test("les dates ne sont pas ecrites sur chaque point", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 8_200_000));
    const svg = page.locator("[data-slot='graphique'] svg").first();
    const dates = await svg.locator("text").allInnerTexts();
    const jours = dates.filter((t) => /^\d{2}\/\d{2}$/.test(t));
    expect(jours.length, `${jours.length} dates sur la courbe`).toBeLessThanOrEqual(3);
  });

  /**
   * Le critere « aucune bibliotheque de graphiques » se verifie en dependance
   * (`packages/ui/src/__tests__/pas-de-bibliotheque-de-graphiques.test.ts`) et se
   * confirme ici a l'execution : aucune de leurs empreintes globales connues
   * n'apparait sur la page.
   */
  test("aucune bibliotheque de graphiques n'est chargee a l'execution", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 8_300_000));
    const presentes = await page.evaluate(() =>
      ["Chart", "d3", "Highcharts", "ApexCharts", "echarts", "Plotly", "uPlot"].filter(
        (nom) => (window as unknown as Record<string, unknown>)[nom] !== undefined,
      ),
    );
    expect(presentes, `objets globaux trouves : ${presentes.join(", ")}`).toEqual([]);
  });

  /**
   * L'ecran est charge a la demande, et c'est ce qui rend son budget mesurable :
   * son code forme un paquet a part que `scripts/budget.mjs` pese seul. Si le
   * decoupage se cassait, tout continuerait de marcher et le budget ne
   * mesurerait plus rien — d'ou ce controle a l'execution.
   */
  test("le code de l'ecran arrive dans son propre paquet", async ({ page }, info) => {
    const paquets: string[] = [];
    page.on("response", (r) => {
      const u = r.url();
      if (u.includes("/assets/") && u.endsWith(".js")) paquets.push(u);
    });
    await ouvrir(page, graineDe(info, 8_400_000));
    expect(
      paquets.some((u) => /Statistiques-[\w-]+\.js/.test(u)),
      `paquets charges : ${paquets.join(", ")}`,
    ).toBe(true);
  });
});

/* ══════════════ accessibilite ══════════════ */

async function ouvrirTousLesTableaux(page: Page) {
  const resumes = page.locator("[data-slot='graphique'] summary");
  for (let i = 0; i < (await resumes.count()); i++) await resumes.nth(i).click();
  await expect(page.locator("[data-slot='graphique'] table").first()).toBeVisible();
}

async function violationsBloquantes(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test.describe("axe-core", () => {
  test("aucune violation bloquante, graphiques fermes", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 8_500_000));
    const bloquantes = await violationsBloquantes(page);
    if (bloquantes.length) {
      await info.attach("axe-ferme", {
        body: JSON.stringify(bloquantes, null, 2),
        contentType: "application/json",
      });
    }
    expect(bloquantes.map((v) => `${v.id} (${v.impact}) × ${v.nodes.length}`)).toEqual([]);
  });

  /**
   * Le critere que le lot souligne. Un `<details>` ferme cache son contenu :
   * axe ne l'inspecte pas, et une suite qui s'arreterait la laisserait QUATRE
   * tableaux entiers hors controle.
   */
  test("aucune violation bloquante, TOUTES les vues tableau ouvertes", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 8_600_000));
    await ouvrirTousLesTableaux(page);

    const bloquantes = await violationsBloquantes(page);
    if (bloquantes.length) {
      await info.attach("axe-tableaux", {
        body: JSON.stringify(bloquantes, null, 2),
        contentType: "application/json",
      });
    }
    expect(bloquantes.map((v) => `${v.id} (${v.impact}) × ${v.nodes.length}`)).toEqual([]);
  });

  test("aucune violation bloquante sur une boutique vide", async ({ page }, info) => {
    await ouvrir(page, graineDe(info, 8_700_000), VIDE);
    await ouvrirTousLesTableaux(page);
    expect((await violationsBloquantes(page)).map((v) => v.id)).toEqual([]);
  });
});

test("capture de l'ecran entier", async ({ page }, info) => {
  await ouvrir(page, graineDe(info, 8_800_000));
  await page.waitForTimeout(300);
  const nom = info.project.name;
  await page.screenshot({ path: info.outputPath(`statistiques-${nom}.png`), fullPage: true });
  await info.attach(`statistiques-${nom}`, {
    path: info.outputPath(`statistiques-${nom}.png`),
    contentType: "image/png",
  });
});
