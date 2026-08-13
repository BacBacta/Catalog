import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@catalog/db";
import { type BotDeps, traiterLivraisonBot } from "../../bot.ts";
import {
  ETAT_INITIAL,
  type EtatConv,
  etatApresInactivite,
  normaliserEtat,
} from "../../domain/bot/conversation.ts";
import type { EnvoyeurBot } from "../../domain/bot/envoyeur.ts";
import {
  type EtatVendeuse,
  etatVendeuseApresInactivite,
  normaliserEtatVendeuse,
} from "../../domain/bot/inscription.ts";
import type { AccuseLecture, MessageSortant } from "../../domain/bot/messages.ts";
import type { Identifiants } from "../_identifiants.ts";
import type { Compteur } from "./couverture.ts";
import type { Geste } from "./gestes.ts";

/**
 * Le PILOTE du harnais — audit de pipeline, phase 2.
 *
 * ── Ce qu'il pilote, et pourquoi c'est celui-la ───────────────────────────
 *
 * Il pousse des livraisons dans `traiterLivraisonBot`, c'est-a-dire dans LE
 * service reel, contre une VRAIE base. Ce n'est pas un detail de confort :
 *
 * - la machine de conversation est pure et deja bien testee, mais elle ne
 *   represente qu'une part du parcours. L'entree dans le fil vendeuse, la
 *   lecture des formulaires, la creation de boutique, la creation de commande,
 *   l'idempotence des relivraisons et la peremption des etats vivent dans
 *   `bot.ts` — 2 700 lignes que piloter la machine seule ne touche pas ;
 * - re-implementer cette orchestration dans un simulateur reviendrait a se
 *   donner raison : le harnais testerait sa propre copie, et une divergence
 *   entre la copie et le produit serait exactement le defaut qu'il ne verrait
 *   jamais. AGENTS.md §6 interdit deja la seconde source de verite sur
 *   l'argent ; la meme raison vaut ici.
 *
 * D'ou l'emplacement : `src/__tests__/harnais/` et non `src/domain/…`. Le
 * domaine s'interdit Prisma (`domaine-pur.test.ts` le verifie), et un pilote
 * qui parle au service reel a besoin de la base. C'est la regle du depot qui
 * choisit l'emplacement, pas une preference.
 *
 * ── Ce qu'il NE couvre PAS, et qui doit se dire ───────────────────────────
 *
 * L'envoyeur est en memoire : rien ne part vers Meta. Ce qui se passe APRES
 * l'envoi — refus HTTP, gabarit hors fenetre, media introuvable chez Meta —
 * n'est pas mesure ici et ne doit jamais etre compte comme `guidé`.
 *
 * ── Determinisme ──────────────────────────────────────────────────────────
 *
 * Le temps arrive en parametre (`deps.maintenant` lit l'horloge de la scene, et
 * les gestes l'avancent explicitement). L'alea reste `randomBytes` : les codes
 * de verification et les references sont UNIQUE en base, et deux executions du
 * harnais sur la meme base doivent pouvoir coexister. Ce qui est deterministe
 * est la TRANSCRIPTION — `instantane.ts` neutralise les valeurs volatiles.
 */

export class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "harnais";
  readonly envoyes: MessageSortant[] = [];
  readonly accuses: AccuseLecture[] = [];

  async envoyer(m: MessageSortant): Promise<void> {
    this.envoyes.push(m);
  }

  async accuser(a: AccuseLecture): Promise<void> {
    this.accuses.push(a);
  }
}

export interface ArticleScene {
  id: string;
  nom: string;
  prixXaf: number;
  stock: number;
}

export interface Scene {
  /** Le wa_id de la vendeuse (sans `+`), tel que Meta le livre. */
  vendeuseWaId: string;
  /** Le wa_id de l'acheteuse — un autre numero, jamais celui de la vendeuse. */
  acheteuseWaId: string;
  /** L'identifiant alloue a la scene — il survit aux reinitialisations. */
  numero: number;
  sellerId: string;
  slug: string;
  nomBoutique: string;
  articles: ArticleScene[];
  envoyeur: EnvoyeurMemoire;
  deps: BotDeps;
  prisma: PrismaClient;
  /** L'horloge de la scene, en millisecondes. Les gestes l'avancent. */
  horloge: number;
}

export interface OptionsScene {
  /** Le reversement est-il pose ? Sans lui, la boutique vend sans prepaiement. */
  reversement?: boolean;
  enConges?: boolean;
  /** Combien d'articles publier. Zero : une boutique vide, cas reel du premier jour. */
  articles?: number;
  /** Les formulaires branches. Absents : le fil est celui des questions. */
  flux?: {
    livraison?: string;
    avis?: string;
    inscription?: string;
    ouverture?: string;
    article?: string;
  };
}

const PRIX = [15_000, 8_000, 2_500];

/**
 * Efface ce qui CONTAMINE le geste suivant — et rien de plus.
 *
 * ── Pourquoi cette fonction existe ────────────────────────────────────────
 *
 * Le balayage joue vingt-deux gestes sur une meme etape. Au premier passage,
 * les gestes se contaminaient : le formulaire d'inscription CREE une boutique,
 * et les gestes suivants s'entendaient repondre « Une boutique existe deja sur
 * ce numero ». Le tableau de reponses etait donc en partie un artefact du
 * harnais — le genre de constat qui aurait ete rapporte comme un defaut produit
 * s'il n'avait pas ete vu ici. Mesure du 13/08/2026, premier balayage.
 *
 * Remettre l'etat de conversation a zero ne suffit pas : ce qui contamine vit
 * en base, pas dans la colonne `etat`.
 *
 * ── Ce qu'on N'efface PAS, et pourquoi ────────────────────────────────────
 *
 * Les COMMANDES restent. Ce n'est pas un choix de confort : `order_event` est
 * en ajout seul, et une contrainte SQL du lot 3 refuse le DELETE — le harnais
 * s'y est heurte au deuxieme balayage. C'est le comportement voulu, un journal
 * d'audit qu'un test peut effacer n'en est pas un. Une boutique qui porte des
 * commandes n'est donc pas supprimee, seulement videe de ses articles.
 */
async function effacerPour(
  prisma: PrismaClient,
  telephones: readonly string[],
  sauf: string,
): Promise<void> {
  await prisma.botNotification.deleteMany({ where: { phone: { in: [...telephones] } } });
  await prisma.botConversation.deleteMany({ where: { phone: { in: [...telephones] } } });

  /**
   * Les boutiques NEES pendant le balayage — celles que le geste precedent a
   * creees sur le numero pilote. La boutique de la scene, elle, reste : elle
   * porte les commandes, et une commande ne s'efface pas (voir plus bas).
   */
  const intruses = await prisma.seller.findMany({
    where: { phone: { in: [...telephones] }, id: { not: sauf } },
    select: { id: true, userId: true },
  });
  for (const v of intruses) {
    /**
     * ── Ce que la BASE refuse, et pourquoi on ne le contourne pas ──────────
     *
     * `order_event` est en AJOUT SEUL : une contrainte SQL du lot 3 refuse le
     * DELETE, et le harnais s'est heurte a elle au premier balayage. C'est le
     * comportement voulu — un journal d'audit qu'un test peut effacer n'est pas
     * un journal d'audit —, donc une boutique qui porte des commandes N'EST PAS
     * supprimee. Elle est seulement videe de ses articles.
     *
     * La consequence est assumee et bornee : seules les etapes qui creent une
     * commande laissent une trace, et cette trace ne change rien au geste
     * suivant — le stock ne se decompte pas (ADR 0038) et l'etat de
     * conversation, lui, est bien remis a zero.
     */
    const commandes = await prisma.order.count({ where: { sellerId: v.id } });
    await prisma.product.deleteMany({ where: { sellerId: v.id } });
    if (commandes > 0) continue;
    await prisma.sellerAuditEvent.deleteMany({ where: { sellerId: v.id } });
    await prisma.seller.delete({ where: { id: v.id } });
    if (v.userId) await prisma.authUser.delete({ where: { id: v.userId } }).catch(() => {});
  }
  /* Les comptes restes sans boutique — le formulaire en cree un avant elle. */
  await prisma.authUser.deleteMany({
    where: { phoneNumber: { in: [...telephones] }, seller: { is: null } },
  });
}

async function poserBoutique(
  prisma: PrismaClient,
  n: number,
  vendeuseWaId: string,
  horloge: number,
  options: OptionsScene,
): Promise<{ sellerId: string; slug: string; nomBoutique: string; articles: ArticleScene[] }> {
  const { reversement = true, enConges = false, articles = 2 } = options;
  const u = await prisma.authUser.create({
    data: {
      name: `Vendeuse harnais ${n}`,
      email: `harnais-${n}@telephone.catalog.invalid`,
      phoneNumber: `+${vendeuseWaId}`,
      phoneNumberVerified: true,
    },
  });
  const slug = `harnais-${n}`;
  const nomBoutique = `Chez Amina ${n}`;
  const v = await prisma.seller.create({
    data: {
      userId: u.id,
      phone: `+${vendeuseWaId}`,
      businessName: nomBoutique,
      slug,
      city: "Douala",
      ...(reversement
        ? {
            payoutPhone: "+237656746215",
            payoutOperator: "mtn",
            payoutPhoneVerifiedAt: new Date(horloge),
          }
        : {}),
      ...(enConges ? { congesDepuis: new Date(horloge) } : {}),
    },
  });

  const crees: ArticleScene[] = [];
  for (let i = 0; i < articles; i++) {
    const p = await prisma.product.create({
      data: {
        sellerId: v.id,
        name: `Article ${i + 1}`,
        priceXaf: PRIX[i % PRIX.length] as number,
        stock: 5,
        position: i,
      },
    });
    crees.push({ id: p.id, nom: p.name, prixXaf: p.priceXaf, stock: p.stock });
  }
  return { sellerId: v.id, slug, nomBoutique, articles: crees };
}

/**
 * Remet la scene a neuf, MEMES numeros.
 *
 * Reutiliser les numeros est sur, puisque tout ce qui les portait vient d'etre
 * efface — et c'est ce qui permet au balayage de tenir dans les 99 identifiants
 * d'une execution : 484 cases, 22 numeros, au lieu de 968.
 */
export async function reinitialiserScene(scene: Scene, options: OptionsScene = {}): Promise<void> {
  const { reversement = true, enConges = false, articles = 2 } = options;
  await effacerPour(
    scene.prisma,
    [`+${scene.vendeuseWaId}`, `+${scene.acheteuseWaId}`],
    scene.sellerId,
  );
  scene.horloge = Date.now();

  /* La boutique de la scene est REMISE dans l'etat demande plutot que recreee :
     ses commandes la retiennent en base, et son journal d'audit ne s'efface
     pas. On repose donc ce qui compte — reversement, conges, articles. */
  await scene.prisma.seller.update({
    where: { id: scene.sellerId },
    data: {
      payoutPhone: reversement ? "+237656746215" : null,
      payoutOperator: reversement ? "mtn" : null,
      payoutPhoneVerifiedAt: reversement ? new Date(scene.horloge) : null,
      congesDepuis: enConges ? new Date(scene.horloge) : null,
    },
  });
  await scene.prisma.product.deleteMany({ where: { sellerId: scene.sellerId } });
  const crees: ArticleScene[] = [];
  for (let i = 0; i < articles; i++) {
    const p = await scene.prisma.product.create({
      data: {
        sellerId: scene.sellerId,
        name: `Article ${i + 1}`,
        priceXaf: PRIX[i % PRIX.length] as number,
        stock: 5,
        position: i,
      },
    });
    crees.push({ id: p.id, nom: p.name, prixXaf: p.priceXaf, stock: p.stock });
  }
  scene.articles = crees;
  scene.envoyeur.envoyes.length = 0;
  scene.envoyeur.accuses.length = 0;
}

export async function creerScene(
  prisma: PrismaClient,
  ids: Identifiants,
  options: OptionsScene = {},
): Promise<Scene> {
  const { flux = {} } = options;
  const n = ids.suivant();
  const m = ids.suivant();
  const vendeuseWaId = `23767${String(n).padStart(7, "0")}`;
  const acheteuseWaId = `23769${String(m).padStart(7, "0")}`;
  const horlogeDepart = Date.now();

  const pose = await poserBoutique(prisma, n, vendeuseWaId, horlogeDepart, options);
  const envoyeur = new EnvoyeurMemoire();
  const scene: Scene = {
    vendeuseWaId,
    acheteuseWaId,
    numero: n,
    sellerId: pose.sellerId,
    slug: pose.slug,
    nomBoutique: pose.nomBoutique,
    articles: pose.articles,
    envoyeur,
    prisma,
    horloge: horlogeDepart,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      numeroCatalog: "237600000000",
      maintenant: () => new Date(scene.horloge),
      aleatoire: (octets: number) => new Uint8Array(randomBytes(octets)),
      ...(flux.livraison ? { fluxLivraisonId: flux.livraison } : {}),
      ...(flux.avis ? { fluxAvisId: flux.avis } : {}),
      ...(flux.inscription ? { fluxInscriptionId: flux.inscription } : {}),
      ...(flux.ouverture ? { fluxOuvertureId: flux.ouverture } : {}),
      ...(flux.article ? { fluxArticleId: flux.article } : {}),
    },
  };
  return scene;
}

/* ────────────────────────── lecture de l'etape ──────────────────────────── */

export interface EtapeLue {
  cle: string;
  etatVendeuse: EtatVendeuse | null;
  etatAchat: EtatConv;
}

/**
 * Quelle etape la personne occupe, du point de vue du SERVICE.
 *
 * Cette fonction reproduit `traiterEntree` (bot.ts) : etat vendeuse d'abord,
 * perime a 24 h ; etat d'achat seulement s'il n'y a pas d'etat vendeuse. La
 * reproduction est volontairement litterale — si les deux divergent un jour, le
 * harnais mesurera une etape que le produit n'occupe pas, et c'est le genre de
 * mensonge que cet audit existe pour empecher. `harnais.test.ts` garde le
 * couplage sur les cas qui comptent.
 */
export async function lireEtape(scene: Scene, waId: string): Promise<EtapeLue> {
  const phone = waId.startsWith("+") ? waId : `+${waId}`;
  /**
   * Vendeuse ou non se LIT, a chaque tour, comme le service le lit.
   *
   * Le harnais le savait d'avance a la construction de la scene, et c'etait
   * faux : une prospect DEVIENT vendeuse au milieu de son propre parcours, et
   * l'etiquette figee rangeait ses tours suivants sous « acheteuse a l'accueil »
   * — une etape qu'elle n'occupait plus. Mesure du 13/08/2026, premier passage
   * du harnais. Un compteur de couverture qui range les cases sous la mauvaise
   * ligne est pire qu'un compteur absent : il donne un chiffre faux.
   *
   * La recherche reproduit celle de `traiterEntree` : `authUser.phoneNumber`
   * OU `seller.phone`, parce qu'une vendeuse nee de la ceremonie Google n'a pas
   * de numero de connexion (ADR 0029).
   */
  const utilisateur = await scene.prisma.authUser.findUnique({
    where: { phoneNumber: phone },
    include: { seller: true },
  });
  const estVendeuse =
    (utilisateur?.seller ??
      (await scene.prisma.seller.findUnique({ where: { phone }, select: { id: true } }))) != null;

  const enregistrement = await scene.prisma.botConversation.findUnique({ where: { phone } });
  const age = enregistrement ? scene.horloge - enregistrement.updatedAt.getTime() : 0;

  const luVendeuse = normaliserEtatVendeuse(enregistrement?.etat);
  const etatVendeuse =
    luVendeuse && enregistrement ? etatVendeuseApresInactivite(luVendeuse, age) : luVendeuse;

  let etatAchat = etatVendeuse ? ETAT_INITIAL : normaliserEtat(enregistrement?.etat);
  if (!etatVendeuse && enregistrement) etatAchat = etatApresInactivite(etatAchat, age);

  if (etatVendeuse) {
    const cle =
      etatVendeuse.nom === "comptoir" ? `comptoir:${etatVendeuse.comptoir.pas}` : etatVendeuse.nom;
    return { cle, etatVendeuse, etatAchat };
  }
  if (etatAchat.nom === "accueil") {
    if (estVendeuse) return { cle: "aucun_vendeuse", etatVendeuse: null, etatAchat };
    return {
      cle: enregistrement ? "accueil" : "aucun_prospect",
      etatVendeuse: null,
      etatAchat,
    };
  }
  return { cle: etatAchat.nom, etatVendeuse: null, etatAchat };
}

/**
 * Pose l'etat de conversation DIRECTEMENT, pour amener une personne a une
 * etape sans rejouer tout le parcours.
 *
 * C'est un raccourci de MESURE, pas un raccourci de verite : ce que le service
 * lit, c'est cette colonne, et rien d'autre. Il rend possible le balayage
 * systematique — vingt-deux gestes sur chaque etape — qui serait autrement
 * quadratique en nombre de messages.
 */
export async function poserEtape(
  scene: Scene,
  waId: string,
  etat: unknown,
  extra: { langue?: string; derniereCommandeId?: string } = {},
): Promise<void> {
  const phone = waId.startsWith("+") ? waId : `+${waId}`;
  const data = {
    etat: etat as never,
    ...(extra.langue ? { langue: extra.langue } : {}),
    ...(extra.derniereCommandeId ? { derniereCommandeId: extra.derniereCommandeId } : {}),
  };
  await scene.prisma.botConversation.upsert({
    where: { phone },
    create: { phone, ...data },
    update: data,
  });
}

/* ────────────────────────── jouer un geste ──────────────────────────────── */

export interface Tour {
  /** L'ordre du geste dans le scenario, a partir de 1. */
  rang: number;
  geste: Geste;
  /** L'etape occupee AVANT le geste — c'est elle que la couverture compte. */
  etapeAvant: string;
  etapeApres: string;
  /** Les messages emis par CE geste, dans l'ordre d'envoi. */
  messages: MessageSortant[];
  /** Les accuses de lecture emis par ce geste. */
  accuses: AccuseLecture[];
  /** L'horloge de la scene au moment du geste. */
  horloge: number;
  /** Vrai quand le geste n'a produit AUCUN message — la famille « muet ». */
  muet: boolean;
}

export interface Pilote {
  jouer(geste: Geste): Promise<Tour>;
  jouerTous(gestes: readonly Geste[]): Promise<Tour[]>;
  tours(): readonly Tour[];
}

/**
 * Le pilote d'UNE personne dans une scene.
 *
 * Le statut de vendeuse n'est PAS un parametre : il se relit a chaque tour
 * (`lireEtape`), parce qu'il change au milieu d'un parcours — c'est meme le
 * moment le plus interessant du parcours vendeuse.
 */
export function pilote(
  scene: Scene,
  waId: string,
  options: { compteur?: Compteur; prefixeMessage?: string } = {},
): Pilote {
  const journal: Tour[] = [];
  let compteurMessage = 0;
  let derniereLivraison: unknown = null;
  let dernierMessageId = "";
  const prefixe = options.prefixeMessage ?? `wamid.${waId}`;

  async function jouer(geste: Geste): Promise<Tour> {
    if (geste.attente) scene.horloge += geste.attente;

    const avant = await lireEtape(scene, waId);
    options.compteur?.noter(avant.cle, geste.famille);

    const dejaEnvoyes = scene.envoyeur.envoyes.length;
    const dejaAccuses = scene.envoyeur.accuses.length;

    if (geste.rejeu) {
      /* La relivraison de Meta : meme charge, MEME identifiant — ADR 0040. Sans
         geste precedent, il n'y a rien a rejouer, et le dire vaut mieux que de
         rejouer du vide en silence. */
      if (derniereLivraison === null) {
        throw new Error("double_envoi sans geste precedent : rien a rejouer");
      }
      await traiterLivraisonBot(scene.deps, derniereLivraison);
    } else if (geste.livraison) {
      compteurMessage += 1;
      dernierMessageId = `${prefixe}.${compteurMessage}`;
      derniereLivraison = geste.livraison(waId, dernierMessageId);
      await traiterLivraisonBot(scene.deps, derniereLivraison);
    }
    /* `silence` : rien n'est pousse. Le temps a passe, c'est tout — et c'est
       exactement ce qu'on veut observer. */

    const apres = await lireEtape(scene, waId);
    const messages = scene.envoyeur.envoyes.slice(dejaEnvoyes);
    const tour: Tour = {
      rang: journal.length + 1,
      geste,
      etapeAvant: avant.cle,
      etapeApres: apres.cle,
      messages,
      accuses: scene.envoyeur.accuses.slice(dejaAccuses),
      horloge: scene.horloge,
      muet: messages.length === 0,
    };
    journal.push(tour);
    return tour;
  }

  return {
    jouer,
    async jouerTous(gestes) {
      const sortie: Tour[] = [];
      for (const g of gestes) sortie.push(await jouer(g));
      return sortie;
    },
    tours: () => journal,
  };
}
