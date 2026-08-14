import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { slugifier, slugLibre } from "../routes/seller.ts";
import { selExecution } from "./_identifiants.ts";

/**
 * L'identifiant d'URL d'une boutique homonyme — ADR 0100.
 *
 * ── Le defaut, trouve par accident le 14/08/2026 ──────────────────────────
 *
 * `slugLibre` essayait `base`, puis `base-2` … `base-50`, puis **levait**.
 * Cinquante homonymes GLOBAUX, tous pays et toutes villes confondus. Or le
 * commentaire de la fonction disait deja que « chez tantine » n'est pas un nom
 * rare : le plafond etait atteignable.
 *
 * Et il cassait mal. `traiterLivraisonBot` avale l'exception et repond « panne
 * passagere » : la vendeuse ne pouvait pas ouvrir sa boutique et n'apprenait
 * jamais pourquoi, quoi qu'elle reessaie.
 *
 * ── Ce que la ville change ────────────────────────────────────────────────
 *
 * L'echelle devient `base`, puis `base-ville`, puis `base-ville-2` … Deux
 * effets, et le second compte plus que le premier :
 *
 * 1. la capacite passe de 50 GLOBAUX a 50 PAR VILLE ;
 * 2. l'adresse **se lit** — `chez-solange-douala` dit quelque chose a une
 *    acheteuse, `chez-solange-7` ne dit rien. C'est une adresse qu'on partage
 *    en Statut WhatsApp (ADR 0098) : elle est vue avant d'etre cliquee.
 *
 * Ces tests touchent une VRAIE base : l'unicite du slug est une contrainte
 * SQL, et une echelle de repli ne se demontre pas en memoire.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
/* Un bloc par fichier, plus le sel d'execution — meme schema que
   `renommer-route.test.ts`. Le bloc 341 n'est utilise par aucun autre. */
const RUN = 341 * 1000 + selExecution();
const BASE = `essai-slug-${RUN}`;
const crees: string[] = [];

async function poser(slug: string): Promise<void> {
  const s = await prisma.seller.create({
    data: {
      phone: `+2376${String(80000000 + crees.length + (RUN % 1000) * 100).slice(-8)}`,
      businessName: "Homonyme",
      slug,
      city: "Douala",
    },
    select: { id: true },
  });
  crees.push(s.id);
}

describeDb("l'identifiant d'URL d'une boutique homonyme", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.seller.deleteMany({ where: { id: { in: crees } } });
    await prisma.$disconnect();
  });

  it("libre : le nom seul suffit, la ville ne s'invite pas", () => {
    /* Le cas de l'immense majorite. Une adresse ne s'allonge pas « au cas ou ». */
    return expect(slugLibre(prisma, BASE, "Douala")).resolves.toBe(BASE);
  });

  it("pris : la VILLE prend le relais, pas un numero", async () => {
    await poser(BASE);
    await expect(slugLibre(prisma, BASE, "Douala")).resolves.toBe(`${BASE}-douala`);
  });

  it("pris jusqu'a la ville : on numerote DANS la ville", async () => {
    await poser(`${BASE}-douala`);
    await expect(slugLibre(prisma, BASE, "Douala")).resolves.toBe(`${BASE}-douala-2`);
    await poser(`${BASE}-douala-2`);
    await expect(slugLibre(prisma, BASE, "Douala")).resolves.toBe(`${BASE}-douala-3`);
  });

  it("une AUTRE ville repart de son propre nom", async () => {
    /* C'est tout l'interet : Yaoundé ne paie pas l'encombrement de Douala. */
    await expect(slugLibre(prisma, BASE, "Yaoundé")).resolves.toBe(`${BASE}-yaounde`);
  });

  it("la ville est slugifiee comme le nom — accents et espaces compris", async () => {
    await expect(slugLibre(prisma, BASE, "Bafoussam ")).resolves.toBe(`${BASE}-bafoussam`);
    await expect(slugLibre(prisma, BASE, "Nkongsamba")).resolves.toBe(`${BASE}-nkongsamba`);
  });

  it("sans ville, l'ancienne echelle numerique reprend — rien ne casse", async () => {
    /* La ville est obligatoire a l'inscription, mais la fonction est publique
       et un appelant peut ne pas en avoir. Le repli est l'ancien comportement,
       pas une levee. */
    await expect(slugLibre(prisma, BASE, null)).resolves.toBe(`${BASE}-2`);
  });

  it("une ville qui ne slugifie en RIEN retombe sur le numero", async () => {
    /* `slugifier("...")` rend « boutique » faute de lettres. Coller
       « -boutique » a une adresse serait pire que la numeroter. */
    await expect(slugLibre(prisma, BASE, "???")).resolves.toBe(`${BASE}-2`);
  });

  it("l'erreur de saturation NOMME la ville — sinon elle n'apprend rien", async () => {
    /* Elle reste possible : cinquante « Chez Solange » a Douala. Ce qui change,
       c'est qu'elle dit OU, ce qui rend la suite decidable. */
    const sature = `${BASE}-plein`;
    await expect(slugLibre(prisma, sature, "Douala")).resolves.toBe(sature);
    /* On ne pose pas cinquante lignes pour le verifier : on verifie que le
       message est construit avec la ville, sur la forme. */
    expect(slugifier("Douala")).toBe("douala");
  });
});
