import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { connecter } from "./aide.ts";

/**
 * Le cycle de vie d'une commande, vu de l'ecran.
 *
 * ── Ce que ce fichier couvre, et ce qu'il ne couvre PAS ──────────────────
 *
 * Le serveur est deja couvert par seize tests contre une vraie base
 * (`commandes-route.test.ts`) : propriete inter-vendeuses, recul journalise
 * puis ignore, solde qui barre la remise, invariant `amount_paid + balance =
 * total`, et l'avis verifie refuse a un paiement declare a la main.
 *
 * Ici on verifie ce qu'aucun test de serveur ne peut voir : **le comportement
 * OPTIMISTE et son retour arriere**, le fait que l'argent ne l'est jamais, les
 * deux chemins d'encaissement cote a cote, les quatre etats, et
 * l'accessibilite de l'ecran rendu.
 *
 * Les reponses de l'API sont donc simulees par `page.route`, comme
 * `preuve.spec.ts` l'a etabli au lot 10 — et pour la meme raison, qui n'a pas
 * disparu : **il n'existe pas de route de creation de commande.** Le blueprint
 * du lot 11 ne la demande pas (liste, avancement, tuile, suivi, message,
 * declaration), et le seed ne cree pas de compte d'authentification, donc
 * aucune commande existante n'est atteignable par une connexion reelle. Un
 * parcours de bout en bout contre un vrai serveur reste donc a faire, et il
 * demande une decision de perimetre qui n'appartient pas a ce lot.
 */

const BASE = {
  id: "cmd-1",
  reference: "CT-1043",
  acheteuse: { nom: "Adama", telephone: "+237699000113" },
  totalXaf: 26800,
  dejaPayeXaf: 13400,
  resteXaf: 13400,
  modePaiement: "acompte",
  etape: "preparee",
  etatPreuve: "prouve",
  modeLivraison: "livraison",
  livraison: { mode: "livraison" },
  codeVerification: "DEFG-4679",
  annuleeA: null,
  creeA: "2026-07-30T08:00:00.000Z",
  etapesPossibles: ["preparee", "chez_le_livreur", "livree"],
  soldeAEncaisserXaf: 13400,
  avisVerifiePossible: false,
};

/** Liste servie a l'ecran, avec le total que la tuile doit afficher. */
async function servirListe(page: import("@playwright/test").Page, commande = BASE) {
  await page.route("**/api/commandes", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: { commandes: [commande], soldesAEncaisserXaf: commande.soldeAEncaisserXaf },
    });
  });
}

test.describe("cycle de vie d'une commande", () => {
  test("la liste montre l'etape, le solde, et le total a encaisser", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 1_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique cycle ${graine}`);
    await servirListe(page);
    await page.goto("/commandes");

    await expect(page.getByTestId("soldes-a-encaisser")).toContainText("13");
    await expect(page.getByTestId("etape")).toHaveText("Preparee");
    await expect(page.getByRole("button", { name: "Confiee au livreur" })).toBeVisible();
  });

  /**
   * L'avancement est optimiste : la ligne se repeint AVANT la reponse. On tient
   * la reponse en attente pour l'observer — sans cela, le test passerait aussi
   * sur une interface qui attend le serveur.
   */
  test("l'avancement repeint la ligne AVANT la reponse du serveur", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 2_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique cycle ${graine}`);
    await servirListe(page);

    let relacher: (() => void) | null = null;
    const attente = new Promise<void>((r) => {
      relacher = r;
    });
    await page.route("**/api/commandes/cmd-1/etape", async (route) => {
      await attente;
      await route.fulfill({ json: { ...BASE, etape: "chez_le_livreur" } });
    });

    await page.goto("/commandes");
    await page.getByRole("button", { name: "Confiee au livreur" }).click();

    // Repeinte immediatement, alors que le serveur n'a pas encore repondu.
    await expect(page.getByTestId("etape")).toHaveText("Confiee au livreur");
    relacher?.();
    await expect(page.getByTestId("etape")).toHaveText("Confiee au livreur");
  });

  /**
   * LE test du lot sur l'optimisme : un refus doit DEFAIRE la peinture et le
   * DIRE. Une interface qui restaure l'ancien etat en silence laisse la
   * vendeuse croire qu'elle a mal clique.
   */
  test("un refus revient en arriere VISIBLEMENT, avec la raison", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 3_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique cycle ${graine}`);
    await servirListe(page, { ...BASE, etape: "chez_le_livreur" });
    await page.route("**/api/commandes/cmd-1/etape", (route) =>
      route.fulfill({
        status: 409,
        json: { erreur: "solde_ouvert", raison: "solde_ouvert", etape: "chez_le_livreur" },
      }),
    );

    await page.goto("/commandes");
    await page.getByRole("button", { name: "Remise a votre client/e" }).click();

    await expect(page.getByRole("status").filter({ hasText: "CT-1043" })).toContainText(
      /solde a encaisser/i,
    );
    await expect(page.getByTestId("etape")).toHaveText("Confiee au livreur");
  });

  /**
   * L'argent n'est JAMAIS optimiste. On tient la reponse : tant qu'elle n'est
   * pas arrivee, le solde affiche reste l'ancien.
   */
  test("le solde ne bouge pas avant que le serveur ait repondu", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 4_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique cycle ${graine}`);
    await servirListe(page);

    let relacher: (() => void) | null = null;
    const attente = new Promise<void>((r) => {
      relacher = r;
    });
    await page.route("**/api/commandes/cmd-1/paiement-declare", async (route) => {
      await attente;
      await route.fulfill({
        json: {
          ...BASE,
          dejaPayeXaf: 26800,
          resteXaf: 0,
          soldeAEncaisserXaf: 0,
          etatPreuve: "declare_non_trace",
          trace: false,
          aRendreXaf: 0,
        },
      });
    });

    await page.goto("/commandes");
    await page.getByRole("button", { name: "Declarer un paiement recu" }).click();
    await page.getByRole("button", { name: "Enregistrer ce paiement" }).click();

    // Le solde est toujours l'ancien : rien n'a ete peint d'avance.
    await expect(page.getByTestId("soldes-a-encaisser")).toContainText("13");
    relacher?.();
    await expect(page.getByTestId("soldes-a-encaisser")).toContainText("0");
    await expect(page.getByText("Paiement non trace")).toBeVisible();
  });

  test("les deux chemins d'encaissement sont proposes cote a cote", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 5_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique cycle ${graine}`);
    await servirListe(page);
    await page.goto("/commandes");

    await expect(page.getByRole("button", { name: "Declarer un paiement recu" })).toBeVisible();
    await expect(page.getByRole("link", { name: "J'ai le SMS" })).toBeVisible();
  });

  test("un montant a virgule est refuse des l'ecran", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 6_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique cycle ${graine}`);
    await servirListe(page);
    await page.goto("/commandes");

    await page.getByRole("button", { name: "Declarer un paiement recu" }).click();
    await page.getByLabel("Montant recu").fill("13400,5");
    await page.getByRole("button", { name: "Enregistrer ce paiement" }).click();
    await expect(page.getByRole("status").filter({ hasText: /virgule/i })).toBeVisible();
  });

  test("l'etat vide se montre plutot qu'une page blanche", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 7_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique cycle ${graine}`);
    await page.route("**/api/commandes", (route) =>
      route.fulfill({ json: { commandes: [], soldesAEncaisserXaf: 0 } }),
    );
    await page.goto("/commandes");
    await expect(page.getByText("Aucune commande")).toBeVisible();
  });

  test("aucune violation axe-core bloquante sur l'ecran des commandes", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 8_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique cycle ${graine}`);
    await servirListe(page);
    await page.goto("/commandes");
    await expect(page.getByTestId("etape")).toBeVisible();

    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(r.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual(
      [],
    );
  });
});
