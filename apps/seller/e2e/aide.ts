import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { expect, type Page } from "@playwright/test";

/**
 * Outils partages par les suites de bout en bout.
 *
 * Ils sont ici et pas recopies dans chaque fichier pour une raison precise : les
 * numeros et les adresses doivent etre uniques PAR EXECUTION, et deux
 * implementations divergentes de cette regle produiraient des echecs
 * intermittents qu'on mettrait des heures a comprendre.
 */

export const API = "http://127.0.0.1:8787";

/**
 * Numeros uniques par execution.
 *
 * National a NEUF chiffres : `+237` puis un prefixe a deux chiffres et sept
 * chiffres. Les prefixes ne sont pas quelconques — 67 est MTN, 69 est Orange
 * (voir `operateurDuNumero`) — et le reversement en prend un DIFFERENT de celui
 * de la connexion : la double SIM est le cas normal, pas l'exception.
 *
 * Les tables d'audit sont en ajout seul : on ne nettoie pas, donc on ne reutilise
 * pas.
 */
export function numeros(graine: number) {
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
 * limiteur : c'est le limiteur qui fonctionne.
 */
export async function adressePropre(page: Page, graine: number) {
  const o = (d: number) => (((graine >> d) % 250) + 1).toString();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `41.202.${o(8)}.${o(0)}` });
}

/** Le fournisseur factice garde les messages ; l'API les relit ici. */
export async function dernierCode(page: Page, numero: string): Promise<string> {
  const r = await page.request.get(`${API}/api/dev/dernier-code`, { params: { numero } });
  expect(r.ok(), `aucun code retrouve pour ${numero}`).toBe(true);
  const { code } = (await r.json()) as { code: string };
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

export async function demanderCode(page: Page, numero: string) {
  await page.goto("/connexion");
  await page.getByLabel("Numero de telephone").fill(numero);
  await page.getByRole("button", { name: "Recevoir le code" }).click();
}

/**
 * Demande un code et s'assure qu'on est bien arrive a l'ecran de saisie.
 *
 * Sans ce controle, un envoi refuse — limitation de debit, numero invalide —
 * echouerait plus loin sur « aucun code retrouve », c'est-a-dire sur un symptome
 * qui ne dit rien de la cause. Ici, le message affiche a la vendeuse est dans le
 * rapport d'echec.
 */
export async function demanderCodeEtVerifier(page: Page, numero: string) {
  await demanderCode(page, numero);
  const enErreur = page.locator('[role="status"]', { hasText: /\S/ });
  await expect(
    page.getByRole("heading", { name: "Votre code", level: 1 }),
    async () => `l'envoi du code a echoue : ${(await enErreur.allInnerTexts()).join(" | ")}`,
  ).toBeVisible();
}

/**
 * Parcours de connexion complet, profil compris.
 *
 * Le code est **colle** et non tape : c'est le geste reel, et un test qui tape
 * ne verifierait pas la regle WCAG 2.2 §3.3.8 que la suite d'authentification
 * couvre explicitement.
 */
export async function connecter(page: Page, graine: number, boutique = "Chez Tantine") {
  const { connexion } = numeros(graine);
  await adressePropre(page, graine);
  await demanderCodeEtVerifier(page, connexion);

  const code = await dernierCode(page, connexion);
  const champ = page.getByLabel("Code reçu par SMS");
  await page.evaluate((t) => navigator.clipboard.writeText(t), code);
  await champ.click();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(champ).toHaveValue(code);
  await page.getByRole("button", { name: "Me connecter" }).click();

  await expect(page.getByRole("heading", { name: "Votre boutique", level: 1 })).toBeVisible();
  await page.getByLabel("Nom de la boutique").fill(boutique);
  await page.getByLabel("Ville").fill("Douala");
  await page.getByRole("button", { name: "Ouvrir ma boutique" }).click();
  await expect(page.getByRole("heading", { name: boutique, level: 1 })).toBeVisible();

  return { connexion, boutique };
}

/* ────────────────────────── fabrique de PNG ────────────────────────── */

function crc32(donnees: Buffer): number {
  let c = 0xffffffff;
  for (const octet of donnees) {
    c ^= octet;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, corps: Buffer): Buffer {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(corps.length);
  const nomEtCorps = Buffer.concat([Buffer.from(type, "ascii"), corps]);
  const somme = Buffer.alloc(4);
  somme.writeUInt32BE(crc32(nomEtCorps));
  return Buffer.concat([longueur, nomEtCorps, somme]);
}

/**
 * PNG de bruit, fabrique a la main.
 *
 * **Pourquoi pas une image de test versionnee** : un depot qui embarque des
 * binaires grossit sans qu'on le voie, et une photo reelle porterait des
 * metadonnees — dont, sur une photo de telephone, des coordonnees GPS.
 *
 * **Pourquoi du bruit** : c'est incompressible, donc la taille du fichier est
 * previsible et proche de la taille brute. Un degrade produirait un fichier de
 * quelques kilooctets, et le test ne televerserait pas les deux megaoctets que la
 * definition de terminé demande.
 *
 * **Pourquoi pas `sharp`** : ce paquet est celui de l'app vendeuse, qui n'a
 * aucune raison de dependre d'une bibliotheque de traitement d'images serveur.
 */
export function pngDeBruit(largeur: number, hauteur: number, graine = 1): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 2; // couleur vraie, RVB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parLigne = 1 + largeur * 3;
  const brut = Buffer.alloc(hauteur * parLigne);

  /**
   * Le bruit vient d'une fonction de hachage en mode compteur, et non d'un
   * generateur a congruence lineaire.
   *
   * C'est mesure, pas theorique : avec un generateur congruentiel, les octets de
   * poids faible ont une periode tres courte, `deflate` les recompresse, et une
   * image de 1000x800 censee peser 2,4 Mo n'en pese que 0,4. Le test ne
   * televerserait alors pas les deux megaoctets que la definition de terminé
   * demande. Le hachage est DETERMINISTE — meme graine, meme image — donc le
   * poids attendu ne varie pas d'une execution a l'autre.
   */
  const pixels = largeur * hauteur * 3;
  const flot = Buffer.alloc(pixels + 32);
  for (let i = 0, n = 0; i < pixels; i += 32, n++) {
    createHash("sha256").update(`${graine}:${n}`).digest().copy(flot, i);
  }

  for (let y = 0; y < hauteur; y++) {
    const base = y * parLigne;
    brut[base] = 0; // filtre « aucun » : sans lui, la compression annulerait le bruit
    flot.copy(brut, base + 1, y * largeur * 3, (y + 1) * largeur * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(brut, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
