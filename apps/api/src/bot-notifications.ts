import type { PrismaClient } from "@catalog/db";
import type { EnvoyeurBot } from "./domain/bot/envoyeur.ts";
import { texte } from "./domain/bot/messages.ts";
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

/**
 * Envoie maintenant si la fenetre est sure, sinon met en attente. L'echec
 * d'envoi retombe lui aussi en attente : le message partira au prochain
 * message entrant, il ne se perd pas.
 */
export async function notifier(
  deps: NotificateurDeps,
  phone: string,
  corps: string,
): Promise<void> {
  const maintenant = deps.maintenant?.() ?? new Date();
  try {
    const conversation = await deps.prisma.botConversation.findUnique({
      where: { phone },
      select: { updatedAt: true },
    });
    if (decisionRemise(conversation?.updatedAt ?? null, maintenant) === "envoyer") {
      try {
        await deps.envoyeur.envoyer(texte(versWhatsapp(phone), corps));
        return;
      } catch {
        /* L'envoi a echoue : la notification attend, elle ne disparait pas. */
      }
    }
    await deps.prisma.botNotification.create({ data: { phone, corps } });
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
      await deps.envoyeur.envoyer(texte(versWhatsapp(phone), n.corps));
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
    await notifier(
      deps,
      conversation.phone,
      t.notifPaiementProuve(commande.ref, commande.balanceXaf),
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
    await notifier(
      deps,
      conversation.phone,
      t.notifLivree(commande.ref, commande.seller.businessName),
    );
  } catch {
    console.warn("bot : notification de livraison non envoyee (details retenus)");
  }
}
