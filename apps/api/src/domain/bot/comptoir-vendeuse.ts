import { formatXaf } from "@catalog/contracts/money";
import { normalizePhone } from "@catalog/contracts/phone";
import { lirePrix } from "./inscription.ts";

/**
 * Le comptoir vendeuse — rang 1 de l'ADR 0061.
 *
 * ── Pourquoi cette porte existe ───────────────────────────────────────────
 *
 * Le comptoir acheteuse — self-service, au prix affiche — existait depuis le
 * lot 7. Il ne couvre pas le cas le PLUS FREQUENT au Cameroun : une vente
 * negociee de vive voix, a un prix qui n'est pas celui du catalogue. Cette
 * vente-la n'entrait dans aucun moteur : ni commande, ni preuve, ni recu, ni
 * statistique. C'est la fuite que l'ADR 0061 nomme, et que le rang 0 a fermee
 * cote web sans la fermer ici.
 *
 * ── Ce que le comptoir fait, et ce qu'il ne fait pas ──────────────────────
 *
 * Il recueille QUATRE faits, tous connus de la vendeuse a l'instant ou elle
 * vend, puis rend la main au moteur. Il ne parle jamais a la cliente : c'est la
 * vendeuse qui TRANSFERE le message de paiement, dans leur conversation a
 * elles. « La transaction ne change pas de mains : elle change de piece. »
 *
 * ── Les quatre faits, et pourquoi ceux-la ─────────────────────────────────
 *
 * | fait          | pourquoi lui                                            |
 * |---------------|---------------------------------------------------------|
 * | article       | le libelle de la vente ; texte libre, elle sait le dire  |
 * | prix convenu  | PAS celui du catalogue — c'est toute la raison d'etre    |
 * | numero cliente| la commande en a besoin, et l'apres-achat aussi          |
 * | point remise  | `retrait` n'exige que lui et le telephone (ADR 0005)     |
 *
 * Le point de remise n'est pas un pis-aller : « le point de retrait convenu est
 * un mode de livraison de plein droit, pas un cas degrade ». Il evite surtout
 * de faire retaper a la vendeuse une ville, un quartier et un repere qu'elle
 * vient de convenir a l'oral.
 *
 * ── Pur ───────────────────────────────────────────────────────────────────
 *
 * Pas de base, pas de reseau, pas d'horloge : le temps et l'alea arrivent en
 * parametre chez l'appelant. Ce module ne fait que lire du texte et decider.
 */

/** Ce que la vendeuse a fini par declarer. Remis au moteur, tel quel. */
export interface VenteDeclaree {
  article: string;
  prixXaf: number;
  cliente: string;
  pointRemise: string;
}

export type EtatComptoir =
  | { pas: "article" }
  | { pas: "prix"; article: string }
  | { pas: "cliente"; article: string; prixXaf: number }
  | { pas: "remise"; article: string; prixXaf: number; cliente: string }
  | { pas: "recap"; article: string; prixXaf: number; cliente: string; remise: string };

export const COMPTOIR_DEPART: EtatComptoir = { pas: "article" };

/** Pourquoi une reponse a ete refusee. L'appelant en fait une phrase. */
export type MotifRefus =
  | "article_vide"
  | "prix_illisible"
  | "prix_negatif"
  | "numero_illisible"
  | "remise_trop_courte";

export interface ReactionComptoir {
  type: "question" | "refus" | "recap" | "creer" | "abandon";
  /** L'etat a persister. Sans objet quand `ouvert` est faux. */
  etat: EtatComptoir;
  /** Faux : le comptoir se ferme, l'appelant oublie l'etat. */
  ouvert: boolean;
  motif?: MotifRefus;
  vente?: VenteDeclaree;
}

/** Longueur minimale d'un point de remise — celle du contrat `pickupPoint`. */
const REMISE_MIN = 3;
const ARTICLE_MIN = 2;
const ARTICLE_MAX = 80;

const net = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/**
 * « vendu », « j'ai vendu », « vente » — et rien qui leur ressemble.
 *
 * L'ancrage est strict a dessein. Ouvrir une saisie a tort coute plus cher que
 * de ne pas l'ouvrir : le comptoir capture les messages SUIVANTS, si bien
 * qu'une vendeuse qui demandait « comment vendre ? » se retrouverait a repondre
 * a un formulaire qu'elle n'a pas ouvert.
 */
export function demandeComptoir(texteBrut: string): boolean {
  return /^(j'?ai\s+)?vendu$|^vente$/.test(net(texteBrut).replace(/\s+/g, " "));
}

/** Un « - » colle a des chiffres : une faute de saisie, pas une remise. */
const NEGATIF = /-\s*\d/;

const question = (etat: EtatComptoir): ReactionComptoir => ({
  type: "question",
  etat,
  ouvert: true,
});
const refus = (etat: EtatComptoir, motif: MotifRefus): ReactionComptoir => ({
  type: "refus",
  etat,
  ouvert: true,
  motif,
});

/**
 * Un pas du comptoir. Rend l'etat a persister et ce que l'appelant doit dire.
 *
 * `annuler` ferme a tout moment, `corriger` repart du premier fait : ce sont
 * les deux sorties de secours de l'ADR 0032, et elles valent ici aussi.
 */
export function avancerComptoir(
  etat: EtatComptoir,
  entree: { texte: string; id?: string | undefined },
): ReactionComptoir {
  const mot = net(entree.texte);
  const id = entree.id ?? "";

  if (id === "annuler" || mot === "annuler") {
    return { type: "abandon", etat: COMPTOIR_DEPART, ouvert: false };
  }

  switch (etat.pas) {
    case "article": {
      const article = entree.texte.trim().replace(/\s+/g, " ");
      if (article.length < ARTICLE_MIN || article.length > ARTICLE_MAX) {
        return refus(etat, "article_vide");
      }
      return question({ pas: "prix", article });
    }

    case "prix": {
      if (NEGATIF.test(entree.texte)) return refus(etat, "prix_negatif");
      const prixXaf = lirePrix(entree.texte);
      /* `lirePrix` refuse deja zero, le vide et l'absurde. Le franc CFA n'a pas
         de sous-unite : « 12.500 » est un separateur de milliers camerounais,
         pas une decimale, et il ressort entier. */
      if (prixXaf === null) return refus(etat, "prix_illisible");
      return question({ pas: "cliente", article: etat.article, prixXaf });
    }

    case "cliente": {
      const cliente = normalizePhone(entree.texte);
      /* Un numero qui n'en est pas un se REFUSE, il ne se devine pas : la
         commande et tout l'apres-achat pendent a ce fil. */
      if (!cliente) return refus(etat, "numero_illisible");
      return question({
        pas: "remise",
        article: etat.article,
        prixXaf: etat.prixXaf,
        cliente,
      });
    }

    case "remise": {
      const remise = entree.texte.trim().replace(/\s+/g, " ");
      if (remise.length < REMISE_MIN) return refus(etat, "remise_trop_courte");
      return {
        type: "recap",
        etat: {
          pas: "recap",
          article: etat.article,
          prixXaf: etat.prixXaf,
          cliente: etat.cliente,
          remise,
        },
        ouvert: true,
      };
    }

    case "recap": {
      if (id === "corriger" || mot === "corriger") {
        return question(COMPTOIR_DEPART);
      }
      if (id === "confirmer" || mot === "confirmer" || mot === "confirm") {
        return {
          type: "creer",
          etat: COMPTOIR_DEPART,
          ouvert: false,
          vente: {
            article: etat.article,
            prixXaf: etat.prixXaf,
            cliente: etat.cliente,
            pointRemise: etat.remise,
          },
        };
      }
      /* Ni l'un ni l'autre : on redit le recapitulatif plutot que de creer sur
         un mot ambigu. Rien ne se cree sans un oui explicite. */
      return { type: "recap", etat, ouvert: true };
    }
  }
}

/**
 * Ce que la vendeuse TRANSFERE a sa cliente, une fois la commande creee.
 *
 * ── Le jeton n'y est pas, et c'est la regle qui compte ────────────────────
 *
 * Ce message passe par les mains de la VENDEUSE. Le jeton acheteuse
 * (`buyerToken`, ADR 0021) autorise la contre-signature ; le lui remettre
 * reviendrait a la laisser se contre-signer elle-meme, et le controle n° 7 —
 * celui qui attrape « la collusion a une seule voix » — s'annulerait tout seul.
 *
 * Y figurent donc la reference et le code de verification, qui IDENTIFIENT sans
 * rien autoriser. Le lien de suivi arrive a l'acheteuse dans SON fil, le jour ou
 * elle ecrit au bot — et c'est ce qui donne au quatrieme fait du comptoir, le
 * numero de la cliente, sa raison d'etre.
 *
 * ── Autosuffisant en texte brut ───────────────────────────────────────────
 *
 * « Jamais un parcours qui exige un lien externe » (ADR 0061) : le forfait
 * « WhatsApp seul » est la norme. Prive de tout lien, ce message doit encore
 * permettre de payer — d'ou le montant, le numero et le code d'entree en clair.
 */
export interface FaitsATransferer {
  boutique: string;
  article: string;
  prixXaf: number;
  reference: string;
  codeVerification: string;
  /** Ce qui est du MAINTENANT — l'acompte, ou le total. */
  aPayerXaf: number;
  /** Ce qui restera a la remise. Zero : la ligne ne s'ecrit pas. */
  resteXaf: number;
  numeroReversement: string;
  operateurNom: string | null;
  /** Venu de la CONFIGURATION, jamais d'une constante (AGENTS.md §2). */
  codeEntree: string | null;
}

export function messageATransferer(f: FaitsATransferer): string {
  const entete = [
    `🧾 *${f.boutique}* — commande *${f.reference}*`,
    `${f.article} — 1 × ${formatXaf(f.prixXaf)}`,
    `*Total : ${formatXaf(f.prixXaf)}*`,
    `Code de vérification : *${f.codeVerification}*`,
    "",
  ];
  /* Sans reversement pose, rien n'est du AVANT la remise : exiger un
     prepaiement enverrait la cliente payer vers nulle part — la meme regle que
     le comptoir acheteuse (`sans_prepaiement`). Le message le dit au lieu
     d'afficher « a payer maintenant : 0 F ». */
  if (f.aPayerXaf <= 0) {
    return [...entete, `Le montant, ${formatXaf(f.prixXaf)}, se règle à la remise.`].join("\n");
  }
  return [
    ...entete,
    `💳 *À payer maintenant : ${formatXaf(f.aPayerXaf)}*`,
    `${f.operateurNom ?? "Mobile Money"} : ${f.numeroReversement}`,
    ...(f.codeEntree
      ? [`Composez ${f.codeEntree}, puis suivez le menu de transfert d'argent.`]
      : []),
    ...(f.resteXaf > 0 ? [`Le reste, ${formatXaf(f.resteXaf)}, se règle à la remise.`] : []),
    "Votre code secret se tape UNIQUEMENT sur l'écran de votre opérateur — jamais ici, jamais à personne.",
  ].join("\n");
}

/** Relit un etat comptoir persiste. Tout ce qui ne se relit pas vaut `null`. */
export function normaliserEtatComptoir(brut: unknown): EtatComptoir | null {
  const e = brut as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return null;
  const texteNonVide = (v: unknown): v is string => typeof v === "string" && v.length > 0;
  const prixValide = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v > 0;
  switch (e.pas) {
    case "article":
      return { pas: "article" };
    case "prix":
      return texteNonVide(e.article) ? { pas: "prix", article: e.article } : null;
    case "cliente":
      return texteNonVide(e.article) && prixValide(e.prixXaf)
        ? { pas: "cliente", article: e.article, prixXaf: e.prixXaf }
        : null;
    case "remise":
      return texteNonVide(e.article) && prixValide(e.prixXaf) && texteNonVide(e.cliente)
        ? { pas: "remise", article: e.article, prixXaf: e.prixXaf, cliente: e.cliente }
        : null;
    case "recap":
      return texteNonVide(e.article) &&
        prixValide(e.prixXaf) &&
        texteNonVide(e.cliente) &&
        texteNonVide(e.remise)
        ? {
            pas: "recap",
            article: e.article,
            prixXaf: e.prixXaf,
            cliente: e.cliente,
            remise: e.remise,
          }
        : null;
    default:
      return null;
  }
}

/* ── Les phrases du comptoir — le fil vendeuse est en francais (ADR 0033) ── */

/** La question du pas courant. L'appelant l'enveloppe en message sortant. */
export function questionComptoir(etat: EtatComptoir): string {
  switch (etat.pas) {
    case "article":
      return "*Qu'avez-vous vendu ?*\nExemple : Robe wax grande taille";
    case "prix":
      return `*${etat.article}* — au prix convenu avec votre cliente, en francs ?\nExemple : 12500`;
    case "cliente":
      return "*Le numéro WhatsApp de votre cliente ?*\nExemple : 677 00 11 22";
    case "remise":
      return "*Où se fait la remise ?* Le lieu convenu, en quelques mots.\nExemple : Carrefour Warda, devant la pharmacie";
    case "recap":
      return recapComptoir(etat);
  }
}

/** Le recapitulatif : tout relire AVANT de creer, la lecon de l'ADR 0032. */
export function recapComptoir(etat: Extract<EtatComptoir, { pas: "recap" }>): string {
  return [
    "🧾 *Récapitulatif de la vente*",
    `${etat.article} — ${formatXaf(etat.prixXaf)}`,
    `Cliente : ${etat.cliente}`,
    `Remise : ${etat.remise}`,
    "",
    "Je crée la commande et je vous rends le message de paiement à lui transférer.",
  ].join("\n");
}

/** Le refus, dit en phrase — jamais un code. */
export function phraseRefusComptoir(motif: MotifRefus): string {
  switch (motif) {
    case "article_vide":
      return "Je n'ai pas saisi l'article. En quelques mots — exemple : Robe wax grande taille.";
    case "prix_illisible":
      return "Je n'ai pas lu de prix. En francs, en chiffres — exemple : 12500.";
    case "prix_negatif":
      return "Un prix ne peut pas être négatif. En francs, en chiffres — exemple : 12500.";
    case "numero_illisible":
      return "Ce numéro ne se lit pas. Celui de votre cliente, au format camerounais — exemple : 677 00 11 22.";
    case "remise_trop_courte":
      return "Il me faut un lieu que votre cliente reconnaîtra. Exemple : Carrefour Warda, devant la pharmacie.";
  }
}
