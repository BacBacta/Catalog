import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * Le formulaire d'avis de l'acheteuse — la reserve assumee du lot 12.
 *
 * Le lot 12 a livre le domaine, la route et l'ecran, mais pas de test de bout en
 * bout sur le formulaire : « le point faible du lot », ecrit son propre message
 * de commit. C'est ce fichier.
 *
 * Le serveur est deja couvert par sept tests contre une vraie base — unicite
 * tranchee par la contrainte `Review.orderId`, avis non verifie publie mais hors
 * note, droit au depot calcule cote serveur. Rien de cela n'est reteste ici.
 *
 * Ce que seul un test d'ecran peut voir :
 *
 * 1. **cinq boutons et non un curseur** — on tape d'une main sur un telephone
 *    d'entree de gamme, et chaque bouton porte son intitule en TEXTE ;
 * 2. **l'ecran DIT avant l'envoi si l'avis comptera dans la note**, et il le dit
 *    differemment selon que le paiement est trace ou non. Le decouvrir apres
 *    coup serait une mauvaise surprise sur la seule chose qui compte ici ;
 * 3. **le commentaire est facultatif** : une note seule vaut mieux qu'un
 *    silence, et exiger un texte ferait abandonner ;
 * 4. **le refus d'un second avis est nomme**, pas generique ;
 * 5. **axe-core** sur le formulaire rendu, dans les deux cas.
 */

const BOUTIQUE = "http://127.0.0.1:4174";
const JETON = "b".repeat(32);

const RECU = {
  reference: "CT-2044",
  code: "BCDE-4679",
  boutique: "Chez Maman Jeanne",
  operateur: { cle: "mtn", nom: "MTN Mobile Money" },
  operatorTxId: "17600000042",
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
    etapes: ["Composez le code ci-dessus."],
    etapesAConfirmer: true,
  },
};

/**
 * Un suivi ou le depot d'avis est ouvert.
 *
 * `verifie` suit l'etat de la preuve : un paiement prouve donne un avis
 * « achat verifie », un depot declare a la main donne un avis publie mais hors
 * note. C'est le SERVEUR qui tranche — l'ilot ne fait qu'afficher ce qu'il
 * recoit, et ce test le prend au mot.
 */
function suivi(etatPreuve: string, verifie: boolean) {
  return {
    reference: "CT-2044",
    boutique: "Chez Maman Jeanne",
    totalXaf: 26800,
    dejaPayeXaf: 26800,
    resteXaf: 0,
    etatPreuve,
    numeroDeVersement: "+237677123456",
    ...(etatPreuve === "declare_non_trace" ? {} : { recu: { ...RECU, etat: etatPreuve } }),
    portee: "Ce reçu n'est pas une preuve informatique.",
    actions: { contresigner: false, contester: true },
    avis: { possible: true, verifie },
  };
}

async function ouvrir(page: Page, etatPreuve: string, verifie: boolean) {
  await page.route("**/api/suivi/*", async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    await r.fulfill({
      json: suivi(etatPreuve, verifie),
      headers: { "content-type": "application/json" },
    });
  });
  await page.goto(`${BOUTIQUE}/suivi/?t=${JETON}`);
  await expect(page.getByTestId("depot-avis")).toBeVisible();
}

async function auditer(page: Page, etape: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const bloquantes = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bloquantes.map((v) => `${v.id} — ${v.nodes.length} nœud(s)`),
    etape,
  ).toEqual([]);
}

test.describe("depot d'avis de l'acheteuse", () => {
  test("cinq boutons, chacun avec son intitule en texte", async ({ page }) => {
    await ouvrir(page, "prouve", true);

    for (let n = 1; n <= 5; n++) {
      const bouton = page.getByTestId(`note-${n}`);
      await expect(bouton).toBeVisible();
      // La note ne se lit pas qu'a la couleur d'une etoile : un lecteur d'ecran
      // doit entendre autre chose que « bouton, bouton, bouton ».
      await expect(bouton).not.toHaveText("");
      // Cible tactile : on tape d'une main, souvent en marchant.
      const box = await bouton.boundingBox();
      expect(box?.height ?? 0, `note ${n} sous 44px`).toBeGreaterThanOrEqual(44);
    }
    // Aucun curseur : il se rate au pouce et n'annonce pas sa valeur.
    expect(await page.locator("[data-testid='depot-avis'] input[type='range']").count()).toBe(0);
  });

  test("l'etat selectionne est annonce, pas seulement peint", async ({ page }) => {
    await ouvrir(page, "prouve", true);
    await page.getByTestId("note-4").click();
    await expect(page.getByTestId("note-4")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("note-2")).toHaveAttribute("aria-pressed", "false");
  });

  /**
   * Le point qui distingue cet ecran d'un formulaire d'avis ordinaire. La
   * mention « achat verifie » est ce qui donne sa valeur a la reputation : on
   * dit AVANT l'envoi si l'avis la portera. Le decouvrir apres serait une
   * mauvaise surprise sur la seule chose qui compte ici.
   */
  test("dit AVANT l'envoi que l'avis portera la mention « achat verifie »", async ({ page }) => {
    await ouvrir(page, "prouve", true);
    await expect(page.getByTestId("depot-avis")).toContainText("achat vérifié");
    await expect(page.getByTestId("depot-avis")).toContainText("Votre paiement est tracé");
  });

  /**
   * L'autre moitie de la meme regle, et la plus delicate : un depot direct
   * declare a la main n'est pas BLOQUE. L'acheteuse a recu sa commande et a le
   * droit d'en parler — son avis est publie, sans le label, et n'entre pas dans
   * la note. On ne l'empeche pas, on le distingue.
   */
  test("sur un paiement non trace, l'ecran le dit — et laisse quand meme deposer", async ({
    page,
  }) => {
    await ouvrir(page, "declare_non_trace", false);
    const form = page.getByTestId("depot-avis");
    await expect(form).toContainText("sans la mention");
    await expect(form).toContainText("n'entrera pas dans la note");
    // Deposer reste possible : c'est la regle d'honnetete du lot 12.
    await page.getByTestId("note-5").click();
    await expect(page.getByTestId("envoyer-avis")).toBeEnabled();
  });

  test("le commentaire est facultatif : une note seule part", async ({ page }) => {
    let envoye: unknown = null;
    await page.route("**/api/suivi/*/avis", async (r) => {
      envoye = r.request().postDataJSON();
      // 201, comme le serveur : l'ilot ne passe en « merci » que sur un CREE.
      // Un 200 le laisserait dans l'etat d'envoi, et un test qui simule 200
      // passerait a cote de la vraie condition.
      await r.fulfill({
        status: 201,
        json: { ok: true },
        headers: { "content-type": "application/json" },
      });
    });
    await ouvrir(page, "prouve", true);

    await page.getByTestId("note-5").click();
    await page.getByTestId("envoyer-avis").click();

    await expect(page.getByTestId("avis-depose")).toBeVisible();
    expect(envoye).toMatchObject({ note: 5 });
    // Un texte vide ne part pas comme chaine vide : le champ est absent.
    expect((envoye as { texte?: string }).texte).toBeUndefined();
  });

  test("sans note, l'envoi reste ferme", async ({ page }) => {
    await ouvrir(page, "prouve", true);
    await expect(page.getByTestId("envoyer-avis")).toBeDisabled();
  });

  test("le commentaire ecrit accompagne la note", async ({ page }) => {
    let envoye: unknown = null;
    await page.route("**/api/suivi/*/avis", async (r) => {
      envoye = r.request().postDataJSON();
      // 201, comme le serveur : l'ilot ne passe en « merci » que sur un CREE.
      // Un 200 le laisserait dans l'etat d'envoi, et un test qui simule 200
      // passerait a cote de la vraie condition.
      await r.fulfill({
        status: 201,
        json: { ok: true },
        headers: { "content-type": "application/json" },
      });
    });
    await ouvrir(page, "prouve", true);

    await page.getByTestId("note-4").click();
    await page.locator("[data-testid='depot-avis'] textarea").fill("Livraison rapide, merci !");
    await page.getByTestId("envoyer-avis").click();

    await expect(page.getByTestId("avis-depose")).toBeVisible();
    expect(envoye).toMatchObject({ note: 4, texte: "Livraison rapide, merci !" });
  });

  /**
   * L'unicite est tranchee par la BASE — `Review.orderId` est UNIQUE — et le
   * serveur traduit le conflit en `avis_deja_depose`. L'ecran doit le NOMMER :
   * « une erreur est survenue » ferait reessayer indefiniment.
   */
  test("un second avis est refuse par un message qui dit pourquoi", async ({ page }) => {
    await page.route("**/api/suivi/*/avis", (r) =>
      r.fulfill({
        status: 409,
        json: { erreur: "avis_deja_depose" },
        headers: { "content-type": "application/json" },
      }),
    );
    await ouvrir(page, "prouve", true);

    await page.getByTestId("note-3").click();
    await page.getByTestId("envoyer-avis").click();

    await expect(page.getByTestId("depot-avis")).toContainText("déjà donné votre avis");
    await expect(page.getByTestId("avis-depose")).toHaveCount(0);
  });

  test("le formulaire disparait quand le serveur ne l'ouvre pas", async ({ page }) => {
    // Le droit au depot est calcule par le SERVEUR : l'ilot ne le devine pas.
    await page.route("**/api/suivi/*", (r) =>
      r.fulfill({
        json: { ...suivi("prouve", true), avis: { possible: false, verifie: false } },
        headers: { "content-type": "application/json" },
      }),
    );
    await page.goto(`${BOUTIQUE}/suivi/?t=${JETON}`);
    await expect(page.getByText("Commande CT-2044").first()).toBeVisible();
    await expect(page.getByTestId("depot-avis")).toHaveCount(0);
  });

  test("axe-core ne remonte aucune violation bloquante", async ({ page }) => {
    await ouvrir(page, "prouve", true);
    await auditer(page, "formulaire d'avis, paiement prouvé");

    await ouvrir(page, "declare_non_trace", false);
    await auditer(page, "formulaire d'avis, paiement non tracé");
  });
});
