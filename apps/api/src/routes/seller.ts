import { normalizePhone } from "@catalog/contracts";
import type { PrismaClient } from "@catalog/db";
import { Hono } from "hono";

/**
 * La session vendeuse, vue du metier.
 *
 * Better Auth possede le compte (`user`) ; Catalog possede le profil (`seller`).
 * Deux tables, et cette route est la couture entre les deux.
 *
 * **Le profil n'est jamais devine.** Le nom de la boutique et la ville sont
 * demandes a la vendeuse : les inventer afficherait « Ma boutique » sur sa page
 * publique, c'est-a-dire sur ce que ses clientes voient. `GET /moi` renvoie donc
 * `profil: null` tant qu'elle n'a pas repondu, et l'interface pose la question.
 */

export interface SessionDeps {
  prisma: PrismaClient;
  /** `auth.api.getSession`, injecte pour rester testable sans Better Auth. */
  session: (
    req: Request,
  ) => Promise<{ user: { id: string; phoneNumber?: string | null | undefined } } | null>;
}

export interface Vendeuse {
  userId: string;
  loginPhone: string;
  seller: {
    id: string;
    businessName: string;
    slug: string;
    city: string;
    payoutPhone: string | null;
    payoutOperator: string | null;
  } | null;
}

/** Resout la session en profil. `null` = non authentifie, jamais une exception. */
export async function vendeuseCourante(deps: SessionDeps, req: Request): Promise<Vendeuse | null> {
  const s = await deps.session(req);
  if (!s?.user?.id) return null;
  const seller = await deps.prisma.seller.findUnique({
    where: { userId: s.user.id },
    select: {
      id: true,
      businessName: true,
      slug: true,
      city: true,
      payoutPhone: true,
      payoutOperator: true,
    },
  });
  return {
    userId: s.user.id,
    loginPhone: s.user.phoneNumber ?? "",
    seller: seller ?? null,
  };
}

/**
 * Identifiant d'URL de la boutique.
 *
 * Les diacritiques sont retirees : une URL qui porte « é » se partage mal par
 * copier-coller dans WhatsApp, et le partage WhatsApp est le canal du produit.
 */
export function slugifier(nom: string): string {
  return (
    nom
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "boutique"
  );
}

export function sellerRoutes(deps: SessionDeps) {
  return (
    new Hono()
      .get("/moi", async (c) => {
        const v = await vendeuseCourante(deps, c.req.raw);
        if (!v) return c.json({ erreur: "non_authentifiee" }, 401);
        return c.json(v);
      })

      /**
       * Cree le profil au premier passage. Idempotent : rappelee avec un profil
       * deja pose, elle le renvoie sans rien ecraser — un double-clic sur un
       * reseau lent ne doit pas renommer une boutique.
       */
      .post("/profil", async (c) => {
        const v = await vendeuseCourante(deps, c.req.raw);
        if (!v) return c.json({ erreur: "non_authentifiee" }, 401);
        if (v.seller) return c.json(v.seller);

        const corps = await c.req.json().catch(() => null);
        const nom = String(corps?.businessName ?? "").trim();
        const ville = String(corps?.city ?? "").trim();
        if (nom.length < 2 || ville.length < 2) {
          return c.json(
            {
              erreur: "champs_requis",
              message: "Le nom de la boutique et la ville sont necessaires.",
            },
            422,
          );
        }

        const phone = normalizePhone(v.loginPhone);
        if (!phone) return c.json({ erreur: "numero_invalide" }, 422);

        const seller = await deps.prisma.seller.create({
          data: {
            userId: v.userId,
            phone,
            businessName: nom,
            slug: await slugLibre(deps.prisma, slugifier(nom)),
            city: ville,
          },
          select: {
            id: true,
            businessName: true,
            slug: true,
            city: true,
            payoutPhone: true,
            payoutOperator: true,
          },
        });
        return c.json(seller, 201);
      })
  );
}

/**
 * Premier identifiant d'URL libre. `slug` est unique en base : la boucle evite
 * le rejet d'inscription pour une homonymie, qui est frequente — « chez tantine »
 * n'est pas un nom rare.
 */
async function slugLibre(prisma: PrismaClient, base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const essai = i === 0 ? base : `${base}-${i + 1}`;
    const pris = await prisma.seller.findUnique({ where: { slug: essai }, select: { id: true } });
    if (!pris) return essai;
  }
  throw new Error(`aucun identifiant d'URL libre pour « ${base} »`);
}
