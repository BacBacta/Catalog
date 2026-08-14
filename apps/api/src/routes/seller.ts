import { normalizePhone } from "@catalog/contracts";
import { villeAcceptable } from "@catalog/contracts/villes";
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
        /* Le MEME predicat que le bot et que la livraison — ADR 0050. Cette
           porte n'avait AUCUNE borne haute : une ville de 4 000 caracteres
           entrait en base et faisait echouer la commande d'une acheteuse. */
        if (nom.length < 2 || !villeAcceptable(ville)) {
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
                "Le numero WhatsApp de la boutique est necessaire : c'est lui que vos client/es toucheront.",
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
              slug: await slugLibre(deps.prisma, slugifier(nom), ville),
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
      /**
       * Le RENOMMAGE — ADR 0092, constat C-002 de l'audit du 13/08.
       *
       * Il n'existait aucun chemin de renommage dans tout le produit : ni dans
       * le bot, ni ici. Un nom pose au deuxieme message du fil etait definitif,
       * et il est aussi l'adresse publique de la boutique.
       *
       * **Le slug ne bouge PAS**, et c'est le point delicat de cette route.
       * L'adresse a peut-etre deja ete partagee — en Statut WhatsApp, dans une
       * chaine, dans le QR d'une carte-vitrine imprimee. La casser en silence
       * produirait exactement le defaut que l'ADR 0073 decrit : « un lien de
       * Statut qui mene a une page 404 ne se voit ni en CI, ni chez la vendeuse.
       * Il se voit chez l'acheteuse, une fois, et elle ne revient pas. »
       * L'interface le dit en toutes lettres ; elle ne le devine pas pour elle.
       *
       * La ville se corrige par la meme porte : elle est du meme regime — saisie
       * une fois, jamais modifiable, et elle sert a la livraison.
       */
      .post("/renommer", async (c) => {
        const v = await vendeuseCourante(deps, c.req.raw);
        if (!v) return c.json({ erreur: "non_authentifiee" }, 401);
        if (!v.seller) return c.json({ erreur: "profil_absent" }, 404);

        const corps = await c.req.json().catch(() => null);
        const nom = String(corps?.businessName ?? "").trim();
        const ville = String(corps?.city ?? v.seller.city).trim();
        /* Les MEMES bornes qu'a la creation : deux portes qui ecrivent le meme
           champ ne peuvent pas diverger sur ce qu'elles acceptent. */
        if (nom.length < 2 || nom.length > 80 || !villeAcceptable(ville)) {
          return c.json(
            {
              erreur: "champs_requis",
              message: "Le nom de la boutique et la ville sont necessaires.",
            },
            422,
          );
        }
        if (nom === v.seller.businessName && ville === v.seller.city) {
          /* Rien n'a change : aucune ecriture, aucune ligne au journal. Meme
             regle que la bascule des conges. */
          return c.json({ businessName: nom, city: ville, slug: v.seller.slug });
        }

        const sellerId = v.seller.id;
        await deps.prisma.$transaction(async (tx) => {
          await tx.seller.update({
            where: { id: sellerId },
            data: { businessName: nom, city: ville },
          });
          await tx.sellerAuditEvent.create({
            data: { sellerId, kind: "boutique_renommee", actor: "vendeuse_app", at: new Date() },
          });
        });
        return c.json({ businessName: nom, city: ville, slug: v.seller.slug });
      })

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
 * Premier identifiant d'URL libre. `slug` est unique en base : l'echelle evite
 * le rejet d'inscription pour une homonymie, qui est frequente — « chez tantine »
 * n'est pas un nom rare.
 *
 * ── L'echelle passe par la VILLE — ADR 0100 ───────────────────────────────
 *
 *     chez-solange  →  chez-solange-douala  →  chez-solange-douala-2  →  …
 *
 * Elle etait purement numerique — `-2` … `-50` — et cinquante homonymes
 * GLOBAUX suffisaient a la saturer. Constate le 14/08/2026, en reproduisant
 * autre chose : quarante executions de la suite ont cree cinquante « Chez
 * Solange », et l'ouverture suivante levait. `traiterLivraisonBot` avale
 * l'exception et repond « panne passagere » — la vendeuse ne pouvait pas
 * ouvrir sa boutique et n'apprenait jamais pourquoi.
 *
 * La ville fait deux choses, et la seconde compte plus que la premiere :
 *
 * 1. la capacite devient cinquante PAR VILLE au lieu de cinquante en tout ;
 * 2. **l'adresse se lit.** `chez-solange-douala` dit quelque chose ;
 *    `chez-solange-7` ne dit rien. C'est une adresse qu'on met en Statut
 *    WhatsApp : elle est VUE avant d'etre cliquee.
 *
 * `ville` est facultative parce que cette fonction est publique et qu'un
 * appelant peut ne pas en avoir. Sans elle — ou quand elle ne slugifie en rien
 * — l'ancienne echelle numerique reprend : un repli, pas une levee.
 */
export async function slugLibre(
  prisma: PrismaClient,
  base: string,
  ville?: string | null,
): Promise<string> {
  const libre = async (essai: string) =>
    !(await prisma.seller.findUnique({ where: { slug: essai }, select: { id: true } }));

  if (await libre(base)) return base;

  /* `slugifier` rend « boutique » quand il ne reste aucune lettre. Coller
     « -boutique » a une adresse serait pire que de la numeroter. */
  const villeSlug = ville ? slugifier(ville) : "";
  const racine = villeSlug && villeSlug !== "boutique" ? `${base}-${villeSlug}` : base;

  if (racine !== base && (await libre(racine))) return racine;

  for (let i = 2; i <= 50; i++) {
    const essai = `${racine}-${i}`;
    if (await libre(essai)) return essai;
  }
  /* Elle reste possible — cinquante homonymes dans la MEME ville. Le message
     nomme la ville : sans elle, il ne dirait pas ou le probleme se pose, et la
     suite ne serait pas decidable. */
  throw new Error(`aucun identifiant d'URL libre pour « ${racine} »`);
}
