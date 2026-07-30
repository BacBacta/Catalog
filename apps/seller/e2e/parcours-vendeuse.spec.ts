import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * Le parcours vendeuse complet, contre un VRAI serveur.
 *
 * Ce que ces tests prouvent, et qu'aucun test unitaire ne peut prouver :
 *
 *  - le parcours entier tient bout a bout — numero, code, session, profil,
 *    reglage du reversement — avec le fournisseur SMS factice ;
 *  - **le collage fonctionne dans le champ OTP**, avec un vrai `Ctrl+V` du vrai
 *    presse-papiers du navigateur. C'est le critere WCAG 2.2 §3.3.8, et un
 *    `onPaste` qui appelle `preventDefault` est invisible partout ailleurs ;
 *  - `autocomplete="one-time-code"` est bien pose sur le champ rendu : c'est ce
 *    qui declenche la proposition automatique du code par le clavier ;
 *  - la limitation de debit bloque a la quatrieme demande, **vue de l'ecran** ;
 *  - un changement de reversement sans le bon code est refuse, et le numero ne
 *    bouge pas.
 *
 * Les tests sont ignores sans `DATABASE_URL` : c'est une dependance
 * d'environnement, pas une regression.
 */

const AVEC_BASE = !!process.env.DATABASE_URL;
const API = "http://127.0.0.1:8787";

/**
 * Numeros uniques par execution. Les tables d'audit sont en ajout seul : on ne
 * nettoie pas, donc on ne reutilise pas. Le decalage par indice de test evite
 * aussi que deux navigateurs paralleles se disputent le meme numero.
 */
function numeros(graine: number) {
  // National a NEUF chiffres : `+237` puis un prefixe a deux chiffres et sept
  // chiffres. Les prefixes ne sont pas quelconques — 67 est MTN, 69 est Orange
  // (voir `operateurDuNumero`) — et le reversement en prend un DIFFERENT de
  // celui de la connexion : la double SIM est le cas normal, pas l'exception.
  const n = (prefixe: string, decalage: number) =>
    `+237${prefixe}${((graine + decalage) % 10000000).toString().padStart(7, "0")}`;
  return { connexion: n("67", 0), reversement: n("69", 4242) };
}

/**
 * Chaque test se declare sa propre adresse.
 *
 * Sans cela, tous les tests partagent l'adresse de la boucle locale et la limite
 * PAR ADRESSE — douze demandes par heure — les fait echouer les uns apres les
 * autres, dans un ordre qui depend du parallelisme. Ce n'est pas un defaut du
 * limiteur : c'est le limiteur qui fonctionne. Donner une adresse par test isole
 * les comptages, et rend au passage la dimension « par adresse » observable.
 */
async function adressePropre(page: Page, graine: number) {
  const o = (d: number) => (((graine >> d) % 250) + 1).toString();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `41.202.${o(8)}.${o(0)}` });
}

/** Le fournisseur factice garde les messages ; l'API les relit ici. */
async function dernierCode(page: Page, numero: string): Promise<string> {
  const r = await page.request.get(`${API}/api/dev/dernier-code`, { params: { numero } });
  expect(r.ok(), `aucun code retrouve pour ${numero}`).toBe(true);
  const { code } = (await r.json()) as { code: string };
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

async function demanderCode(page: Page, numero: string) {
  await page.goto("/connexion");
  await page.getByLabel("Numero de telephone").fill(numero);
  await page.getByRole("button", { name: "Recevoir le code" }).click();
}

test.describe("parcours vendeuse", () => {
  test.skip(!AVEC_BASE, "DATABASE_URL absente : l'API n'est pas lancee");

  test("de la saisie du numero au reglage du reversement", async ({ page }, info) => {
    const graine = (Date.now() % 9000000) + info.workerIndex * 1000;
    const { connexion, reversement } = numeros(graine);
    await adressePropre(page, graine);

    /* ── 1. le numero ───────────────────────────────────────────────── */
    await demanderCode(page, connexion);
    await expect(page.getByRole("heading", { name: "Votre code", level: 1 })).toBeVisible();
    // Le numero survit a un rechargement : il est dans l'URL, pas dans un etat.
    await page.reload();
    await expect(page.getByText(connexion)).toBeVisible();

    /* ── 2. le code, COLLE ──────────────────────────────────────────── */
    const code = await dernierCode(page, connexion);
    const champ = page.getByLabel("Code reçu par SMS");

    // Le collage passe par le vrai presse-papiers : c'est le seul moyen de
    // prouver qu'aucun gestionnaire ne l'intercepte.
    await page.evaluate((t) => navigator.clipboard.writeText(t), code);
    await champ.click();
    await page.keyboard.press("ControlOrMeta+v");
    await expect(champ).toHaveValue(code);

    // Et l'auto-remplissage SMS est declare sur le champ rendu.
    await expect(champ).toHaveAttribute("autocomplete", "one-time-code");
    await expect(champ).toHaveAttribute("inputmode", "numeric");

    await page.getByRole("button", { name: "Me connecter" }).click();

    /* ── 3. le profil, demande et non devine ────────────────────────── */
    await expect(page.getByRole("heading", { name: "Votre boutique", level: 1 })).toBeVisible();
    await page.getByLabel("Nom de la boutique").fill("Chez Tantine");
    await page.getByLabel("Ville").fill("Douala");
    await page.getByRole("button", { name: "Ouvrir ma boutique" }).click();

    /* ── 4. la session ──────────────────────────────────────────────── */
    await expect(page.getByRole("heading", { name: "Chez Tantine", level: 1 })).toBeVisible();
    await expect(page.getByText(connexion)).toBeVisible();
    await expect(page.getByTestId("reversement-actuel")).toHaveText("aucun");

    // Elle survit a un rechargement complet : le cookie est de meme origine.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Chez Tantine", level: 1 })).toBeVisible();

    /* ── 5. le reversement ──────────────────────────────────────────── */
    await page.getByRole("link", { name: "Regler mon numero de reversement" }).click();
    await expect(
      page.getByRole("heading", { name: "Numero de reversement", level: 1 }),
    ).toBeVisible();

    // Une mise en forme humaine doit passer : personne n'ecrit en E.164.
    const humain = `${reversement.slice(4, 7)} ${reversement.slice(7, 9)} ${reversement.slice(9, 11)} ${reversement.slice(11)}`;
    await page.getByLabel("Nouveau numero de reversement").fill(humain);
    await page.getByRole("button", { name: "Recevoir le code" }).click();

    // Un code FAUX ne deplace rien, et l'ecran le dit.
    const champReversement = page.getByLabel("Code reçu sur le nouveau numéro");
    await champReversement.fill("000000");
    await page.getByRole("button", { name: "Confirmer ce numero" }).click();
    await expect(page.getByText("Ce code ne correspond pas. Verifiez le SMS.")).toBeVisible();
    await expect(page.getByTestId("reversement-actuel")).toHaveText("aucun");

    // Le bon code, lui, le deplace.
    const codeReversement = await dernierCode(page, reversement);
    await champReversement.fill(codeReversement);
    await page.getByRole("button", { name: "Confirmer ce numero" }).click();

    await expect(page.getByRole("heading", { name: "Chez Tantine", level: 1 })).toBeVisible();
    await expect(page.getByTestId("reversement-actuel")).toHaveText(reversement);
    // Le numero de reversement est bien DISTINCT de celui de connexion.
    expect(reversement).not.toBe(connexion);

    /* ── 6. la deconnexion ──────────────────────────────────────────── */
    await page.getByRole("button", { name: "Me deconnecter" }).click();
    await expect(page.getByRole("heading", { name: "Connexion", level: 1 })).toBeVisible();
  });

  test("la limitation de debit bloque a la quatrieme demande, et l'ecran l'explique", async ({
    page,
  }, info) => {
    const graine = (Date.now() % 9000000) + 500000 + info.workerIndex * 1000;
    const { connexion } = numeros(graine);
    await adressePropre(page, graine);

    for (let i = 1; i <= 3; i++) {
      await demanderCode(page, connexion);
      await expect(
        page.getByRole("heading", { name: "Votre code", level: 1 }),
        `demande ${i}`,
      ).toBeVisible();
    }

    await demanderCode(page, connexion);
    // On reste sur l'ecran de saisie, avec un message qui dit quoi faire.
    await expect(page.getByRole("heading", { name: "Connexion", level: 1 })).toBeVisible();
    await expect(page.getByText(/Trop de demandes pour ce numero/)).toBeVisible();
  });

  test("un ecran protege ne s'ouvre pas sans session", async ({ page }) => {
    await page.goto("/reversement");
    await expect(page.getByRole("heading", { name: "Connexion", level: 1 })).toBeVisible();
  });

  test("aucune violation axe-core bloquante sur les ecrans d'authentification", async ({
    page,
  }, info) => {
    const graine = (Date.now() % 9000000) + 700000 + info.workerIndex * 1000;
    const { connexion } = numeros(graine);
    await adressePropre(page, graine);

    for (const aller of [
      async () => {
        await page.goto("/connexion");
      },
      async () => {
        await demanderCode(page, connexion);
      },
    ]) {
      await aller();
      const r = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const bloquantes = r.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        bloquantes.map((v) => `${v.id} — ${v.nodes.length} nœud(s)`),
        page.url(),
      ).toEqual([]);
    }
  });
});
