#!/usr/bin/env node
/**
 * Remet un NUMERO a zero — instrument de terrain.
 *
 * ── A quoi ca sert ─────────────────────────────────────────────────────────
 *
 * Rejouer le parcours prospect complet — « je decouvre Catalog, j'ouvre ma
 * boutique dans le fil » — exige que le numero de test redevienne une
 * inconnue. Or il ne suffit PAS d'effacer la conversation : la vendeuse se
 * reconnait par DEUX chemins (`bot.ts`), et n'en couper qu'un donne un
 * parcours a moitie neuf, ou le bot repond « Collez ici le SMS de votre
 * operateur » a une prospect.
 *
 *   1. `authUser.phoneNumber` → sa relation `seller`
 *   2. `seller.phone`
 *
 * Ce script coupe les deux, en DETACHANT la boutique : rien n'est efface.
 * Commandes, preuves, avis, journal d'audit restent en base — ils sont
 * l'historique du produit, et une remise a zero de test n'a aucune raison de
 * detruire une preuve de paiement.
 *
 * ── Ce qu'il fait, precisement ─────────────────────────────────────────────
 *
 * - `seller.phone` → un numero factice unique, `seller.userId` → nul :
 *   les deux chemins de reconnaissance tombent ;
 * - `seller.status` → `closed` : la boutique sort de l'instantane public a la
 *   prochaine publication (l'export filtre sur `active`) ;
 * - `seller.slug` → suffixe `-raz<n>` : l'ancien lien ne resout plus, et le
 *   nom d'origine redevient libre pour la nouvelle boutique ;
 * - la ligne `bot_conversation` du numero est SUPPRIMEE (etat, langue,
 *   memoire de derniere commande) ;
 * - les `bot_notification` en attente qui le visent sont supprimees — sinon
 *   elles seraient remises au premier message du parcours neuf.
 *
 * L'`authUser` est CONSERVE : le bot le retrouvera par son numero et lui
 * rattachera la nouvelle boutique, exactement comme pour une vendeuse qui
 * revient. C'est le chemin reel, pas un raccourci de test.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   node apps/api/scripts/terrain-raz.mjs +237690000000 --voir    # diagnostic
 *   node apps/api/scripts/terrain-raz.mjs +237690000000           # applique
 *
 * Il se lance DANS la machine (`flyctl ssh console -C "…"`), la ou
 * `DATABASE_URL` vit deja. Sans `--voir`, il ECRIT — d'ou le diagnostic
 * d'abord, qui montre ce qui sera touche.
 */

import { createPrismaClient } from "@catalog/db";

const [brut, ...options] = process.argv.slice(2);
const voirSeulement = options.includes("--voir");

if (!brut || !/^\+\d{6,15}$/.test(brut)) {
  console.error("Usage : terrain-raz.mjs <+numero> [--voir]");
  console.error("Le numero s'ecrit au format international, avec le « + ».");
  process.exit(1);
}

const prisma = createPrismaClient();

try {
  const utilisateur = await prisma.authUser.findUnique({
    where: { phoneNumber: brut },
    include: { seller: { select: { id: true, slug: true, businessName: true, status: true } } },
  });
  const parNumero = await prisma.seller.findUnique({
    where: { phone: brut },
    select: { id: true, slug: true, businessName: true, status: true },
  });

  /* Les deux chemins peuvent designer la MEME boutique — ou deux differentes,
     si un profil a ete cree d'un cote et le numero pose de l'autre. */
  const boutiques = [utilisateur?.seller, parNumero].filter(Boolean);
  const uniques = [...new Map(boutiques.map((b) => [b.id, b])).values()];

  const conversations = await prisma.botConversation.count({ where: { phone: brut } });
  const notifications = await prisma.botNotification.count({
    where: { phone: brut, remisLe: null },
  });

  console.log(`numero            : ${brut}`);
  console.log(`compte (authUser) : ${utilisateur ? "existe — conserve" : "aucun"}`);
  console.log(`boutiques liees   : ${uniques.length}`);
  for (const b of uniques) {
    const [articles, commandes] = await Promise.all([
      prisma.product.count({ where: { sellerId: b.id, archivedAt: null } }),
      prisma.order.count({ where: { sellerId: b.id } }),
    ]);
    console.log(
      `  · ${b.businessName} (/${b.slug}, ${b.status}) — ${articles} article(s), ${commandes} commande(s) CONSERVEES`,
    );
  }
  console.log(`conversation      : ${conversations}`);
  console.log(`notifs en attente : ${notifications}`);

  if (voirSeulement) {
    console.log("\n(--voir : rien n'a ete ecrit)");
    process.exit(0);
  }

  await prisma.$transaction(async (tx) => {
    for (const b of uniques) {
      /* Un numero factice UNIQUE : `seller.phone` porte une contrainte
         d'unicite, et deux remises a zero successives se marcheraient dessus.
         L'identifiant de la boutique la garantit sans horloge. */
      const marque = b.id.replace(/-/g, "").slice(-10);
      await tx.seller.update({
        where: { id: b.id },
        data: {
          phone: `+00${marque}`,
          userId: null,
          status: "closed",
          slug: `${b.slug}-raz${marque.slice(-4)}`,
        },
      });
      /* La bascule se journalise : le journal d'audit doit expliquer pourquoi
         une boutique a cesse d'exister publiquement. */
      await tx.sellerAuditEvent.create({
        data: { sellerId: b.id, kind: "boutique_detachee", actor: "terrain_raz" },
      });
    }
    await tx.botConversation.deleteMany({ where: { phone: brut } });
    await tx.botNotification.deleteMany({ where: { phone: brut, remisLe: null } });
  });

  console.log(
    `\n✅ ${brut} est de nouveau une inconnue. ${uniques.length} boutique(s) detachee(s), rien d'efface.`,
  );
  console.log("Le prochain message de ce telephone ouvre le parcours prospect complet.");
} finally {
  await prisma.$disconnect();
}
