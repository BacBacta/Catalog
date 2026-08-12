import { randomBytes } from "node:crypto";
import {
  IMAGE_TAILLE_MAX_OCTETS,
  productDraftSchema,
  productOrderSchema,
  productPatchSchema,
} from "@catalog/contracts";
import type { PrismaClient } from "@catalog/db";
import { Hono } from "hono";
import { reencoderImage } from "../adapters/image-pipeline.ts";
import { MESSAGE_REFUS_IMAGE } from "../domain/image.ts";
import { cleOpaque, declinaisons, type ObjectStorage } from "../domain/storage.ts";
import { type SessionDeps, vendeuseCourante } from "./seller.ts";

/**
 * Le catalogue de la vendeuse : creation, modification, archivage,
 * reordonnancement, et la chaine d'images.
 *
 * Deux regles gouvernent tout ce fichier :
 *
 * 1. **L'identite vient de la SESSION.** Aucune route n'accepte un identifiant
 *    de vendeuse depuis le corps ou l'URL. Chaque lecture et chaque ecriture est
 *    filtree par `sellerId`, y compris celles qui portent deja un identifiant
 *    d'article — sinon il suffirait de connaitre un identifiant pour modifier
 *    l'article de quelqu'un d'autre.
 * 2. **On n'efface pas, on archive.** Une vendeuse qui supprime un article dont
 *    des commandes existent effacerait l'histoire de ses ventes. Les lignes de
 *    commande recopient deja nom et prix (lot 3) ; l'archivage garde en plus la
 *    possibilite de remettre l'article en vente.
 */

/** Duree de validite des URL de lecture. Assez pour un affichage, pas pour un partage. */
export const DUREE_URL_SIGNEE_S = 15 * 60;

export interface ProductDeps {
  prisma: PrismaClient;
  session: SessionDeps;
  storage: ObjectStorage;
  maintenant?: () => Date;
  alea?: (n: number) => Uint8Array;
  /**
   * La reconstruction de la boutique publique — ADR 0065. ABSENTE par defaut :
   * sans crochet, rien n'est demande. Un article cree depuis l'app doit
   * peri mer la page web exactement comme un article cree depuis le fil,
   * sinon la moitie des chemins laisse la boutique en retard.
   */
  reconstruction?: { demander(motif: "article_publie"): Promise<boolean> } | null;
}

const CHAMPS = {
  id: true,
  name: true,
  priceXaf: true,
  stock: true,
  description: true,
  imageKey: true,
  imageWidth: true,
  imageHeight: true,
  imageBytes: true,
  position: true,
  archivedAt: true,
  createdAt: true,
} as const;

type LigneProduit = {
  id: string;
  name: string;
  priceXaf: number;
  stock: number;
  description: string | null;
  imageKey: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageBytes: number | null;
  position: number;
  archivedAt: Date | null;
  createdAt: Date;
};

/**
 * Serialise un article, URL d'images comprises.
 *
 * Les URL sont signees **a la lecture** et jamais stockees : une URL persistee
 * serait perimee la moitie du temps, et l'autre moitie elle constituerait un lien
 * public permanent vers un objet qui ne doit pas l'etre.
 */
async function serialiser(storage: ObjectStorage, p: LigneProduit) {
  const images = p.imageKey
    ? await (async () => {
        const d = declinaisons(p.imageKey as string);
        const [avif, webp] = await Promise.all([
          storage.urlSignee(d.avif, DUREE_URL_SIGNEE_S),
          storage.urlSignee(d.webp, DUREE_URL_SIGNEE_S),
        ]);
        return { avif, webp };
      })()
    : null;

  return {
    id: p.id,
    name: p.name,
    priceXaf: p.priceXaf,
    stock: p.stock,
    description: p.description,
    position: p.position,
    archive: p.archivedAt !== null,
    image: images
      ? {
          ...images,
          largeur: p.imageWidth,
          hauteur: p.imageHeight,
          octets: p.imageBytes,
        }
      : null,
  };
}

export function productRoutes(deps: ProductDeps) {
  const r = new Hono();
  const alea = deps.alea ?? ((n: number) => new Uint8Array(randomBytes(n)));
  const now = () => deps.maintenant?.() ?? new Date();

  /** Session résolue en identifiant de vendeuse, ou refus HTTP prêt à renvoyer. */
  async function contexte(
    req: Request,
  ): Promise<{ sellerId: string } | { erreur: string; statut: 401 | 409 }> {
    const v = await vendeuseCourante(deps.session, req);
    if (!v) return { erreur: "non_authentifiee", statut: 401 };
    if (!v.seller) return { erreur: "profil_absent", statut: 409 };
    return { sellerId: v.seller.id };
  }

  /**
   * Session ET appartenance de l'article.
   *
   * Renvoyer le meme 404 pour « n'existe pas » et « n'est pas a vous » est
   * volontaire : un 403 apprendrait a un attaquant que l'identifiant est valide.
   */
  async function contexteArticle(
    req: Request,
    productId: string,
  ): Promise<
    { sellerId: string; produit: LigneProduit } | { erreur: string; statut: 401 | 404 | 409 }
  > {
    const ctx = await contexte(req);
    if ("erreur" in ctx) return ctx;
    const p = await deps.prisma.product.findFirst({
      where: { id: productId, sellerId: ctx.sellerId },
      select: CHAMPS,
    });

    /* La page web porte le catalogue : un article de plus la perime. Jamais
       fatal — l'article est enregistre, la page suivra. */
    await deps.reconstruction?.demander("article_publie").catch(() => false);
    if (!p) return { erreur: "article_introuvable", statut: 404 };
    return { sellerId: ctx.sellerId, produit: p };
  }

  /* ────────────────────────── liste ────────────────────────── */

  /**
   * Liste des articles. Une seule requete, triee par l'index
   * `(seller_id, position)`. La definition de terminé du lot 5 exige moins de
   * 100 ms sur le seed : un test le mesure.
   */
  r.get("/", async (c) => {
    const ctx = await contexte(c.req.raw);
    if ("erreur" in ctx) return c.json({ erreur: ctx.erreur }, ctx.statut);

    const avecArchives = c.req.query("archives") === "1";
    const lignes = await deps.prisma.product.findMany({
      where: { sellerId: ctx.sellerId, ...(avecArchives ? {} : { archivedAt: null }) },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: CHAMPS,
    });

    return c.json({ articles: await Promise.all(lignes.map((p) => serialiser(deps.storage, p))) });
  });

  /* ────────────────────────── creation ────────────────────────── */

  r.post("/", async (c) => {
    const ctx = await contexte(c.req.raw);
    if ("erreur" in ctx) return c.json({ erreur: ctx.erreur }, ctx.statut);

    const corps = await c.req.json().catch(() => null);
    const parse = productDraftSchema.safeParse(corps);
    if (!parse.success) {
      return c.json({ erreur: "brouillon_invalide", message: parse.error.issues[0]?.message }, 422);
    }

    // Le nouvel article se place a la FIN : l'ordre que la vendeuse a compose ne
    // doit pas bouger parce qu'elle en ajoute un.
    const dernier = await deps.prisma.product.aggregate({
      where: { sellerId: ctx.sellerId },
      _max: { position: true },
    });

    const p = await deps.prisma.product.create({
      data: {
        sellerId: ctx.sellerId,
        name: parse.data.name,
        priceXaf: parse.data.priceXaf,
        ...(parse.data.stock !== undefined ? { stock: parse.data.stock } : {}),
        // Une chaine vide veut dire « pas de description », pas « description vide ».
        ...(parse.data.description !== undefined
          ? { description: parse.data.description || null }
          : {}),
        position: (dernier._max.position ?? -1) + 1,
      },
      select: CHAMPS,
    });
    return c.json(await serialiser(deps.storage, p), 201);
  });

  /* ────────────────────────── modification ────────────────────────── */

  r.patch("/:id", async (c) => {
    const ctx = await contexteArticle(c.req.raw, c.req.param("id"));
    if ("erreur" in ctx) return c.json({ erreur: ctx.erreur }, ctx.statut);

    const corps = await c.req.json().catch(() => null);
    const parse = productPatchSchema.safeParse(corps);
    if (!parse.success) {
      return c.json(
        { erreur: "modification_invalide", message: parse.error.issues[0]?.message },
        422,
      );
    }

    // Les champs se posent un a un : `exactOptionalPropertyTypes` interdit de
    // passer `{ name: undefined }`, et Prisma le lirait de toute facon comme
    // « ne change pas », ce qui masquerait une erreur d'appel.
    const p = await deps.prisma.product.update({
      where: { id: ctx.produit.id },
      data: {
        ...(parse.data.name !== undefined ? { name: parse.data.name } : {}),
        ...(parse.data.priceXaf !== undefined ? { priceXaf: parse.data.priceXaf } : {}),
        ...(parse.data.stock !== undefined ? { stock: parse.data.stock } : {}),
        ...(parse.data.description !== undefined
          ? { description: parse.data.description || null }
          : {}),
      },
      select: CHAMPS,
    });
    return c.json(await serialiser(deps.storage, p));
  });

  /* ────────────────────────── archivage ────────────────────────── */

  r.post("/:id/archiver", async (c) => {
    const ctx = await contexteArticle(c.req.raw, c.req.param("id"));
    if ("erreur" in ctx) return c.json({ erreur: ctx.erreur }, ctx.statut);
    const p = await deps.prisma.product.update({
      where: { id: ctx.produit.id },
      data: { archivedAt: ctx.produit.archivedAt ?? now() },
      select: CHAMPS,
    });
    return c.json(await serialiser(deps.storage, p));
  });

  r.post("/:id/restaurer", async (c) => {
    const ctx = await contexteArticle(c.req.raw, c.req.param("id"));
    if ("erreur" in ctx) return c.json({ erreur: ctx.erreur }, ctx.statut);
    const p = await deps.prisma.product.update({
      where: { id: ctx.produit.id },
      data: { archivedAt: null },
      select: CHAMPS,
    });
    return c.json(await serialiser(deps.storage, p));
  });

  /* ────────────────────────── reordonnancement ────────────────────────── */

  /**
   * L'ordre arrive COMPLET, et s'ecrit dans une seule transaction.
   *
   * Deux reordonnancements concurrents laisseraient sinon des positions en
   * double, et l'ordre affiche a la vendeuse ne serait plus celui qu'elle a pose.
   * Les identifiants inconnus ou appartenant a une autre vendeuse sont ignores en
   * silence par le filtrage — mais on refuse la requete si tous le sont, parce
   * que c'est le signe d'un appel qui se trompe de vendeuse.
   */
  r.post("/ordre", async (c) => {
    const ctx = await contexte(c.req.raw);
    if ("erreur" in ctx) return c.json({ erreur: ctx.erreur }, ctx.statut);

    const parse = productOrderSchema.safeParse(await c.req.json().catch(() => null));
    if (!parse.success) {
      return c.json({ erreur: "ordre_invalide", message: parse.error.issues[0]?.message }, 422);
    }

    const miens = await deps.prisma.product.findMany({
      where: { id: { in: parse.data.ids }, sellerId: ctx.sellerId },
      select: { id: true },
    });
    const aMoi = new Set(miens.map((p) => p.id));
    const ordonnes = parse.data.ids.filter((id) => aMoi.has(id));
    if (ordonnes.length === 0) {
      return c.json({ erreur: "aucun_article_reconnu" }, 404);
    }

    await deps.prisma.$transaction(
      ordonnes.map((id, position) =>
        deps.prisma.product.update({ where: { id }, data: { position } }),
      ),
    );

    const lignes = await deps.prisma.product.findMany({
      where: { sellerId: ctx.sellerId, archivedAt: null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: CHAMPS,
    });
    return c.json({ articles: await Promise.all(lignes.map((p) => serialiser(deps.storage, p))) });
  });

  /* ────────────────────────── image ────────────────────────── */

  /**
   * Televersement d'une photo.
   *
   * Le corps est un `multipart/form-data` avec un champ `photo`. Le serveur ne
   * croit **ni** le nom du fichier, **ni** son `Content-Type` : la signature
   * binaire fait foi, et l'image est entierement re-encodee.
   *
   * La reponse porte le poids REELLEMENT stocke. Ce n'est pas de la telemetrie :
   * c'est ce que l'ecran affiche a la vendeuse (« 701 Ko → 80 Ko »), et c'est son
   * forfait data.
   */
  r.post("/:id/image", async (c) => {
    const ctx = await contexteArticle(c.req.raw, c.req.param("id"));
    if ("erreur" in ctx) return c.json({ erreur: ctx.erreur }, ctx.statut);

    // Borne AVANT lecture, quand l'en-tete la donne : lire huit megaoctets pour
    // les refuser ensuite est du travail offert.
    const annonce = Number(c.req.header("content-length") ?? 0);
    if (annonce > IMAGE_TAILLE_MAX_OCTETS * 1.2) {
      return c.json(
        { erreur: "fichier_trop_gros", message: MESSAGE_REFUS_IMAGE.fichier_trop_gros },
        413,
      );
    }

    let fichier: unknown;
    try {
      fichier = (await c.req.formData()).get("photo");
    } catch {
      return c.json({ erreur: "corps_illisible", message: "L'envoi n'a pas abouti." }, 400);
    }
    if (!(fichier instanceof File)) {
      return c.json({ erreur: "photo_absente", message: "Aucune photo dans l'envoi." }, 422);
    }

    const recus = new Uint8Array(await fichier.arrayBuffer());
    const resultat = await reencoderImage(recus).catch(
      () =>
        ({ ok: false, verdict: { ok: false, raison: "format_non_reconnu" } }) as Awaited<
          ReturnType<typeof reencoderImage>
        >,
    );

    if (!resultat.ok) {
      const raison = resultat.verdict.raison;
      const statut = raison === "fichier_trop_gros" ? 413 : 422;
      return c.json(
        {
          erreur: raison,
          message: MESSAGE_REFUS_IMAGE[raison],
          ...(resultat.verdict.detecte ? { detecte: resultat.verdict.detecte } : {}),
        },
        statut,
      );
    }

    const base = cleOpaque(alea);
    const d = declinaisons(base);
    await Promise.all([
      deps.storage.put({ cle: d.avif, corps: resultat.image.avif, contentType: "image/avif" }),
      deps.storage.put({ cle: d.webp, corps: resultat.image.webp, contentType: "image/webp" }),
      // La declinaison des canaux sans AVIF ni WebP — le bot WhatsApp (ADR 0032).
      deps.storage.put({ cle: d.jpg, corps: resultat.image.jpeg, contentType: "image/jpeg" }),
    ]);

    // L'ancienne image part APRES que la nouvelle est en place : l'inverse
    // laisserait un article sans photo si le second envoi echouait.
    const ancienne = ctx.produit.imageKey;

    const p = await deps.prisma.product.update({
      where: { id: ctx.produit.id },
      data: {
        imageKey: base,
        imageWidth: resultat.image.largeur,
        imageHeight: resultat.image.hauteur,
        imageBytes: resultat.image.avif.length,
      },
      select: CHAMPS,
    });

    if (ancienne && ancienne !== base) {
      const vieux = declinaisons(ancienne);
      // Un echec de suppression ne doit pas faire echouer un envoi reussi : la
      // photo est en place, c'est ce qui compte pour la vendeuse.
      await Promise.allSettled([
        deps.storage.supprimer(vieux.avif),
        deps.storage.supprimer(vieux.webp),
        deps.storage.supprimer(vieux.jpg),
      ]);
    }

    return c.json({
      article: await serialiser(deps.storage, p),
      image: {
        cle: base,
        largeur: resultat.image.largeur,
        hauteur: resultat.image.hauteur,
        octets: resultat.image.avif.length,
        octetsWebp: resultat.image.webp.length,
        octetsRecus: recus.length,
        typeEntree: resultat.image.typeEntree,
      },
    });
  });

  return r;
}
