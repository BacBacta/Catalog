import type { OrderStep } from "@catalog/contracts";
import { formatXaf } from "@catalog/contracts/money";
import { type CommandePourCycle, etapesPour } from "../order/cycle.ts";
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

/* ─────────────── les etapes en boutons — ADR 0098 (lot P4) ─────────────── */

/**
 * Les boutons de la notification de commande — decision P0-d : le bouton
 * appelle LA MEME transition que l'app (`avancerEtape`), avec les memes
 * refus. L'identifiant porte la reference : c'est aussi lui qui permet a la
 * carte d'absence de retrouver la commande SANS colonne nouvelle.
 *
 * « Écrire à la cliente » : le nom de l'acheteuse ne se re-projette jamais
 * (regle de `corpsNouvelleCommande`), et un titre de bouton est borne a 20
 * caracteres — d'ou l'ecart avec la maquette (« Écrire à Marie »).
 */
export function boutonsNouvelleCommande(
  reference: string,
): ReadonlyArray<{ id: string; titre: string }> {
  return [
    { id: `etape:preparee:${reference}`, titre: "🧺 Marquer préparée" },
    { id: `ecrire:${reference}`, titre: "Écrire à la cliente" },
  ];
}

/** Les etapes qu'un bouton du fil peut viser. Jamais « recue » : on y est deja. */
const ETAPES_BOUTON = ["preparee", "chez_le_livreur", "livree"] as const;
export type EtapeBouton = (typeof ETAPES_BOUTON)[number];

/**
 * Lit un identifiant de bouton d'etape (`etape:<vers>:<ref>`). `null` pour
 * tout le reste — un identifiant fabrique ne fait jamais viser une etape
 * inconnue, c'est le moteur qui tranchera la reference.
 */
export function lireBoutonEtape(id: string): { vers: EtapeBouton; reference: string } | null {
  const m = /^etape:([a-z_]+):(.+)$/.exec(id);
  if (!m?.[1] || !m[2]) return null;
  const vers = ETAPES_BOUTON.find((e) => e === m[1]);
  return vers ? { vers, reference: m[2] } : null;
}

/** Lit un identifiant « ecrire:<ref> » — le wa.me de la cliente se repond. */
export function lireBoutonEcrire(id: string): string | null {
  const m = /^ecrire:(.+)$/.exec(id);
  return m?.[1] ?? null;
}

const EMOJI_ETAPE: Record<OrderStep, string> = {
  recue: "🛍️",
  preparee: "🧺",
  chez_le_livreur: "🛵",
  livree: "📦",
};

const NOM_ETAPE: Record<OrderStep, string> = {
  recue: "reçue",
  preparee: "préparée",
  chez_le_livreur: "chez le livreur",
  livree: "livrée",
};

/**
 * La carte d'une etape INTERMEDIAIRE franchie — copie de la maquette.
 * « livree » garde sa carte en place (`corpsLivraisonMarquee`), qui dit
 * aussi ce qui part chez l'acheteuse.
 */
export function corpsEtapeFranchie(reference: string, etape: OrderStep): string {
  return `${EMOJI_ETAPE[etape]} *${reference} → ${NOM_ETAPE[etape]}*`;
}

export type SuiteEtape =
  /** Le bouton de l'etape suivante, a poser sur la carte de retour. */
  | { bouton: { id: string; titre: string } }
  /**
   * La suivante serait la remise, et le solde est OUVERT : pas de bouton —
   * la carte rappelle ce qui manque. C'est la garde `solde_ouvert` de
   * `cycle.ts`, dite au moment ou elle sert, pas au moment ou elle refuse.
   */
  | { rappelSoldeXaf: number }
  /** Rien apres — la commande est livree. */
  | null;

const TITRE_BOUTON_ETAPE: Record<EtapeBouton, string> = {
  preparee: "🧺 Marquer préparée",
  chez_le_livreur: "🛵 Chez le livreur",
  livree: "📦 Remise faite",
};

/**
 * Ce que la carte de retour propose APRES une transition — ADR 0098,
 * decision 2. La sequence vient de `etapesPour(mode)` : un retrait ne voit
 * jamais une etape de livreur (ADR 0005).
 */
export function suiteEtape(
  commande: Pick<CommandePourCycle, "etape" | "modeLivraison" | "balanceXaf">,
  reference: string,
): SuiteEtape {
  const sequence = etapesPour(commande.modeLivraison);
  const suivante = sequence[sequence.indexOf(commande.etape) + 1];
  if (!suivante) return null;
  if (suivante === "livree" && commande.balanceXaf > 0) {
    return { rappelSoldeXaf: commande.balanceXaf };
  }
  const vers = ETAPES_BOUTON.find((e) => e === suivante);
  return vers
    ? { bouton: { id: `etape:${vers}:${reference}`, titre: TITRE_BOUTON_ETAPE[vers] } }
    : null;
}

/** Le rappel quand la remise attend l'argent — le produit, dit en une phrase. */
export function corpsRappelSolde(reference: string, resteXaf: number): string {
  return `Il reste *${formatXaf(resteXaf)}* à encaisser sur ${reference}. Collez ici le SMS de votre opérateur — il devient le reçu — ou déclarez le paiement depuis votre espace. La remise se clôt ensuite.`;
}

/**
 * Le refus `solde_ouvert` d'un bouton perime, en langue simple — les autres
 * refus gardent `corpsLivraisonRefusee`, qui les dit deja.
 */
export function corpsRefusSoldeOuvert(reference: string, resteXaf: number): string {
  return `${reference} : rien n'a bougé — on ne clôt pas une remise sur un solde ouvert.\n${corpsRappelSolde(reference, resteXaf)}`;
}

/**
 * La carte « Pendant votre absence » — ADR 0098, decision 3. Copie de la
 * maquette (`parcours-vendeur-v2.html`). Sans bouton : trois commandes ne
 * tiennent pas dans trois boutons, et « commandes » rend le detail.
 */
export function carteAbsence(
  commandes: ReadonlyArray<{ reference: string; totalXaf: number }>,
): string {
  const n = commandes.length;
  const lignes = commandes.map((c) => `${c.reference} (${formatXaf(c.totalXaf)})`).join(" · ");
  return `*Pendant votre absence*\n${n} commandes : ${lignes}.\nÉcrivez « commandes » pour le détail.`;
}

/**
 * Le detail des commandes ouvertes — le mot-cle « commandes », promis par la
 * carte d'absence (decision 4). Il lit ce que le fil vendeuse charge deja.
 */
export function corpsListeCommandes(
  commandes: ReadonlyArray<{
    reference: string;
    resteXaf: number;
    totalXaf?: number;
    etape?: OrderStep;
  }>,
): string {
  if (commandes.length === 0) {
    return "Aucune commande en cours. Les nouvelles arrivent ici, dans ce fil.";
  }
  const lignes = commandes
    .slice(0, 10)
    .map(
      (c) =>
        `${c.reference}${c.totalXaf ? ` · ${formatXaf(c.totalXaf)}` : ""}${
          c.etape ? ` · ${NOM_ETAPE[c.etape]}` : ""
        }${c.resteXaf > 0 ? ` · reste ${formatXaf(c.resteXaf)}` : " · soldée"}`,
    );
  return [
    `📋 *Vos commandes en cours* (${commandes.length})`,
    ...lignes,
    "",
    "Remise faite ? Écrivez « livrée » et la référence. Un paiement reçu ? Collez le SMS ici.",
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
