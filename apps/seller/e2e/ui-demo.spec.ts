import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * Verification de la page de demonstration du design system (lot 2).
 *
 * Ce que ces tests prouvent, et qu'un test unitaire ne peut pas prouver :
 *  - la page s'affiche vraiment dans les deux themes, et le choix explicite
 *    l'emporte sur la preference du systeme DANS LES DEUX SENS ;
 *  - les cibles tactiles font 44px une fois RENDUES, pas seulement en CSS ;
 *  - axe-core ne trouve aucune violation bloquante ;
 *  - le collage fonctionne pour de vrai dans le champ de SMS.
 */

const DEMO = "/demo";

/** Attend que la page soit peinte et hydratee. */
async function gotoDemo(page: Page) {
  await page.goto(DEMO);
  await expect(page.getByRole("heading", { name: "Composants", level: 1 })).toBeVisible();
}

test.describe("page de demonstration", () => {
  test("s'affiche, et chaque section est presente", async ({ page }) => {
    await gotoDemo(page);
    for (const titre of [
      "Montants",
      "Pastilles de statut",
      "Boutons",
      "Champs",
      "Coller le SMS de l’opérateur",
      "Les sept contrôles",
      "Onglets",
      "Superpositions",
      "Les quatre états de chaque écran",
    ]) {
      await expect(page.getByRole("heading", { name: titre, level: 2 })).toBeVisible();
    }
  });

  test("les quatre etats obligatoires sont tous montres", async ({ page }) => {
    await gotoDemo(page);
    // Chargement : aria-busy. Vide et hors ligne : status. Erreur : alert.
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByText("Vous êtes hors ligne")).toBeVisible();
    await expect(page.getByText("pas encore d’article")).toBeVisible();
  });

  /**
   * La regle de 44px est dans tokens.css, mais une classe utilitaire qui ne se
   * resout pas la rendrait muette. On mesure donc la geometrie reelle.
   */
  test("toute cible tactile fait au moins 44px une fois rendue", async ({ page }) => {
    await gotoDemo(page);
    const cibles = page.locator("main button, main input, main textarea, main [role='tab']");
    const n = await cibles.count();
    expect(n).toBeGreaterThan(10);

    const trop_petites: string[] = [];
    for (let i = 0; i < n; i++) {
      const el = cibles.nth(i);
      if (!(await el.isVisible())) continue;
      const box = await el.boundingBox();
      if (!box) continue;
      if (box.height < 44) {
        trop_petites.push(`${await el.evaluate((e) => e.tagName)} h=${box.height.toFixed(1)}`);
      }
    }
    expect(trop_petites, `cibles sous 44px : ${trop_petites.join(", ")}`).toEqual([]);
  });

  test("le collage fonctionne dans le champ de SMS", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoDemo(page);

    const SMS =
      "Vous avez recu 26800 XAF de ALPHA TRADING SARL (237652000001 ) sur votre compte Mobile Money";
    const champ = page.getByRole("textbox", { name: /Collez le SMS/ });

    // 1. La saisie directe marche.
    await champ.fill(SMS);
    await expect(champ).toHaveValue(SMS);

    // 2. Le collage clavier n'est pas intercepte.
    await champ.fill("");
    await page.evaluate((t) => navigator.clipboard.writeText(t), SMS);
    await champ.focus();
    await page.keyboard.press("ControlOrMeta+V");
    await expect(champ).toHaveValue(SMS);
  });

  test("le bouton « coller » lit le presse-papiers", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoDemo(page);
    const SMS = "Transfert reussi de 17000 FCFA au 688000001 via Orange Cameroun";
    await page.evaluate((t) => navigator.clipboard.writeText(t), SMS);
    await page.getByRole("button", { name: "Coller" }).click();
    await expect(page.getByRole("textbox", { name: /Collez le SMS/ })).toHaveValue(SMS);
  });

  test("les sept controles affichent leur etat en texte, pas seulement en couleur", async ({
    page,
  }) => {
    await gotoDemo(page);
    const liste = page.locator("[data-slot='proof-checklist']");
    await expect(liste).toBeVisible();
    for (const label of ["Vérifié", "Refusé", "À vérifier", "En attente"]) {
      await expect(liste.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test("axe-core ne remonte aucune violation bloquante", async ({ page }, testInfo) => {
    await gotoDemo(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    const bloquantes = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    if (bloquantes.length) {
      await testInfo.attach("axe", {
        body: JSON.stringify(bloquantes, null, 2),
        contentType: "application/json",
      });
    }
    expect(
      bloquantes.map((v) => `${v.id} (${v.impact}) × ${v.nodes.length}`),
      "violations axe-core bloquantes",
    ).toEqual([]);
  });
});

test.describe("theme", () => {
  test("le choix explicite l'emporte DANS LES DEUX SENS", async ({ page }) => {
    await gotoDemo(page);
    const bg = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim(),
      );

    await page.getByRole("button", { name: "Clair" }).click();
    const clair = await bg();
    await page.getByRole("button", { name: "Sombre" }).click();
    const sombre = await bg();

    expect(clair).not.toBe(sombre);
    // Quel que soit le reglage du systeme, les deux choix restent atteignables :
    // c'est ce que le projet « clair » et le projet « sombre » verifient chacun.
    // Le navigateur peut rendre #ffffff sous la forme abregee #fff : on
    // developpe avant de comparer, sinon le test depend du minificateur.
    const hex6 = (c: string) =>
      /^#[0-9a-f]{3}$/i.test(c.trim())
        ? `#${c
            .trim()
            .slice(1)
            .split("")
            .map((d) => d + d)
            .join("")}`.toLowerCase()
        : c.trim().toLowerCase();

    expect(hex6(clair)).toBe("#ffffff");
    expect(hex6(sombre)).toBe("#1a1a19");
  });

  test("capture de la page entiere", async ({ page }, testInfo) => {
    await gotoDemo(page);
    const nom = testInfo.project.name;
    await page.getByRole("button", { name: nom === "sombre" ? "Sombre" : "Clair" }).click();
    // Laisse les transitions CSS se terminer avant de photographier.
    await page.waitForTimeout(400);
    await page.screenshot({
      path: testInfo.outputPath(`demo-${nom}.png`),
      fullPage: true,
    });
    await testInfo.attach(`demo-${nom}`, {
      path: testInfo.outputPath(`demo-${nom}.png`),
      contentType: "image/png",
    });
  });
});

test("le selecteur affiche le LIBELLE de l'operateur, pas sa valeur brute", async ({ page }) => {
  await gotoDemo(page);
  const trigger = page.locator("[data-slot='select-trigger']");
  await expect(trigger).toContainText("MTN Mobile Money");
  await expect(trigger).not.toContainText(/^mtn$/);
});
