import { formatXaf } from "@catalog/contracts/money";
import { gabaritPour, type SujetNotification } from "./gabarits.ts";

/**
 * Les notifications sortantes du bot — ADR 0035. Module PUR : il decide et il
 * formule ; le service envoie ou met en attente.
 *
 * **Notre bot n'initie jamais une conversation** (ADR 0034) : il ne peut
 * ecrire librement que dans la fenetre de service ouverte par un message de
 * l'autre personne. On ne connait pas la fenetre exacte de Meta ; on connait
 * la date du dernier message TRAITE (`BotConversation.updatedAt`), et c'est
 * l'approximation honnete : sous 24 h, la fenetre est sure ; au-dela, la
 * notification ATTEND en base et part a la prochaine interaction — elle n'est
 * jamais perdue, jamais envoyee a l'aveugle.
 */

export const FENETRE_SERVICE_MS = 24 * 60 * 60 * 1000;

export type RemiseNotification = "envoyer" | "gabarit" | "attendre";

/**
 * Envoyer maintenant, ou attendre ? `dernierMessageA` est la derniere
 * activite CONNUE de la conversation ; `null` veut dire « jamais vue » — donc
 * aucune fenetre, donc on attend.
 */
export function decisionRemise(
  dernierMessageA: Date | null,
  maintenant: Date,
  /**
   * Le sujet, quand il en a un — ADR 0054. Sans sujet, aucun gabarit n'est
   * possible et le comportement est celui d'avant : on attend.
   */
  sujet?: SujetNotification,
): RemiseNotification {
  const dansLaFenetre =
    dernierMessageA !== null &&
    (() => {
      const age = maintenant.getTime() - dernierMessageA.getTime();
      return age >= 0 && age < FENETRE_SERVICE_MS;
    })();
  if (dansLaFenetre) return "envoyer";
  /* Hors fenetre : le gabarit est la SEULE porte, et Meta le facture. On ne
     l'ouvre que pour un sujet qui le merite (liste fermee, ADR 0054). */
  return sujet && gabaritPour(sujet) ? "gabarit" : "attendre";
}

/* ─────────────────── les corps, cote vendeuse (francais) ─────────────────── */

/**
 * Nouvelle commande — le rapprochement est PREPARE : la vendeuse sait quel
 * SMS attendre et quoi en faire. Jamais le nom de l'acheteuse du fil (la
 * cle de conversation ne se re-projette pas) ; le numero de LIVRAISON, lui,
 * est fait pour etre appele.
 */
export function corpsNouvelleCommande(c: {
  reference: string;
  lignes: ReadonlyArray<{ nom: string; quantite: number }>;
  totalXaf: number;
  duAvantXaf: number;
  telephoneLivraison: string;
  /**
   * OU livrer — ADR 0050. Absent jusqu'ici, et c'etait un defaut a part
   * entiere : l'acheteuse saisit un quartier et un repere, tous deux rendus
   * OBLIGATOIRES par AGENTS.md §2 parce qu'il n'existe pas d'adresse au
   * Cameroun, et aucune surface vendeuse ne les affichait — ni ce message,
   * ni l'app (`livraison: unknown`, jamais consomme). Elle devait appeler
   * pour savoir ou aller.
   */
  destination?: string | null;
  /**
   * Pose quand la commande part SANS prepaiement parce que le numero de
   * reversement manque — retour du banc du 10/08/2026. La vendeuse
   * l'apprenait par une relance ~20 h plus tard (ADR 0035) : trop tard, la
   * vente du jour etait deja partie sans acompte. Le moment ou ca coute est
   * le moment ou on le dit — avec le lien, pas un renvoi vague.
   */
  lienReversement?: string | null;
  /**
   * L'espace vendeuse, ou les etapes intermediaires se marquent — preparee,
   * chez le livreur. Le fil ne connait que « livree » (ADR 0035) : sans ce
   * lien, la notification est une IMPASSE, et c'est le reproche du banc du
   * 11/08/2026. Absent quand la base n'est pas configuree.
   */
  lienEspace?: string | null;
}): string {
  return [
    `🛍️ *Nouvelle commande ${c.reference}*`,
    ...c.lignes.map((l) => `${l.nom} × ${l.quantite}`),
    `Total : *${formatXaf(c.totalXaf)}*`,
    ...(c.duAvantXaf > 0
      ? [
          `Acompte attendu : *${formatXaf(c.duAvantXaf)}*.`,
          `Un SMS de ${formatXaf(c.duAvantXaf)} devrait arriver de votre opérateur — collez-le ici : il devient le reçu.`,
        ]
      : ["Sans prépaiement — vous encaissez à la remise."]),
    ...(c.duAvantXaf === 0 && c.lienReversement
      ? [
          `⚠️ Cette vente est partie sans acompte : votre numéro Mobile Money n'est pas encore posé. Réglez-le une fois, et vos clientes paient d'avance : ${c.lienReversement}`,
        ]
      : []),
    ...(c.destination ? [`📍 ${c.destination}`] : []),
    `Numéro à appeler pour la remise : ${c.telephoneLivraison}`,
    /**
     * **Ce qui suit, et ou.** Une notification qui annonce sans dire la suite
     * laisse la vendeuse devant un fait, pas devant un geste — c'est ce que le
     * banc du 11/08/2026 a appele « le flow est mort cote vendeur ».
     *
     * Le fil porte le geste le plus frequent (la remise) ; l'espace porte les
     * etapes intermediaires, que la conversation ne sait pas marquer.
     */
    `\nQuand c'est remis, écrivez ici : *livrée ${c.reference}*`,
    ...(c.lienEspace ? [`Préparée, chez le livreur, historique : ${c.lienEspace}`] : []),
  ].join("\n");
}

/** La remise marquee depuis le fil : ce que la vendeuse voit en retour. */
export function corpsLivraisonMarquee(reference: string): string {
  return `📦 *${reference} est marquée livrée.* L'acheteuse vient d'en être prévenue, avec l'invitation à laisser un avis.`;
}

export function corpsLivraisonRefusee(reference: string, raison: string): string {
  const explication =
    raison === "recul_ignore"
      ? "elle est déjà à cette étape ou plus loin"
      : raison === "commande_introuvable"
        ? "aucune commande à ce numéro chez vous"
        : "cette étape n'est pas atteignable maintenant";
  return `${reference} : rien n'a bougé — ${explication}. Le détail est dans votre espace vendeuse, écran Commandes.`;
}
