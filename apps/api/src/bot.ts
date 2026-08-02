/* Le baril est permis COTE SERVEUR : la regle anti-baril (lot 6) protege le
   paquet navigateur de la boutique, pas l'API. */

import { randomBytes } from "node:crypto";
import { deliverySchema, itemsTotalXaf, normalizePhone, type OrderItem } from "@catalog/contracts";
import { formatPhone } from "@catalog/contracts/phone";
import type { RampeConfig } from "@catalog/contracts/ussd";
import type { PrismaClient } from "@catalog/db";
import { reencoderImage } from "./adapters/image-pipeline.ts";
import { emailTechnique } from "./auth.ts";
import { livrerNotificationsEnAttente, notifier, notifierLivree } from "./bot-notifications.ts";
import { aiguiller } from "./domain/bot/aiguillage.ts";
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
  normaliserEtat,
  RAFALE_MAX,
  reagirAcheteuse,
  reagirVendeuse,
  type StatutDerniereCommande,
} from "./domain/bot/conversation.ts";
import { type EntreeBot, lireEntreesBot } from "./domain/bot/entrees.ts";
import type { EnvoyeurBot } from "./domain/bot/envoyeur.ts";
import {
  demandeInscription,
  type EtatVendeuse,
  messageArticlePublie,
  messageBoutiqueCreee,
  normaliserEtatVendeuse,
  PREMIERE_QUESTION,
  reagirInscription,
} from "./domain/bot/inscription.ts";
import type { LecteurMedia } from "./domain/bot/media.ts";
import { type MessageSortant, sansCitation, texte } from "./domain/bot/messages.ts";
import {
  corpsLivraisonMarquee,
  corpsLivraisonRefusee,
  corpsNouvelleCommande,
} from "./domain/bot/notifications.ts";
import { type Langue, TEXTES } from "./domain/bot/textes.ts";
import { extraireCodeDefi } from "./domain/connexion-whatsapp.ts";
import {
  avancerEtape,
  type CommandePourCycle,
  etapesDuSuivi,
  soldeAEncaisser,
} from "./domain/order/cycle.ts";
import { echeance } from "./domain/order/expiration.ts";
import { planDePaiement } from "./domain/order/paiement.ts";
import { analyserSms } from "./domain/proof/motifs.ts";
import { genererJetonSuivi, lienDeSuivi } from "./domain/receipt/jeton.ts";
import { reputation } from "./domain/review/reputation.ts";
import { cleOpaque, declinaisons, type ObjectStorage } from "./domain/storage.ts";
import { generateVerificationCode } from "./domain/verification-code.ts";
import type { ChargeRelance } from "./jobs/relance-acompte.ts";
import { mesurerTransitionBot } from "./observabilite/mesures.ts";
import { slugifier, slugLibre } from "./routes/seller.ts";

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
  maintenant?: () => Date;
  aleatoire?: (n: number) => Uint8Array;
}

export async function traiterLivraisonBot(deps: BotDeps, corps: unknown): Promise<void> {
  for (const entree of lireEntreesBot(corps)) {
    /* Un message qui porte un code de defi (AAAA-BB) appartient a la
       connexion WhatsApp (ADR 0027), deja traitee par `surMessage` : le bot
       ne repond pas par-dessus. */
    if (entree.genre === "texte" && extraireCodeDefi(entree.texte)) continue;
    await traiterEntree(deps, entree).catch(() => {
      /* Une entree qui casse ne bloque ni les suivantes ni la relivraison. */
    });
  }
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
function cleConversation(waId: string): string | null {
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
async function traiterEntree(deps: BotDeps, entree: EntreeBot): Promise<void> {
  const phone = cleConversation(entree.de);
  if (!phone) return;

  /* Le message entrant vient d'OUVRIR la fenetre de service : les
     notifications en attente partent d'abord (ADR 0035), la reponse suit. */
  await livrerNotificationsEnAttente(deps, phone);

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
  const etatVendeuse = normaliserEtatVendeuse(enregistrement?.etat);
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
  } else if (sellerId) {
    etat = { nom: "article_nom" };
  } else {
    const demande = entree.genre === "texte" ? demandeInscription(entree.texte) : {};
    etat = { nom: "inscription_nom", ...(demande?.parrain ? { parrain: demande.parrain } : {}) };
    await poserEtat(deps, phone, etat);
    await deps.envoyeur.envoyer(texte(entree.de, PREMIERE_QUESTION));
    return;
  }

  /* Une vendeuse installee qui vient d'appuyer sur « Autre article » entre
     directement dans l'etat — sans que son appui soit lu comme un nom. Une
     PHOTO, elle, traverse jusqu'a la machine : legendee « nom prix », c'est
     deja l'article entier (ADR 0035). */
  if (!etatCourant && sellerId && entree.genre !== "image") {
    await poserEtat(deps, phone, etat);
    await deps.envoyeur.envoyer(
      texte(
        entree.de,
        "*Quel est le nom de l'article ?*\nExemple : Pagne wax 6 yards\n\nPlus rapide : envoyez directement la photo, avec « nom prix » en légende.",
      ),
    );
    return;
  }

  const reaction = reagirInscription(etat, entreePourMachine(entree), entree.de);
  const messages = [...reaction.messages];
  let etatSuivant: EtatVendeuse | EtatConv = reaction.etat ?? ETAT_INITIAL;

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
  }

  if (reaction.effet?.type === "creer_article" && sellerId) {
    const article = await creerArticleDepuisFil(deps, sellerId, reaction.effet);
    messages.push(
      article
        ? messageArticlePublie(entree.de, article)
        : texte(
            entree.de,
            "Cet article n'a pas pu être enregistré. Réessayez avec « ajouter » — rien n'a été perdu.",
          ),
    );
    etatSuivant = ETAT_INITIAL;
  }

  await poserEtat(deps, phone, etatSuivant);
  await envoyerSequence(deps, messages);
}

/**
 * Une entree de livraison, ramenee a ce que les machines pures attendent :
 * le geste, sans l'expediteur. Les deux machines acceptent cette union — le
 * fil acheteuse l'a typee, l'inscription lui est structurellement compatible.
 */
function entreePourMachine(entree: EntreeBot): EntreeMachine {
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
    default:
      return { genre: entree.genre, id: entree.id, ...id };
  }
}

/**
 * L'envoi d'une sequence, avec les deux replis de l'ADR 0035 :
 * - une REACTION refusee ne casse jamais la suite — c'est un confort ;
 * - une CITATION refusee fait repartir le message nu — le contenu prime.
 * Le sandbox v1 n'a pas confirme ces deux formes : on les tente, on ne
 * parie jamais la conversation dessus.
 */
async function envoyerSequence(deps: BotDeps, messages: MessageSortant[]): Promise<void> {
  for (const m of messages) {
    if (m.type === "reaction") {
      await deps.envoyeur.envoyer(m).catch(() => {});
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
async function creerArticleDepuisFil(
  deps: BotDeps,
  sellerId: string,
  demande: { nom: string; prixXaf: number; mediaId?: string },
): Promise<{ nom: string; prixXaf: number; avecPhoto: boolean } | null> {
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
        ...(image
          ? {
              imageKey: image.cle,
              imageWidth: image.largeur,
              imageHeight: image.hauteur,
              imageBytes: image.octets,
            }
          : {}),
      },
      select: { name: true, priceXaf: true },
    })
    .catch(() => null);

  return cree ? { nom: cree.name, prixXaf: cree.priceXaf, avecPhoto: image !== null } : null;
}

/* ────────────────────────── fil acheteuse ───────────────────────────────── */

async function filAcheteuse(deps: BotDeps, entree: EntreeBot, phone: string): Promise<void> {
  const maintenant = deps.maintenant?.() ?? new Date();
  const enregistrement = await deps.prisma.botConversation.findUnique({ where: { phone } });
  const langue: Langue = enregistrement?.langue === "en" ? "en" : "fr";
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

  /* La memoire post-achat : « ou est ma commande ? » se repond sans
     reconcilier par numero — la conversation connait SA derniere commande. */
  const derniereCommande =
    entree.genre === "texte" && enregistrement?.derniereCommandeId
      ? await statutDerniereCommande(deps, enregistrement.derniereCommandeId)
      : null;

  const reaction = reagirAcheteuse(etat, entreePourMachine(entree), {
    vers: entree.de,
    boutique,
    derniereCommande,
    langue,
  });
  etat = reaction.etat;
  const messages = [...reaction.messages];
  let commandeCreeeId: string | null = null;

  if (reaction.effet?.type === "creer_commande" && boutique) {
    const b = reaction.effet.brouillon;
    const livraison = deliverySchema.safeParse(b.livraison);
    const resolution = resoudreLignes(boutique, b.lignes);
    if (!livraison.success || !resolution.ok) {
      messages.push(
        texte(entree.de, resolution.ok ? t.commandeRatee : t.stockInsuffisant(resolution.nom)),
      );
      etat = { nom: "catalogue", slug: boutique.slug, page: 0 };
    } else {
      const commande = await creerCommande(deps, boutique, resolution.articles, livraison.data);
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
          }),
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

interface BoutiqueChargee {
  boutique: BoutiqueBot;
  /** Cle de base d'image par article — detail de stockage, hors du domaine. */
  clesImage: Map<string, string>;
  /** Le reversement pour le bloc paiement (ADR 0035) — jamais montre ailleurs. */
  reversement: { numero: string; operateur: string | null } | null;
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
  return {
    reference: o.ref,
    boutique: o.seller.businessName,
    libelle,
    resteXaf: soldeAEncaisser(cycle),
  };
}

async function creerCommande(
  deps: BotDeps,
  boutique: BoutiqueBot,
  articles: Array<{ article: ArticleBot; quantite: number }>,
  livraison: unknown,
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

  const items: OrderItem[] = articles.map((a) => ({
    productId: a.article.id,
    name: a.article.nom,
    unitPriceXaf: a.article.prixXaf,
    quantity: a.quantite,
  }));
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
            payload: { canal: "bot_whatsapp" },
            actor: "acheteuse",
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
        }
      : null,
  });
  const messages = [...reaction.messages];

  if (reaction.effet?.type === "marquer_livree") {
    messages.push(
      texte(entree.de, await marquerLivree(deps, sellerIdent, reaction.effet.reference)),
    );
  }

  if (reaction.effet?.type === "verifier_sms") {
    /* V1 : reconnaissance et aiguillage — pas de verdict dans le fil (voir
       l'en-tete du fichier). Le SMS n'est ni persiste ni retranscrit : seuls
       l'operateur et le montant, deja connus de la vendeuse, reapparaissent. */
    const analyse = analyserSms(reaction.effet.texte);
    if (analyse.reconnu) {
      const montant = analyse.sms.amountXaf;
      const cible = commandesOuvertes.length === 1 ? commandesOuvertes[0] : null;
      const lien = (chemin: string) => (deps.baseApp ? `${deps.baseApp}${chemin}` : chemin);
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
      void montant; /* le montant n'est pas reecrit dans le fil : il y est deja. */
      messages.push(texte(entree.de, corps));
    }
  }

  await envoyerSequence(deps, messages);
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
