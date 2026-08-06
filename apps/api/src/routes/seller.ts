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
    /** Mode conges — ADR 0039. `null` = la boutique prend les commandes. */
    congesDepuis: string | null;
  } | null;
}

/**
 * La bascule du mode conges — ADR 0039.
 *
 * Ecrite ICI et appelee par les DEUX chemins (l'app vendeuse et le fil
 * WhatsApp) : deux ecritures separees finiraient par diverger sur le journal,
 * qui est justement ce qui permet de repondre a « depuis quand ma boutique
 * ne prend plus rien ? ».
 *
 * Idempotente : refermer une boutique fermee ne repousse pas la date. La date
 * repond a « depuis quand », pas a « quand a-t-elle appuye pour la derniere
 * fois » — et une bascule sans changement n'entre pas au journal.
 */
export async function basculerConges(
  prisma: PrismaClient,
  sellerId: string,
  fermer: boolean,
  acteur: string,
  maintenant: Date,
): Promise<{ congesDepuis: Date | null }> {
  const actuel = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: { congesDepuis: true },
  });
  if (!actuel) throw new Error("boutique introuvable");
  const cible = fermer ? (actuel.congesDepuis ?? maintenant) : null;
  if (actuel.congesDepuis?.getTime() === cible?.getTime()) return { congesDepuis: cible };

  await prisma.$transaction(async (tx) => {
    await tx.seller.update({ where: { id: sellerId }, data: { congesDepuis: cible } });
    await tx.sellerAuditEvent.create({
      data: {
        sellerId,
        kind: fermer ? "boutique_fermee" : "boutique_rouverte",
        actor: acteur,
        at: maintenant,
      },
    });
  });
  return { congesDepuis: cible };
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
      congesDepuis: true,
    },
  });
  return {
    userId: s.user.id,
    loginPhone: s.user.phoneNumber ?? "",
    seller: seller ? { ...seller, congesDepuis: seller.congesDepuis?.toISOString() ?? null } : null,
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

        /**
         * Le numero de contact de la boutique — ADR 0029.
         *
         * Compte ne du telephone : il est DERIVE du numero de connexion,
         * comme avant. Compte ne de Google (pas de numero verifie) : il se
         * DECLARE ici. C'est un attribut, pas une preuve — une vendeuse qui le
         * saisit faux prive ses propres clientes de la joindre, et le corrige
         * dans Reglages. Il n'entre JAMAIS dans la recherche de compte des
         * ceremonies telephone : declarer le numero d'autrui ne cree aucun
         * lien d'authentification.
         */
        const declare = normalizePhone(String(corps?.contactPhone ?? ""));
        const phone = normalizePhone(v.loginPhone) ?? declare;
        if (!phone) {
          return c.json(
            {
              erreur: "numero_contact_requis",
              message:
                "Le numero WhatsApp de la boutique est necessaire : c'est lui que vos clientes toucheront.",
            },
            422,
          );
        }

        const seller = await deps.prisma.seller
          .create({
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
          })
          .catch((cause: unknown) => {
            /**
             * `Seller.phone` est UNIQUE : c'est l'anti-squat des boutiques. Une
             * collision est une reponse claire, jamais une 500.
             */
            if ((cause as { code?: string })?.code === "P2002") return null;
            throw cause;
          });
        if (!seller) {
          return c.json(
            {
              erreur: "numero_deja_utilise",
              message: "Une boutique utilise deja ce numero. Verifiez-le, ou contactez-nous.",
            },
            422,
          );
        }
        return c.json(seller, 201);
      })

      /**
       * Le mode conges — ADR 0039.
       *
       * Pas d'OTP : fermer sa boutique ne deplace aucun argent et se defait
       * d'un geste. Le champ qui exige une verification est le numero de
       * reversement, et lui seul (AGENTS.md).
       */
      .post("/conges", async (c) => {
        const v = await vendeuseCourante(deps, c.req.raw);
        if (!v) return c.json({ erreur: "non_authentifiee" }, 401);
        if (!v.seller) return c.json({ erreur: "profil_absent" }, 404);

        const corps = await c.req.json().catch(() => null);
        if (typeof corps?.fermer !== "boolean") {
          return c.json({ erreur: "champs_requis", message: "`fermer` est un booleen." }, 422);
        }
        const r = await basculerConges(
          deps.prisma,
          v.seller.id,
          corps.fermer,
          "vendeuse_app",
          new Date(),
        );
        return c.json({ congesDepuis: r.congesDepuis?.toISOString() ?? null });
      })
  );
}

/**
 * Premier identifiant d'URL libre. `slug` est unique en base : la boucle evite
 * le rejet d'inscription pour une homonymie, qui est frequente — « chez tantine »
 * n'est pas un nom rare.
 */
export async function slugLibre(prisma: PrismaClient, base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const essai = i === 0 ? base : `${base}-${i + 1}`;
    const pris = await prisma.seller.findUnique({ where: { slug: essai }, select: { id: true } });
    if (!pris) return essai;
  }
  throw new Error(`aucun identifiant d'URL libre pour « ${base} »`);
}
