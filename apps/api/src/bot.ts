/* Le baril est permis COTE SERVEUR : la regle anti-baril (lot 6) protege le
   paquet navigateur de la boutique, pas l'API. */

import { randomBytes } from "node:crypto";
import { deliverySchema, itemsTotalXaf, normalizePhone, type OrderItem } from "@catalog/contracts";
import type { PrismaClient } from "@catalog/db";
import {
  type ArticleBot,
  type BoutiqueBot,
  confirmationCommande,
  ETAT_INITIAL,
  type EtatConv,
  etatApresInactivite,
  extraireSlugBoutique,
  type LignePanier,
  normaliserEtat,
  reagirAcheteuse,
  reagirVendeuse,
  type StatutDerniereCommande,
} from "./domain/bot/conversation.ts";
import { type EntreeBot, lireEntreesBot } from "./domain/bot/entrees.ts";
import type { EnvoyeurBot } from "./domain/bot/envoyeur.ts";
import { texte } from "./domain/bot/messages.ts";
import { type Langue, normaliserLangue, TEXTES } from "./domain/bot/textes.ts";
import { extraireCodeDefi } from "./domain/connexion-whatsapp.ts";
import { type CommandePourCycle, etapesDuSuivi, soldeAEncaisser } from "./domain/order/cycle.ts";
import { echeance } from "./domain/order/expiration.ts";
import { planDePaiement } from "./domain/order/paiement.ts";
import { analyserSms } from "./domain/proof/motifs.ts";
import { genererJetonSuivi, lienDeSuivi } from "./domain/receipt/jeton.ts";
import { reputation } from "./domain/review/reputation.ts";
import type { ObjectStorage } from "./domain/storage.ts";
import { generateVerificationCode } from "./domain/verification-code.ts";
import type { ChargeRelance } from "./jobs/relance-acompte.ts";
import { mesurerTransitionBot } from "./observabilite/mesures.ts";

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
   * Planification de la relance d'acompte (ADR 0033). Absente : pas de
   * relance — la commande vit, seule la piqure de rappel manque.
   */
  planifierRelance?: (charge: ChargeRelance) => Promise<void>;
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

async function traiterEntree(deps: BotDeps, entree: EntreeBot): Promise<void> {
  const phone = cleConversation(entree.de);
  if (!phone) return;

  const utilisateur = await deps.prisma.authUser.findUnique({
    where: { phoneNumber: phone },
    include: { seller: true },
  });
  if (utilisateur?.seller) {
    await filVendeuse(deps, entree, utilisateur.seller.id);
    return;
  }
  await filAcheteuse(deps, entree, phone);
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

  /* L'en-tete image, seulement la ou il s'affiche : l'accueil (entree par
     lien) et la fiche article. Jamais d'URL non verifiee — un lien mort fait
     refuser le message entier par l'API. */
  if (boutique && charge) {
    const articleVise =
      entree.genre !== "texte" && entree.id.startsWith("art:") ? entree.id.slice(4) : null;
    const cibleId = articleVise ?? (slugDuTexte ? boutique.articles[0]?.id : null) ?? null;
    if (cibleId) {
      const cle = charge.clesImage.get(cibleId);
      const url = cle ? await urlJpegVerifiee(deps, cle) : null;
      const cible = boutique.articles.find((a) => a.id === cibleId);
      if (cible && url) cible.imageUrl = url;
    }
  }

  /* La memoire post-achat : « ou est ma commande ? » se repond sans
     reconcilier par numero — la conversation connait SA derniere commande. */
  const derniereCommande =
    entree.genre === "texte" && enregistrement?.derniereCommandeId
      ? await statutDerniereCommande(deps, enregistrement.derniereCommandeId)
      : null;

  const reaction = reagirAcheteuse(etat, entree, {
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
          },
          langue,
        ),
      );
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
  for (const m of messages) await deps.envoyeur.envoyer(m);
}

interface BoutiqueChargee {
  boutique: BoutiqueBot;
  /** Cle de base d'image par article — detail de stockage, hors du domaine. */
  clesImage: Map<string, string>;
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
  const ouvertes = await deps.prisma.order.findMany({
    where: { sellerId: sellerIdent, balanceXaf: { gt: 0 }, cancelledAt: null },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, ref: true, balanceXaf: true },
  });
  const commandesOuvertes = ouvertes.map((o) => ({
    id: o.id,
    reference: o.ref,
    resteXaf: o.balanceXaf,
  }));
  const soldesXaf = commandesOuvertes.reduce((s, c) => s + c.resteXaf, 0);

  const smsReconnu = entree.genre === "texte" && analyserSms(entree.texte).reconnu;
  const reaction = reagirVendeuse(entree, entree.de, { smsReconnu, commandesOuvertes, soldesXaf });
  const messages = [...reaction.messages];

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

  for (const m of messages) await deps.envoyeur.envoyer(m);
}
