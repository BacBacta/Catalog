import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { connecter } from "./aide.ts";

/**
 * Le recu verifiable, de bout en bout — les QUATRE ecrans du lot 10.
 *
 * 1. la page publique `/v/<code>`, sur la boutique ;
 * 2. le suivi de l'acheteuse `/suivi/<jeton>`, avec la contre-signature ;
 * 3. l'ecran vendeuse « verifier un recu » ;
 * 4. le refus explicite, sur chacun des trois.
 *
 * **Les reponses de l'API sont simulees.** Ce n'est pas un raccourci : le
 * serveur est deja couvert par seize tests contre une vraie base — refus nommes,
 * contre-signature, contestation, jeton distinct du code —, et ce qu'on mesure
 * ici (axe-core sur l'ecran rendu, ce qui est ecrit et ce qui ne l'est pas) n'en
 * depend pas. Creer une commande complete demanderait les routes du lot 11.
 */

const AVEC_BASE = !!process.env.DATABASE_URL;
const BOUTIQUE = "http://127.0.0.1:4174";

const RECU = {
  reference: "CT-1043",
  code: "ACDE-4679",
  boutique: "Chez Maman Jeanne",
  operateur: { cle: "mtn", nom: "MTN Mobile Money" },
  operatorTxId: "17600000002",
  montantXaf: 26800,
  totalXaf: 26800,
  resteXaf: 0,
  survenuA: "2026-06-23T08:50:32.000Z",
  constateA: "2026-06-23T08:52:00.000Z",
  contresigneA: null,
  etat: "prouve",
  aConfirmer: false,
  marcheAsuivre: {
    codeOperateur: "*126#",
    codeVerifie: true,
    etapes: ["Composez le code ci-dessus.", "Demandez l'historique de vos transactions."],
    etapesAConfirmer: true,
  },
};

const PORTEE =
  "Ce reçu n'est pas une preuve informatique : c'est un identifiant de transaction que " +
  "l'opérateur peut confirmer, apporté par la personne dont l'argent est en jeu.";

async function auditer(page: Page, etape: string) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const bloquantes = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bloquantes.map((v) => `${v.id} — ${v.nodes.length} nœud(s)`),
    etape,
  ).toEqual([]);
}

/* ═══════════════ 1. la page publique de verification ═══════════════ */

test.describe("page publique /v/", () => {
  test("affiche l'identifiant de transaction et comment le controler", async ({ page }) => {
    await page.route("**/api/recu/**", (r) =>
      r.fulfill({
        json: { recu: RECU, portee: PORTEE },
        headers: { "content-type": "application/json" },
      }),
    );

    await page.goto(`${BOUTIQUE}/v/?c=ACDE-4679`);
    await expect(page.getByTestId("recu")).toBeVisible();

    // L'identifiant, c'est LUI qui se controle.
    await expect(page.getByTestId("identifiant")).toHaveText("17600000002");
    await expect(page.getByTestId("code-operateur")).toHaveText("*126#");

    // Le code d'operateur vient de la configuration de la rampe, pas d'un
    // gabarit : la page ne l'invente pas, elle l'affiche.
    await expect(page.getByText("Demandez l'historique de vos transactions.")).toBeVisible();

    // Ce que le recu vaut, dit en toutes lettres.
    await expect(page.getByTestId("portee")).toContainText("n'est pas une preuve informatique");

    // JAMAIS un certificat.
    await expect(page.locator("body")).not.toContainText(/garanti|certifié/i);

    await auditer(page, "reçu affiché");
  });

  test("un code inconnu produit un refus EXPLICITE, avec la consigne", async ({ page }) => {
    await page.route("**/api/recu/**", (r) =>
      r.fulfill({
        status: 404,
        json: { refus: "code_inconnu" },
        headers: { "content-type": "application/json" },
      }),
    );

    await page.goto(`${BOUTIQUE}/v/?c=ACDE-4679`);
    await expect(page.getByTestId("refus-code_inconnu")).toBeVisible();
    // Une page vide laisserait croire a une panne. Ici on dit quoi faire.
    await expect(page.getByTestId("refus-code_inconnu")).toContainText("n'expédiez rien");

    await auditer(page, "refus affiché");
  });

  test("un depot declare a la main n'a pas de recu, et l'ecran le dit", async ({ page }) => {
    await page.route("**/api/recu/**", (r) =>
      r.fulfill({
        status: 404,
        json: { refus: "declare_non_trace", etat: "declare_non_trace" },
        headers: { "content-type": "application/json" },
      }),
    );
    await page.goto(`${BOUTIQUE}/v/?c=ACDE-4679`);
    await expect(page.getByTestId("refus-declare_non_trace")).toBeVisible();
    await expect(page.getByTestId("refus-declare_non_trace")).toContainText(
      "aucun SMS d'opérateur",
    );
  });
});

/* ═══════════════ 2. le suivi et la contre-signature ═══════════════ */

test.describe("suivi de l'acheteuse /suivi/", () => {
  const JETON = "a".repeat(32);

  const suivi = (etat: string, contresigneA: string | null) => ({
    reference: "CT-1043",
    boutique: "Chez Maman Jeanne",
    totalXaf: 26800,
    dejaPayeXaf: 26800,
    resteXaf: 0,
    etatPreuve: etat,
    numeroDeVersement: "+237677123456",
    recu: { ...RECU, etat, contresigneA },
    portee: PORTEE,
    actions: { contresigner: etat === "prouve", contester: etat !== "conteste" },
  });

  test("un TAP contresigne, et l'ecran le reflete", async ({ page }) => {
    let contresigne = false;
    await page.route("**/api/suivi/*/contresigner", async (r) => {
      contresigne = true;
      await r.fulfill({
        json: { etat: "contresigne" },
        headers: { "content-type": "application/json" },
      });
    });
    await page.route("**/api/suivi/*", (r) =>
      r.fulfill({
        json: contresigne
          ? suivi("contresigne", "2026-06-23T17:00:00.000Z")
          : suivi("prouve", null),
        headers: { "content-type": "application/json" },
      }),
    );

    await page.goto(`${BOUTIQUE}/suivi/?t=${JETON}`);
    // Deux titres portent la reference : l'entete du suivi et la carte de
    // recu. C'est voulu — la carte est autonome, elle se lit hors contexte.
    await expect(page.getByText("Commande CT-1043").first()).toBeVisible();

    // Un tap, pas un formulaire.
    await page.getByTestId("contresigner").click();
    await expect(page.getByTestId("deja-contresigne")).toBeVisible();
    await expect(page.getByTestId("contresignature")).toContainText("Confirmée le");

    await auditer(page, "suivi contresigné");
  });

  test("l'ecran dit que le lien est personnel", async ({ page }) => {
    // Corollaire assume du « pas de compte requis » : partager ce lien, c'est
    // partager le pouvoir de contresigner. On le dit plutot que de le laisser
    // decouvrir.
    await page.route("**/api/suivi/*", (r) =>
      r.fulfill({ json: suivi("prouve", null), headers: { "content-type": "application/json" } }),
    );
    await page.goto(`${BOUTIQUE}/suivi/?t=${JETON}`);
    await expect(page.getByText(/Ne le transmettez pas/)).toBeVisible();
  });

  test("un lien inconnu ne montre RIEN de la commande", async ({ page }) => {
    await page.route("**/api/suivi/*", (r) =>
      r.fulfill({
        status: 404,
        json: { erreur: "lien_inconnu" },
        headers: { "content-type": "application/json" },
      }),
    );
    await page.goto(`${BOUTIQUE}/suivi/?t=${JETON}`);
    await expect(page.getByTestId("lien-inconnu")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("CT-1043");
    await expect(page.getByTestId("contresigner")).toHaveCount(0);
  });
});

/* ═══════════════ 3. l'ecran vendeuse ═══════════════ */

test.describe("écran vendeuse « vérifier un reçu »", () => {
  test.skip(!AVEC_BASE, "DATABASE_URL absente : l'API n'est pas lancée");

  test("un code valide donne « preuve authentique » avec le détail", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 8_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique verif ${graine}`);

    await page.route("**/api/recu/ACDE4679", (r) =>
      r.fulfill({
        json: { recu: RECU, portee: PORTEE },
        headers: { "content-type": "application/json" },
      }),
    );

    await page.goto("/verifier");
    await page.getByLabel("Code du reçu ou identifiant de transaction").fill("acde-4679");
    await page.getByRole("button", { name: "Vérifier" }).click();

    await expect(page.getByTestId("verdict-recu")).toContainText("Preuve authentique");
    await expect(page.getByTestId("identifiant")).toHaveText("17600000002");
    await expect(page.locator("body")).not.toContainText(/garanti|certifié/i);

    await auditer(page, "reçu authentique");
  });

  test("aucune correspondance dit de NE PAS expédier", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 9_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique verif vide ${graine}`);

    await page.route("**/api/recu/**", (r) =>
      r.fulfill({
        status: 404,
        json: { refus: "code_inconnu" },
        headers: { "content-type": "application/json" },
      }),
    );

    await page.goto("/verifier");
    await page.getByLabel("Code du reçu ou identifiant de transaction").fill("17600000002");
    await page.getByRole("button", { name: "Vérifier" }).click();

    await expect(page.getByTestId("verdict-recu")).toContainText("Aucune preuve ne correspond");
    // La consigne, pas seulement le refus : sans elle, une vendeuse expédie
    // quand même et le produit n'aura servi à rien.
    await expect(
      page.getByText(/N'expédiez pas tant que le paiement n'est pas prouvé/),
    ).toBeVisible();

    await auditer(page, "aucune correspondance");
  });

  test("le collage fonctionne — c'est l'usage entier de ce champ", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + 10_000_000 + info.workerIndex * 1000;
    await connecter(page, graine, `Boutique collage ${graine}`);

    await page.goto("/verifier");
    const champ = page.getByLabel("Code du reçu ou identifiant de transaction");
    await page.evaluate((t) => navigator.clipboard.writeText(t), "ACDE-4679");
    await champ.click();
    await page.keyboard.press("ControlOrMeta+v");
    await expect(champ).toHaveValue("ACDE-4679");
  });
});
