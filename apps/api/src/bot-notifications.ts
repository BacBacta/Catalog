import { formatXaf } from "@catalog/contracts/money";
import type { PrismaClient } from "@catalog/db";
import type { EnvoyeurBot } from "./domain/bot/envoyeur.ts";
import { gabaritPour, type SujetNotification, variablesManquantes } from "./domain/bot/gabarits.ts";
import { boutons, gabarit, type MessageSortant, texte } from "./domain/bot/messages.ts";
import {
  decisionRemise,
  estResumable,
  RECAP_SUJETS_MAX,
  recapAbsence,
} from "./domain/bot/notifications.ts";
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
  /**
   * Le sujet et ses variables — ADR 0054. Present : hors fenetre, un gabarit
   * peut ouvrir la porte au lieu de faire attendre. Absent : comportement
   * d'avant, la notification attend la prochaine interaction.
   */
  horsFenetre?: { sujet: SujetNotification; parametres: readonly string[]; langue?: "fr" | "en" },
): Promise<void> {
  const maintenant = deps.maintenant?.() ?? new Date();
  try {
    const conversation = await deps.prisma.botConversation.findUnique({
      where: { phone },
      select: { updatedAt: true, langue: true },
    });
    const decision = decisionRemise(
      conversation?.updatedAt ?? null,
      maintenant,
      horsFenetre?.sujet,
    );
    if (decision === "envoyer") {
      try {
        await deps.envoyeur.envoyer(messageDe(phone, corps, choix));
        return;
      } catch {
        /* L'envoi a echoue : la notification attend, elle ne disparait pas. */
      }
    }
    /**
     * Hors fenetre, avec un gabarit — ADR 0054. Trois raisons de retomber sur
     * la file : le gabarit n'est pas approuve, une variable manque, ou Meta
     * refuse. Dans les trois cas la notification ATTEND ; elle n'est jamais
     * perdue, et on ne paie jamais un envoi qu'on sait incomplet.
     */
    if (decision === "gabarit" && horsFenetre) {
      const g = gabaritPour(horsFenetre.sujet);
      if (g && variablesManquantes(g, horsFenetre.parametres) === 0) {
        const langue = horsFenetre.langue ?? (conversation?.langue === "en" ? "en" : "fr");
        try {
          /* `versWhatsapp` ICI AUSSI. Le module pose sa regle en tete — le
             `to` de l'API est un wa_id, donc sans son `+` — et seul le chemin
             texte la suivait : tout gabarit partait avec un `+` que les
             messages ordinaires n'avaient pas. Meta tolere les deux, mais un
             code qui n'obeit qu'a moitie a sa propre regle est un code dont
             on ne sait plus laquelle des deux formes fait foi. */
          await deps.envoyeur.envoyer(
            gabarit(versWhatsapp(phone), g, langue, horsFenetre.parametres),
          );
          return;
        } catch (e) {
          /* Meme regle de redaction que partout (ADR 0023) : nos propres
             messages traversent, une erreur etrangere ne livre que son nom.
             Redit ici plutot qu'importe de `bot.ts`, qui importe CE module. */
          const cause =
            e instanceof Error ? (e.message.startsWith("envoi bot") ? e.message : e.name) : "?";
          console.warn(`bot : gabarit refuse, la notification attend (${cause})`);
        }
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

/** Plafond de MESSAGES par interaction : informer, jamais inonder. */
const REMISES_MAX = 5;

/**
 * Remet les notifications en attente d'un numero — appele au debut de chaque
 * entree traitee : le message entrant vient d'OUVRIR la fenetre, c'est le
 * moment sur. La remise se date ; un envoi rate laisse le reste en place.
 *
 * ── Le recapitulatif d'absence — ADR 0105 ────────────────────────────────
 *
 * Ce qui se RESUME (ni boutons, ni avertissement — `estResumable`) part en UN
 * message recapitulatif au lieu de N : c'etait jusqu'a cinq notifications de
 * commande d'affilee, melees a la conversation en cours, et Meta n'a aucun
 * mecanisme pour ca. Le reste — boutons de contre-signature, contestations —
 * garde son message entier, dans la limite d'avant.
 *
 * L'ORDRE est voulu : le recapitulatif d'abord (la vue d'ensemble), les
 * messages entiers ensuite (les gestes). Seules les notifications que le
 * recapitulatif PORTE sont marquees remises — un debordement au-dela de
 * `RECAP_SUJETS_MAX` reste en file et se dit (« … et N de plus »).
 */
export async function livrerNotificationsEnAttente(
  deps: NotificateurDeps,
  phone: string,
): Promise<void> {
  try {
    const enAttente = await deps.prisma.botNotification.findMany({
      where: { phone, remisLe: null },
      orderBy: { creeLe: "asc" },
      take: RECAP_SUJETS_MAX + REMISES_MAX,
    });

    const resumables = enAttente.filter((n) =>
      estResumable(n.corps, boutonsPersistes(n.boutons).length > 0),
    );
    const entieres = enAttente.filter((n) => !resumables.includes(n));

    const recap = recapAbsence(resumables.map((n) => n.corps));
    if (recap) {
      await deps.envoyeur.envoyer(texte(versWhatsapp(phone), recap));
      for (const n of resumables.slice(0, RECAP_SUJETS_MAX)) {
        await deps.prisma.botNotification.update({
          where: { id: n.id },
          data: { remisLe: deps.maintenant?.() ?? new Date() },
        });
      }
    }

    /* Une seule notification resumable ne merite pas un recapitulatif : elle
       part entiere, comme avant. */
    const seules = recap ? [] : resumables;
    for (const n of [...seules, ...entieres].slice(0, REMISES_MAX)) {
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
        select: { ref: true, balanceXaf: true, totalXaf: true },
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
      /* La valeur n°1 du produit ne doit pas attendre — ADR 0054. Une
         acheteuse qui ignore que son paiement est confirme est exactement
         celle que la fausse capture MoMo inquiete. */
      {
        sujet: "paiement_prouve",
        parametres: [commande.ref, formatXaf(commande.totalXaf - commande.balanceXaf)],
        langue: conversation.langue === "en" ? "en" : "fr",
      },
    );
  } catch {
    console.warn("bot : notification de preuve non envoyee (details retenus)");
  }
}

/**
 * L'acheteuse dement le paiement — la VENDEUSE doit l'apprendre tout de suite.
 *
 * ── Pourquoi ce message existe ─────────────────────────────────────────────
 *
 * La contre-signature (ADR 0036) donne a l'acheteuse un bouton « ce n'est pas
 * moi ». Il gele la commande. Sans notification, la vendeuse ne l'apprenait
 * qu'a sa prochaine visite dans le fil : elle continuait a preparer, a livrer,
 * a relancer une commande deja arretee — et decouvrait le litige plusieurs
 * jours apres, quand plus rien ne se retablit a l'amiable.
 *
 * C'est le seul endroit du produit ou la preuve opposable, qui est sa valeur
 * n° 1, se retournait contre celle qu'elle protege.
 *
 * ── Deux choix a ne pas defaire ────────────────────────────────────────────
 *
 * **Aucun bouton.** Un litige ne se tranche pas d'un tap. Le message ouvre la
 * conversation, il ne propose pas de la clore.
 *
 * **Le fil vendeuse est en francais** (ADR 0033) : la langue de l'acheteuse ne
 * commande pas celle de la vendeuse, et c'est bien SA langue a elle qu'il faut
 * ici. Le pidgin reste ecrit et non servi (ADR 0034).
 *
 * Comme partout dans ce module : ne leve pas vers l'appelant. Une contestation
 * qui n'a pas pu etre notifiee reste une contestation enregistree.
 */
export async function notifierConteste(deps: NotificateurDeps, orderId: string): Promise<void> {
  try {
    const commande = await deps.prisma.order.findUnique({
      where: { id: orderId },
      select: { ref: true, seller: { select: { phone: true } } },
    });
    if (!commande?.seller.phone) return;
    await notifier(
      deps,
      commande.seller.phone,
      `⚠️ *${commande.ref} est contestée.*\nL'acheteur/se dit ne pas reconnaître ce paiement. La commande est gelée : elle n'avance plus tant que le désaccord n'est pas réglé.\nLa preuve n'est pas effacée — elle reste au dossier. Le plus rapide reste d'appeler l'acheteur/se.`,
      undefined,
      /* Hors fenetre, le gabarit ouvre la porte — ADR 0054. C'est le sujet ou
         l'attente coute le plus cher : une commande gelee que la vendeuse
         croit vivante, c'est du travail fait pour rien et un litige qui
         durcit pendant ce temps. */
      { sujet: "paiement_conteste", parametres: [commande.ref], langue: "fr" },
    );
  } catch {
    console.warn("bot : notification de contestation non envoyee (details retenus)");
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
      /* Le gabarit existe, il est approuve et il etait DEJA paye — il n'etait
         simplement pas passe. Sans ce cinquieme argument, une remise faite a
         18 h attendait que l'acheteuse reecrive d'elle-meme, ce qu'elle n'a
         aucune raison de faire : c'est la vendeuse qui vient de livrer.
         L'avis verifie, lui, se depose depuis CE message — le faire attendre,
         c'est perdre l'avis, pas le retarder. */
      {
        sujet: "commande_livree",
        parametres: [commande.ref],
        langue: conversation.langue === "en" ? "en" : "fr",
      },
    );
  } catch {
    console.warn("bot : notification de livraison non envoyee (details retenus)");
  }
}
