import type { PrismaClient } from "@catalog/db";
import type { EnvoyeurBot } from "./domain/bot/envoyeur.ts";
import { boutons, type MessageSortant, texte } from "./domain/bot/messages.ts";
import { decisionRemise } from "./domain/bot/notifications.ts";
import { TEXTES } from "./domain/bot/textes.ts";

/**
 * L'envoi des notifications du bot — ADR 0035. La DECISION (fenetre de
 * service sure ou pas) vit dans `domain/bot/notifications.ts` ; ici on
 * execute : envoi immediat, ou mise en attente dans `bot_notification`,
 * remise a la prochaine interaction du numero.
 *
 * Une notification n'est JAMAIS le chemin critique : toute panne d'envoi
 * degrade en mise en attente, toute panne de base degrade en silence. Ce
 * fichier ne leve pas vers ses appelants.
 */

export interface NotificateurDeps {
  prisma: PrismaClient;
  envoyeur: EnvoyeurBot;
  maintenant?: () => Date;
}

/** Le `to` de l'API est un wa_id — la cle de conversation, sans son `+`. */
const versWhatsapp = (phone: string) => phone.replace(/^\+/, "");

/** Les boutons d'une notification — portes jusqu'a la remise (ADR 0036). */
export type BoutonsNotification = ReadonlyArray<{ id: string; titre: string }>;

function messageDe(phone: string, corps: string, choix?: BoutonsNotification): MessageSortant {
  return choix && choix.length > 0
    ? boutons(versWhatsapp(phone), corps, choix)
    : texte(versWhatsapp(phone), corps);
}

/** Relit des boutons persistes. Tout ce qui ne se relit pas vaut « aucun ». */
function boutonsPersistes(brut: unknown): BoutonsNotification {
  if (!Array.isArray(brut)) return [];
  const sortie: Array<{ id: string; titre: string }> = [];
  for (const b of brut) {
    const c = b as { id?: unknown; titre?: unknown } | null;
    if (typeof c?.id === "string" && typeof c.titre === "string" && c.id && c.titre) {
      sortie.push({ id: c.id, titre: c.titre });
    }
  }
  return sortie.slice(0, 3);
}

/**
 * Envoie maintenant si la fenetre est sure, sinon met en attente. L'echec
 * d'envoi retombe lui aussi en attente : le message partira au prochain
 * message entrant, il ne se perd pas — **ses boutons compris** (ADR 0036),
 * sinon la contre-signature disparaitrait pour les acheteuses inactives.
 */
export async function notifier(
  deps: NotificateurDeps,
  phone: string,
  corps: string,
  choix?: BoutonsNotification,
): Promise<void> {
  const maintenant = deps.maintenant?.() ?? new Date();
  try {
    const conversation = await deps.prisma.botConversation.findUnique({
      where: { phone },
      select: { updatedAt: true },
    });
    if (decisionRemise(conversation?.updatedAt ?? null, maintenant) === "envoyer") {
      try {
        await deps.envoyeur.envoyer(messageDe(phone, corps, choix));
        return;
      } catch {
        /* L'envoi a echoue : la notification attend, elle ne disparait pas. */
      }
    }
    await deps.prisma.botNotification.create({
      data: {
        phone,
        corps,
        ...(choix && choix.length > 0 ? { boutons: choix as unknown as object } : {}),
      },
    });
  } catch {
    console.warn("bot : notification perdue (details retenus)");
  }
}

/** Plafond de remise par interaction : informer, jamais inonder. */
const REMISES_MAX = 5;

/**
 * Remet les notifications en attente d'un numero — appele au debut de chaque
 * entree traitee : le message entrant vient d'OUVRIR la fenetre, c'est le
 * moment sur. La remise se date ; un envoi rate laisse le reste en place.
 */
export async function livrerNotificationsEnAttente(
  deps: NotificateurDeps,
  phone: string,
): Promise<void> {
  try {
    const enAttente = await deps.prisma.botNotification.findMany({
      where: { phone, remisLe: null },
      orderBy: { creeLe: "asc" },
      take: REMISES_MAX,
    });
    for (const n of enAttente) {
      await deps.envoyeur.envoyer(messageDe(phone, n.corps, boutonsPersistes(n.boutons)));
      await deps.prisma.botNotification.update({
        where: { id: n.id },
        data: { remisLe: deps.maintenant?.() ?? new Date() },
      });
    }
  } catch {
    /* La prochaine interaction retentera — rien n'est marque remis a tort. */
  }
}

/* ─────────────── les deux notifications acheteuse (bilingues) ────────────── */

/**
 * La conversation ACHETEUSE d'une commande : celle dont c'est la derniere
 * commande. Aucun jeton n'est relu — la cle est `derniereCommandeId`, et la
 * reponse renvoie au message de confirmation qui porte deja le lien.
 */
async function conversationDeLaCommande(prisma: PrismaClient, orderId: string) {
  return prisma.botConversation.findFirst({
    where: { derniereCommandeId: orderId },
    select: { phone: true, langue: true },
  });
}

/** Paiement prouve (ADR 0035) : le recu existe, l'acheteuse le sait. */
export async function notifierPaiementProuve(
  deps: NotificateurDeps,
  orderId: string,
): Promise<void> {
  try {
    const [commande, conversation] = await Promise.all([
      deps.prisma.order.findUnique({
        where: { id: orderId },
        select: { ref: true, balanceXaf: true },
      }),
      conversationDeLaCommande(deps.prisma, orderId),
    ]);
    if (!commande || !conversation) return;
    const t = TEXTES[conversation.langue === "en" ? "en" : "fr"];
    /* Les deux boutons de la contre-signature (ADR 0036) : le « oui » qui
       porte la preuve a deux voix, et son pendant honnete. */
    await notifier(
      deps,
      conversation.phone,
      t.notifPaiementProuve(commande.ref, commande.balanceXaf),
      [
        { id: "contresigner", titre: t.btnContresigner },
        { id: "contester", titre: t.btnPasMoi },
      ],
    );
  } catch {
    console.warn("bot : notification de preuve non envoyee (details retenus)");
  }
}

/** Commande livree : l'invitation a noter part au SEUL bon moment. */
export async function notifierLivree(deps: NotificateurDeps, orderId: string): Promise<void> {
  try {
    const [commande, conversation] = await Promise.all([
      deps.prisma.order.findUnique({
        where: { id: orderId },
        select: { ref: true, seller: { select: { businessName: true } } },
      }),
      conversationDeLaCommande(deps.prisma, orderId),
    ]);
    if (!commande || !conversation) return;
    const t = TEXTES[conversation.langue === "en" ? "en" : "fr"];
    /* L'invitation a noter part au SEUL bon moment, et elle est cliquable. */
    await notifier(
      deps,
      conversation.phone,
      t.notifLivree(commande.ref, commande.seller.businessName),
      [{ id: "avis", titre: t.btnDonnerAvis }],
    );
  } catch {
    console.warn("bot : notification de livraison non envoyee (details retenus)");
  }
}
