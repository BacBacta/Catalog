import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { connecter } from "./aide.ts";

/**
 * L'ecran « coller le SMS ».
 *
 * **Ce que ce test verifie, et ce qu'il ne verifie pas.** Le serveur est deja
 * couvert par dix-neuf tests contre une vraie base — analyse, sept controles,
 * unicite reseau, chiffrement. Ici on verifie le RENDU : le bandeau permanent,
 * le collage, les explications, et l'accessibilite.
 *
 * La reponse de l'API est donc simulee par `page.route`. Ce n'est pas un
 * raccourci : creer une commande demanderait les routes du lot 11, et ce qu'on
 * mesure ici — axe-core sur l'ecran rendu, le collage reel — ne depend pas du
 * serveur.
 */

const AVEC_BASE = !!process.env.DATABASE_URL;

const COMMANDE = {
  id: "cmd-test",
  ref: "CT-1043",
  totalXaf: 26800,
  balanceXaf: 26800,
  amountPaidXaf: 0,
  proofState: "attendu",
};

/** Un SMS de reception MTN, pseudonymise comme dans les fixtures du serveur. */
const SMS =
  "Vous avez recu 26800 XAF de ALPHA TRADING SARL (237652000001 ) sur votre compte Mobile Money 2026-06-23 09:50:32. Message de l'expediteur:. Votre nouveau solde est de 29398 FCFA. Frais: 0 XAF. Transaction ID: 17600000002.Prix Cassés chez MoMo pour tout le monde !";

const REPONSE_ACCEPTEE = {
  verdict: "accepte",
  checks: [
    { n: 1, id: "format", state: "pass", explanation: "Message reconnu : MTN — réception." },
    { n: 2, id: "montant", state: "pass", explanation: "Le montant du SMS correspond." },
    { n: 3, id: "contrepartie", state: "pass", explanation: "L'expéditeur correspond." },
    { n: 4, id: "horodatage", state: "pass", explanation: "La date est cohérente." },
    { n: 5, id: "unicite", state: "pass", explanation: "Ce paiement n'avait jamais été utilisé." },
    { n: 7, id: "contresignature", state: "pending", explanation: "En attente de l'acheteuse." },
  ],
  resume: {
    operateur: "MTN MoMo",
    operatorTxId: "17600000002",
    montantXaf: 26800,
    aConfirmer: false,
  },
};

test.describe("écran de collage du SMS", () => {
  test.skip(!AVEC_BASE, "DATABASE_URL absente : l'API n'est pas lancée");

  test("le bandeau d'avertissement est permanent, et le collage fonctionne", async ({
    page,
  }, info) => {
    const graine = (Date.now() % 9000000) + 5_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique preuve ${graine}`);

    await page.route("**/api/commandes/cmd-test", (r) =>
      r.fulfill({ json: COMMANDE, headers: { "content-type": "application/json" } }),
    );
    await page.route("**/api/commandes/cmd-test/preuve", (r) =>
      r.fulfill({ json: REPONSE_ACCEPTEE, headers: { "content-type": "application/json" } }),
    );

    await page.goto("/commandes/cmd-test/preuve");
    await expect(
      page.getByRole("heading", { name: "Prouver le paiement", level: 1 }),
    ).toBeVisible();

    /* ── le bandeau, AVANT toute action ── */
    const bandeau = page.getByTestId("bandeau-capture");
    await expect(bandeau).toBeVisible();
    await expect(bandeau).toContainText("Ne vous fiez jamais à une capture d'écran");
    await expect(bandeau).toContainText("Seul votre propre SMS compte");

    /* ── les sept contrôles sont annoncés AVANT le collage ── */
    // La vendeuse voit ce qui va être vérifié : un refus devient compréhensible
    // au lieu d'arbitraire.
    for (const titre of [
      "Message d'opérateur reconnu",
      "Montant conforme",
      "Bon numéro",
      "Date cohérente",
      "Paiement jamais utilisé ailleurs",
      "Identifiant cohérent",
      "Confirmation de l'acheteuse",
    ]) {
      // Texte partiel : `ProofChecklist` numerote les lignes, donc le titre
      // rendu est « 1. Message d'opérateur reconnu En attente ».
      await expect(page.getByText(titre, { exact: false }).first()).toBeVisible();
    }

    /* ── le collage, avec un vrai Ctrl+V ── */
    const champ = page.getByLabel("Collez le SMS de votre opérateur");
    await page.evaluate((t) => navigator.clipboard.writeText(t), SMS);
    await champ.click();
    await page.keyboard.press("ControlOrMeta+v");
    await expect(champ).toHaveValue(SMS);

    await page.getByRole("button", { name: "Vérifier ce paiement" }).click();

    /* ── le verdict et les explications ── */
    await expect(page.getByTestId("verdict")).toContainText("Paiement prouvé");
    await expect(page.getByText("Message reconnu : MTN — réception.")).toBeVisible();
    await expect(page.getByText("Ce paiement n'avait jamais été utilisé.")).toBeVisible();
    // Le contrôle 6 est absent chez MTN : l'écran le dit, plutôt que de le
    // laisser en attente indéfinie.
    await expect(page.getByText(/Sans objet/)).toBeVisible();

    /* ── le champ est vidé : le texte porte le solde du compte ── */
    await expect(champ).toHaveValue("");
    // Et le solde n'est nulle part sur la page.
    await expect(page.locator("body")).not.toContainText("29398");
  });

  test("un refus explique ce qui bloque, en langue simple", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 6_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique refus ${graine}`);

    await page.route("**/api/commandes/cmd-test", (r) =>
      r.fulfill({ json: COMMANDE, headers: { "content-type": "application/json" } }),
    );
    await page.route("**/api/commandes/cmd-test/preuve", (r) =>
      r.fulfill({
        status: 409,
        json: {
          verdict: "refuse",
          checks: [
            { n: 1, id: "format", state: "pass", explanation: "Message reconnu." },
            {
              n: 5,
              id: "unicite",
              state: "fail",
              explanation:
                "Ce paiement a déjà servi à régler une autre commande. Un même transfert ne peut payer qu'une fois.",
            },
          ],
        },
        headers: { "content-type": "application/json" },
      }),
    );

    await page.goto("/commandes/cmd-test/preuve");
    await page.getByLabel("Collez le SMS de votre opérateur").fill(SMS);
    await page.getByRole("button", { name: "Vérifier ce paiement" }).click();

    await expect(page.getByTestId("verdict")).toContainText("n'est pas prouvé");
    // L'explication doit être lisible par une vendeuse, sinon elle expédie quand
    // même et le produit n'aura servi à rien.
    await expect(page.getByText(/Un même transfert ne peut payer qu'une fois/)).toBeVisible();
  });

  test("aucune violation axe-core bloquante, avant et après vérification", async ({
    page,
  }, info) => {
    const graine = (Date.now() % 9000000) + 7_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique axe preuve ${graine}`);

    await page.route("**/api/commandes/cmd-test", (r) =>
      r.fulfill({ json: COMMANDE, headers: { "content-type": "application/json" } }),
    );
    await page.route("**/api/commandes/cmd-test/preuve", (r) =>
      r.fulfill({ json: REPONSE_ACCEPTEE, headers: { "content-type": "application/json" } }),
    );

    await page.goto("/commandes/cmd-test/preuve");
    await expect(page.getByTestId("bandeau-capture")).toBeVisible();

    const auditer = async (etape: string) => {
      const r = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const bloquantes = r.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        bloquantes.map((v) => `${v.id} — ${v.nodes.length} nœud(s)`),
        etape,
      ).toEqual([]);
    };

    await auditer("avant vérification");

    await page.getByLabel("Collez le SMS de votre opérateur").fill(SMS);
    await page.getByRole("button", { name: "Vérifier ce paiement" }).click();
    await expect(page.getByTestId("verdict")).toContainText("Paiement prouvé");

    await auditer("après vérification");
  });
});
