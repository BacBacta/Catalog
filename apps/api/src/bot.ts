/* Le baril est permis COTE SERVEUR : la regle anti-baril (lot 6) protege le
   paquet navigateur de la boutique, pas l'API. */

import { randomBytes } from "node:crypto";
import { deliverySchema, itemsTotalXaf, normalizePhone, type OrderItem } from "@catalog/contracts";
import type { PrismaClient } from "@catalog/db";
import {
  type BoutiqueBot,
  confirmationCommande,
  ETAT_INITIAL,
  type EtatConv,
  extraireSlugBoutique,
  reagirAcheteuse,
  reagirVendeuse,
} from "./domain/bot/conversation.ts";
import { type EntreeBot, lireEntreesBot } from "./domain/bot/entrees.ts";
import type { EnvoyeurBot } from "./domain/bot/envoyeur.ts";
import { texte } from "./domain/bot/messages.ts";
import { extraireCodeDefi } from "./domain/connexion-whatsapp.ts";
import { echeance } from "./domain/order/expiration.ts";
import { planDePaiement } from "./domain/order/paiement.ts";
import { analyserSms } from "./domain/proof/motifs.ts";
import { genererJetonSuivi, lienDeSuivi } from "./domain/receipt/jeton.ts";
import { generateVerificationCode } from "./domain/verification-code.ts";

/**
 * Le service du bot — ADR 0031. Il charge l'etat et les donnees, appelle la
 * machine PURE de `domain/bot`, execute l'effet, persiste, envoie.
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
  const enregistrement = await deps.prisma.botConversation.findUnique({ where: { phone } });
  let etat = (enregistrement?.etat as EtatConv | undefined) ?? ETAT_INITIAL;

  /* Le slug vient du texte (lien d'entree) ou de l'etat courant. */
  const slug =
    (entree.genre === "texte" ? extraireSlugBoutique(entree.texte) : null) ??
    ("slug" in etat ? etat.slug : null);
  const boutique = slug ? await chargerBoutique(deps, slug) : null;

  const reaction = reagirAcheteuse(etat, entree, entree.de, boutique);
  etat = reaction.etat;
  const messages = [...reaction.messages];

  if (reaction.effet?.type === "creer_commande" && boutique) {
    const b = reaction.effet.brouillon;
    const article = boutique.articles.find((a) => a.id === b.articleId);
    const livraison = deliverySchema.safeParse(b.livraison);
    if (!article || !livraison.success) {
      messages.push(
        texte(
          entree.de,
          "Cette commande n'a pas pu etre enregistree. Reprenez au catalogue — rien n'a ete perdu.",
        ),
      );
      etat = ETAT_INITIAL;
    } else {
      const commande = await creerCommande(deps, boutique, article, b.quantite, livraison.data);
      messages.push(
        ...confirmationCommande(entree.de, {
          reference: commande.ref,
          codeVerification: commande.verificationCode,
          boutique: boutique.nom,
          articleNom: article.nom,
          quantite: b.quantite,
          prixUnitaireXaf: article.prixXaf,
          totalXaf: commande.totalXaf,
          duAvantXaf: commande.duAvantXaf,
          lienPaiement:
            deps.baseBoutique && commande.buyerToken
              ? lienDeSuivi(deps.baseBoutique, commande.buyerToken)
              : null,
        }),
      );
    }
  }

  await deps.prisma.botConversation.upsert({
    where: { phone },
    create: { phone, etat },
    update: { etat },
  });
  for (const m of messages) await deps.envoyeur.envoyer(m);
}

async function chargerBoutique(deps: BotDeps, slug: string): Promise<BoutiqueBot | null> {
  const seller = await deps.prisma.seller.findUnique({
    where: { slug },
    include: {
      products: {
        where: { archivedAt: null },
        orderBy: { position: "asc" },
        select: { id: true, name: true, priceXaf: true },
      },
    },
  });
  if (!seller) return null;
  return {
    id: seller.id,
    slug: seller.slug,
    nom: seller.businessName,
    ville: seller.city,
    whatsappVendeuse: seller.phone,
    reversementPose: seller.payoutPhone !== null,
    articles: seller.products.map((p) => ({ id: p.id, nom: p.name, prixXaf: p.priceXaf })),
  };
}

async function creerCommande(
  deps: BotDeps,
  boutique: BoutiqueBot,
  article: { id: string; nom: string; prixXaf: number },
  quantite: number,
  livraison: unknown,
): Promise<{
  ref: string;
  verificationCode: string;
  buyerToken: string | null;
  totalXaf: number;
  duAvantXaf: number;
}> {
  const alea = deps.aleatoire ?? ((n: number) => new Uint8Array(randomBytes(n)));
  const maintenant = deps.maintenant?.() ?? new Date();

  const items: OrderItem[] = [
    { productId: article.id, name: article.nom, unitPriceXaf: article.prixXaf, quantity: quantite },
  ];
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
        ? `SMS ${analyse.pattern.operateur} reconnu. Pour verifier les sept controles et emettre le recu de ${cible.reference}, collez-le ici : ${lien(`/commandes/${cible.id}/preuve`)}`
        : commandesOuvertes.length === 0
          ? "SMS reconnu, mais aucune commande n'a de solde ouvert. Verifiez vos commandes dans l'app."
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
