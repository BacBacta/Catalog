/* Le baril est permis COTE SERVEUR : la regle anti-baril (lot 6) protege le
   paquet navigateur de la boutique, pas l'API. */

import { randomBytes } from "node:crypto";

/**
 * Le plafond d'octets de la carte-vitrine — ADR 0059. Trois fois celui d'une
 * photo de catalogue, parce que ce n'en est pas une : un objet, un envoi,
 * et un code a scanner. WhatsApp accepte tres au-dela ; la borne existe pour
 * que la carte reste une image et pas un telechargement.
 */
const CARTE_CIBLE_OCTETS = 300_000;

import { deliverySchema, itemsTotalXaf, normalizePhone, type OrderItem } from "@catalog/contracts";
import { formatXaf } from "@catalog/contracts/money";
import { formatPhone } from "@catalog/contracts/phone";
import { slugArticle } from "@catalog/contracts/slug";
import type { RampeConfig } from "@catalog/contracts/ussd";
import type { PrismaClient } from "@catalog/db";
import { rendreCarte, rendreCarteAvis } from "./adapters/carte-vitrine.ts";
import { reencoderImage } from "./adapters/image-pipeline.ts";
import type { DeclencheurReconstruction } from "./adapters/reconstruction-boutique.ts";
import type { ChiffreurSms } from "./adapters/sms-chiffre.ts";
import { emailTechnique } from "./auth.ts";
import {
  livrerNotificationsEnAttente,
  notifier,
  notifierConteste,
  notifierLivree,
} from "./bot-notifications.ts";
import { aiguiller } from "./domain/bot/aiguillage.ts";
import { ARTICLES_MAX, CARTE_HAUTEUR } from "./domain/bot/carte-vitrine.ts";
import {
  COMPTOIR_DEPART,
  demandeComptoir,
  messageATransferer,
  type VenteDeclaree,
} from "./domain/bot/comptoir-vendeuse.ts";
import { confianceAuPaiement, type VerdictConfiance } from "./domain/bot/confiance.ts";
import {
  type ArticleBot,
  type BoutiqueBot,
  confirmationCommande,
  type Entree as EntreeMachine,
  ETAT_INITIAL,
  type EtatConv,
  etatApresInactivite,
  extraireSlugBoutique,
  type LignePanier,
  messageVerdict,
  normaliserEtat,
  RAFALE_MAX,
  reagirAcheteuse,
  reagirVendeuse,
  type StatutDerniereCommande,
} from "./domain/bot/conversation.ts";
import { texteEntreeBoutique } from "./domain/bot/entree-boutique.ts";
import { type EntreeBot, lireEntreesBot } from "./domain/bot/entrees.ts";
import type { EnvoyeurBot } from "./domain/bot/envoyeur.ts";
import {
  genreDuJeton,
  jetonFlux,
  lireArticleFlux,
  lireInscriptionFlux,
  messageFlux,
} from "./domain/bot/flux.ts";
import {
  demandeInscription,
  type EtatVendeuse,
  etatVendeuseApresInactivite,
  messageArticlePublie,
  messageBoutiqueCreee,
  messageOnboarding,
  normaliserEtatVendeuse,
  PREMIERE_QUESTION,
  questionDeLEtat,
  rappelConges,
  reagirInscription,
} from "./domain/bot/inscription.ts";
import type { LecteurMedia } from "./domain/bot/media.ts";
import {
  accuseLecture,
  boutons as boutonsMessage,
  image as imageMessage,
  type MessageSortant,
  sansCitation,
  texte,
} from "./domain/bot/messages.ts";
import {
  corpsLivraisonMarquee,
  corpsLivraisonRefusee,
  corpsNouvelleCommande,
} from "./domain/bot/notifications.ts";
import { consigneDuPack, packStatut } from "./domain/bot/pack-statut.ts";
import { type Langue, normaliserLangue, TEXTES } from "./domain/bot/textes.ts";
import { extraireCodeDefi } from "./domain/connexion-whatsapp.ts";
import { ATTENTE_ANNONCEE_MIN } from "./domain/deploiement/reconstruction-boutique.ts";
import {
  avancerEtape,
  type CommandePourCycle,
  etapesDuSuivi,
  soldeAEncaisser,
} from "./domain/order/cycle.ts";
import { echeance } from "./domain/order/expiration.ts";
import { planDePaiement } from "./domain/order/paiement.ts";
import { appliquerEvenement, type EvenementPreuve } from "./domain/proof/machine.ts";
import { analyserSms } from "./domain/proof/motifs.ts";
import { genererJetonSuivi, lienDeSuivi } from "./domain/receipt/jeton.ts";
import { droitAuDepot, reputation } from "./domain/review/reputation.ts";
import { decisionGel, effetDuGel } from "./domain/securite/alerte-reversement.ts";
import { cleOpaque, declinaisons, type ObjectStorage } from "./domain/storage.ts";
import { generateVerificationCode } from "./domain/verification-code.ts";
import type { ChargeRelance } from "./jobs/relance-acompte.ts";
import { mesurerEtatPreuve, mesurerTransitionBot } from "./observabilite/mesures.ts";
import { avecSpan, PARCOURS, poser } from "./observabilite/traces.ts";
import { soumettrePreuve } from "./preuve-service.ts";
import { basculerConges, slugifier, slugLibre } from "./routes/seller.ts";

/**
 * Le service du bot — ADR 0031, revise par les ADR 0032 et 0033. Il charge
 * l'etat et les donnees, appelle la machine PURE de `domain/bot`, execute
 * l'effet, persiste, envoie.
 *
 * C'est ici que nait la PREMIERE creation de commande du produit : jusqu'au
 * bot, la boutique fabriquait un message wa.me et rien n'etait persiste. Le
 * generateur de code de verification, le jeton de suivi, le plan d'acompte et
 * l'echeance de 48 h existaient deja — ils n'attendaient que ce point d'appel.
 *
 * Le verdict des sept controles DANS le fil vendeuse n'est pas encore la :
 * l'orchestration de preuve vit dans sa route (chiffrement, unicite tranchee
 * par l'INSERT) et se dupliquer serait une seconde source de verite sur de
 * l'argent (AGENTS.md §6). V1 : le SMS est RECONNU dans le fil et dirige vers
 * l'ecran de preuve de la bonne commande. L'extraction propre de
 * l'orchestration est le prochain pas, note dans l'ADR.
 */

export interface BotDeps {
  prisma: PrismaClient;
  envoyeur: EnvoyeurBot;
  /** Origine publique de la boutique (liens de suivi). Vide : pas de lien. */
  baseBoutique: string;
  /** Origine publique de l'app vendeuse (ecran de preuve). Vide : pas de lien. */
  baseApp: string;
  /**
   * Stockage d'objets, pour les en-tetes image (declinaison JPEG, ADR 0032).
   * Absent : les messages partent sans image, jamais avec un lien mort.
   */
  storage?: ObjectStorage;
  /**
   * Lecture des photos entrantes (ADR 0034). Absent : l'inscription marche,
   * les articles se publient sans photo — jamais de blocage.
   */
  media?: LecteurMedia;
  /** Le numero WhatsApp de Catalog, pour composer les liens `wa.me` partages. */
  numeroCatalog?: string;
  /**
   * Planification de la relance d'acompte (ADR 0033). Absente : pas de
   * relance — la commande vit, seule la piqure de rappel manque.
   */
  planifierRelance?: (charge: ChargeRelance) => Promise<void>;
  /**
   * Relance « posez votre reversement » ~20 h apres l'ouverture (ADR 0035).
   * Meme regle : absente, la boutique vit sans rappel.
   */
  planifierRelanceReversement?: (charge: { sellerId: string; phone: string }) => Promise<void>;
  /**
   * La configuration de la rampe (lot 9) : le bloc paiement du fil en lit le
   * nom d'operateur et le code d'entree — jamais une constante (AGENTS.md).
   * Absente : le bloc part sans ligne de code, il reste vrai.
   */
  rampe?: RampeConfig;
  /**
   * Le verdict de preuve DANS le fil — ADR 0083. Absent : le fil reconnait
   * le SMS et aiguille vers l'app (comportement V1), rien ne casse. Present,
   * ET quand UNE SEULE commande a un solde ouvert, le SMS colle passe les
   * sept controles par LE MEME service que la route (`soumettrePreuve`) et
   * le verdict se dit ici. `apresPreuve` previent l'acheteuse apres commit.
   */
  preuve?: {
    chiffreur: ChiffreurSms;
    apresPreuve?: (orderId: string) => Promise<void>;
  };
  /**
   * L'identifiant du Flow de livraison — ADR 0055. **Absent par defaut**, et
   * c'est le cas normal : sans lui, le fil est celui d'avant, question par
   * question. Present, le formulaire s'AJOUTE — un Flow ne s'affiche pas sur
   * un WhatsApp ancien, et la question doit rester atteignable.
   */
  fluxLivraisonId?: string;
  /** Le Flow d'AVIS — meme regime : absent, le fil est celui d'avant. */
  fluxAvisId?: string;
  /** Le formulaire d'inscription vendeuse — tache #60. Absent : rien n'est monte. */
  fluxInscriptionId?: string;
  /** Le formulaire de creation d'article — tache #62. Meme regime : un raccourci
      qui s'AJOUTE aux questions, jamais un passage oblige. */
  fluxArticleId?: string;
  /**
   * Le declencheur de reconstruction de la boutique publique — ADR 0065.
   * ABSENT par defaut : sans lui, aucun deploiement n'est demande et aucun
   * delai n'est annonce. Le silence est alors la seule reponse honnete.
   */
  reconstruction?: DeclencheurReconstruction | null;
  maintenant?: () => Date;
  aleatoire?: (n: number) => Uint8Array;
}

/**
 * Un message n'est traite QU'UNE FOIS — ADR 0040.
 *
 * WhatsApp et ses relais livrent au moins une fois : un accuse qui tarde, et
 * la meme livraison revient, indefiniment, a intervalle croissant. Sans cette
 * garde, chaque relivraison rejoue le message dans la machine de conversation.
 * Ce n'est pas une gene cosmetique : en bac a sable, un « Bonjour » vieux
 * d'une minute est devenu le NOM d'une boutique, et un « Douala » le nom d'un
 * article (05/08/2026).
 *
 * La reclamation se pose AVANT tout travail : c'est ce qui rend inoffensive la
 * relivraison qui arrive pendant le traitement de la premiere. Elle se termine
 * apres — et une reclamation restee inachevee au-dela de `RECLAMATION_PERIMEE`
 * se laisse rejouer, sinon un processus tue emporterait le message avec lui.
 *
 * Le compromis est explicite : on prefere PERDRE un message dont le traitement
 * est mort en chemin — la vendeuse reecrit — plutot que d'en traiter un deux
 * fois. Un double traitement, lui, corrompt un etat que personne ne repare.
 */
const RECLAMATION_PERIMEE_MS = 2 * 60_000;

/** Purge tardive : les lignes ne servent que le temps des relivraisons. */
/**
 * Le mot qu'un echec laisse au journal — SANS CONTENU, comme toute trace
 * (ADR 0023). Nos propres erreurs (« envoi bot refuse : HTTP 400, code Meta
 * 131037 ») sont construites sans une lettre de conversation et traversent
 * telles quelles ; toute erreur etrangere — Prisma, reseau — ne livre que son
 * NOM, car son message peut porter un numero, une requete, un fragment de SQL.
 */
export function resumerErreur(e: unknown): string {
  if (!(e instanceof Error)) return "erreur non standard";
  return e.message.startsWith("envoi bot") ? e.message : e.name;
}

const RETENTION_VUS_MS = 3 * 24 * 3600_000;

async function reclamer(deps: BotDeps, messageId: string, maintenant: Date): Promise<boolean> {
  try {
    await deps.prisma.botMessageVu.create({ data: { id: messageId, reclameLe: maintenant } });
    return true;
  } catch (cause) {
    if ((cause as { code?: string })?.code !== "P2002") throw cause;
  }
  /* Deja vu. Reste a savoir si le traitement precedent s'est acheve, ou s'il
     est mort en chemin — auquel cas la relivraison est notre seconde chance. */
  const vu = await deps.prisma.botMessageVu.findUnique({
    where: { id: messageId },
    select: { reclameLe: true, termineLe: true },
  });
  if (!vu || vu.termineLe) return false;
  if (maintenant.getTime() - vu.reclameLe.getTime() < RECLAMATION_PERIMEE_MS) return false;
  await deps.prisma.botMessageVu.update({
    where: { id: messageId },
    data: { reclameLe: maintenant },
  });
  return true;
}

export async function traiterLivraisonBot(deps: BotDeps, corps: unknown): Promise<void> {
  const maintenant = deps.maintenant?.() ?? new Date();
  for (const entree of lireEntreesBot(corps)) {
    /* Un message qui porte un code de defi (AAAA-BB) appartient a la
       connexion WhatsApp (ADR 0027), deja traitee par `surMessage` : le bot
       ne repond pas par-dessus. */
    if (entree.genre === "texte" && extraireCodeDefi(entree.texte)) continue;

    /**
     * Sans `messageId`, aucune idempotence possible — on traite, comme avant.
     * Le simulateur de terrain est dans ce cas, et c'est voulu : il sert
     * justement a rejouer un scenario a l'identique.
     */
    if (entree.messageId) {
      const aTraiter = await reclamer(deps, entree.messageId, maintenant).catch(() => true);
      if (!aTraiter) continue;
    }

    /**
     * L'accuse de lecture, et la frappe — ADR 0049. Pose AVANT le travail :
     * la double coche bleue est la seule chose qui distingue « le bot reflechit »
     * de « le bot est mort », et le traitement peut durer (telechargement de
     * media, re-encodage, carte-vitrine). De CONFORT : un echec ne coute rien
     * et ne casse pas le fil — l'indicateur se dissipe seul.
     */
    if (entree.messageId && deps.envoyeur.accuser) {
      await deps.envoyeur
        .accuser(accuseLecture(entree.messageId, { frappe: true }))
        .catch(() => {});
    }

    await traiterEntree(deps, entree).catch((e: unknown) => {
      /* Une entree qui casse ne bloque ni les suivantes ni la relivraison —
         mais elle se NOMME. La panne muette du 07/08/2026 : tous les envois
         mouraient sur (#131037), et ce catch ne disait rien. */
      console.warn(`bot : entree non traitee (${resumerErreur(e)})`);
      /* Et surtout : la personne en face apprend qu'il s'est passe quelque
         chose. Un silence apres un message est indiscernable d'une panne, et
         c'est exactement ce qu'on vient de vivre le 07/08/2026. L'envoi est
         lui-meme protege : si c'est LUI qui est casse, on ne boucle pas. */
      deps.envoyeur.envoyer(texte(entree.de, TEXTES.fr.pannePassagere)).catch(() => {});
    });

    if (entree.messageId) {
      await deps.prisma.botMessageVu
        .update({ where: { id: entree.messageId }, data: { termineLe: maintenant } })
        .catch(() => {});
    }
  }

  /* La purge se fait ici plutot que dans un job : la table ne vit que par ce
     chemin, et une ligne de trois jours n'a plus aucune relivraison a bloquer. */
  await deps.prisma.botMessageVu
    .deleteMany({ where: { reclameLe: { lt: new Date(maintenant.getTime() - RETENTION_VUS_MS) } } })
    .catch(() => {});
}

/**
 * La cle de conversation d'un numero WhatsApp quelconque.
 *
 * Une ACHETEUSE peut ecrire de n'importe ou — la diaspora qui commande pour
 * sa famille est un cas reel, decouvert au premier essai sandbox (numero
 * belge). `normalizePhone` reste la regle pour tout ce qui est camerounais
 * (comptes vendeuses, numero de rappel de livraison) ; la cle de conversation,
 * elle, accepte tout wa_id plausible.
 */
export function cleConversation(waId: string): string | null {
  const camerounais = normalizePhone(waId);
  if (camerounais) return camerounais;
  const chiffres = waId.replace(/^\+/, "");
  return /^\d{6,15}$/.test(chiffres) ? `+${chiffres}` : null;
}

/**
 * L'aiguillage — ADR 0034.
 *
 * On route sur le GESTE, plus sur l'identite. Deux defauts corriges d'un
 * coup : une vendeuse peut desormais acheter chez une consoeur (le demi-gros
 * est la norme sur ce marche), et une prospect qui ecrit au numero se voit
 * proposer d'ouvrir sa boutique au lieu d'etre renvoyee a un lien qu'elle
 * n'a pas.
 */
/**
 * Le STOP qui gele le reversement — ADR 0061, rang 2b.
 *
 * Rend `true` quand le message a ete TRAITE ici : l'appelant s'arrete alors,
 * et le message ne traverse ni l'aiguillage ni la machine d'achat.
 *
 * ── Pourquoi passer par le journal d'audit plutot qu'une table ─────────
 *
 * L'alerte y est deja consignee (`reversement_alerte`), en ajout seul, avec le
 * numero destinataire. C'est exactement l'index dont le STOP a besoin, et le
 * signal de securite reste dans le registre indelebile plutot que dans une
 * table qu'on pourrait vider.
 */
async function filStopReversement(
  deps: BotDeps,
  phone: string,
  entree: EntreeBot,
): Promise<boolean> {
  if (entree.genre !== "texte") return false;
  const maintenant = deps.maintenant?.() ?? new Date();

  const alerte = await deps.prisma.sellerAuditEvent.findFirst({
    where: { kind: "reversement_alerte", payload: { path: ["vers"], equals: phone } },
    orderBy: { at: "desc" },
    select: { sellerId: true, at: true },
  });

  const decision = decisionGel({
    texte: entree.texte,
    alerteEnvoyeeA: alerte?.at ?? null,
    maintenant,
  });
  if (!decision.geler || !alerte) return false;

  const effet = effetDuGel(maintenant);
  await deps.prisma.$transaction(async (tx) => {
    await tx.seller.update({ where: { id: alerte.sellerId }, data: effet });
    await tx.sellerAuditEvent.create({
      data: {
        sellerId: alerte.sellerId,
        kind: "reversement_gele",
        actor: "systeme",
        payload: { surStopDe: phone },
        at: maintenant,
      },
    });
  });

  /**
   * L'accuse est bref et ne nomme rien. Celui qui lit peut etre la vendeuse
   * — auquel cas il la rassure — ou quelqu'un d'autre, auquel cas il ne lui
   * apprend ni quelle boutique, ni quel numero, ni quoi faire ensuite.
   */
  await deps.envoyeur.envoyer(
    texte(
      entree.de,
      "C'est noté : les paiements à l'avance sont suspendus sur ce compte. " +
        "Nous allons vous contacter.",
    ),
  );
  return true;
}

async function traiterEntree(deps: BotDeps, entree: EntreeBot): Promise<void> {
  const phone = cleConversation(entree.de);
  if (!phone) return;

  /* Le message entrant vient d'OUVRIR la fenetre de service : les
     notifications en attente partent d'abord (ADR 0035), la reponse suit. */
  await livrerNotificationsEnAttente(deps, phone);

  /**
   * ── Le STOP passe AVANT l'aiguillage — ADR 0061, rang 2b ──────────────
   *
   * Il vient de l'ANCIEN numero de reversement, qui n'est presque jamais le
   * numero de connexion de la vendeuse : l'aiguillage le prendrait pour une
   * acheteuse et lui repondrait un catalogue. Le seul endroit ou ce message
   * peut etre reconnu est ici, avant toute regle d'identite.
   */
  if (await filStopReversement(deps, phone, entree)) return;

  /**
   * La vendeuse se reconnait par `authUser.phoneNumber` OU par `seller.phone` :
   * une vendeuse nee de la ceremonie Google n'a pas de numero de connexion —
   * son numero de contact est un attribut du profil (ADR 0029). Sans la
   * seconde recherche, elle serait traitee en acheteuse et son SMS colle
   * recevrait une reponse d'acheteuse (T4).
   */
  const utilisateur = await deps.prisma.authUser.findUnique({
    where: { phoneNumber: phone },
    include: { seller: true },
  });
  const vendeuse =
    utilisateur?.seller ??
    (await deps.prisma.seller.findUnique({ where: { phone }, select: { id: true } }));
  const enregistrement = await deps.prisma.botConversation.findUnique({ where: { phone } });
  /* Le flux vendeuse perime comme le flux acheteuse — ADR 0048. Ici, et pas
     dans `filInscription` : la regle 1 de l'aiguillage lit `etatVendeuseEnCours`
     AVANT tout le reste, donc un etat perime doit avoir disparu des ce point
     ou il continuerait de detourner le message. */
  const etatVendeuseLu = normaliserEtatVendeuse(enregistrement?.etat);
  const etatVendeuse =
    etatVendeuseLu && enregistrement
      ? etatVendeuseApresInactivite(
          etatVendeuseLu,
          (deps.maintenant?.() ?? new Date()).getTime() - enregistrement.updatedAt.getTime(),
        )
      : etatVendeuseLu;
  const etatAchat = etatVendeuse ? ETAT_INITIAL : normaliserEtat(enregistrement?.etat);

  const smsReconnu =
    vendeuse != null && entree.genre === "texte" && analyserSms(entree.texte).reconnu;

  const fil = aiguiller(
    {
      genre: entree.genre,
      ...(entree.genre === "texte" ? { texte: entree.texte } : {}),
      ...(entree.genre === "bouton" || entree.genre === "liste" ? { id: entree.id } : {}),
    },
    {
      estVendeuse: vendeuse != null,
      etatVendeuseEnCours: etatVendeuse !== null,
      smsReconnu,
      achatEnCours: etatAchat.nom !== "accueil",
      /* Le jeton vit dans la charge utile, que l'aiguillage ne lit pas :
         c'est ICI qu'on le regarde, une fois, pour toutes les regles. */
      formulaireArticle: entree.genre === "flux" && genreDuJeton(entree.reponse) === "article",
    },
  );

  if (fil === "inscription") {
    await filInscription(deps, entree, phone, etatVendeuse, vendeuse?.id ?? null);
    return;
  }
  if (fil === "vendeuse" && vendeuse) {
    await filVendeuse(deps, entree, vendeuse.id);
    return;
  }
  await filAcheteuse(deps, entree, phone);
}

/* ────────────────────────── fil inscription ─────────────────────────────── */

/**
 * L'inscription d'une vendeuse et l'ajout d'article — ADR 0034.
 *
 * Le numero est ATTESTE par le message entrant : Meta nous donne le `wa_id`,
 * personne ne peut l'usurper. C'est la meme force de preuve que le defi de
 * l'ADR 0027, dans l'autre sens — donc aucun code a ressaisir.
 *
 * **Le numero de reversement n'est jamais touche ici** (AGENTS.md §2). Une
 * boutique nee dans le fil vend en `sans_prepaiement` jusqu'a ce que sa
 * vendeuse pose son reversement, avec son OTP propre, dans l'espace vendeuse.
 */
async function filInscription(
  deps: BotDeps,
  entree: EntreeBot,
  phone: string,
  etatCourant: EtatVendeuse | null,
  sellerId: string | null,
): Promise<void> {
  /* L'entree dans le fil : « vendre », « vendre avec <marraine> », le bouton
     de l'aide acheteuse, ou « ajouter » pour une vendeuse installee. */
  let etat: EtatVendeuse;
  if (etatCourant) {
    etat = etatCourant;
  } else if (sellerId && entree.genre === "texte" && demandeComptoir(entree.texte)) {
    /* Le comptoir vendeuse — rang 1, ADR 0061. « Vendu » ouvre la declaration
       d'une vente negociee ; quatre questions, puis le moteur. */
    etat = { nom: "comptoir", comptoir: COMPTOIR_DEPART };
    await poserEtat(deps, phone, etat);
    await deps.envoyeur.envoyer(questionDeLEtat(etat, entree.de));
    return;
  } else if (sellerId) {
    etat = { nom: "article_nom" };
  } else {
    const demande = entree.genre === "texte" ? demandeInscription(entree.texte) : {};
    etat = { nom: "inscription_nom", ...(demande?.parrain ? { parrain: demande.parrain } : {}) };
    await poserEtat(deps, phone, etat);
    /**
     * ── Le formulaire s'AJOUTE a la question, il ne la remplace pas ──────
     *
     * Meme regle que l'avis (ADR 0063) et que la livraison (ADR 0055) : un
     * Flow exige un WhatsApp recent, la question marche partout. Celle qui
     * peut l'ouvrir s'inscrit d'un geste ; les autres suivent le chemin
     * d'avant, intact — et c'est le meme etat, donc une vendeuse peut
     * commencer par le formulaire, l'abandonner, et repondre a la question.
     *
     * Sans `WABOT_FLUX_INSCRIPTION_ID`, rien n'est envoye et le fil est
     * exactement celui d'hier (AGENTS.md §5).
     */
    await envoyerSequence(deps, [
      texte(entree.de, PREMIERE_QUESTION),
      ...(deps.fluxInscriptionId
        ? [
            messageFlux(
              entree.de,
              deps.fluxInscriptionId,
              "Remplir le formulaire",
              jetonFlux("inscription"),
              "Plus rapide : tout d'un coup, dans un formulaire.",
            ),
          ]
        : []),
    ]);
    return;
  }

  /**
   * ── La reponse du formulaire d'article — tache #62 ────────────────────
   *
   * Traitee ICI et pas dans la machine, comme l'inscription : les formulaires
   * arrivent tous par le meme `nfm_reply`, et c'est le jeton qui les separe
   * (ADR 0063). Elle passe AVANT la question directe, sinon une reponse
   * arrivant apres l'expiration de l'etat serait avalee par « quel est le
   * nom de l'article ? ».
   *
   * Illisible : on le dit, et la question reste — le formulaire est un
   * raccourci, jamais un passage oblige (meme regle que l'inscription).
   */
  if (sellerId && entree.genre === "flux" && genreDuJeton(entree.reponse) === "article") {
    const lu = lireArticleFlux(entree.reponse);
    if (!lu) {
      await poserEtat(deps, phone, { nom: "article_nom" });
      await deps.envoyeur.envoyer(
        texte(entree.de, "Le formulaire n'a pas pu être lu. Reprenons ici, c'est aussi rapide."),
      );
      await deps.envoyeur.envoyer(
        texte(
          entree.de,
          "*Quel est le nom de l'article ?*\nExemple : Pagne wax 6 yards\n\nPlus rapide : envoyez directement la photo, avec « nom prix » en légende.",
        ),
      );
      return;
    }
    await poserEtat(deps, phone, ETAT_INITIAL);
    await envoyerSequence(deps, await publierArticleDepuisFil(deps, sellerId, entree.de, lu));
    return;
  }

  /* Une vendeuse installee qui vient d'appuyer sur « Autre article » entre
     directement dans l'etat — sans que son appui soit lu comme un nom. Une
     PHOTO, elle, traverse jusqu'a la machine : legendee « nom prix », c'est
     deja l'article entier (ADR 0035). */
  if (!etatCourant && sellerId && entree.genre !== "image") {
    await poserEtat(deps, phone, etat);
    /* Le formulaire s'AJOUTE a la question — meme regle que l'inscription
       (tache #60) : un Flow exige un WhatsApp recent, la question marche
       partout, et c'est le meme etat derriere les deux. La QUESTION part en
       dernier : c'est elle qui reste visible si le formulaire echoue. */
    await envoyerSequence(deps, [
      ...(deps.fluxArticleId
        ? [
            messageFlux(
              entree.de,
              deps.fluxArticleId,
              "Remplir le formulaire",
              jetonFlux("article"),
              "Ou tout d'un coup, dans un formulaire : nom, prix, stock.",
            ),
          ]
        : []),
      texte(
        entree.de,
        "*Quel est le nom de l'article ?*\nExemple : Pagne wax 6 yards\n\nPlus rapide : envoyez directement la photo, avec « nom prix » en légende.",
      ),
    ]);
    return;
  }

  /**
   * ── La reponse du formulaire d'inscription — tache #60 ────────────────
   *
   * Elle est traitee ICI et pas dans la machine, parce que `entreePourMachine`
   * exclut deliberement le genre `flux` : les trois formulaires arrivent par
   * le meme `nfm_reply`, et c'est le jeton qui les separe (ADR 0063).
   *
   * Une reponse ILLISIBLE ne fait pas echouer l'inscription : on le dit, et la
   * question posee reste la. Le formulaire est un raccourci, jamais un passage
   * oblige — une vendeuse ne doit pas se retrouver coincee parce qu'un champ
   * est revenu vide.
   */
  if (
    !sellerId &&
    entree.genre === "flux" &&
    genreDuJeton(entree.reponse) === "inscription" &&
    (etat.nom === "inscription_nom" || etat.nom === "inscription_ville")
  ) {
    const lue = lireInscriptionFlux(entree.reponse);
    if (!lue) {
      await deps.envoyeur.envoyer(
        texte(entree.de, "Le formulaire n'a pas pu être lu. Reprenons ici, c'est aussi rapide."),
      );
      await deps.envoyeur.envoyer(questionDeLEtat(etat, entree.de));
      return;
    }
    const parrain = "parrain" in etat ? etat.parrain : undefined;
    const cree = await creerBoutique(deps, phone, {
      nomBoutique: lue.nomBoutique,
      ville: lue.ville,
      ...(parrain ? { parrain } : {}),
    });
    const suite: MessageSortant[] = cree.ok
      ? messageBoutiqueCreee(entree.de, cree.messagerie)
      : [texte(entree.de, cree.message)];
    if (cree.ok) {
      if (deps.planifierRelanceReversement) {
        await deps
          .planifierRelanceReversement({ sellerId: cree.id, phone })
          .catch(() => console.warn("bot : relance reversement non planifiee (details retenus)"));
      }
      /* Une boutique neuve n'a AUCUNE page — meme raison qu'au chemin
         question par question (ADR 0065). */
      await deps.reconstruction?.demander("boutique_creee");
    }
    await poserEtat(deps, phone, cree.ok ? { nom: "article_nom" } : etat);
    if (cree.ok) {
      /* Celle qui vient de remplir UN formulaire est exactement celle qui en
         remplira un second : il s'ajoute a la question, comme partout. */
      if (deps.fluxArticleId) {
        suite.push(
          messageFlux(
            entree.de,
            deps.fluxArticleId,
            "Remplir le formulaire",
            jetonFlux("article"),
            "Ou tout d'un coup, dans un formulaire : nom, prix, stock.",
          ),
        );
      }
      suite.push(
        texte(
          entree.de,
          "*Quel est le nom de votre premier article ?*\nExemple : Pagne wax 6 yards\n\nPlus rapide : envoyez directement la photo, avec « nom prix » en légende.",
        ),
      );
    }
    await envoyerSequence(deps, suite);
    return;
  }

  const reaction = reagirInscription(etat, entreePourMachine(entree), entree.de);
  const messages = [...reaction.messages];
  let etatSuivant: EtatVendeuse | EtatConv = reaction.etat ?? ETAT_INITIAL;

  /**
   * « Voir la boutique » — ADR 0052. Le fil vendeuse se libere, et le geste
   * d'achat mis de cote REPART, comme s'il venait d'arriver. Sans ce rejeu,
   * la personne aurait appuye sur un bouton pour ne rien recevoir.
   */
  if (reaction.effet?.type === "aller_boutique") {
    const slug = reaction.effet.slug;
    await poserEtat(deps, phone, ETAT_INITIAL);
    await filAcheteuse(deps, { genre: "texte", de: entree.de, texte: `boutique ${slug}` }, phone);
    return;
  }

  if (reaction.effet?.type === "creer_boutique") {
    const cree = await creerBoutique(deps, phone, reaction.effet);
    if (cree.ok) {
      messages.push(...messageBoutiqueCreee(entree.de, cree.messagerie));
      /* La relance « posez votre reversement » a ~20 h (ADR 0035) : le
         travail re-decide sur l'etat reel — posee entre-temps, silence. */
      if (deps.planifierRelanceReversement) {
        await deps
          .planifierRelanceReversement({ sellerId: cree.id, phone })
          .catch(() => console.warn("bot : relance reversement non planifiee (details retenus)"));
      }
    } else {
      messages.push(texte(entree.de, cree.message));
    }
    /* Une boutique neuve n'a AUCUNE page : l'accueil de la boutique publique
       la liste, et la sienne n'existe pas encore. Le regroupement absorbera
       la publication d'article qui suit dans la foulee. */
    await deps.reconstruction?.demander("boutique_creee");
  }

  if (reaction.effet?.type === "creer_vente" && sellerId) {
    messages.push(...(await creerVenteAuComptoir(deps, sellerId, entree.de, reaction.effet.vente)));
  }

  if (reaction.effet?.type === "creer_article" && sellerId) {
    /* Le corps vit dans `publierArticleDepuisFil` : le formulaire d'article
       (tache #62) publie par le MEME chemin — un seul endroit decide de ce
       qui accompagne une publication (carte, pack, mode d'emploi). */
    messages.push(...(await publierArticleDepuisFil(deps, sellerId, entree.de, reaction.effet)));
    etatSuivant = ETAT_INITIAL;
  }

  /* L'ENTREE dans « nom de l'article » — d'ou qu'elle vienne : bouton
     « Premier article », « ajouter », « corriger » au recapitulatif. Le
     formulaire s'insere AVANT les messages de la machine : la question de la
     machine reste en dernier, visible si le formulaire echoue. On n'envoie
     rien quand l'etat ne fait que BOUCLER sur article_nom (nom refuse) —
     reproposer le formulaire a chaque faute de frappe serait du bruit. */
  if (
    deps.fluxArticleId &&
    typeof etatSuivant === "object" &&
    etatSuivant.nom === "article_nom" &&
    etat.nom !== "article_nom" &&
    messages.length > 0
  ) {
    messages.unshift(
      messageFlux(
        entree.de,
        deps.fluxArticleId,
        "Remplir le formulaire",
        jetonFlux("article"),
        "Ou tout d'un coup, dans un formulaire : nom, prix, stock.",
      ),
    );
  }
  await poserEtat(deps, phone, etatSuivant);
  await envoyerSequence(deps, messages);
}

/**
 * Une entree de livraison, ramenee a ce que les machines pures attendent :
 * le geste, sans l'expediteur. Les deux machines acceptent cette union — le
 * fil acheteuse l'a typee, l'inscription lui est structurellement compatible.
 */
function entreePourMachine(
  entree: EntreeBot,
): Exclude<EntreeMachine, { genre: "flux" } | { genre: "localisation" }> {
  const id = entree.messageId ? { messageId: entree.messageId } : {};
  switch (entree.genre) {
    case "texte":
      return { genre: "texte", texte: entree.texte, ...id };
    case "image":
      return {
        genre: "image",
        mediaId: entree.mediaId,
        ...(entree.legende ? { legende: entree.legende } : {}),
        ...id,
      };
    case "autre":
      return { genre: "autre", forme: entree.forme, ...id };
    /* Une reponse de Flow n'a de sens que dans le fil ACHETEUSE — ADR 0055.
       Les machines vendeuse et inscription ne la connaissent pas : elle y
       devient une forme non lue, donc une phrase plutot qu'un silence.
       `entreePourAcheteuse` est la seule a la laisser passer entiere. */
    case "flux":
      return { genre: "autre", forme: "inconnue", ...id };
    /* Une position n'a de sens que dans le fil ACHETEUSE, a l'etape livraison.
       Ailleurs — inscription, fil vendeuse — elle devient une forme non lue,
       donc une phrase plutot qu'un silence (ADR 0049). */
    case "localisation":
      return { genre: "autre", forme: "localisation", ...id };
    default:
      return { genre: entree.genre, id: entree.id, ...id };
  }
}

/**
 * La meme entree, pour la machine ACHETEUSE — elle seule sait lire une
 * reponse de Flow (ADR 0055). Le contenu voyage brut : `lireReponseFlux` le
 * relit dans le domaine, ou il est teste.
 */
function entreePourAcheteuse(entree: EntreeBot): EntreeMachine {
  const id = entree.messageId ? { messageId: entree.messageId } : {};
  if (entree.genre === "flux") return { genre: "flux", reponse: entree.reponse, ...id };
  /* La position entiere, avec ses deux coordonnees — seule la machine
     acheteuse sait quoi en faire, et seulement a l'etape livraison. */
  if (entree.genre === "localisation") {
    return { genre: "localisation", lat: entree.lat, lng: entree.lng, ...id };
  }
  return entreePourMachine(entree);
}

/**
 * Ou livrer, en une ligne lisible — ADR 0050.
 *
 * Il n'y a pas d'adresse au Cameroun (ADR 0005) : la destination se dit par
 * une ville, un quartier et un REPERE, et c'est le repere qui fait le travail
 * (« en face de la pharmacie Bleue »). Un point de retrait convenu est un
 * mode de livraison de plein droit, pas un cas degrade — il se dit donc
 * aussi.
 */
function destinationLisible(livraison: unknown): string | null {
  const l = livraison as Record<string, unknown> | null;
  if (!l || typeof l !== "object") return null;
  if (l.mode === "retrait") {
    return typeof l.pickupPoint === "string" && l.pickupPoint ? `Retrait : ${l.pickupPoint}` : null;
  }
  const parts = [l.city, l.quartier, l.landmark].filter(
    (x): x is string => typeof x === "string" && x.trim() !== "",
  );
  return parts.length > 0 ? `Livraison : ${parts.join(", ")}` : null;
}

/** Un message qui ouvre un Flow — ADR 0055. Confort, jamais contenu. */
function estFlux(m: MessageSortant): boolean {
  return (
    m.type === "interactive" &&
    (m as { interactive?: { type?: string } }).interactive?.type === "flow"
  );
}

/**
 * L'envoi d'une sequence, avec les trois replis de l'ADR 0035 puis 0055 :
 * - une REACTION refusee ne casse jamais la suite — c'est un confort ;
 * - un FLOW refuse non plus, et c'est ce qui rend vraie la promesse de
 *   l'ADR 0055 : la question part APRES, et elle doit partir meme quand le
 *   formulaire est refuse. Un Flow depublie, un identifiant perime, un
 *   numero non eligible — et sans ce repli, l'acheteuse recevrait le
 *   silence a l'etape la plus couteuse du parcours ;
 * - une CITATION refusee fait repartir le message nu — le contenu prime.
 * Le sandbox v1 n'a confirme aucune de ces formes : on les tente, on ne
 * parie jamais la conversation dessus.
 */
async function envoyerSequence(deps: BotDeps, messages: MessageSortant[]): Promise<void> {
  for (const m of messages) {
    if (m.type === "reaction") {
      await deps.envoyeur.envoyer(m).catch(() => {});
      continue;
    }
    if (estFlux(m)) {
      await deps.envoyeur
        .envoyer(m)
        .catch((e) => console.warn(`bot : formulaire de livraison refuse (${resumerErreur(e)})`));
      continue;
    }
    try {
      await deps.envoyeur.envoyer(m);
    } catch (e) {
      if ("context" in m && m.context) {
        await deps.envoyeur.envoyer(sansCitation(m));
      } else {
        throw e;
      }
    }
  }
}

async function poserEtat(
  deps: BotDeps,
  phone: string,
  etat: EtatVendeuse | EtatConv,
): Promise<void> {
  const valeur = etat as unknown as object;
  await deps.prisma.botConversation.upsert({
    where: { phone },
    create: { phone, etat: valeur },
    update: { etat: valeur },
  });
}

/**
 * Le compte ET la boutique, en une transaction.
 *
 * Le compte suit le patron de l'ADR 0027 (`signUpOnVerification` du plugin
 * `phoneNumber`) : recherche par numero, creation au premier passage,
 * `phoneNumberVerified` a vrai — le message entrant EST la verification.
 *
 * `Seller.phone` est UNIQUE, et c'est l'anti-squat des boutiques : une
 * collision se dit clairement, elle ne devient jamais une exception.
 */
async function creerBoutique(
  deps: BotDeps,
  phone: string,
  demande: { nomBoutique: string; ville: string; parrain?: string },
): Promise<
  | {
      ok: true;
      id: string;
      messagerie: {
        nom: string;
        lienBoutique: string;
        lienParrainage: string;
        lienEspace: string | null;
      };
    }
  | { ok: false; message: string }
> {
  /* La marraine est resolue AVANT la transaction : un slug inconnu n'empeche
     pas d'ouvrir la boutique, il perd seulement l'attribution. */
  const parrain = demande.parrain
    ? await deps.prisma.seller.findUnique({
        where: { slug: demande.parrain },
        select: { id: true },
      })
    : null;

  const slug = await slugLibre(deps.prisma, slugifier(demande.nomBoutique));

  try {
    const seller = await deps.prisma.$transaction(async (tx) => {
      const compte =
        (await tx.authUser.findUnique({ where: { phoneNumber: phone }, select: { id: true } })) ??
        (await tx.authUser.create({
          data: {
            email: emailTechnique(phone),
            name: phone,
            phoneNumber: phone,
            phoneNumberVerified: true,
          },
          select: { id: true },
        }));

      return tx.seller.create({
        data: {
          userId: compte.id,
          phone,
          businessName: demande.nomBoutique,
          slug,
          city: demande.ville,
          canalOuverture: "bot",
          ...(parrain ? { parrainId: parrain.id } : {}),
        },
        select: { id: true, businessName: true, slug: true },
      });
    });

    return {
      ok: true,
      id: seller.id,
      messagerie: {
        nom: seller.businessName,
        lienBoutique: lienBot(deps, `boutique ${seller.slug}`),
        lienParrainage: lienBot(deps, `vendre avec ${seller.slug}`),
        lienEspace: deps.baseApp || null,
      },
    };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return {
        ok: false,
        message:
          "Une boutique existe déjà sur ce numéro. Écrivez « ma boutique » pour la retrouver.",
      };
    }
    throw e;
  }
}

/** Un lien `wa.me` vers le bot, texte pre-rempli. Sans numero : pas de lien. */
function lienBot(deps: BotDeps, texteInitial: string): string {
  const chiffres = (deps.numeroCatalog ?? "").replace(/\D/g, "");
  return chiffres
    ? `https://wa.me/${chiffres}?text=${encodeURIComponent(texteInitial)}`
    : texteInitial;
}

/**
 * L'article publie depuis le fil, photo comprise.
 *
 * La photo passe par le MEME pipeline que l'espace vendeuse — validation de
 * signature binaire, rotation EXIF, retrait des metadonnees (donc des
 * coordonnees GPS du domicile), re-encodage sous 100 Ko (ADR 0016). Rien
 * n'est allege parce que l'origine est WhatsApp : le client n'est jamais cru,
 * et WhatsApp est un client comme un autre.
 *
 * Une photo illisible ne fait pas echouer l'article : il se publie sans, et
 * la vendeuse peut la renvoyer. Un article sans photo vaut mieux qu'aucun.
 */
/**
 * Publier un article, et tout ce qui l'accompagne — le SEUL chemin.
 *
 * Deux entrees y menent : l'effet `creer_article` de la machine (questions ou
 * photo legendee) et la reponse du formulaire d'article (tache #62). Les deux
 * doivent produire exactement la meme suite — l'annonce, la reconstruction de
 * la page web (ADR 0065), la carte-vitrine au premier article (ADR 0037), le
 * pack statut a chaque publication (rang 3a) et le mode d'emploi au premier
 * article (tache #62). Un second exemplaire de cette liste divergerait au
 * premier lot venu.
 */
async function publierArticleDepuisFil(
  deps: BotDeps,
  sellerId: string,
  vers: string,
  demande: { nom: string; prixXaf: number; mediaId?: string; stock?: number },
): Promise<MessageSortant[]> {
  const messages: MessageSortant[] = [];
  const article = await creerArticleDepuisFil(deps, sellerId, demande);
  /* L'etat de conges se relit ICI, dans la base — ADR 0057. Elle a pu
     fermer depuis un autre appareil, ou depuis l'app, entre deux messages :
     c'est le meme principe que le verrou de creation de commande. */
  const enConges =
    (
      await deps.prisma.seller.findUnique({
        where: { id: sellerId },
        select: { congesDepuis: true },
      })
    )?.congesDepuis != null;
  /**
   * La page WEB se reconstruit — ADR 0065.
   *
   * L'article entre en base tout de suite ; la boutique publique, elle, lit
   * un instantane pris a la CONSTRUCTION. Sans ce declenchement, une
   * boutique nee dans le fil restait en 404 — mesure du 11/08/2026.
   *
   * Le delai n'est annonce que si la demande est REELLEMENT partie : sans
   * crochet configure, ou si le regroupement l'absorbe, la page n'arrivera
   * pas dans le delai qu'on annoncerait. Le silence est alors honnete.
   */
  const pageWebDansMinutes =
    article && (await deps.reconstruction?.demander("article_publie"))
      ? ATTENTE_ANNONCEE_MIN
      : null;
  messages.push(
    article
      ? messageArticlePublie(vers, article, enConges, pageWebDansMinutes)
      : texte(
          vers,
          "Cet article n'a pas pu être enregistré. Réessayez avec « ajouter » — rien n'a été perdu.",
        ),
  );
  /**
   * La carte-vitrine part au moment ou la boutique devient MONTRABLE : a la
   * publication du PREMIER article (ADR 0037). Pas a la creation — une carte
   * sans article ne donne envie a personne — et pas aux suivants, ce serait
   * du bruit ; « ma carte » la redonne quand on veut.
   */
  if (article) {
    const nb = await deps.prisma.product.count({
      where: { sellerId, archivedAt: null },
    });
    if (nb === 1) {
      messages.push(...(await carteVitrine(deps, sellerId).catch(() => [])));
    }
    /**
     * Le pack statut part a CHAQUE publication — ADR 0061, rang 3a.
     *
     * La carte-vitrine, elle, ne part qu'au premier article : elle dit « la
     * boutique existe », une fois. Le pack dit « poste CELUI-CI aujourd'hui »,
     * et c'est vrai a chaque fois. Sur la premiere publication les deux
     * partent, et c'est voulu : ils ne disent pas la meme chose.
     */
    messages.push(...(await packStatutArticle(deps, sellerId, article).catch(() => [])));
    /**
     * Le mode d'emploi — tache #62, et il part EN DERNIER : c'est lui qui
     * reste sous le pouce. Au premier article seulement, comme la carte, et
     * pour la meme raison — c'est l'instant ou la boutique devient reelle,
     * donc l'instant ou « que se passe-t-il maintenant ? » se pose.
     */
    if (nb === 1) {
      const profil = await deps.prisma.seller.findUnique({
        where: { id: sellerId },
        select: { slug: true },
      });
      messages.push(
        messageOnboarding(vers, {
          lienBoutique: profil && deps.baseBoutique ? `${deps.baseBoutique}/${profil.slug}` : null,
          lienEspace: deps.baseApp ?? null,
        }),
      );
    }
  }
  return messages;
}

async function creerArticleDepuisFil(
  deps: BotDeps,
  sellerId: string,
  demande: { nom: string; prixXaf: number; mediaId?: string; stock?: number },
): Promise<{
  id: string;
  nom: string;
  prixXaf: number;
  avecPhoto: boolean;
  imageKey: string | null;
} | null> {
  const alea = deps.aleatoire ?? ((n: number) => new Uint8Array(randomBytes(n)));

  let image: {
    cle: string;
    largeur: number;
    hauteur: number;
    octets: number;
  } | null = null;

  if (demande.mediaId && deps.media && deps.storage) {
    const media = await deps.media.lire(demande.mediaId);
    if (media) {
      const resultat = await reencoderImage(media.octets);
      if (resultat.ok) {
        const base = cleOpaque(alea);
        const d = declinaisons(base);
        await Promise.all([
          deps.storage.put({ cle: d.avif, corps: resultat.image.avif, contentType: "image/avif" }),
          deps.storage.put({ cle: d.webp, corps: resultat.image.webp, contentType: "image/webp" }),
          deps.storage.put({ cle: d.jpg, corps: resultat.image.jpeg, contentType: "image/jpeg" }),
        ]);
        image = {
          cle: base,
          largeur: resultat.image.largeur,
          hauteur: resultat.image.hauteur,
          octets: resultat.image.avif.length,
        };
      }
    }
  }

  const dernier = await deps.prisma.product.aggregate({
    where: { sellerId },
    _max: { position: true },
  });

  const cree = await deps.prisma.product
    .create({
      data: {
        sellerId,
        name: demande.nom,
        priceXaf: demande.prixXaf,
        position: (dernier._max.position ?? -1) + 1,
        /* Le stock du formulaire (tache #62). Absent = 0, la valeur « non
           annonce » de l'ADR 0038 — il ne se decompte pas tout seul. */
        ...(demande.stock ? { stock: demande.stock } : {}),
        ...(image
          ? {
              imageKey: image.cle,
              imageWidth: image.largeur,
              imageHeight: image.hauteur,
              imageBytes: image.octets,
            }
          : {}),
      },
      select: { id: true, name: true, priceXaf: true },
    })
    .catch(() => null);

  return cree
    ? {
        id: cree.id,
        nom: cree.name,
        prixXaf: cree.priceXaf,
        avecPhoto: image !== null,
        /* La cle sert au pack statut (rang 3a) : la photo se recompose sur la
           carte, elle ne se re-telecharge pas depuis WhatsApp. */
        imageKey: image?.cle ?? null,
      }
    : null;
}

/* ────────────────────────── fil acheteuse ───────────────────────────────── */

async function filAcheteuse(deps: BotDeps, entree: EntreeBot, phone: string): Promise<void> {
  const maintenant = deps.maintenant?.() ?? new Date();
  const enregistrement = await deps.prisma.botConversation.findUnique({ where: { phone } });
  const langue: Langue = normaliserLangue(enregistrement?.langue);
  const t = TEXTES[langue];

  /* L'etat se RELIT (toutes generations confondues), puis perime : un flux
     abandonne depuis plus de 24 h retombe sur le catalogue (ADR 0032). */
  let etat = normaliserEtat(enregistrement?.etat ?? ETAT_INITIAL);
  if (enregistrement) {
    etat = etatApresInactivite(etat, maintenant.getTime() - enregistrement.updatedAt.getTime());
  }
  const etatAvant = etat.nom;

  /* Le slug vient du texte (lien d'entree) ou de l'etat courant. */
  const slugDuTexte = entree.genre === "texte" ? extraireSlugBoutique(entree.texte) : null;
  const slug = slugDuTexte ?? ("slug" in etat ? etat.slug : null);
  const charge = slug ? await chargerBoutique(deps, slug) : null;
  const boutique = charge?.boutique ?? null;

  /* L'image, seulement la ou elle s'affiche : l'accueil (entree par lien), la
     fiche article, et la rafale « voir en photos » (ADR 0035). Jamais d'URL
     non verifiee — un lien mort fait refuser le message entier par l'API. */
  if (boutique && charge) {
    const idGeste = entree.genre === "bouton" || entree.genre === "liste" ? entree.id : null;
    if (idGeste === "photos") {
      /* La rafale : autant d'URL verifiees que d'images qui partiront. */
      const illustres = boutique.articles.filter((a) => charge.clesImage.has(a.id));
      await Promise.all(
        illustres.slice(0, RAFALE_MAX).map(async (a) => {
          const cle = charge.clesImage.get(a.id);
          const url = cle ? await urlJpegVerifiee(deps, cle) : null;
          if (url) a.imageUrl = url;
        }),
      );
    } else {
      const articleVise = idGeste?.startsWith("art:") ? idGeste.slice(4) : null;
      const cibleId = articleVise ?? (slugDuTexte ? boutique.articles[0]?.id : null) ?? null;
      if (cibleId) {
        const cle = charge.clesImage.get(cibleId);
        const url = cle ? await urlJpegVerifiee(deps, cle) : null;
        const cible = boutique.articles.find((a) => a.id === cibleId);
        if (cible && url) cible.imageUrl = url;
      }
    }
  }

  /**
   * La memoire post-achat : « ou est ma commande ? » se repond sans
   * reconcilier par numero — la conversation connait SA derniere commande.
   * Depuis l'ADR 0036, elle porte aussi ce que l'identite du fil AUTORISE, et
   * se charge donc pour les boutons autant que pour le texte.
   */
  const derniereCommande = enregistrement?.derniereCommandeId
    ? await statutDerniereCommande(deps, enregistrement.derniereCommandeId)
    : null;

  const reaction = reagirAcheteuse(etat, entreePourAcheteuse(entree), {
    vers: entree.de,
    boutique,
    derniereCommande,
    langue,
    ...(deps.fluxLivraisonId ? { fluxLivraisonId: deps.fluxLivraisonId } : {}),
    ...(deps.fluxAvisId ? { fluxAvisId: deps.fluxAvisId } : {}),
  });
  etat = reaction.etat;
  const messages = [...reaction.messages];
  let commandeCreeeId: string | null = null;

  if (reaction.effet?.type === "creer_commande" && boutique) {
    const b = reaction.effet.brouillon;
    const livraison = deliverySchema.safeParse(b.livraison);
    const resolution = resoudreLignes(boutique, b.lignes);
    /**
     * Mode conges — ADR 0039. Le verrou est RELU ici, pas seulement dans la
     * machine : entre l'affichage du recapitulatif et l'appui sur « Confirmer »,
     * la vendeuse a pu partir. La base fait foi, comme pour le stock.
     */
    if (boutique.enConges) {
      messages.push(texte(entree.de, t.boutiqueFermee(boutique.nom)));
      etat = { nom: "catalogue", slug: boutique.slug, page: 0 };
    } else if (!livraison.success || !resolution.ok) {
      messages.push(
        texte(entree.de, resolution.ok ? t.commandeRatee : t.stockInsuffisant(resolution.nom)),
      );
      etat = { nom: "catalogue", slug: boutique.slug, page: 0 };
    } else {
      const commande = await creerCommande(
        deps,
        boutique,
        resolution.articles.map((a) => ({
          productId: a.article.id,
          name: a.article.nom,
          unitPriceXaf: a.article.prixXaf,
          quantity: a.quantite,
        })),
        livraison.data,
      );
      commandeCreeeId = commande.id;
      /**
       * Le bloc paiement DANS le fil (ADR 0035) : le numero de reversement de
       * la vendeuse, l'operateur et son code d'entree lus de la CONFIGURATION
       * de la rampe — jamais une constante. `/payer` reste le confort.
       */
      const operateur =
        charge?.reversement?.operateur && deps.rampe
          ? (deps.rampe.operateurs.find((o) => o.id === charge.reversement?.operateur) ?? null)
          : null;
      const paiement =
        commande.duAvantXaf > 0 && charge?.reversement
          ? {
              montantXaf: commande.duAvantXaf,
              numeroAffiche: formatPhone(charge.reversement.numero),
              operateurNom: operateur?.nom ?? null,
              codeEntree: operateur?.codeEntree.modele ?? null,
              lienPayer: deps.baseBoutique
                ? `${deps.baseBoutique}/payer?numero=${encodeURIComponent(
                    charge.reversement.numero,
                  )}&montant=${commande.duAvantXaf}`
                : null,
              /* ADR 0061, rang 2a — la reputation au moment ou l'on paie. */
              ...(charge ? { confiance: charge.confiance } : {}),
              lienBoutique: deps.baseBoutique ? `${deps.baseBoutique}/${boutique.slug}` : null,
            }
          : null;
      const chiffresVendeuse = boutique.whatsappVendeuse?.replace(/\D/g, "") ?? "";
      messages.push(
        ...confirmationCommande(
          entree.de,
          {
            reference: commande.ref,
            codeVerification: commande.verificationCode,
            boutique: boutique.nom,
            lignes: resolution.articles.map((a) => ({
              nom: a.article.nom,
              quantite: a.quantite,
              prixUnitaireXaf: a.article.prixXaf,
            })),
            totalXaf: commande.totalXaf,
            duAvantXaf: commande.duAvantXaf,
            livraison: b.livraison,
            lienSuivi:
              deps.baseBoutique && commande.buyerToken
                ? lienDeSuivi(deps.baseBoutique, commande.buyerToken)
                : null,
            paiement,
            waVendeuse: chiffresVendeuse ? `https://wa.me/${chiffresVendeuse}` : null,
          },
          langue,
        ),
      );
      /* La vendeuse apprend la commande DANS son fil (ADR 0035) — envoi
         immediat si sa fenetre est sure, mise en attente sinon. */
      if (boutique.whatsappVendeuse) {
        await notifier(
          deps,
          boutique.whatsappVendeuse,
          corpsNouvelleCommande({
            reference: commande.ref,
            lignes: resolution.articles.map((a) => ({
              nom: a.article.nom,
              quantite: a.quantite,
            })),
            totalXaf: commande.totalXaf,
            duAvantXaf: commande.duAvantXaf,
            telephoneLivraison: formatPhone((b.livraison as { phone?: string }).phone ?? ""),
            /* OU livrer — ADR 0050. Le quartier et le repere sont
               OBLIGATOIRES cote acheteuse (AGENTS.md §2) et n'atteignaient
               aucune surface vendeuse : elle devait appeler pour le savoir. */
            destination: destinationLisible(b.livraison),
            /* Sans reversement, la vente part sans acompte : c'est ICI que la
               vendeuse doit l'apprendre, pas a la relance de ~20 h. */
            lienReversement:
              !boutique.reversementPose && deps.baseApp ? `${deps.baseApp}/reversement` : null,
            /* Ou marquer « preparee » et « chez le livreur » : le fil ne sait
               que la remise. Sans ce lien, la notification est une impasse. */
            lienEspace: deps.baseApp ? `${deps.baseApp}/commandes` : null,
          }),
          undefined,
          /* Hors fenetre, un gabarit ouvre la porte — ADR 0054. C'est LE cas
             qui justifie le palier payant : une commande arrivee a 21 h un
             vendredi n'attend plus que la vendeuse reecrive, alors qu'elle
             ne peut pas deviner qu'il y en a une. */
          {
            sujet: "nouvelle_commande",
            parametres: [
              commande.ref,
              formatXaf(commande.totalXaf),
              destinationLisible(b.livraison) ?? "à convenir avec l'acheteuse",
            ],
          },
        );
      }
      /* La relance d'acompte (ADR 0033) : planifiee seulement quand un
         acompte est attendu — le travail redecide de toute facon sur l'etat
         reel au moment de partir. */
      if (commande.duAvantXaf > 0 && deps.planifierRelance) {
        await deps
          .planifierRelance({ commandeId: commande.id, phone: entree.de, langue })
          .catch(() => console.warn("bot : relance non planifiee (details retenus)"));
      }
    }
  }

  /**
   * L'apres-achat — ADR 0036. L'autorisation est deja tranchee : ces effets ne
   * sortent de la machine que sur la DERNIERE commande du fil, et seulement
   * quand le domaine l'a permis. Aucun jeton n'est relu.
   */
  const idApresAchat = enregistrement?.derniereCommandeId ?? null;
  if (idApresAchat && reaction.effet?.type === "contresigner") {
    await transitionApresAchat(deps, idApresAchat, { type: "contresignature", par: "acheteuse" });
  }
  if (idApresAchat && reaction.effet?.type === "contester") {
    await transitionApresAchat(deps, idApresAchat, { type: "contestation", par: "acheteuse" });
    /* La vendeuse l'apprend MAINTENANT. Sans cela elle continue de preparer
       une commande deja gelee, et decouvre le litige plusieurs jours apres. */
    await notifierConteste(deps, idApresAchat);
  }
  if (idApresAchat && reaction.effet?.type === "deposer_avis") {
    await deposerAvis(deps, idApresAchat, reaction.effet.note);
  }
  if (idApresAchat && reaction.effet?.type === "deposer_avis_complet") {
    await deposerAvis(deps, idApresAchat, reaction.effet.note, reaction.effet.texte);
  }
  if (idApresAchat && reaction.effet?.type === "completer_avis") {
    await deps.prisma.review
      .update({ where: { orderId: idApresAchat }, data: { body: reaction.effet.texte } })
      .catch(() => {
        /* L'avis a pu etre purge, ou n'avoir jamais ete cree : le mot se perd,
           la note reste. On ne fabrique pas un avis depuis un commentaire. */
      });
  }

  await deps.prisma.botConversation.upsert({
    where: { phone },
    create: {
      phone,
      etat: etat as unknown as object,
      ...(reaction.langue ? { langue: reaction.langue } : {}),
      ...(commandeCreeeId ? { derniereCommandeId: commandeCreeeId } : {}),
    },
    update: {
      etat: etat as unknown as object,
      ...(reaction.langue ? { langue: reaction.langue } : {}),
      ...(commandeCreeeId ? { derniereCommandeId: commandeCreeeId } : {}),
    },
  });
  mesurerTransitionBot(etatAvant, etat.nom, reaction.effet?.type);
  await envoyerSequence(deps, messages);
}

/**
 * La carte-vitrine — ADR 0037.
 *
 * Elle est REGENEREE a chaque demande : une carte montre des articles et une
 * reputation qui changent, et une carte perimee partagee en Statut est pire
 * que pas de carte. L'objet suit exactement le regime des photos d'articles —
 * `reencoderImage`, trois declinaisons, sous 100 Ko, cle opaque, URL signee.
 *
 * Rend le message a envoyer, ou une explication : sans article la carte n'a
 * rien a montrer, sans numero Catalog elle porterait un lien faux.
 */
/**
 * Le PACK STATUT d'un article — ADR 0061, rang 3a.
 *
 * Deux messages, et leur separation compte : l'IMAGE porte une consigne qui
 * reste entre nous, la LEGENDE part telle quelle chez les clientes. Les
 * melanger ferait poster a la vendeuse une phrase qui lui etait destinee.
 *
 * Le mot-cle du lien porte le canal `statut` : chaque commande nee d'un Statut
 * se compte comme telle (rang 0). Sans lui, la vendeuse ne saurait jamais
 * lequel de ses gestes rapporte.
 *
 * Ne leve jamais : la publication de l'article est faite, le pack est un plus
 * — meme lecon que la reconstruction de boutique (ADR 0065).
 */
async function packStatutArticle(
  deps: BotDeps,
  sellerId: string,
  article: { id: string; nom: string; prixXaf: number; imageKey: string | null },
): Promise<MessageSortant[]> {
  const seller = await deps.prisma.seller.findUnique({
    where: { id: sellerId },
    select: { businessName: true, slug: true, city: true, phone: true },
  });
  const chiffres = (deps.numeroCatalog ?? "").replace(/\D/g, "");
  if (!seller || !chiffres || !deps.storage) return [];
  const a = (seller.phone ?? "").replace(/^\+/, "");
  if (!a) return [];

  const pack = packStatut({
    nomBoutique: seller.businessName,
    slug: seller.slug,
    article: {
      nom: article.nom,
      prixXaf: article.prixXaf,
      slugArticle: slugArticle(article.nom, article.id),
    },
    lien: lienBot(deps, texteEntreeBoutique({ slug: seller.slug, canal: "statut" })),
  });

  const photo = article.imageKey
    ? await deps.storage
        .lire(`${article.imageKey}.jpg`)
        .then((o) => (o ? { octets: o } : null))
        .catch(() => null)
    : null;

  const carte = await carteEnMessage(
    deps,
    {
      nomBoutique: seller.businessName,
      ville: seller.city,
      lien: lienBot(deps, pack.motCle),
      lienAffiche: `wa.me/${chiffres}`,
      motCle: pack.motCle,
      /* UN seul article : le gabarit lui donne toute la place (ADR 0037). */
      articles: [{ nom: article.nom, prixXaf: article.prixXaf, avecPhoto: photo !== null }],
    },
    [photo],
    a,
    consigneDuPack(),
  );
  /* La legende arrive SEULE, dans son propre message : c'est ce qui la rend
     transferable d'un appui long, sans rien a effacer. */
  return [...carte, texte(a, pack.legende)];
}

async function carteVitrine(deps: BotDeps, sellerId: string): Promise<MessageSortant[]> {
  const vers = (phone: string) => phone.replace(/^\+/, "");
  const seller = await deps.prisma.seller.findUnique({
    where: { id: sellerId },
    select: {
      businessName: true,
      slug: true,
      city: true,
      phone: true,
      products: {
        where: { archivedAt: null },
        orderBy: { position: "asc" },
        take: ARTICLES_MAX,
        select: { name: true, priceXaf: true, imageKey: true },
      },
      reviews: { select: { rating: true, verified: true } },
    },
  });
  if (!seller) return [];
  const a = vers(seller.phone ?? "");

  if (seller.products.length === 0) {
    return [
      boutonsMessage(a, "Votre carte a besoin d'au moins un article à montrer.", [
        { id: "article", titre: "Ajouter un article" },
      ]),
    ];
  }
  const chiffres = (deps.numeroCatalog ?? "").replace(/\D/g, "");
  if (!chiffres || !deps.storage) {
    return [
      texte(
        a,
        "La carte n'est pas disponible pour l'instant. Votre lien de boutique reste partageable : écrivez « ma boutique ».",
      ),
    ];
  }

  /* Les photos, lues depuis NOS objets pour etre composees sur le gabarit. */
  const photos = await Promise.all(
    seller.products.map(async (p) =>
      p.imageKey && deps.storage
        ? await deps.storage
            .lire(`${p.imageKey}.jpg`)
            .then((o) => (o ? { octets: o } : null))
            .catch(() => null)
        : null,
    ),
  );

  const rep = reputation(seller.reviews.map((r) => ({ note: r.rating, verifie: r.verified })));
  const motCle = `boutique ${seller.slug}`;
  return carteEnMessage(
    deps,
    {
      nomBoutique: seller.businessName,
      ville: seller.city,
      lien: lienBot(deps, motCle),
      /* Ce qui s'ECRIT a la main : le QR porte le lien pre-rempli. */
      lienAffiche: `wa.me/${chiffres}`,
      motCle,
      reputation: { note: rep.note, nbVerifies: rep.nbVerifies },
      articles: seller.products.map((p, i) => ({
        nom: p.name,
        prixXaf: p.priceXaf,
        avecPhoto: photos[i] !== null,
      })),
    },
    photos,
    a,
    `Votre carte — postez-la en Statut WhatsApp, imprimez-la pour l'étal.\nQui la scanne arrive directement dans votre boutique.`,
  );
}

/**
 * Rend une carte, l'encode, la range et la renvoie en message image.
 *
 * Extrait de `carteVitrine` au rang 3a : le pack statut (ADR 0061) rend la
 * MEME carte avec d'autres donnees et une autre legende. Deux copies de ce
 * pipeline auraient derive — et l'une des deux aurait fini par perdre le
 * calibrage de l'ADR 0059, qui est precisement ce qu'on n'a pas le droit
 * d'oublier ici.
 */
async function carteEnMessage(
  deps: BotDeps,
  donnees: Parameters<typeof rendreCarte>[0]["donnees"],
  photos: ReadonlyArray<{ octets: Uint8Array } | null>,
  a: string,
  legende: string,
): Promise<MessageSortant[]> {
  const png = await rendreCarte({ donnees, photos });

  /**
   * Le meme pipeline que les photos, mais PAS le meme calibrage — ADR 0059.
   *
   * `reencoderImage` reduit par defaut a 640 px sur le plus grand cote et
   * vise 100 Ko : c'est la regle des photos de catalogue, qui borne le poids
   * de la boutique publique (ADR 0016). Appliquee a la carte, elle ramenait
   * un 1080x1920 a 360x640 — le QR passait de 240 a 80 px, soit moins de
   * trois pixels par module. Illisible par construction, et la carte floue
   * avec lui.
   *
   * La carte n'est PAS une photo de catalogue : elle ne parait sur aucune
   * page, elle part une fois dans un fil, et son objet est d'etre scannee.
   * Elle garde donc sa definition, et son propre plafond d'octets.
   */
  const resultat = await reencoderImage(png, {
    plusGrandCote: CARTE_HAUTEUR,
    cibleOctets: CARTE_CIBLE_OCTETS,
  });
  if (!resultat.ok || !deps.storage) {
    return [texte(a, "La carte n'a pas pu être fabriquée. Réessayez dans un instant.")];
  }
  const alea = deps.aleatoire ?? ((n: number) => new Uint8Array(randomBytes(n)));
  const base = cleOpaque(alea, "carte");
  const d = declinaisons(base);
  await Promise.all([
    deps.storage.put({ cle: d.avif, corps: resultat.image.avif, contentType: "image/avif" }),
    deps.storage.put({ cle: d.webp, corps: resultat.image.webp, contentType: "image/webp" }),
    deps.storage.put({ cle: d.jpg, corps: resultat.image.jpeg, contentType: "image/jpeg" }),
  ]);
  const url = await urlJpegVerifiee(deps, base);
  if (!url) return [texte(a, "La carte n'a pas pu être publiée. Réessayez dans un instant.")];

  return [imageMessage(a, url, legende)];
}

/**
 * Une transition de preuve demandee depuis le fil — ADR 0036.
 *
 * C'est la MEME machine que la route web (`recu.ts`), et le meme contrat :
 * l'etat et le journal s'ecrivent dans une seule transaction, et un refus est
 * journalise aussi solidement qu'une acceptation. La date de contre-signature
 * vit dans `order_event`, jamais sur la preuve — `payment_proof` est en ajout
 * seul (ADR 0021).
 */
async function transitionApresAchat(
  deps: BotDeps,
  commandeId: string,
  evenement: EvenementPreuve,
): Promise<void> {
  const commande = await deps.prisma.order.findUnique({
    where: { id: commandeId },
    select: { id: true, proofState: true, sellerId: true },
  });
  if (!commande) return;

  const maintenant = deps.maintenant?.() ?? new Date();
  const resultat = appliquerEvenement(commande.proofState, evenement, maintenant);

  await deps.prisma.$transaction(async (tx) => {
    if (resultat.ok) {
      await tx.order.update({
        where: { id: commande.id },
        data: { proofState: resultat.etat },
      });
    }
    await tx.orderEvent.create({
      data: {
        orderId: commande.id,
        sellerId: commande.sellerId,
        kind: resultat.journal.kind,
        actor: resultat.journal.par,
        at: resultat.journal.at,
        payload: {
          de: resultat.journal.de,
          vers: resultat.journal.vers,
          evenement: resultat.journal.evenement,
          canal: "bot_whatsapp",
          ...(resultat.journal.raison ? { raison: resultat.journal.raison } : {}),
        },
      },
    });
  });
  mesurerEtatPreuve(resultat.ok ? resultat.etat : commande.proofState);
}

/**
 * L'avis depose depuis le fil — ADR 0036. Le droit vient de `droitAuDepot`
 * (lot 12), l'unicite de la contrainte `UNIQUE(order_id)` : on TENTE l'insert
 * et on traduit la violation, jamais un SELECT suivi d'un `if`.
 *
 * La note s'ecrit MAINTENANT ; le mot l'enrichira peut-etre ensuite.
 */
async function deposerAvis(
  deps: BotDeps,
  commandeId: string,
  note: number,
  /* Le formulaire rend la note ET le mot d'un coup : l'avis s'ecrit complet,
     dans la MEME transaction. Le chemin question-par-question, lui, passe le
     mot ensuite par `completer_avis` — les deux finissent au meme endroit. */
  mot?: string,
): Promise<void> {
  const commande = await deps.prisma.order.findUnique({
    where: { id: commandeId },
    select: {
      id: true,
      sellerId: true,
      step: true,
      totalXaf: true,
      amountPaidXaf: true,
      balanceXaf: true,
      proofState: true,
      cancelledAt: true,
      delivery: true,
      items: true,
    },
  });
  if (!commande) return;

  const droit = droitAuDepot({
    etape: commande.step,
    modeLivraison:
      (commande.delivery as { mode?: string } | null)?.mode === "retrait" ? "retrait" : "livraison",
    totalXaf: commande.totalXaf,
    amountPaidXaf: commande.amountPaidXaf,
    balanceXaf: commande.balanceXaf,
    etatPreuve: commande.proofState,
    annuleeA: commande.cancelledAt,
  });
  if (!droit.possible) return;

  /* L'article note, quand la commande n'en porte qu'un (ADR 0035). */
  const articles = new Set(
    (Array.isArray(commande.items) ? commande.items : [])
      .map((l) => (l as { productId?: unknown }).productId)
      .filter((p): p is string => typeof p === "string"),
  );
  const productId = articles.size === 1 ? [...articles][0] : null;
  const maintenant = deps.maintenant?.() ?? new Date();

  await deps.prisma
    .$transaction(async (tx) => {
      await tx.review.create({
        data: {
          orderId: commande.id,
          sellerId: commande.sellerId,
          ...(productId ? { productId } : {}),
          rating: note,
          ...(mot ? { body: mot } : {}),
          verified: droit.verifie,
          createdAt: maintenant,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: commande.id,
          sellerId: commande.sellerId,
          kind: "avis_depose",
          actor: "acheteuse",
          at: maintenant,
          payload: { verifie: droit.verifie, canal: "bot_whatsapp" },
        },
      });
    })
    .catch(() => {
      /* `Review.orderId` est UNIQUE : un second avis est refuse par la base.
         La machine l'a deja dit a l'acheteuse ; ici on se tait. */
      return "refuse" as const;
    })
    .then((r) => r !== "refuse");

  /**
   * ── La carte d'avis VERIFIE part chez la vendeuse — ADR 0061, rang 3c ──
   *
   * **Jamais pour un avis non verifie.** Un avis non verifie existe et il est
   * honnete — le depot direct non trace le produit (AGENTS.md §2) —, mais en
   * faire une carte qui dit « verifie par paiement » serait la reputation
   * achetable que le produit refuse. La condition est ici, une fois.
   *
   * Elle ne leve jamais : l'avis est enregistre, la carte est un plus.
   */
  if (droit.verifie) {
    await envoyerCarteAvis(deps, commande.sellerId, note, mot).catch(() => {});
  }
}

/**
 * Fabrique et envoie la carte d'avis verifie a la vendeuse.
 *
 * Le compteur affiche est relu APRES l'enregistrement : il compte donc l'avis
 * qui vient d'arriver. Le lire avant afficherait un nombre en retard d'une
 * unite sur la carte que la vendeuse va justement poster.
 */
async function envoyerCarteAvis(
  deps: BotDeps,
  sellerId: string,
  note: number,
  mot: string | undefined,
): Promise<void> {
  const seller = await deps.prisma.seller.findUnique({
    where: { id: sellerId },
    select: { businessName: true, slug: true, phone: true },
  });
  const chiffres = (deps.numeroCatalog ?? "").replace(/\D/g, "");
  if (!seller?.phone || !chiffres || !deps.storage) return;

  const nbVerifies = await deps.prisma.review.count({
    where: { sellerId, verified: true },
  });
  /* Le canal `chaine` : une commande nee d'un repost se compte comme telle. */
  const motCle = texteEntreeBoutique({ slug: seller.slug, canal: "chaine" });
  const png = await rendreCarteAvis(
    {
      nomBoutique: seller.businessName,
      note,
      ...(mot ? { mot } : {}),
      nbVerifies,
      lienAffiche: `wa.me/${chiffres}`,
      motCle,
    },
    lienBot(deps, motCle),
  );

  const resultat = await reencoderImage(png, {
    plusGrandCote: CARTE_HAUTEUR,
    cibleOctets: CARTE_CIBLE_OCTETS,
  });
  if (!resultat.ok) return;
  const alea = deps.aleatoire ?? ((n: number) => new Uint8Array(randomBytes(n)));
  const base = cleOpaque(alea, "carte");
  const d = declinaisons(base);
  await Promise.all([
    deps.storage.put({ cle: d.avif, corps: resultat.image.avif, contentType: "image/avif" }),
    deps.storage.put({ cle: d.webp, corps: resultat.image.webp, contentType: "image/webp" }),
    deps.storage.put({ cle: d.jpg, corps: resultat.image.jpeg, contentType: "image/jpeg" }),
  ]);
  const url = await urlJpegVerifiee(deps, base);
  if (!url) return;

  await deps.envoyeur.envoyer(
    imageMessage(
      seller.phone.replace(/^\+/, ""),
      url,
      "⭐ Un avis vérifié vient d'arriver — voici votre carte à poster.\n" +
        "Aucune concurrente ne peut poster celle-ci : elle est adossée à un paiement prouvé.",
    ),
  );
}

interface BoutiqueChargee {
  boutique: BoutiqueBot;
  /** Cle de base d'image par article — detail de stockage, hors du domaine. */
  clesImage: Map<string, string>;
  /** Le reversement pour le bloc paiement (ADR 0035) — jamais montre ailleurs. */
  reversement: { numero: string; operateur: string | null } | null;
  /**
   * Ce que la boutique a DEJA prouve, pour le dire au moment du doute
   * (ADR 0061, rang 2a). Compte a part de `reputation` : un paiement prouve
   * n'est pas un avis, et c'est le premier des deux qui rassure devant un
   * acompte.
   */
  confiance: VerdictConfiance;
}

async function chargerBoutique(deps: BotDeps, slug: string): Promise<BoutiqueChargee | null> {
  const seller = await deps.prisma.seller.findUnique({
    where: { slug },
    include: {
      products: {
        where: { archivedAt: null },
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          priceXaf: true,
          stock: true,
          description: true,
          imageKey: true,
        },
      },
      reviews: { select: { rating: true, verified: true } },
    },
  });
  if (!seller) return null;
  const rep = reputation(seller.reviews.map((a) => ({ note: a.rating, verifie: a.verified })));
  /**
   * ── Ce qui compte comme « prouve », et ce qui n'y entre pas ────────────
   *
   * Seuls `prouve` et `contresigne`. PAS `declare_non_trace` : le depot direct
   * non trace fait avancer la commande mais ne prouve rien (AGENTS.md §2), et
   * le compter ici transformerait un compteur de preuves en compteur de
   * ventes — exactement le chiffre invérifiable que le produit refuse.
   */
  const paiementsProuves = await deps.prisma.order.count({
    where: { sellerId: seller.id, proofState: { in: ["prouve", "contresigne"] } },
  });
  const clesImage = new Map<string, string>();
  for (const p of seller.products) {
    if (p.imageKey) clesImage.set(p.id, p.imageKey);
  }
  return {
    boutique: {
      id: seller.id,
      slug: seller.slug,
      nom: seller.businessName,
      ville: seller.city,
      whatsappVendeuse: seller.phone,
      reversementPose: seller.payoutPhone !== null,
      ...(seller.congesDepuis ? { enConges: true } : {}),
      reputation: { note: rep.note, nbVerifies: rep.nbVerifies },
      /* « Voir en photos » n'apparait que s'il y a au moins une photo (ADR 0035). */
      aDesPhotos: clesImage.size > 0,
      articles: seller.products.map((p) => ({
        id: p.id,
        nom: p.name,
        prixXaf: p.priceXaf,
        /* Zero veut dire « non suivi » — meme lecture que la boutique publique. */
        stock: p.stock > 0 ? p.stock : null,
        ...(p.description ? { description: p.description } : {}),
      })),
    },
    clesImage,
    reversement: seller.payoutPhone
      ? { numero: seller.payoutPhone, operateur: seller.payoutOperator ?? null }
      : null,
    confiance: confianceAuPaiement({ paiementsProuves, avisVerifies: rep.nbVerifies }),
  };
}

/**
 * Resout les lignes du panier en articles, et REVERIFIE le stock suivi : le
 * panier a pu vieillir de quelques minutes, la vendeuse a pu vendre au
 * comptoir entre-temps. Le refus est global — une commande partielle
 * surprendrait plus qu'elle n'aiderait.
 */
function resoudreLignes(
  boutique: BoutiqueBot,
  lignes: LignePanier[],
):
  | { ok: true; articles: Array<{ article: ArticleBot; quantite: number }> }
  | { ok: false; nom: string } {
  const articles: Array<{ article: ArticleBot; quantite: number }> = [];
  for (const l of lignes) {
    const article = boutique.articles.find((a) => a.id === l.articleId);
    if (!article) return { ok: false, nom: "?" };
    if (article.stock !== null && l.quantite > article.stock) {
      return { ok: false, nom: article.nom };
    }
    articles.push({ article, quantite: l.quantite });
  }
  return articles.length > 0 ? { ok: true, articles } : { ok: false, nom: "?" };
}

/**
 * L'URL signee de la declinaison JPEG — VERIFIEE avant d'etre promise.
 *
 * Les objets anterieurs a l'ADR 0032 n'ont qu'AVIF et WebP, que les serveurs
 * de Meta n'acceptent pas ; et un en-tete au lien mort fait refuser le message
 * entier. Donc : existence d'abord, URL ensuite, et toute erreur de stockage
 * degrade en « pas d'image » — jamais en message perdu.
 */
async function urlJpegVerifiee(deps: BotDeps, cleDeBase: string): Promise<string | null> {
  if (!deps.storage) return null;
  const cle = `${cleDeBase}.jpg`;
  try {
    if ((await deps.storage.taille(cle)) === null) return null;
    return await deps.storage.urlSignee(cle, 600);
  } catch {
    return null;
  }
}

/**
 * Le statut de la derniere commande du fil, dit avec les libelles du cycle de
 * vie (lot 11). AUCUN jeton n'est relu ici : le lien de suivi ne se re-projette
 * jamais (garde du lot 10) — la reponse renvoie au message de confirmation.
 */
async function statutDerniereCommande(
  deps: BotDeps,
  commandeId: string,
): Promise<StatutDerniereCommande | null> {
  const o = await deps.prisma.order.findUnique({
    where: { id: commandeId },
    select: {
      ref: true,
      step: true,
      proofState: true,
      totalXaf: true,
      amountPaidXaf: true,
      balanceXaf: true,
      cancelledAt: true,
      delivery: true,
      seller: { select: { businessName: true } },
      /* Un avis par commande : la contrainte UNIQUE le garantit, ce compte
         sert seulement a ne pas proposer deux fois (ADR 0036). */
      review: { select: { id: true } },
    },
  });
  if (!o) return null;
  const cycle: CommandePourCycle = {
    etape: o.step,
    modeLivraison:
      (o.delivery as { mode?: string } | null)?.mode === "retrait" ? "retrait" : "livraison",
    totalXaf: o.totalXaf,
    amountPaidXaf: o.amountPaidXaf,
    balanceXaf: o.balanceXaf,
    etatPreuve: o.proofState,
    annuleeA: o.cancelledAt,
  };
  const libelle = o.cancelledAt
    ? "Commande annulée."
    : (etapesDuSuivi(cycle).find((e) => e.courante)?.libelle ?? "En cours.");

  /**
   * Ce que l'identite du fil autorise MAINTENANT (ADR 0036). Les regles
   * viennent des machines existantes — `appliquerEvenement` du lot 7 pour la
   * contre-signature, `droitAuDepot` du lot 12 pour l'avis. La conversation
   * n'en redit aucune : elle propose ce que le domaine permet.
   */
  const maintenant = deps.maintenant?.() ?? new Date();
  const contresignature = appliquerEvenement(
    o.proofState,
    { type: "contresignature", par: "acheteuse" },
    maintenant,
  );
  const droit = droitAuDepot(cycle);

  /**
   * Le chemin complet et le sort de la preuve — la reponse a « suivi » les
   * dessine desormais (banc du 12/08/2026) au lieu de renvoyer « plus haut
   * dans ce fil ». Une commande annulee garde son libelle seul.
   */
  const etapes = o.cancelledAt
    ? undefined
    : etapesDuSuivi(cycle).map((e) => ({
        libelle: e.libelle,
        faite: e.faite,
        courante: e.courante,
      }));
  const preuve =
    o.proofState === "prouve" || o.proofState === "contresigne"
      ? ("prouve" as const)
      : o.proofState === "conteste"
        ? ("conteste" as const)
        : o.proofState === "declare_non_trace"
          ? ("non_trace" as const)
          : null;

  return {
    reference: o.ref,
    boutique: o.seller.businessName,
    libelle,
    resteXaf: soldeAEncaisser(cycle),
    ...(etapes ? { etapes } : {}),
    preuve,
    contresignable: contresignature.ok,
    avisPossible: droit.possible,
    avisVerifie: droit.verifie,
    avisDejaDepose: o.review !== null,
  };
}

async function creerCommande(
  deps: BotDeps,
  boutique: BoutiqueBot,
  items: OrderItem[],
  livraison: unknown,
  /* Qui a fait naitre la commande, et par quelle porte. Les DEUX comptoirs de
     l'ADR 0061 passent ici — c'est ce qui fait qu'il n'y a qu'UN moteur. */
  origine: { actor: "acheteuse" | "vendeuse"; canal: string } = {
    actor: "acheteuse",
    canal: "bot_whatsapp",
  },
): Promise<{
  id: string;
  ref: string;
  verificationCode: string;
  buyerToken: string | null;
  totalXaf: number;
  duAvantXaf: number;
}> {
  const alea = deps.aleatoire ?? ((n: number) => new Uint8Array(randomBytes(n)));
  const maintenant = deps.maintenant?.() ?? new Date();

  const totalXaf = itemsTotalXaf(items);
  /* Acompte seulement si la rampe existe : sans reversement pose, exiger un
     prepaiement enverrait l'acheteuse payer vers nulle part. */
  const mode = boutique.reversementPose ? ("acompte" as const) : ("sans_prepaiement" as const);
  const plan = planDePaiement(totalXaf, mode);

  const livraisonJson = livraison as object;
  const buyerPhone =
    (livraison as { phone?: string }).phone ?? "+237600000000"; /* garanti par le schema */

  /* Le jeton est GENERE ici et jamais re-projete : le garde « le jeton ne se
     projette jamais » tient aussi pour le bot — la valeur part au navigateur
     de l'ACHETEUSE via son propre fil, sans repasser par un select. */
  const jetonSuivi = genererJetonSuivi(alea);

  /* La reference est courte, unique, et se retente sur collision : deux
     acheteuses a la meme milliseconde ne partagent pas leur reference. */
  for (let essai = 0; essai < 3; essai++) {
    const octets = alea(4);
    const n = (((octets[0] ?? 0) << 16) | ((octets[1] ?? 0) << 8) | (octets[2] ?? 0)) % 900000;
    const ref = `CT-${100000 + n}`;
    try {
      const cree = await deps.prisma.$transaction(async (tx) => {
        const commande = await tx.order.create({
          data: {
            ref,
            sellerId: boutique.id,
            buyerPhone,
            items: items as unknown as object,
            totalXaf,
            amountPaidXaf: 0,
            balanceXaf: totalXaf,
            payMode: mode,
            delivery: livraisonJson,
            verificationCode: generateVerificationCode(alea),
            buyerToken: jetonSuivi,
            expiresAt: echeance(maintenant),
          },
          select: { id: true, ref: true, verificationCode: true },
        });
        await tx.orderEvent.create({
          data: {
            orderId: commande.id,
            sellerId: boutique.id,
            kind: "commande_creee",
            payload: { canal: origine.canal },
            actor: origine.actor,
          },
        });
        return commande;
      });
      return {
        id: cree.id,
        ref: cree.ref,
        verificationCode: cree.verificationCode,
        buyerToken: jetonSuivi,
        totalXaf,
        duAvantXaf: plan.duAvantXaf,
      };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "P2002" || essai === 2) throw e;
    }
  }
  throw new Error("creation de commande : collisions de reference repetees");
}

/**
 * La vente declaree au comptoir vendeuse — rang 1, ADR 0069.
 *
 * Elle passe par `creerCommande`, l'UNIQUE fonction ou une commande nait :
 * c'est ce qui fait qu'il n'y a qu'un moteur (ADR 0061), et que le plan de
 * paiement, la reference, le code et le jeton sont EXACTEMENT ceux du comptoir
 * acheteuse.
 *
 * Le mode conges NE bloque PAS ce comptoir : il ferme la boutique aux
 * commandes que des ACHETEUSES initient (ADR 0039). Ici c'est la vendeuse
 * elle-meme qui declare une vente qu'elle vient de conclure — la refuser
 * pousserait la vente hors du moteur, la fuite exacte que ce rang ferme. Un
 * rappel part quand la boutique est fermee, comme apres la carte (ADR 0057).
 */
async function creerVenteAuComptoir(
  deps: BotDeps,
  sellerId: string,
  vers: string,
  vente: VenteDeclaree,
): Promise<MessageSortant[]> {
  const seller = await deps.prisma.seller.findUnique({
    where: { id: sellerId },
    select: { slug: true, congesDepuis: true },
  });
  const charge = seller ? await chargerBoutique(deps, seller.slug) : null;
  if (!charge) {
    return [
      texte(vers, "La vente n'a pas pu être enregistrée. Réécrivez « vendu » — rien n'est perdu."),
    ];
  }

  /* La MEME porte de validation que le comptoir acheteuse : le point de remise
     et le numero repassent par le schema, pas seulement par la machine. */
  const livraison = deliverySchema.safeParse({
    mode: "retrait",
    pickupPoint: vente.pointRemise,
    phone: vente.cliente,
  });
  if (!livraison.success) {
    return [
      texte(vers, "La vente n'a pas pu être enregistrée. Réécrivez « vendu » — rien n'est perdu."),
    ];
  }

  const commande = await creerCommande(
    deps,
    charge.boutique,
    /* PAS de productId : l'article est en texte libre, au prix CONVENU — c'est
       toute la raison d'etre de ce comptoir. Le contrat l'admet (ADR 0069). */
    [{ name: vente.article, unitPriceXaf: vente.prixXaf, quantity: 1 }],
    livraison.data,
    { actor: "vendeuse", canal: "comptoir_vendeuse" },
  );

  const operateur =
    charge.reversement?.operateur && deps.rampe
      ? (deps.rampe.operateurs.find((o) => o.id === charge.reversement?.operateur) ?? null)
      : null;
  const aTransferer = messageATransferer({
    boutique: charge.boutique.nom,
    article: vente.article,
    prixXaf: vente.prixXaf,
    reference: commande.ref,
    codeVerification: commande.verificationCode,
    aPayerXaf: commande.duAvantXaf,
    resteXaf: commande.totalXaf - commande.duAvantXaf,
    numeroReversement: charge.reversement ? formatPhone(charge.reversement.numero) : "",
    operateurNom: operateur?.nom ?? null,
    codeEntree: operateur?.codeEntree.modele ?? null,
  });

  const messages: MessageSortant[] = [
    texte(
      vers,
      `✅ *${commande.ref} est créée.* Transférez le message suivant à votre cliente — il porte tout ce qu'il lui faut pour payer.\nDès qu'elle a payé, collez ici le SMS de votre opérateur : il devient son reçu vérifiable.`,
    ),
    /* Le message a transferer part SEUL : c'est lui qu'elle fait suivre, sans
       avoir a decouper le notre. Il ne porte NI jeton NI lien de suivi — il
       passe par ses mains, et le controle n° 7 en depend (ADR 0069). */
    texte(vers, aTransferer),
  ];
  if (seller?.congesDepuis) messages.push(rappelConges(vers));
  return messages;
}

/* ────────────────────────── fil vendeuse ────────────────────────────────── */

async function filVendeuse(deps: BotDeps, entree: EntreeBot, sellerIdent: string): Promise<void> {
  const [ouvertes, profil] = await Promise.all([
    deps.prisma.order.findMany({
      where: { sellerId: sellerIdent, balanceXaf: { gt: 0 }, cancelledAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, ref: true, balanceXaf: true },
    }),
    deps.prisma.seller.findUnique({
      where: { id: sellerIdent },
      select: {
        businessName: true,
        slug: true,
        congesDepuis: true,
        chaineUrl: true,
        payoutPhone: true,
        _count: { select: { products: { where: { archivedAt: null } } } },
      },
    }),
  ]);
  const commandesOuvertes = ouvertes.map((o) => ({
    id: o.id,
    reference: o.ref,
    resteXaf: o.balanceXaf,
  }));
  const soldesXaf = commandesOuvertes.reduce((s, c) => s + c.resteXaf, 0);

  const smsReconnu = entree.genre === "texte" && analyserSms(entree.texte).reconnu;
  const reaction = reagirVendeuse(entreePourMachine(entree), entree.de, {
    smsReconnu,
    commandesOuvertes,
    soldesXaf,
    boutique: profil
      ? {
          nom: profil.businessName,
          nbArticles: profil._count.products,
          lienBoutique: lienBot(deps, `boutique ${profil.slug}`),
          lienEspace: deps.baseApp || null,
          ...(profil.congesDepuis ? { enConges: true } : {}),
          /* ADR 0061, rang 3b — « ma chaine » rappelle le lien range. */
          chaine: profil.chaineUrl,
        }
      : null,
  });
  const messages = [...reaction.messages];

  if (reaction.effet?.type === "marquer_livree") {
    messages.push(
      texte(entree.de, await marquerLivree(deps, sellerIdent, reaction.effet.reference)),
    );
  }

  if (reaction.effet?.type === "envoyer_carte") {
    messages.push(...(await carteVitrine(deps, sellerIdent)));
    /**
     * Une carte partagee pendant les conges attire des acheteuses qui seront
     * refusees au dernier verrou — ADR 0057. Le rappel part APRES la carte :
     * la carte reste l'objet du geste, le rappel est ce qu'on lit ensuite.
     */
    if (profil?.congesDepuis) messages.push(rappelConges(entree.de));
  }

  if (reaction.effet?.type === "basculer_conges") {
    const fermer = reaction.effet.fermer;
    await basculerConges(
      deps.prisma,
      sellerIdent,
      fermer,
      "bot_whatsapp",
      deps.maintenant?.() ?? new Date(),
    );
    /* Ce que ça change ET ce que ça ne change pas : sans la seconde moitié, une
       vendeuse peut croire qu'elle vient d'annuler ses commandes en cours. */
    const n = commandesOuvertes.length;
    messages.push(
      texte(
        entree.de,
        fermer
          ? `🌴 C'est noté. Votre boutique reste en ligne — lien, articles, avis — mais n'accepte plus de nouvelle commande.${
              n > 0
                ? ` Vos ${n} commande${n > 1 ? "s" : ""} en cours continue${n > 1 ? "nt" : ""} normalement : paiement, preuve, remise.`
                : ""
            }\nÉcrivez « je reprends » quand vous revenez.`
          : "☀️ C'est reparti — votre boutique accepte de nouveau les commandes. Bon retour !",
      ),
    );
  }

  /**
   * ── La chaine WhatsApp — ADR 0061, rang 3b ────────────────────────────
   *
   * Le lien arrive DEJA canonise par le domaine (`lireLienChaine`) : le
   * service n'assainit rien, il range. C'est ce qui garantit que la page
   * publique et la carte affichent la meme chose pour une meme chaine.
   *
   * La page se reconstruit, parce que « Suivre la boutique » en depend et que
   * la boutique est statique (ADR 0065). Le regroupement absorbe la rafale
   * d'une vendeuse qui se ravise deux fois.
   */
  if (reaction.effet?.type === "poser_chaine") {
    const lien = reaction.effet.lien;
    await deps.prisma.seller.update({
      where: { id: sellerIdent },
      data: { chaineUrl: lien },
    });
    const dansMinutes = (await deps.reconstruction?.demander("boutique_modifiee"))
      ? ATTENTE_ANNONCEE_MIN
      : null;
    messages.push(
      texte(
        entree.de,
        lien
          ? `📣 C'est rangé. « Suivre la boutique » mène maintenant à votre chaîne.${
              dansMinutes ? `\nVotre page se met à jour dans ~${dansMinutes} minutes.` : ""
            }\n\nPartagez votre boutique dans la chaîne : chaque commande qui en vient se comptera à part.`
          : `📣 Lien retiré. « Suivre la boutique » disparaît de votre page.${
              dansMinutes ? `\nMise à jour dans ~${dansMinutes} minutes.` : ""
            }`,
      ),
    );
  }

  if (reaction.effet?.type === "verifier_sms") {
    const analyse = analyserSms(reaction.effet.texte);
    if (analyse.reconnu) {
      const cible = commandesOuvertes.length === 1 ? commandesOuvertes[0] : null;
      const lien = (chemin: string) => (deps.baseApp ? `${deps.baseApp}${chemin}` : chemin);

      /**
       * Le verdict DANS le fil — ADR 0083. Le geste central du produit
       * exigeait un changement de surface au moment le plus charge : lien,
       * connexion, ecran, re-collage. Quand UNE SEULE commande a un solde
       * ouvert, il n'y a rien a choisir : LE MEME service que la route rend
       * les sept controles ici — meme transaction, meme journal, meme
       * contrainte d'unicite. Plusieurs commandes ouvertes : on aiguille
       * encore, choisir dans une liste WhatsApp le paiement qu'on rattache
       * serait le vrai risque d'erreur.
       */
      if (cible && deps.preuve) {
        await verdictDansLeFil(deps, entree.de, sellerIdent, cible, reaction.effet.texte, lien);
        await envoyerSequence(deps, messages);
        return;
      }

      /* Repli V1 : reconnaissance et aiguillage. Le SMS n'est ni persiste ni
         retranscrit : seuls l'operateur et le montant, deja connus de la
         vendeuse, reapparaissent. */
      const corps = cible
        ? `SMS ${analyse.pattern.operateur} reconnu. Pour vérifier les sept contrôles et émettre le reçu de ${cible.reference}, collez-le ici : ${lien(`/commandes/${cible.id}/preuve`)}`
        : commandesOuvertes.length === 0
          ? "SMS reconnu, mais aucune commande n'a de solde ouvert. Vérifiez vos commandes dans l'app."
          : `SMS ${analyse.pattern.operateur} reconnu. Plusieurs commandes ont un solde ouvert (${commandesOuvertes
              .slice(0, 3)
              .map((c) => c.reference)
              .join(
                ", ",
              )}) : ouvrez la bonne dans l'app pour y coller ce message : ${lien("/commandes")}`;
      messages.push(texte(entree.de, corps));
    }
  }

  await envoyerSequence(deps, messages);
}

/**
 * Le verdict de preuve DANS le fil — ADR 0083.
 *
 * LE MEME service que la route (`soumettrePreuve`) : sept controles, INSERT
 * qui tranche le n° 5, transition, versement, journal. Cette fonction ne
 * decide rien — elle traduit le resultat en messages de fil, et previent
 * l'acheteuse apres commit quand la commande a avance.
 *
 * Le SMS n'est jamais retranscrit. Sur un refus, l'EXPLICATION du controle
 * echoue se dit (elle est redigee pour la vendeuse et ne contient rien du
 * texte) ; l'ecran de l'app reste le detail, controle par controle.
 */
async function verdictDansLeFil(
  deps: BotDeps,
  vers: string,
  sellerIdent: string,
  cible: { id: string; reference: string },
  texteSms: string,
  lien: (chemin: string) => string,
): Promise<void> {
  const porte = deps.preuve;
  if (!porte) return;
  const [commande, vendeuse] = await Promise.all([
    deps.prisma.order.findFirst({
      where: { id: cible.id, sellerId: sellerIdent },
      select: {
        id: true,
        totalXaf: true,
        amountPaidXaf: true,
        balanceXaf: true,
        payMode: true,
        createdAt: true,
        buyerPhone: true,
        proofState: true,
      },
    }),
    deps.prisma.seller.findUnique({
      where: { id: sellerIdent },
      select: { payoutPhone: true },
    }),
  ]);
  if (!commande) return;

  const resultat = await avecSpan(PARCOURS.preuveSoumise, {}, async (span) => {
    poser(span, { "catalog.commande.id": commande.id, "catalog.vendeuse.id": sellerIdent });
    return soumettrePreuve(
      {
        prisma: deps.prisma,
        chiffreur: porte.chiffreur,
        ...(deps.maintenant ? { maintenant: deps.maintenant } : {}),
      },
      {
        vendeuse: { id: sellerIdent, payoutPhone: vendeuse?.payoutPhone ?? null },
        commande,
        texteSms,
        span,
      },
    );
  });

  /* Defensif : `smsReconnu` a deja tranche, une re-analyse divergente serait
     un bug d'analyseur — on retombe alors sur le silence plutot que de
     contredire l'accuse ✅ deja pose. */
  if (resultat.issue === "non_reconnue") return;

  if (resultat.issue === "acceptee" || resultat.issue === "acceptee_sous_reserve") {
    await envoyerSequence(deps, [
      messageVerdict(vers, {
        verdict: resultat.issue === "acceptee" ? "accepte" : "accepte_sous_reserve",
        reference: cible.reference,
      }),
    ]);
    /* La notification de l'acheteuse — apres l'envoi du verdict, jamais avant
       le commit (le service a deja commite). Une notification ratee ne defait
       jamais une preuve. */
    if (resultat.transitionOk && porte.apresPreuve) {
      await porte.apresPreuve(commande.id).catch(() => {});
    }
    return;
  }

  /* Refus — celui des six controles purs, ou l'identifiant deja reclame
     (contrainte d'unicite). L'explication du controle echoue est redigee pour
     la vendeuse et ne cite jamais le texte du SMS. */
  const echoue = resultat.checks.find((x) => x.state === "fail");
  await envoyerSequence(deps, [
    texte(
      vers,
      [
        "⛔ Ce SMS n'a pas passé les contrôles.",
        ...(echoue ? [echoue.explanation] : []),
        `Le détail, contrôle par contrôle : ${lien(`/commandes/${cible.id}/preuve`)}`,
      ].join("\n"),
    ),
  ]);
}

/**
 * « livree CT-XXXXXX » — ADR 0035. La MEME machine d'etapes que la route web
 * decide (`avancerEtape`), le meme journal ecrit, le meme refus se journalise.
 * Deux sources de verite sur une etape seraient pires qu'aucune.
 */
async function marquerLivree(
  deps: BotDeps,
  sellerIdent: string,
  reference: string,
): Promise<string> {
  const commande = await deps.prisma.order.findFirst({
    where: { ref: reference, sellerId: sellerIdent },
    select: {
      id: true,
      step: true,
      totalXaf: true,
      amountPaidXaf: true,
      balanceXaf: true,
      proofState: true,
      delivery: true,
      cancelledAt: true,
      createdAt: true,
    },
  });
  if (!commande) return corpsLivraisonRefusee(reference, "commande_introuvable");

  const cycle: CommandePourCycle = {
    etape: commande.step,
    modeLivraison:
      (commande.delivery as { mode?: string } | null)?.mode === "retrait" ? "retrait" : "livraison",
    totalXaf: commande.totalXaf,
    amountPaidXaf: commande.amountPaidXaf,
    balanceXaf: commande.balanceXaf,
    etatPreuve: commande.proofState,
    annuleeA: commande.cancelledAt,
  };
  const maintenant = deps.maintenant?.() ?? new Date();
  const decision = avancerEtape(cycle, "livree", maintenant);

  await deps.prisma.$transaction(async (tx) => {
    if (decision.ok) {
      await tx.order.update({ where: { id: commande.id }, data: { step: decision.etape } });
    }
    await tx.orderEvent.create({
      data: {
        orderId: commande.id,
        sellerId: sellerIdent,
        kind: decision.journal.kind,
        actor: "vendeuse",
        at: decision.journal.at,
        payload: {
          de: decision.journal.de,
          vers: decision.journal.vers,
          canal: "bot_whatsapp",
          ...(decision.ok ? {} : { raison: decision.raison }),
        },
      },
    });
  });

  if (!decision.ok) return corpsLivraisonRefusee(reference, decision.raison);
  await notifierLivree(deps, commande.id);
  return corpsLivraisonMarquee(reference);
}
