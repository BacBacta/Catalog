import type { PrismaClient } from "@catalog/db";

/**
 * L'INSTANTANE du catalogue public — la photo dont la boutique statique est
 * construite (lot 6), et la seule forme sous laquelle la base sort d'ici.
 *
 * ── Pourquoi ce module existe, alors que le script existait deja ──────────
 *
 * La requete vivait dans `scripts/exporter-catalogue.mjs`, appele depuis
 * l'integration continue avec `DATABASE_URL`. Depuis l'ADR 0070, l'API SERT
 * aussi l'instantane a la construction, et il devient donc lu de deux endroits.
 * Deux copies de cette requete deriveraient : celle du script publierait un
 * champ que la route ne publie pas, ou l'inverse — et le jour ou l'ecart porte
 * sur un champ SENSIBLE, personne ne le verrait.
 *
 * Le choix des champs est ici, une fois, et les deux chemins le partagent.
 *
 * ── Ce qui n'y entre pas ──────────────────────────────────────────────────
 *
 * Le numero de REVERSEMENT, jamais. C'est le champ qu'un attaquant chercherait
 * a detourner (AGENTS.md §2) ; il n'a rien a faire dans un fichier destine a un
 * CDN. Seul le numero de CONNEXION voyage : c'est celui sur lequel la vendeuse
 * discute, celui du bouton « ecrire a la vendeuse » de sa page.
 */

export interface ArticleInstantane {
  id: string;
  nom: string;
  prixXaf: number;
  stock: number | null;
  variantes: unknown[];
  imageCle: string | null;
  imageLargeur: number | null;
  imageHauteur: number | null;
}

export interface BoutiqueInstantane {
  slug: string;
  nom: string;
  ville: string | null;
  quartier: string | null;
  pointDeRetrait: string | null;
  whatsapp: string;
  reversementVerifie: boolean;
  enConges: boolean;
  notes: number[];
  articles: ArticleInstantane[];
}

export interface Instantane {
  version: 1;
  boutiques: BoutiqueInstantane[];
}

export async function construireInstantane(prisma: PrismaClient): Promise<Instantane> {
  const vendeuses = await prisma.seller.findMany({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
    select: {
      slug: true,
      businessName: true,
      city: true,
      quartier: true,
      pickupPoint: true,
      phone: true,
      payoutPhoneVerifiedAt: true,
      congesDepuis: true,
      products: {
        where: { archivedAt: null },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          priceXaf: true,
          stock: true,
          variants: true,
          imageKey: true,
          imageWidth: true,
          imageHeight: true,
        },
      },
      // Seuls les avis VERIFIES comptent : une note batie sur des avis non
      // verifies serait exactement la reputation achetable que le produit refuse.
      reviews: { where: { verified: true }, select: { rating: true } },
    },
  });

  return {
    version: 1,
    boutiques: vendeuses.map((v) => ({
      slug: v.slug,
      nom: v.businessName,
      ville: v.city,
      quartier: v.quartier,
      pointDeRetrait: v.pickupPoint,
      // Le numero de CONNEXION, pas celui de reversement : c'est celui sur
      // lequel la vendeuse discute, et le reversement ne se publie jamais.
      whatsapp: v.phone,
      reversementVerifie: v.payoutPhoneVerifiedAt !== null,
      // Mode conges — ADR 0039. La boutique reste PUBLIEE : ses pages, ses
      // photos et ses avis continuent d'exister, seule la commande se tait.
      // Une boutique retiree de l'instantane perdrait son referencement et le
      // lien deja partage en Statut renverrait sur une page absente.
      enConges: v.congesDepuis !== null,
      notes: v.reviews.map((r) => r.rating),
      articles: v.products.map((p) => ({
        id: p.id,
        nom: p.name,
        prixXaf: p.priceXaf,
        stock: p.stock,
        variantes: Array.isArray(p.variants) ? p.variants : [],
        imageCle: p.imageKey,
        imageLargeur: p.imageWidth,
        imageHauteur: p.imageHeight,
      })),
    })),
  };
}
