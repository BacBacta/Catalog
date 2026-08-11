import { formatXaf } from "@catalog/contracts/money";
import { formatPhone } from "@catalog/contracts/phone";
import { villeAcceptable } from "@catalog/contracts/villes";
import { planDePaiement } from "../order/paiement.ts";
import type { FormeNonLue } from "./entrees.ts";
import {
  genreDuJeton,
  jetonFlux,
  lireAvisFlux,
  lireReponseFlux,
  messageFlux,
  veutPositionFlux,
} from "./flux.ts";
import { demandeCarteVitrine, demandeConges } from "./inscription.ts";
import {
  boutons,
  demandeLocalisation,
  image,
  liste,
  type MessageSortant,
  reaction,
  texte,
} from "./messages.ts";
import { type Langue, langueDemandee, TEXTES, type TextesAcheteuse } from "./textes.ts";

/**
 * La machine de conversation du bot — ADR 0031, revisee par les ADR 0032
 * et 0033. Pure : pas de base, pas de reseau, pas d'horloge implicite. Elle
 * recoit l'etat, l'entree et les donnees deja chargees ; elle rend le nouvel
 * etat, les messages a envoyer, et au plus UN effet d'ecriture que la couche
 * service execute.
 *
 * Pas d'intelligence artificielle : un menu deterministe, comme un USSD.
 * La meme entree dans le meme etat produit toujours la meme reponse — c'est
 * ce qui rend la machine testable, et ce qui rend le bot previsible pour une
 * acheteuse qui le decouvre.
 *
 * Les regles tenues ici :
 * - **aucun etat n'est un piege** : « menu », « annuler » et « aide » marchent
 *   partout, en texte comme en bouton (ADR 0032) ;
 * - **rien ne se cree sans recapitulatif** : l'effet `creer_commande` ne sort
 *   que de l'etat `recap`, sur l'appui explicite de « Confirmer » ;
 * - **le panier porte plusieurs articles** (ADR 0033) : une commande, un seul
 *   acompte, une seule preuve — au lieu d'une commande par article ;
 * - **le stock suivi borne la quantite**, panier compris ; le stock a zero
 *   veut dire « non suivi », comme partout ailleurs dans le produit ;
 * - la copie sort du catalogue de `textes.ts`, en francais ou en anglais.
 */

/* ────────────────────────── donnees fournies par le service ─────────────── */

export interface ArticleBot {
  id: string;
  nom: string;
  prixXaf: number;
  /** `null` quand la vendeuse ne suit pas son stock. Ce n'est pas zero. */
  stock: number | null;
  /** Facultative (ADR 0033) — c'est elle qui vend sur la fiche. */
  description?: string;
  /**
   * URL d'image lisible par les serveurs de Meta, posee par le service quand
   * la declinaison JPEG existe. Absente : le message part sans en-tete —
   * jamais avec un lien mort, l'API refuserait tout le message.
   */
  imageUrl?: string;
}

export interface BoutiqueBot {
  /** Identifiant vendeuse — porte par le service, jamais montre. */
  id: string;
  slug: string;
  nom: string;
  ville: string;
  /** Le numero PERSONNEL de la vendeuse — « Parler a … » y mene. */
  whatsappVendeuse: string | null;
  /** Sans reversement pose, on peut commander mais pas payer d'avance. */
  reversementPose: boolean;
  /**
   * Mode conges — ADR 0039. La boutique reste ENTIEREMENT visible : accueil,
   * catalogue, fiches, photos, reputation. Seule la commande est suspendue, et
   * la conversation avec la vendeuse reste offerte partout ou elle l'etait.
   * Les commandes deja passees ne sont pas concernees.
   */
  enConges?: boolean;
  /**
   * La reputation du lot 12 — l'argument de confiance du produit, dit a
   * l'accueil. `nbVerifies` a zero : la ligne ne s'affiche pas ; on ne fait
   * pas dire « 0 vente » a une vendeuse qui debute.
   */
  reputation?: { note: number | null; nbVerifies: number };
  /**
   * Vrai quand au moins un article a une photo STOCKEE — pose par le service,
   * qui seul connait les cles d'objets. C'est ce qui fait apparaitre « Voir en
   * photos » a l'accueil (ADR 0035) sans jamais promettre une rafale vide.
   */
  aDesPhotos?: boolean;
  articles: ArticleBot[];
}

/**
 * La derniere commande passee depuis ce fil, pour repondre a « ou est ma
 * commande ? ». Le libelle vient du cycle de vie (lot 11) ; le lien de suivi
 * n'y est PAS — le jeton d'acheteuse ne se re-projette jamais (garde du
 * lot 10), la reponse renvoie donc au message de confirmation qui le porte.
 */
export interface StatutDerniereCommande {
  reference: string;
  boutique: string;
  libelle: string;
  resteXaf: number;
  /**
   * Ce que l'identite du fil autorise MAINTENANT sur cette commande
   * (ADR 0036). Calcule par le service avec les machines du domaine
   * (`appliquerEvenement`, `droitAuDepot`) : la conversation ne redit aucune
   * regle, elle propose ce qui est permis.
   */
  contresignable?: boolean;
  avisPossible?: boolean;
  /** Vrai quand l'avis portera le label « achat vérifié » (lot 12). */
  avisVerifie?: boolean;
  avisDejaDepose?: boolean;
}

/* ────────────────────────── l'etat persiste ─────────────────────────────── */

export interface LignePanier {
  articleId: string;
  quantite: number;
}

export type LivraisonBrouillon =
  | { mode: "livraison"; city: string; quartier: string; landmark: string; phone: string }
  | { mode: "retrait"; pickupPoint: string; phone: string };

export type EtatConv =
  | { nom: "accueil" }
  | { nom: "catalogue"; slug: string; page: number; panier?: LignePanier[] }
  | { nom: "quantite"; slug: string; articleId: string; panier: LignePanier[] }
  /** « Autre chose ? » — l'article vient d'entrer au panier. */
  | { nom: "ajout"; slug: string; panier: LignePanier[] }
  | { nom: "mode"; slug: string; panier: LignePanier[] }
  /**
   * La ville de LIVRAISON — ADR 0050. Elle etait injectee en silence depuis
   * la boutique : une boutique de Douala qui livrait a Yaounde enregistrait
   * « Douala ». La ville de la boutique dit ou est la VENDEUSE ; celle-ci dit
   * ou va le COLIS. Le retrait n'en a pas — le point de rendez-vous suffit.
   */
  | { nom: "ville"; slug: string; panier: LignePanier[] }
  | {
      nom: "details";
      slug: string;
      panier: LignePanier[];
      mode: "livraison" | "retrait";
      /** Absente en retrait ; presente des que le mode est « livraison ». */
      ville?: string;
      /**
       * Le point deja envoye, en attente des champs obligatoires. Il ne fait
       * PAS avancer l'etape : il patiente ici jusqu'a ce que le quartier, le
       * repere et le telephone soient donnes.
       */
      geo?: { lat: number; lng: number };
    }
  | {
      nom: "recap";
      slug: string;
      panier: LignePanier[];
      mode: "livraison" | "retrait";
      livraison: LivraisonBrouillon;
    }
  /**
   * L'apres-achat (ADR 0036) : la note vient d'etre enregistree, on attend le
   * mot facultatif. Seul etat qui ne porte pas de boutique — il ne detient
   * rien d'autre que le fait qu'un avis vient d'etre depose.
   */
  | { nom: "avis_mot" };

export const ETAT_INITIAL: EtatConv = { nom: "accueil" };

/**
 * Relit un etat persiste, de n'importe quelle generation.
 *
 * Les etats du sprint A portaient `articleId`/`quantite` sur `mode`, `details`
 * et `recap` : ils deviennent un panier d'une ligne. Tout ce qui ne se relit
 * pas retombe sur l'accueil — un etat illisible ne doit jamais faire lever la
 * machine, la conversation continue.
 */
export function normaliserEtat(brut: unknown): EtatConv {
  const e = brut as Record<string, unknown> | null;
  if (!e || typeof e !== "object" || typeof e.nom !== "string") return ETAT_INITIAL;
  const slug = typeof e.slug === "string" ? e.slug : null;
  const panier = lignesPanier(e.panier);
  const ancienne: LignePanier[] | null =
    typeof e.articleId === "string" && typeof e.quantite === "number" && e.quantite > 0
      ? [{ articleId: e.articleId, quantite: Math.floor(e.quantite) }]
      : null;
  const mode = e.mode === "livraison" || e.mode === "retrait" ? e.mode : null;

  switch (e.nom) {
    case "catalogue":
      if (!slug) return ETAT_INITIAL;
      return {
        nom: "catalogue",
        slug,
        page: typeof e.page === "number" && e.page >= 0 ? Math.floor(e.page) : 0,
        ...(panier.length > 0 ? { panier } : {}),
      };
    case "quantite":
      if (!slug || typeof e.articleId !== "string") return ETAT_INITIAL;
      return { nom: "quantite", slug, articleId: e.articleId, panier };
    case "ajout":
      if (!slug || panier.length === 0) return ETAT_INITIAL;
      return { nom: "ajout", slug, panier };
    case "mode": {
      const lignes = panier.length > 0 ? panier : ancienne;
      if (!slug || !lignes) return ETAT_INITIAL;
      return { nom: "mode", slug, panier: lignes };
    }
    case "ville": {
      const lignes = panier.length > 0 ? panier : ancienne;
      if (!slug || !lignes) return ETAT_INITIAL;
      return { nom: "ville", slug, panier: lignes };
    }
    case "details": {
      const lignes = panier.length > 0 ? panier : ancienne;
      if (!slug || !lignes || !mode) return ETAT_INITIAL;
      const ville = typeof e.ville === "string" ? e.ville : null;
      /* Un `details` de la GENERATION PRECEDENTE n'a pas de ville : elle
         etait injectee plus tard, depuis la boutique (ADR 0050). On ne la
         devine pas — on retourne la demander, panier intact. */
      if (mode === "livraison" && !ville) return { nom: "ville", slug, panier: lignes };
      return { nom: "details", slug, panier: lignes, mode, ...(ville ? { ville } : {}) };
    }
    case "recap": {
      const lignes = panier.length > 0 ? panier : ancienne;
      const livraison = e.livraison as LivraisonBrouillon | undefined;
      if (!slug || !lignes || !mode || !livraison || typeof livraison !== "object") {
        return ETAT_INITIAL;
      }
      return { nom: "recap", slug, panier: lignes, mode, livraison };
    }
    case "avis_mot":
      return { nom: "avis_mot" };
    default:
      return ETAT_INITIAL;
  }
}

function lignesPanier(brut: unknown): LignePanier[] {
  if (!Array.isArray(brut)) return [];
  const sortie: LignePanier[] = [];
  for (const l of brut) {
    const ligne = l as { articleId?: unknown; quantite?: unknown } | null;
    if (typeof ligne?.articleId === "string" && typeof ligne.quantite === "number") {
      if (ligne.quantite > 0) {
        sortie.push({ articleId: ligne.articleId, quantite: Math.floor(ligne.quantite) });
      }
    }
  }
  return sortie;
}

/**
 * Peremption d'un etat de conversation.
 *
 * Sans elle, un « bonjour » envoye trois semaines apres un flux abandonne en
 * plein etat `details` serait analyse comme une adresse. Au-dela de ce delai,
 * le flux de commande retombe sur le catalogue de la meme boutique — panier
 * compris : un panier de trois semaines ne reflete plus ni les prix ni les
 * stocks, on ne le ressuscite pas en silence.
 */
export const INACTIVITE_MAX_MS = 24 * 60 * 60 * 1000;

export function etatApresInactivite(etat: EtatConv, ageMs: number): EtatConv {
  if (ageMs < INACTIVITE_MAX_MS) return etat;
  if (etat.nom === "accueil") return etat;
  /* L'attente d'un mot d'avis perime sans boutique ou revenir : la note, elle,
     est deja enregistree (ADR 0036) — rien n'est perdu. */
  if (etat.nom === "avis_mot") return ETAT_INITIAL;
  if (etat.nom === "catalogue") {
    return { nom: "catalogue", slug: etat.slug, page: etat.page };
  }
  return { nom: "catalogue", slug: etat.slug, page: 0 };
}

/* ────────────────────────── entree et reaction ──────────────────────────── */

/** `messageId` est le wamid entrant — pour reagir et citer (ADR 0035). */
export type Entree =
  | { genre: "texte"; texte: string; messageId?: string }
  | { genre: "bouton"; id: string; messageId?: string }
  | { genre: "liste"; id: string; messageId?: string }
  /** Une photo. Le fil acheteuse ne la lit pas — seule l'inscription le fait. */
  | { genre: "image"; mediaId: string; legende?: string; messageId?: string }
  /** Une forme que le bot ne sait pas traiter — ADR 0049. */
  | { genre: "autre"; forme: FormeNonLue; messageId?: string }
  /**
   * UN POINT sur la carte. Il s'AJOUTE a la livraison, il n'en remplace aucun
   * champ : l'ADR 0005 exige le quartier, le repere et le telephone, et un
   * point GPS ne dit ni l'etage, ni « en face de la pharmacie », ni qui
   * appeler en arrivant.
   */
  | { genre: "localisation"; lat: number; lng: number; messageId?: string }
  /**
   * La reponse d'un Flow — ADR 0055. Le contenu voyage BRUT : c'est le
   * domaine qui le relit (`lireReponseFlux`), pas le parseur d'entrees.
   */
  | { genre: "flux"; reponse: string; messageId?: string };

export interface BrouillonCommande {
  slug: string;
  lignes: LignePanier[];
  livraison: LivraisonBrouillon;
}

export type EffetBot =
  | { type: "creer_commande"; brouillon: BrouillonCommande }
  | { type: "verifier_sms"; texte: string }
  /** « livrée CT-XXXXXX » — la vendeuse marque la remise depuis le fil (ADR 0035). */
  | { type: "marquer_livree"; reference: string }
  /** « ma carte » — la carte-vitrine à poster en Statut (ADR 0037). */
  | { type: "envoyer_carte" }
  /** « congés » / « je reprends » — la boutique se ferme et se rouvre (ADR 0039). */
  | { type: "basculer_conges"; fermer: boolean }
  /* ─── l'apres-achat, autorise par l'identite du fil — ADR 0036 ─── */
  | { type: "contresigner" }
  | { type: "contester" }
  | { type: "deposer_avis"; note: number }
  | { type: "completer_avis"; texte: string }
  /**
   * Le formulaire rend la note ET le mot d'un coup — un seul effet, donc, et
   * pas deux qui se suivraient : le service ecrit l'avis complet en une fois.
   */
  | { type: "deposer_avis_complet"; note: number; texte: string };

export interface Reaction {
  etat: EtatConv;
  messages: MessageSortant[];
  effet?: EffetBot;
  /** Posee quand l'acheteuse change de langue — le service la persiste. */
  langue?: Langue;
}

/* ────────────────────────── petites lectures pures ──────────────────────── */

/**
 * Le slug de boutique dans un message d'entree. Le lien `wa.me` pre-rempli
 * ecrit « Voir la boutique <slug> » ; on accepte aussi le slug nu, pour qui
 * le retape de memoire.
 */
export function extraireSlugBoutique(texteBrut: string): string | null {
  const net = texteBrut.trim().toLowerCase();
  const marque = /boutique\s+([a-z0-9][a-z0-9-]*)/.exec(net);
  if (marque?.[1]) return marque[1];
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(net)) return net;
  return null;
}

const sansAccents = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Les mots-cles valables PARTOUT, dans les deux langues. En correspondance
 * exacte : un quartier qui s'appellerait « Menu » n'existe pas, mais un repere
 * qui CONTIENT le mot existe surement — d'ou l'egalite stricte, pas la
 * recherche.
 */
/**
 * Le vocabulaire commun aux TROIS fils — ADR 0051.
 *
 * Il ne vivait que dans le fil acheteuse : « menu », « aide » et « panier »
 * ne faisaient RIEN cote vendeuse et cote inscription. Une vendeuse coincee
 * dans un formulaire n'avait qu'un mot pour sortir (« annuler »), et il
 * n'etait annonce que dans une partie des messages.
 */
/**
 * « livree CT-522801 » — ADR 0035, exporte par l'ADR 0052.
 *
 * L'aiguillage en a besoin : ce geste doit traverser un formulaire en cours,
 * ou il devient un prix de 522 801 F (`lirePrix` colle tous les chiffres).
 * « CT- » se tolere absent : six chiffres suffisent.
 */
export function demandeRemise(texteBrut: string): string | null {
  const m = /^livree\s+(?:ct-?)?(\d{6})$/.exec(sansAccents(texteBrut.trim().toLowerCase()));
  return m?.[1] ? `CT-${m[1]}` : null;
}

export function motCleGlobal(texteBrut: string): "menu" | "annuler" | "aide" | "panier" | null {
  const net = sansAccents(texteBrut.trim().toLowerCase());
  if (net === "menu" || net === "accueil" || net === "home") return "menu";
  if (net === "annuler" || net === "stop" || net === "cancel") return "annuler";
  if (net === "aide" || net === "help") return "aide";
  if (net === "panier" || net === "cart" || net === "mon panier") return "panier";
  return null;
}

/**
 * Une question sur la commande en cours. Cherchee seulement HORS flux de
 * commande : dans l'etat `details`, « livraison » fait partie de la reponse
 * attendue, pas d'une question.
 */
function demandeStatut(texteBrut: string): boolean {
  const net = sansAccents(texteBrut.trim().toLowerCase());
  return /\b(commandes?|suivis?|statuts?|livraisons?|orders?|status|tracking)\b/.test(net);
}

/**
 * Une question frequente, cherchee hors flux de commande. Trois themes qui
 * couvrent l'essentiel de ce qu'une acheteuse tape en langage libre — sans
 * intelligence artificielle : des mots, une reponse preparee, et toujours les
 * memes deux boutons de sortie.
 */
function questionFrequente(texteBrut: string): "prix" | "photo" | "variante" | null {
  const net = sansAccents(texteBrut.trim().toLowerCase());
  if (/\b(prix|combien|cout|tarif|price|how much|cost)\b/.test(net)) return "prix";
  if (/\b(photos?|images?|pictures?)\b/.test(net)) return "photo";
  if (/\b(tailles?|couleurs?|pointures?|modeles?|sizes?|colou?rs?|models?)\b/.test(net)) {
    return "variante";
  }
  return null;
}

const PAR_PAGE = 8; // 8 articles + « voir la suite » restent sous les 10 lignes.

/** Plafond absolu par article — au-dela, ce n'est plus une conversation. */
const QUANTITE_MAX = 99;

/**
 * La rafale « voir en photos » : six images au plus. Au-dela, ce n'est plus
 * une vitrine, c'est une inondation — et chaque image coute une verification
 * d'existence au service. Exportee : le service enrichit exactement autant
 * d'articles qu'il en partira.
 */
export const RAFALE_MAX = 6;

function panierDe(etat: EtatConv): LignePanier[] {
  return "panier" in etat && etat.panier ? etat.panier : [];
}

function totalPanier(b: BoutiqueBot, panier: LignePanier[]): number {
  let total = 0;
  for (const l of panier) {
    const a = b.articles.find((x) => x.id === l.articleId);
    if (a) total += a.prixXaf * l.quantite;
  }
  return total;
}

/**
 * Ce qu'on peut encore commander d'un article, panier compris. Le stock a
 * `null` (non suivi) ne borne que par le plafond conversationnel.
 */
function maxCommandable(article: ArticleBot, panier: LignePanier[]): number {
  const deja = panier.find((l) => l.articleId === article.id)?.quantite ?? 0;
  const plafond = article.stock === null ? QUANTITE_MAX : Math.min(QUANTITE_MAX, article.stock);
  return Math.max(0, plafond - deja);
}

/* ────────────────────────── le fil acheteuse ────────────────────────────── */

export interface ContexteAcheteuse {
  vers: string;
  boutique: BoutiqueBot | null;
  derniereCommande?: StatutDerniereCommande | null;
  langue?: Langue;
  /**
   * L'identifiant du Flow de livraison — ADR 0055. **Absent par defaut**, et
   * c'est le cas normal : sans lui, le fil est exactement celui d'avant.
   * Present, le formulaire s'AJOUTE a la question ; il ne la remplace jamais,
   * parce qu'un Flow ne s'affiche pas sur un WhatsApp ancien.
   */
  fluxLivraisonId?: string;
  /**
   * L'identifiant du Flow d'AVIS — meme regime que celui de livraison :
   * absent par defaut, et le fil est alors exactement celui d'avant. Present,
   * le formulaire s'AJOUTE a la liste d'etoiles ; il ne la remplace jamais,
   * parce qu'un Flow ne s'affiche pas sur un WhatsApp ancien.
   */
  fluxAvisId?: string;
}

/**
 * Les etats ou un texte libre est du CONTENU, jamais de la navigation —
 * ADR 0050.
 *
 * `details` : « Bonapriso, en face de la *boutique* Bata » est LA facon
 * camerounaise de donner un repere (AGENTS.md §2 : le repere est
 * obligatoire, il n'existe pas d'adresse). Le lire comme un lien de boutique
 * effacait le panier ET la livraison, sans un mot.
 *
 * `ville` : « Bafoussam » ressemble a un slug nu. MESURE : sans cette garde,
 * une acheteuse qui ecrit sa ville est renvoyee au catalogue.
 *
 * `recap` : elle retape sa ligne au lieu d'appuyer sur Corriger.
 * `avis_mot` : tout texte est le commentaire de son avis.
 */
/**
 * Les etats du TUNNEL D'ACHAT — ADR 0051.
 *
 * Entre le choix d'un article et la creation de la commande, les mots de
 * l'apres-achat (« confirmer », « avis », « noter ») designent autre chose
 * que ce qu'ils designent une fois la commande passee. Ils s'y taisent.
 */
function dansLeTunnel(etat: EtatConv): boolean {
  return (
    etat.nom === "quantite" ||
    etat.nom === "ajout" ||
    etat.nom === "mode" ||
    etat.nom === "ville" ||
    etat.nom === "details" ||
    etat.nom === "recap"
  );
}

function texteEstDuContenu(etat: EtatConv): boolean {
  return (
    etat.nom === "details" ||
    etat.nom === "ville" ||
    etat.nom === "recap" ||
    etat.nom === "avis_mot"
  );
}

export function reagirAcheteuse(etat: EtatConv, entree: Entree, ctx: ContexteAcheteuse): Reaction {
  const langue = ctx.langue ?? "fr";
  const t = TEXTES[langue];
  const vers = ctx.vers;
  const boutique = ctx.boutique;

  /**
   * Une forme qu'on ne sait pas lire — ADR 0049. On repond, et l'etat NE
   * BOUGE PAS : un vocal envoye au milieu de la saisie de livraison ne doit
   * pas renvoyer au catalogue. La personne reprend ou elle en etait.
   */
  if (entree.genre === "autre") {
    return { etat, messages: [texte(vers, t.formeNonLue(entree.forme))] };
  }

  /* Le changement de langue prime sur tout : c'est une demande sur la
     conversation elle-meme, pas sur la boutique. */
  if (entree.genre === "texte") {
    const demande = langueDemandee(entree.texte);
    if (demande && demande !== langue) {
      const tNouveau = TEXTES[demande];
      const suite = boutique ? accueilBoutique(vers, boutique, tNouveau, panierDe(etat)) : null;
      return {
        etat: suite?.etat ?? etat,
        messages: [texte(vers, tNouveau.langueChangee), ...(suite?.messages ?? [])],
        langue: demande,
      };
    }
  }

  /* Un slug dans le texte remet la conversation sur la boutique — SAUF la ou
     le texte libre est du CONTENU (ADR 0050) :
     c'est le geste du lien partage, il prime sur tout etat anterieur. Le
     panier suit si c'est la MEME boutique ; sinon il est laisse — et on le
     DIT, au lieu de le faire disparaitre en silence (ADR 0035). */
  if (entree.genre === "texte" && !texteEstDuContenu(etat) && extraireSlugBoutique(entree.texte)) {
    if (!boutique) {
      return { etat: ETAT_INITIAL, messages: [texte(vers, t.boutiqueIntrouvable)] };
    }
    const panier = panierDe(etat);
    const memeBoutique = "slug" in etat && etat.slug === boutique.slug;
    const accueil = accueilBoutique(vers, boutique, t, memeBoutique ? panier : []);
    if (!memeBoutique && panier.length > 0) {
      return {
        etat: accueil.etat,
        messages: [texte(vers, t.panierAbandonneAilleurs), ...accueil.messages],
      };
    }
    return accueil;
  }

  const mot = entree.genre === "texte" ? motCleGlobal(entree.texte) : null;

  /**
   * L'apres-achat — ADR 0036. Il passe AVANT l'exigence d'une boutique : on
   * contre-signe et on note une commande, pas un catalogue. L'autorisation
   * vient du fil lui-meme (`derniereCommande`), jamais d'une reference tapee.
   */
  const apres = reagirApresAchat(etat, entree, ctx, t);
  if (apres) return apres;

  if (!boutique) {
    if (entree.genre === "texte" && demandeStatut(entree.texte)) {
      return {
        etat: ETAT_INITIAL,
        messages: [messageStatut(vers, ctx.derniereCommande ?? null, t)],
      };
    }
    /**
     * L'aide OFFRE une sortie vendeuse — ADR 0034. Sans ce bouton, une
     * personne qui a entendu parler de Catalog et qui ecrit au numero
     * s'entend repondre d'ouvrir le lien d'une boutique qu'elle n'a pas :
     * l'entonnoir fuyait au premier message.
     */
    return {
      etat: ETAT_INITIAL,
      messages: [boutons(vers, t.aideAcheteuse, [{ id: "vendre", titre: t.btnVendre }])],
    };
  }

  const id = entree.genre === "bouton" || entree.genre === "liste" ? entree.id : null;

  /* Les gestes globaux, valables dans tout etat — bouton OU mot-cle.
     « menu » GARDE le panier : seul « annuler » le vide, et il le dit. */
  if (id === "menu" || mot === "menu") return accueilBoutique(vers, boutique, t, panierDe(etat));
  if (id === "annuler" || mot === "annuler") {
    const accueil = accueilBoutique(vers, boutique, t);
    return {
      etat: accueil.etat,
      messages: [texte(vers, t.annule), ...accueil.messages],
    };
  }
  if (mot === "aide") {
    return { etat, messages: [texte(vers, t.aideGestes)] };
  }
  /**
   * « panier » marche PARTOUT (T8) : depuis le catalogue, depuis une fiche,
   * depuis le flux de livraison. Jusqu'ici, la premiere fois qu'une acheteuse
   * voyait ses lignes etait le recapitulatif — trop tard pour corriger.
   */
  if (id === "panier" || mot === "panier") {
    const contenu = panierDe(etat);
    if (contenu.length === 0) {
      return { etat, messages: [texte(vers, t.panierVide)] };
    }
    return {
      etat: { nom: "ajout", slug: boutique.slug, panier: contenu },
      messages: messageAjout(vers, boutique, contenu, t),
    };
  }
  /**
   * Mode conges — ADR 0039. Le refus se pose sur les TROIS gestes qui font
   * avancer vers une commande, et pas seulement sur le premier : un fil ouvert
   * avant le depart en conges porte encore ses anciens boutons, et WhatsApp les
   * laisse appuyer. `confirmer` est le dernier verrou avant `creer_commande`.
   *
   * Tout le reste marche : catalogue, fiches, photos, panier, suivi, avis. Une
   * boutique fermee reste une vitrine, et la vendeuse reste joignable.
   */
  if (
    boutique.enConges &&
    (id === "commander" || id === "confirmer" || (id?.startsWith("cmd:") ?? false))
  ) {
    return {
      etat,
      messages: [
        boutons(vers, t.boutiqueFermee(boutique.nom), [
          ...(boutique.whatsappVendeuse ? [{ id: "vendeuse", titre: t.btnParlerVendeuse }] : []),
          { id: "catalogue", titre: t.btnVoirArticles },
        ]),
      ],
    };
  }

  if (id === "vendeuse") {
    if (!boutique.whatsappVendeuse) return accueilBoutique(vers, boutique, t);
    const chiffres = boutique.whatsappVendeuse.replace(/\D/g, "");
    return {
      etat: { nom: "catalogue", slug: boutique.slug, page: 0, panier: panierDe(etat) },
      messages: [texte(vers, t.parlerVendeuse(boutique.nom, `https://wa.me/${chiffres}`))],
    };
  }
  if (id === "catalogue" || id?.startsWith("cat:")) {
    const page = id?.startsWith("cat:") ? Number(id.slice(4)) || 0 : 0;
    return pageCatalogue(vers, boutique, page, panierDe(etat), t);
  }
  if (id === "photos") {
    /* La rafale : chaque article illustre part en photo pleine largeur,
       legendee nom et prix, puis la liste reprend la main. Le service n'a
       enrichi que les URL VERIFIEES — une rafale ne promet jamais un lien
       mort (regle de l'ADR 0032). */
    const suite = pageCatalogue(vers, boutique, 0, panierDe(etat), t);
    const photos = boutique.articles
      .slice(0, RAFALE_MAX)
      .flatMap((a) =>
        a.imageUrl ? [image(vers, a.imageUrl, `${a.nom} — ${formatXaf(a.prixXaf)}`)] : [],
      );
    if (photos.length === 0) {
      return { etat: suite.etat, messages: [texte(vers, t.rafaleAucunePhoto), ...suite.messages] };
    }
    return { etat: suite.etat, messages: [...photos, ...suite.messages] };
  }
  if (id?.startsWith("art:")) {
    const page = etat.nom === "catalogue" ? etat.page : 0;
    return ficheArticle(vers, boutique, id.slice(4), page, panierDe(etat), t);
  }
  if (id?.startsWith("cmd:")) {
    const article = boutique.articles.find((a) => a.id === id.slice(4));
    if (!article) return accueilBoutique(vers, boutique, t);
    const panier = panierDe(etat);
    if (maxCommandable(article, panier) === 0) {
      const suite =
        panier.length > 0
          ? messageAjout(vers, boutique, panier, t)
          : pageCatalogue(vers, boutique, 0, panier, t).messages;
      return {
        etat:
          panier.length > 0
            ? { nom: "ajout", slug: boutique.slug, panier }
            : { nom: "catalogue", slug: boutique.slug, page: 0, panier },
        messages: [texte(vers, t.plusDeStock(article.nom)), ...suite],
      };
    }
    return {
      etat: { nom: "quantite", slug: boutique.slug, articleId: article.id, panier },
      messages: [questionQuantite(vers, article, panier, t, Boolean(boutique.whatsappVendeuse))],
    };
  }

  /* Les questions en langage libre — hors flux de commande seulement. */
  if ((etat.nom === "accueil" || etat.nom === "catalogue") && entree.genre === "texte") {
    if (demandeStatut(entree.texte)) {
      return { etat, messages: [messageStatut(vers, ctx.derniereCommande ?? null, t)] };
    }
    const faq = questionFrequente(entree.texte);
    if (faq) {
      const corps = faq === "prix" ? t.faqPrix : faq === "photo" ? t.faqPhoto : t.faqVariante;
      return {
        etat,
        messages: [
          boutons(vers, corps, [
            { id: "catalogue", titre: t.btnVoirArticles },
            ...(boutique.whatsappVendeuse ? [{ id: "vendeuse", titre: t.btnParlerVendeuse }] : []),
          ]),
        ],
      };
    }
  }

  switch (etat.nom) {
    case "quantite": {
      const article = boutique.articles.find((a) => a.id === etat.articleId);
      if (!article) return accueilBoutique(vers, boutique, t);
      const max = maxCommandable(article, etat.panier);

      let quantite: number | null = null;
      const choisi = id?.startsWith("qte:") ? Number(id.slice(4)) : Number.NaN;
      if (Number.isInteger(choisi) && choisi > 0) quantite = choisi;
      else if (id === "qte:autre") {
        return { etat, messages: [texte(vers, t.quantiteAutre)] };
      } else if (entree.genre === "texte") {
        const n = Number(entree.texte.trim());
        if (Number.isInteger(n) && n > 0) quantite = n;
      }
      /* Un refus de quantite ne doit pas etre un cul-de-sac — ADR 0053 : on
         explique, PUIS on re-propose la liste, qui porte la sortie. */
      const joignable = Boolean(boutique.whatsappVendeuse);
      if (quantite === null) {
        return {
          etat,
          messages: [
            texte(vers, t.quantiteIncomprise),
            questionQuantite(vers, article, etat.panier, t, joignable),
          ],
        };
      }
      if (quantite > max) {
        return {
          etat,
          messages: [
            texte(vers, t.quantiteTropHaute(max)),
            questionQuantite(vers, article, etat.panier, t, joignable),
          ],
        };
      }

      /* L'article entre au panier — fusionne s'il y etait deja. */
      const panier = etat.panier.some((l) => l.articleId === article.id)
        ? etat.panier.map((l) =>
            l.articleId === article.id ? { ...l, quantite: l.quantite + quantite } : l,
          )
        : [...etat.panier, { articleId: article.id, quantite }];
      return {
        etat: { nom: "ajout", slug: etat.slug, panier },
        messages: messageAjout(vers, boutique, panier, t, t.ajout(article.nom, quantite)),
      };
    }

    case "ajout": {
      if (id === "commander") {
        return {
          etat: { nom: "mode", slug: etat.slug, panier: etat.panier },
          messages: [
            questionMode(
              vers,
              totalPanier(boutique, etat.panier),
              t,
              Boolean(boutique.whatsappVendeuse),
            ),
          ],
        };
      }
      /* « catalogue » et « annuler » sont deja traites en gestes globaux. */
      return { etat, messages: messageAjout(vers, boutique, etat.panier, t) };
    }

    case "mode": {
      /* Le mode s'accepte au bouton comme au mot tape : forcer le bouton a qui
         a deja ecrit « livraison » serait un refus de comprendre. */
      const tape = entree.genre === "texte" ? sansAccents(entree.texte.trim().toLowerCase()) : "";
      const mode =
        id === "mode:livraison" || tape === "livraison" || tape === "delivery"
          ? "livraison"
          : id === "mode:retrait" ||
              tape === "retrait" ||
              tape === "point de retrait" ||
              tape === "pickup"
            ? "retrait"
            : null;
      if (!mode) {
        return {
          etat,
          messages: [
            questionMode(
              vers,
              totalPanier(boutique, etat.panier),
              t,
              Boolean(boutique.whatsappVendeuse),
            ),
          ],
        };
      }
      /* La livraison demande OU — ADR 0050. Le retrait, non : le point de
         rendez-vous porte deja le lieu, et lui ajouter une ville serait un
         tour de parole pour rien. */
      if (mode === "livraison") {
        /**
         * Le formulaire part EN PLUS, jamais A LA PLACE — ADR 0055. La
         * question passe en DERNIER : c'est le message qui reste visible si
         * le Flow ne s'affiche pas, et c'est le cas de l'Android bas de gamme
         * qu'on ne peut pas se permettre de perdre.
         */
        const raccourci = ctx.fluxLivraisonId
          ? [
              messageFlux(
                vers,
                ctx.fluxLivraisonId,
                t.btnFluxLivraison,
                jetonFlux("livraison", etat.slug),
                t.corpsFluxLivraison,
              ),
            ]
          : [];
        return {
          etat: { nom: "ville", slug: etat.slug, panier: etat.panier },
          messages: [
            ...raccourci,
            questionVille(vers, boutique.ville, t, Boolean(boutique.whatsappVendeuse)),
          ],
        };
      }
      return {
        etat: { nom: "details", slug: etat.slug, panier: etat.panier, mode },
        messages: messagesDetails(
          vers,
          t.questionDetailsRetrait,
          t,
          Boolean(boutique.whatsappVendeuse),
          mode,
        ),
      };
    }

    case "ville": {
      /* Un appui sur la ville de la boutique, ou n'importe quelle ville
         ecrite. On ne propose PAS de liste : le Cameroun ne tient pas en dix
         lignes, et une liste incomplete exclurait une acheteuse en silence. */
      /**
       * Une reponse de Flow porte les QUATRE champs d'un coup — ADR 0055.
       * Elle saute donc `details` et va droit au recapitulatif, qui reste le
       * seul endroit ou la livraison se relit avant de s'engager (ADR 0032).
       * Illisible, elle ne casse rien : la question se re-pose.
       */
      if (entree.genre === "flux") {
        const lu = lireReponseFlux(entree.reponse);
        if (!lu) {
          return {
            etat,
            messages: [questionVille(vers, boutique.ville, t, Boolean(boutique.whatsappVendeuse))],
          };
        }
        /* La case cochee dans le formulaire n'est qu'une INTENTION : seul le
           message natif sait capter un point (aucun composant de carte
           n'existe — mesure du 11/08/2026, ADR 0063). Le recapitulatif passe
           EN PREMIER : elle relit ce qu'elle a saisi avant qu'on lui demande
           autre chose. Le point recu ensuite s'attache au recapitulatif, qui
           se re-montre — le chemin est deja ecrit (ADR 0062). */
        return {
          etat: {
            nom: "recap",
            slug: etat.slug,
            panier: etat.panier,
            mode: "livraison",
            livraison: lu,
          },
          messages: [
            messageRecap(vers, boutique, etat.panier, lu, t),
            ...(veutPositionFlux(entree.reponse)
              ? [demandeLocalisation(vers, t.positionApresFormulaire)]
              : []),
          ],
        };
      }
      const proposee = id === "ville:boutique" ? boutique.ville : null;
      const tapee = entree.genre === "texte" ? entree.texte.trim() : "";
      const ville = proposee ?? (villeAcceptable(tapee) ? tapee : null);
      if (!ville) {
        return {
          etat,
          messages: [questionVille(vers, boutique.ville, t, Boolean(boutique.whatsappVendeuse))],
        };
      }
      return {
        etat: { nom: "details", slug: etat.slug, panier: etat.panier, mode: "livraison", ville },
        messages: messagesDetails(
          vers,
          t.questionDetailsLivraison,
          t,
          Boolean(boutique.whatsappVendeuse),
          "livraison",
        ),
      };
    }

    case "details": {
      /**
       * Un POINT recu pendant la saisie. Il se retient et l'etape ne bouge
       * PAS : le quartier, le repere et le telephone restent exiges
       * (ADR 0005). Le point ne dit pas l'etage, ni « en face de la pharmacie
       * du Rond-Point », ni qui appeler en arrivant — c'est le repere qui
       * fait le travail au Cameroun, et le point qui vient en plus.
       *
       * On ne redemande PAS la position : elle vient d'etre donnee.
       */
      if (entree.genre === "localisation") {
        return {
          etat: { ...etat, geo: { lat: entree.lat, lng: entree.lng } },
          messages: [
            questionDetails(
              vers,
              t.positionRecue(
                etat.mode === "livraison" ? t.questionDetailsLivraison : t.questionDetailsRetrait,
              ),
              t,
              Boolean(boutique.whatsappVendeuse),
            ),
          ],
        };
      }
      if (entree.genre !== "texte") {
        return {
          etat,
          messages: [
            questionDetails(vers, t.detailsParTexte, t, Boolean(boutique.whatsappVendeuse)),
          ],
        };
      }
      const lu = lireDetailsLivraison(entree.texte, etat.mode, etat.ville ?? boutique.ville, t);
      if (!lu.ok) {
        return {
          etat,
          messages: [questionDetails(vers, lu.aide, t, Boolean(boutique.whatsappVendeuse))],
        };
      }
      /**
       * RIEN ne se cree ici : on montre ce qui a ete compris — livraison
       * relue comprise — et on attend « Confirmer ». C'est le seul endroit ou
       * l'acheteuse peut voir une adresse mal decoupee AVANT qu'elle entre
       * dans une commande (ADR 0032).
       */
      /* Le point retenu rejoint la livraison ICI, une fois les champs
         obligatoires donnes — et seulement en livraison : `geo` n'existe pas
         sur un retrait, c'est le schema qui le dit. */
      const livraison =
        etat.geo && lu.livraison.mode === "livraison"
          ? { ...lu.livraison, geo: etat.geo }
          : lu.livraison;
      return {
        etat: {
          nom: "recap",
          slug: etat.slug,
          panier: etat.panier,
          mode: etat.mode,
          livraison,
        },
        messages: [messageRecap(vers, boutique, etat.panier, livraison, t)],
      };
    }

    case "recap": {
      /**
       * Le mot TAPE vaut l'appui — ADR 0051. Le libelle est ecrit sur le
       * bouton : refuser ce qu'on affiche est le defaut qu'on passe ce lot a
       * corriger. Et les boutons ne s'affichent pas toujours — vieux
       * WhatsApp, message transfere, connexion degradee : taper est le repli
       * naturel, et c'est la population qui en depend le plus.
       *
       * Correspondance EXACTE, jamais une sous-chaine : « je ne veux pas
       * confirmer » ne confirme rien. L'etat `recap` a deja montre les
       * articles, le total et la livraison — l'engagement est informe qu'elle
       * tape ou qu'elle appuie.
       */
      /**
       * Le point envoye APRES coup — elle a lu le recapitulatif, puis a
       * pense a sa position. Il s'attache et le recapitulatif se RE-MONTRE :
       * on ne confirme jamais une livraison qu'elle vient de modifier sans
       * la lui remontrer (ADR 0032).
       */
      if (entree.genre === "localisation" && etat.livraison.mode === "livraison") {
        const livraison = { ...etat.livraison, geo: { lat: entree.lat, lng: entree.lng } };
        return {
          etat: { ...etat, livraison },
          messages: [messageRecap(vers, boutique, etat.panier, livraison, t)],
        };
      }

      const mot = entree.genre === "texte" ? sansAccents(entree.texte.trim().toLowerCase()) : "";
      if (id === "confirmer" || mot === "confirmer" || mot === "confirm") {
        return {
          /* La boutique reste en contexte ; le panier, lui, part en commande. */
          etat: { nom: "catalogue", slug: etat.slug, page: 0 },
          messages: [], // la confirmation part APRES la creation, avec la vraie reference
          effet: {
            type: "creer_commande",
            brouillon: { slug: etat.slug, lignes: etat.panier, livraison: etat.livraison },
          },
        };
      }
      if (id === "corriger" || mot === "corriger" || mot === "correct") {
        /* Corriger une ligne de livraison ne doit pas coûter le panier —
           ADR 0053. Ça renvoyait a l'etape `ajout`, donc il fallait
           re-traverser mode, ville ET details pour rectifier un chiffre.
           On rouvre la SAISIE, la ou l'erreur a ete faite. */
        /* La ville se relit de la LIVRAISON deja analysee : l'etat `recap` ne
           la porte pas a part, et c'est bien — une seule source. */
        const villeChoisie = etat.livraison.mode === "livraison" ? etat.livraison.city : null;
        if (etat.mode === "livraison" && villeChoisie) {
          return {
            etat: {
              nom: "details",
              slug: etat.slug,
              panier: etat.panier,
              mode: "livraison",
              ville: villeChoisie,
            },
            messages: [
              questionDetails(
                vers,
                t.questionDetailsLivraison,
                t,
                Boolean(boutique.whatsappVendeuse),
              ),
            ],
          };
        }
        return {
          etat: { nom: "details", slug: etat.slug, panier: etat.panier, mode: etat.mode },
          messages: [
            questionDetails(vers, t.questionDetailsRetrait, t, Boolean(boutique.whatsappVendeuse)),
          ],
        };
      }
      return {
        etat,
        messages: [
          boutons(vers, t.recapParBoutons, [
            { id: "confirmer", titre: t.btnConfirmer },
            { id: "corriger", titre: t.btnCorriger },
            { id: "annuler", titre: t.btnAnnuler },
          ]),
        ],
      };
    }

    default:
      return accueilBoutique(vers, boutique, t, panierDe(etat));
  }
}

/* ──────────────────── l'apres-achat dans le fil (ADR 0036) ──────────────── */

/**
 * Les quatre gestes que l'identite du fil autorise, et rien d'autre :
 * contre-signer, contester, noter, ajouter un mot.
 *
 * Rend `null` quand l'entree n'est aucun de ces gestes — la conversation
 * ordinaire reprend alors la main. **Aucune regle metier n'est redite ici** :
 * ce qui est permis vient de `ctx.derniereCommande`, calcule par le service
 * avec les machines du lot 7 et du lot 12 (decision 4 de l'ADR).
 */
function reagirApresAchat(
  etat: EtatConv,
  entree: Entree,
  ctx: ContexteAcheteuse,
  t: TextesAcheteuse,
): Reaction | null {
  const vers = ctx.vers;
  const id = entree.genre === "bouton" || entree.genre === "liste" ? entree.id : null;
  /**
   * Les MOTS de l'apres-achat sont inertes dans le tunnel d'achat — ADR 0051.
   *
   * « Confirmer » est le libelle du bouton du RECAPITULATIF (`btnConfirmer`).
   * Quelqu'un qui recopie le mot au lieu d'appuyer perdait son panier, son
   * mode et sa livraison ; avec une commande anterieure dans le fil, il
   * contre-signait la MAUVAISE commande — le controle n°7 declenche sur autre
   * chose. Les boutons, eux, restent honores partout : leur identifiant est
   * pose par nous, il ne se tape pas par hasard.
   */
  const tape =
    entree.genre === "texte" && !dansLeTunnel(etat)
      ? sansAccents(entree.texte.trim().toLowerCase())
      : "";
  const commande = ctx.derniereCommande ?? null;

  /* Le mot d'avis attendu : tout texte devient le commentaire. Les mots-cles
     globaux, eux, ont deja repris la main plus haut. */
  if (etat.nom === "avis_mot") {
    if (id === "avis:sans_mot") {
      return { etat: ETAT_INITIAL, messages: [texte(vers, t.avisMotMerci)] };
    }
    if (entree.genre === "texte" && entree.texte.trim().length > 1) {
      return {
        etat: ETAT_INITIAL,
        messages: [texte(vers, t.avisMotMerci)],
        effet: { type: "completer_avis", texte: entree.texte.trim().slice(0, 1000) },
      };
    }
  }

  const veutContresigner = id === "contresigner" || tape === "confirmer";
  const veutContester = id === "contester";
  const veutNoter = id === "avis" || tape === "avis" || tape === "noter" || tape === "review";
  const note = id?.startsWith("note:") ? Number(id.slice(5)) : null;
  /* Une reponse de formulaire n'arrive ici QUE si son jeton dit « avis ».
     Une reponse de LIVRAISON emprunte le meme chemin technique (`nfm_reply`)
     et n'a rien a faire dans l'apres-achat : c'est tout l'objet du jeton. */
  const avisParFormulaire = entree.genre === "flux" && genreDuJeton(entree.reponse) === "avis";

  if (
    !veutContresigner &&
    !veutContester &&
    !veutNoter &&
    !avisParFormulaire &&
    note === null &&
    id !== "contester:oui"
  ) {
    return null;
  }

  /* Aucune commande dans ce fil : on le DIT, on n'invente rien. */
  if (!commande) {
    return { etat: ETAT_INITIAL, messages: [texte(vers, t.apresAchatSansCommande)] };
  }

  if (veutContresigner) {
    if (!commande.contresignable) {
      return { etat, messages: [texte(vers, t.contresigneImpossible)] };
    }
    return {
      etat,
      messages: [texte(vers, t.contresigneMerci(commande.reference))],
      effet: { type: "contresigner" },
    };
  }

  if (veutContester) {
    /* La contestation se CONFIRME : un appui malheureux gelerait la commande. */
    return {
      etat,
      messages: [
        boutons(vers, t.contesterConfirmation(commande.reference), [
          { id: "contester:oui", titre: t.btnContesterOui },
          { id: "menu", titre: t.btnAnnuler },
        ]),
      ],
    };
  }

  /**
   * La reponse du formulaire d'avis : la note ET le mot arrivent ensemble,
   * la ou le chemin question-par-question les separe en deux etapes. Les deux
   * effets partent donc a la suite, dans cet ordre — la note d'abord, c'est
   * elle qui cree l'avis.
   */
  if (avisParFormulaire && entree.genre === "flux") {
    const lu = lireAvisFlux(entree.reponse);
    if (!lu) return { etat, messages: [texte(vers, t.avisImpossible)] };
    if (commande.avisDejaDepose) {
      return { etat, messages: [texte(vers, t.avisDejaDepose)] };
    }
    if (!commande.avisPossible) {
      return { etat, messages: [texte(vers, t.avisImpossible)] };
    }
    if (lu.mot) {
      return {
        etat: ETAT_INITIAL,
        messages: [texte(vers, t.avisMotMerci)],
        effet: { type: "deposer_avis_complet", note: lu.note, texte: lu.mot },
      };
    }
    return {
      etat: ETAT_INITIAL,
      messages: [texte(vers, t.avisMotMerci)],
      effet: { type: "deposer_avis", note: lu.note },
    };
  }

  if (id === "contester:oui") {
    return {
      etat,
      messages: [texte(vers, t.contesteEnregistre(commande.reference))],
      effet: { type: "contester" },
    };
  }

  if (veutNoter) {
    if (commande.avisDejaDepose) {
      return { etat, messages: [texte(vers, t.avisDejaDepose)] };
    }
    if (!commande.avisPossible) {
      return { etat, messages: [texte(vers, t.avisImpossible)] };
    }
    /* Le formulaire s'AJOUTE a la liste d'etoiles — meme regle que la
       livraison (ADR 0055) : un Flow exige un WhatsApp recent, la liste
       marche partout. Celle qui peut l'ouvrir note et commente d'un geste ;
       les autres suivent le chemin d'avant, intact. */
    const formulaire = ctx.fluxAvisId
      ? [
          messageFlux(
            vers,
            ctx.fluxAvisId,
            t.btnNoter,
            jetonFlux("avis"),
            t.avisInvitation(commande.boutique),
          ),
        ]
      : [];
    return {
      etat,
      messages: [
        ...formulaire,
        liste(
          vers,
          t.avisInvitation(commande.boutique),
          t.btnNoter,
          [5, 4, 3, 2, 1].map((n) => ({ id: `note:${n}`, titre: t.avisLigne(n) })),
        ),
      ],
    };
  }

  if (note !== null) {
    if (!Number.isInteger(note) || note < 1 || note > 5) {
      return { etat, messages: [texte(vers, t.avisImpossible)] };
    }
    if (commande.avisDejaDepose) {
      return { etat, messages: [texte(vers, t.avisDejaDepose)] };
    }
    if (!commande.avisPossible) {
      return { etat, messages: [texte(vers, t.avisImpossible)] };
    }
    /* La note s'enregistre TOUT DE SUITE ; le mot l'enrichit ensuite. */
    return {
      etat: { nom: "avis_mot" },
      messages: [
        boutons(vers, t.avisNoteEnregistree(commande.avisVerifie === true), [
          { id: "avis:sans_mot", titre: t.btnSansMot },
        ]),
      ],
      effet: { type: "deposer_avis", note },
    };
  }

  return null;
}

/* ────────────────────────── les messages du fil ─────────────────────────── */

/** Au-dela, la liste WhatsApp deborde ses dix lignes — ADR 0053. */
const QUANTITE_LISTE_MAX = 8;

/**
 * La quantite se CHOISIT — ADR 0053.
 *
 * Trois boutons couvraient 1, 2, et « un autre nombre » : des trois, seule la
 * saisie clavier restait pour commander trois pagnes. Une liste en porte dix,
 * bornee par le stock quand il est connu — on ne propose jamais ce qui
 * n'existe pas.
 *
 * La derniere ligne est une SORTIE, presente a toutes les etapes du tunnel
 * (AGENTS.md §1 : l'acheteuse et la vendeuse continuent de se parler).
 */
function questionQuantite(
  vers: string,
  article: ArticleBot,
  panier: LignePanier[],
  t: TextesAcheteuse,
  boutiqueJoignable: boolean,
): MessageSortant {
  const max = maxCommandable(article, panier);
  const nombres = Math.min(max, QUANTITE_LISTE_MAX);
  const choix = [
    ...Array.from({ length: nombres }, (_, i) => ({
      id: `qte:${i + 1}`,
      titre: String(i + 1),
      description: "",
    })),
    ...(max > nombres ? [{ id: "qte:autre", titre: t.btnAutreNombre, description: "" }] : []),
    boutiqueJoignable
      ? { id: "vendeuse", titre: t.btnParlerVendeuse, description: "" }
      : { id: "menu", titre: t.btnAccueil, description: "" },
  ];
  return liste(vers, t.questionQuantite(article.nom, article.stock), t.btnChoisirQuantite, choix);
}

/**
 * La question de livraison, avec sa SORTIE — ADR 0053.
 *
 * Elle attend un texte, mais un message a boutons se repond aussi au clavier :
 * offrir la sortie ne coute donc rien et ferme le dernier cul-de-sac du
 * tunnel. Sans elle, l'acheteuse bloquee sur « il me manque le numero » n'a
 * aucun moyen visible de joindre la vendeuse.
 */
/**
 * La saisie de livraison : la question, PUIS la demande de position.
 *
 * Deux messages et non un, parce que `location_request_message` n'accepte
 * qu'une seule action : en faire la question ferait disparaitre « parler a la
 * vendeuse » et « annuler » de l'ecran, au moment ou l'acheteuse tape le plus
 * long message de son parcours. Les sorties de secours restent sur la
 * question ; le point vient en plus, et son texte dit qu'il est facultatif.
 *
 * Le RETRAIT n'en recoit pas : le point de rendez-vous est celui de la
 * vendeuse, la position de l'acheteuse n'y veut rien dire.
 */
function messagesDetails(
  vers: string,
  corps: string,
  t: TextesAcheteuse,
  boutiqueJoignable: boolean,
  mode: "livraison" | "retrait",
): MessageSortant[] {
  const question = questionDetails(vers, corps, t, boutiqueJoignable);
  if (mode !== "livraison") return [question];
  return [question, demandeLocalisation(vers, t.demandePosition)];
}

function questionDetails(
  vers: string,
  corps: string,
  t: TextesAcheteuse,
  boutiqueJoignable: boolean,
): MessageSortant {
  return boutons(vers, corps, [
    boutiqueJoignable
      ? { id: "vendeuse", titre: t.btnParlerVendeuse }
      : { id: "menu", titre: t.btnAccueil },
    { id: "annuler", titre: t.btnAnnuler },
  ]);
}

/** Les trois sorties de l'etape panier : commander, continuer, abandonner. */
function boutonsAjout(
  vers: string,
  corps: string,
  t: TextesAcheteuse,
  boutiqueJoignable = false,
): MessageSortant {
  return boutons(vers, corps, [
    { id: "commander", titre: t.btnPasserCommande },
    { id: "catalogue", titre: t.btnAutreArticle },
    boutiqueJoignable
      ? { id: "vendeuse", titre: t.btnParlerVendeuse }
      : { id: "annuler", titre: t.btnAnnuler },
  ]);
}

/**
 * Les lignes du panier, telles qu'elles se lisent — ADR 0033, complete par la
 * tranche P1d. Un article disparu du catalogue depuis l'ajout est simplement
 * omis : la creation le reverifiera de toute facon (`resoudreLignes`).
 */
function lignesLisibles(b: BoutiqueBot, panier: LignePanier[], t: TextesAcheteuse): string[] {
  return panier.flatMap((l) => {
    const a = b.articles.find((x) => x.id === l.articleId);
    return a ? [t.ligneArticle(a.nom, l.quantite, a.prixXaf)] : [];
  });
}

/**
 * L'etape panier telle qu'elle s'affiche. Jusqu'a la tranche P1d elle n'en
 * montrait que le TOTAL : la premiere fois qu'une acheteuse relisait ses lignes
 * etait le recapitulatif, une fois la livraison saisie — trop tard pour
 * corriger sans tout reprendre. Elle les montre desormais a chaque passage.
 *
 * `ajoute` n'est present que lorsqu'on vient d'ajouter quelque chose : l'accuse
 * de reception a sa valeur propre, il ne se deduit pas d'une liste.
 */
function messageAjout(
  vers: string,
  b: BoutiqueBot,
  panier: LignePanier[],
  t: TextesAcheteuse,
  ajoute?: string,
): MessageSortant[] {
  const corps = t.panierCorps(lignesLisibles(b, panier, t), totalPanier(b, panier));
  return [
    boutonsAjout(vers, ajoute ? `${ajoute}\n\n${corps}` : corps, t, Boolean(b.whatsappVendeuse)),
  ];
}

/**
 * « Livraison dans quelle ville ? » — ADR 0050.
 *
 * UN bouton, celui de la ville de la boutique : c'est le cas majoritaire, et
 * il coute une frappe. Toute autre ville s'ECRIT — on ne propose pas de
 * liste, parce que le Cameroun ne tient pas en dix lignes et qu'une liste
 * incomplete exclurait une acheteuse sans lui dire pourquoi.
 */
/**
 * Le jeton de session du Flow — ADR 0055. Jetable, deterministe, sans secret.
 * Le jeton acheteuse (`buyerToken`, ADR 0021) autorise la contre-signature :
 * il ne voyage JAMAIS dans un message que WhatsApp nous renverra. Le numero
 * n'y entre pas non plus — le fil le porte deja, l'y recopier n'ajoute rien.
 */
function questionVille(
  vers: string,
  villeBoutique: string,
  t: TextesAcheteuse,
  boutiqueJoignable = false,
): MessageSortant {
  return boutons(vers, t.questionVille(villeBoutique), [
    { id: "ville:boutique", titre: villeBoutique },
    boutiqueJoignable
      ? { id: "vendeuse", titre: t.btnParlerVendeuse }
      : { id: "annuler", titre: t.btnAnnuler },
  ]);
}

function questionMode(
  vers: string,
  totalXaf: number,
  t: TextesAcheteuse,
  boutiqueJoignable = false,
): MessageSortant {
  return boutons(vers, t.questionMode(totalXaf), [
    { id: "mode:livraison", titre: t.btnLivraison },
    { id: "mode:retrait", titre: t.btnRetrait },
    boutiqueJoignable
      ? { id: "vendeuse", titre: t.btnParlerVendeuse }
      : { id: "annuler", titre: t.btnAnnuler },
  ]);
}

/** « 4.8 » → « 4,8 » en francais ; l'anglais garde le point. */
function noteAffichee(note: number, langue: "fr" | "point"): string {
  return langue === "fr" ? String(note).replace(".", ",") : String(note);
}

function accueilBoutique(
  vers: string,
  b: BoutiqueBot,
  t: TextesAcheteuse,
  panier: LignePanier[] = [],
): Reaction {
  const rep = b.reputation;
  const note = rep?.note != null ? noteAffichee(rep.note, t === TEXTES.fr ? "fr" : "point") : null;
  const lignes = [
    `*${b.nom}* — ${b.ville}`,
    ...(rep && rep.nbVerifies > 0 ? [t.accueilReputation(note, rep.nbVerifies)] : []),
    /* Fermee, on le dit A L'ACCUEIL : laisser choisir un article puis refuser
       a la fin serait la meme faute que la course de livraison decouverte a la
       remise (ADR 0035). */
    b.enConges ? t.boutiqueFermeeAccueil : t.accueilPitch,
  ];
  /* Trois boutons au plus (limite API) : la vitrine, les photos, l'humaine. */
  const choix = [
    { id: "catalogue", titre: t.btnVoirArticles },
    ...(b.aDesPhotos ? [{ id: "photos", titre: t.btnVoirPhotos }] : []),
    ...(b.whatsappVendeuse ? [{ id: "vendeuse", titre: t.btnParlerVendeuse }] : []),
  ];
  const enTete = b.articles.find((a) => a.imageUrl)?.imageUrl;
  return {
    etat: { nom: "catalogue", slug: b.slug, page: 0, ...(panier.length > 0 ? { panier } : {}) },
    messages: [boutons(vers, lignes.join("\n"), choix, enTete ? { image: enTete } : {})],
  };
}

function pageCatalogue(
  vers: string,
  b: BoutiqueBot,
  page: number,
  panier: LignePanier[],
  t: TextesAcheteuse,
): Reaction {
  const debut = page * PAR_PAGE;
  const tranche = b.articles.slice(debut, debut + PAR_PAGE);
  if (tranche.length === 0) {
    /* Jamais de cul-de-sac : meme vide, la boutique offre une sortie. */
    const choix = b.whatsappVendeuse
      ? [{ id: "vendeuse", titre: t.btnParlerVendeuse }]
      : [{ id: "menu", titre: t.btnAccueil }];
    return {
      etat: { nom: "catalogue", slug: b.slug, page: 0, panier },
      messages: [boutons(vers, t.catalogueVide, choix)],
    };
  }
  const lignes = tranche.map((a) => ({
    id: `art:${a.id}`,
    titre: a.nom,
    description: formatXaf(a.prixXaf),
  }));
  if (b.articles.length > debut + PAR_PAGE) {
    lignes.push({ id: `cat:${page + 1}`, titre: t.voirLaSuite, description: "" });
  }
  /* Le panier se voit sans avoir a le taper (T8) : une ligne en TETE de liste
     des qu'il contient quelque chose. 8 articles + « voir la suite » + celle-ci
     font exactement les 10 lignes que WhatsApp accepte. */
  if (panier.length > 0) {
    lignes.unshift({
      id: "panier",
      titre: t.btnMonPanier,
      description: formatXaf(totalPanier(b, panier)),
    });
  }
  return {
    etat: { nom: "catalogue", slug: b.slug, page, ...(panier.length > 0 ? { panier } : {}) },
    messages: [liste(vers, t.listeTitre(b.nom, b.articles.length), t.btnVoirArticles, lignes)],
  };
}

function ficheArticle(
  vers: string,
  b: BoutiqueBot,
  articleId: string,
  page: number,
  panier: LignePanier[],
  t: TextesAcheteuse,
): Reaction {
  const article = b.articles.find((a) => a.id === articleId);
  if (!article) return pageCatalogue(vers, b, 0, panier, t);
  const lignes = [
    `*${article.nom}*`,
    formatXaf(article.prixXaf),
    ...(article.stock != null ? [t.stockRestant(article.stock)] : []),
    ...(article.description ? ["", article.description] : []),
  ];
  const actions = [
    /* En conges, « Commander » ne s'affiche pas du tout : proposer un bouton
       dont on sait qu'il refusera est une promesse qu'on ne tient pas. La
       vendeuse prend sa place — elle seule sait quand elle reprend. */
    ...(b.enConges
      ? b.whatsappVendeuse
        ? [{ id: "vendeuse", titre: t.btnParlerVendeuse }]
        : []
      : [{ id: `cmd:${article.id}`, titre: t.btnCommander }]),
    { id: `cat:${page}`, titre: t.btnRetourCatalogue },
    /* Trois boutons au maximum : celui-ci ne prend sa place que lorsqu'il a
       quelque chose a montrer. */
    ...(panier.length > 0 ? [{ id: "panier", titre: t.btnMonPanier }] : []),
  ];
  return {
    /* La page courante est conservee : « Retour au catalogue » y ramene, au
       lieu de renvoyer une acheteuse de la page 3 a la page 0. */
    etat: { nom: "catalogue", slug: b.slug, page, ...(panier.length > 0 ? { panier } : {}) },
    /* Image d'ABORD, pleine largeur (ADR 0035) : la photo vend, le texte
       precise. Sans photo, la fiche reste un seul message a boutons. */
    messages: article.imageUrl
      ? [
          image(vers, article.imageUrl, `${article.nom} — ${formatXaf(article.prixXaf)}`),
          boutons(vers, lignes.join("\n"), actions),
        ]
      : [boutons(vers, lignes.join("\n"), actions)],
  };
}

/**
 * Les details de livraison en langage naturel : « quartier, repere, numero ».
 * Le telephone est cherche en fin de message ; le reste se coupe a la
 * premiere virgule. Jamais de champ « adresse » (ADR 0005) — et l'echec rend
 * une AIDE, pas une erreur : la personne est en train d'acheter.
 */
export function lireDetailsLivraison(
  texteBrut: string,
  mode: "livraison" | "retrait",
  villeBoutique: string,
  t: TextesAcheteuse = TEXTES.fr,
): { ok: true; livraison: LivraisonBrouillon } | { ok: false; aide: string } {
  const net = texteBrut.trim().replace(/\s+/g, " ");
  /**
   * Le numero se lit PAR LA FIN — ADR 0051.
   *
   * `[62]\d` exigeait les deux premiers chiffres COLLES : la forme que le bot
   * affiche lui-meme (`690 11 22 33`, `formatPhone`) etait donc refusee
   * quand l'acheteuse la recopiait du recapitulatif. Elle relisait, ne voyait
   * pas la difference, recommencait : boucle.
   *
   * L'espace est desormais libre PARTOUT entre les neuf chiffres. L'ancre de
   * fin fait le tri quand le repere en contient aussi (« carrefour 2, 690 11
   * 22 33 ») : seul un groupe de neuf chiffres commencant par 6 ou 2 et
   * terminant le message est retenu.
   */
  const telephone = /(?:\+?237|00237)?\s*([62](?:\s*\d){8})\s*$/.exec(net);
  if (!telephone?.[1]) {
    return { ok: false, aide: t.aideSansTelephone };
  }
  const phone = `+237${telephone[1].replace(/\s/g, "")}`;
  const sansTel = net.slice(0, telephone.index).replace(/[,\s]+$/, "");

  if (mode === "retrait") {
    if (sansTel.length < 3) {
      return { ok: false, aide: t.aideSansLieu };
    }
    return { ok: true, livraison: { mode: "retrait", pickupPoint: sansTel, phone } };
  }

  const virgule = sansTel.indexOf(",");
  const quartier = (virgule === -1 ? sansTel : sansTel.slice(0, virgule)).trim();
  const landmark = (virgule === -1 ? "" : sansTel.slice(virgule + 1)).trim();
  if (quartier.length < 2 || landmark.length < 5) {
    return { ok: false, aide: t.aideSansRepere };
  }
  return {
    ok: true,
    livraison: { mode: "livraison", city: villeBoutique, quartier, landmark, phone },
  };
}

/** La ligne de livraison, relue telle que comprise — recap ET confirmation. */
function ligneLivraison(l: LivraisonBrouillon, t: TextesAcheteuse): string {
  return l.mode === "livraison"
    ? t.ligneLivraison(l.city, l.quartier, l.landmark)
    : t.ligneRetrait(l.pickupPoint);
}

/**
 * Le recapitulatif AVANT creation. Il ne porte NI reference NI code : ces
 * champs n'existent qu'apres creation et ne s'inventent pas (AGENTS.md). Il
 * porte en revanche la livraison RELUE — c'est sa raison d'etre — et
 * l'acompte, calcule par la meme regle que la creation (`planDePaiement`).
 */
function messageRecap(
  vers: string,
  b: BoutiqueBot,
  panier: LignePanier[],
  livraison: LivraisonBrouillon,
  t: TextesAcheteuse,
): MessageSortant {
  const total = totalPanier(b, panier);
  const plan = planDePaiement(total, b.reversementPose ? "acompte" : "sans_prepaiement");
  const lignes = [
    t.recapTitre(b.nom),
    ...lignesLisibles(b, panier, t),
    t.ligneTotal(total),
    /* Le total ne comprend JAMAIS la course : le dire au recap evite de le
       decouvrir a la remise (ADR 0035). */
    ...(livraison.mode === "livraison" ? [t.ligneHorsLivraison] : []),
    ...(plan.duAvantXaf > 0 && plan.duAvantXaf < total ? [t.ligneAcompte(plan.duAvantXaf)] : []),
    ligneLivraison(livraison, t),
    t.ligneTelephone(formatPhone(livraison.phone)),
    "",
    t.recapRien,
  ];
  return boutons(vers, lignes.join("\n"), [
    { id: "confirmer", titre: t.btnConfirmer },
    { id: "corriger", titre: t.btnCorriger },
    { id: "annuler", titre: t.btnAnnuler },
  ]);
}

/** La reponse a « ou est ma commande ? ». Sans commande : on le dit, sans inventer. */
function messageStatut(
  vers: string,
  s: StatutDerniereCommande | null,
  t: TextesAcheteuse,
): MessageSortant {
  if (!s) return texte(vers, t.statutAucune);
  const lignes = [
    `*${s.reference} — ${s.boutique}*`,
    s.libelle,
    s.resteXaf > 0 ? t.statutResteAPayer(s.resteXaf) : t.statutRegle,
    t.statutOuEstLeLien,
  ];
  return texte(vers, lignes.join("\n"));
}

/**
 * La confirmation, envoyee APRES que la commande existe : la reference et le
 * code ne s'inventent pas (AGENTS.md — contenu canonique, autosuffisant en
 * texte brut). Elle RELIT la livraison, comme le recap : c'est le document que
 * l'acheteuse garde.
 */
export function confirmationCommande(
  vers: string,
  c: {
    reference: string;
    codeVerification: string;
    boutique: string;
    lignes: ReadonlyArray<{ nom: string; quantite: number; prixUnitaireXaf: number }>;
    totalXaf: number;
    duAvantXaf: number;
    livraison: LivraisonBrouillon;
    /**
     * Le lien de SUIVI (jeton d'acheteuse). Avec un acompte attendu, c'est
     * aussi la ou l'on paie ; sans acompte, ce n'est QUE le suivi — la copie
     * ne dit jamais « payer » quand il n'y a rien a payer d'avance.
     */
    lienSuivi: string | null;
    /**
     * Le bloc paiement DANS le fil (ADR 0035) : monte par le service depuis le
     * reversement de la vendeuse et la CONFIGURATION de la rampe — le code
     * d'entree n'est jamais une constante (AGENTS.md). Absent : la copie
     * historique reprend la main, rien ne casse.
     */
    paiement?: {
      montantXaf: number;
      numeroAffiche: string;
      operateurNom: string | null;
      codeEntree: string | null;
      lienPayer: string | null;
    } | null;
    /** Le wa.me de la vendeuse : la conversation continue chez elle. */
    waVendeuse?: string | null;
  },
  langue: Langue = "fr",
): MessageSortant[] {
  const t = TEXTES[langue];
  const lignes = [
    t.confirmationTitre(c.reference, c.boutique),
    ...c.lignes.map((l) => t.ligneArticle(l.nom, l.quantite, l.prixUnitaireXaf)),
    t.ligneTotal(c.totalXaf),
    ...(c.livraison.mode === "livraison" ? [t.ligneHorsLivraison] : []),
    ...(c.duAvantXaf > 0 && c.duAvantXaf < c.totalXaf ? [t.ligneAcompte(c.duAvantXaf)] : []),
    ligneLivraison(c.livraison, t),
    t.ligneTelephone(formatPhone(c.livraison.phone)),
    t.ligneCode(c.codeVerification),
  ];
  const messages: MessageSortant[] = [texte(vers, lignes.join("\n"))];

  if (c.duAvantXaf > 0 && c.paiement) {
    /* Le paiement se dit ICI, en texte brut autosuffisant ; le lien de suivi
       redevient ce qu'il est — le suivi et le recu. */
    messages.push(texte(vers, t.blocPaiement(c.paiement)));
    if (c.lienSuivi) messages.push(texte(vers, t.suiteSuivi(c.lienSuivi)));
  } else if (c.lienSuivi) {
    messages.push(
      texte(vers, c.duAvantXaf > 0 ? t.suiteAcompte(c.lienSuivi) : t.suiteSansAcompte(c.lienSuivi)),
    );
  }

  if (c.waVendeuse) messages.push(texte(vers, t.apresConfirmation(c.boutique, c.waVendeuse)));
  return messages;
}

/* ────────────────────────── le fil vendeuse ─────────────────────────────── */

export interface CommandeOuverte {
  id: string;
  reference: string;
  resteXaf: number;
}

/** Ce que le menu vendeuse montre d'elle-meme — charge par le service. */
export interface BoutiqueVendeuse {
  nom: string;
  nbArticles: number;
  lienBoutique: string;
  /** L'URL de l'espace vendeuse. `null` quand la base n'est pas configuree. */
  lienEspace: string | null;
  /** Mode conges — ADR 0039. Le menu dit l'etat et propose l'inverse. */
  enConges?: boolean;
}

/**
 * La vendeuse ecrit au bot : un SMS colle, ou un mot-cle. Le SMS n'est JAMAIS
 * garde dans l'etat de conversation — il part en effet, se verifie, et
 * disparait (ADR 0023 : nos traces ne portent pas le SMS brut ; notre etat de
 * conversation non plus).
 */
export function reagirVendeuse(
  entree: Entree,
  vers: string,
  contexte: {
    smsReconnu: boolean;
    commandesOuvertes: CommandeOuverte[];
    soldesXaf: number;
    boutique?: BoutiqueVendeuse | null;
  },
): Reaction {
  /* Une forme non lue — ADR 0049. Le fil vendeuse est en francais (ADR 0033). */
  if (entree.genre === "autre") {
    return { etat: ETAT_INITIAL, messages: [texte(vers, TEXTES.fr.formeNonLue(entree.forme))] };
  }

  if (entree.genre === "texte" && contexte.smsReconnu) {
    return {
      etat: ETAT_INITIAL,
      /* L'accuse pose SUR le SMS meme (ADR 0035) : le fil reste lisible. */
      messages: entree.messageId ? [reaction(vers, entree.messageId, "✅")] : [],
      effet: { type: "verifier_sms", texte: entree.texte },
    };
  }

  /* « livree CT-522801 » — la remise se marque depuis le fil (ADR 0035). */
  if (entree.genre === "texte") {
    const livree = demandeRemise(entree.texte);
    if (livree) {
      return {
        etat: ETAT_INITIAL,
        messages: [],
        effet: { type: "marquer_livree", reference: livree },
      };
    }
  }

  const mot = entree.genre === "texte" ? entree.texte.trim().toLowerCase() : "";
  const id = entree.genre === "bouton" || entree.genre === "liste" ? entree.id : null;

  /* La carte-vitrine (ADR 0037) : le service la fabrique et l'envoie — la
     machine ne sait pas dessiner, elle sait demander. */
  if (id === "carte" || (entree.genre === "texte" && demandeCarteVitrine(entree.texte))) {
    return { etat: ETAT_INITIAL, messages: [], effet: { type: "envoyer_carte" } };
  }

  /**
   * Le mode conges depuis le fil — ADR 0039. Deux gestes symetriques, en
   * bouton comme au mot tape. La bascule n'est pas confirmee : elle est
   * REVERSIBLE d'un mot, et rien ne se perd — ni commande, ni reputation.
   */
  const bascule =
    id === "conges"
      ? true
      : id === "rouvrir"
        ? false
        : entree.genre === "texte"
          ? demandeConges(entree.texte)
          : null;
  if (bascule !== null) {
    return {
      etat: ETAT_INITIAL,
      messages: [],
      effet: { type: "basculer_conges", fermer: bascule },
    };
  }

  if (mot === "solde" || mot === "soldes" || id === "solde") {
    const n = contexte.commandesOuvertes.length;
    const corps =
      n === 0
        ? "Rien à encaisser : toutes vos commandes sont soldées."
        : `Soldes à encaisser : *${formatXaf(contexte.soldesXaf)}* sur ${n} commande${n > 1 ? "s" : ""}.\n${contexte.commandesOuvertes
            .slice(0, 5)
            .map((c) => `${c.reference} : ${formatXaf(c.resteXaf)}`)
            .join("\n")}`;
    return { etat: ETAT_INITIAL, messages: [texte(vers, corps)] };
  }

  /**
   * Le menu vendeuse — ADR 0035. « Ma boutique » n'est plus un cul-de-sac :
   * l'etat de la boutique, ses liens, et les deux gestes qui comptent. La
   * copie de repli reste pour le service qui n'aurait pas charge la boutique.
   */
  const b = contexte.boutique;
  if (!b) {
    return {
      etat: ETAT_INITIAL,
      messages: [
        texte(
          vers,
          "Collez ici le SMS de votre opérateur pour prouver un paiement, ou écrivez « solde ». Le reste — articles, photos, chiffres — vit dans votre espace vendeuse.",
        ),
      ],
    };
  }
  const lignes = [
    `*${b.nom}*`,
    ...(b.enConges
      ? ["🌴 *En congés* — votre boutique reste en ligne, mais ne prend pas de nouvelle commande."]
      : []),
    b.nbArticles > 0
      ? `${b.nbArticles} article${b.nbArticles > 1 ? "s" : ""} en ligne`
      : "Aucun article en ligne pour l'instant — ajoutez le premier !",
    contexte.commandesOuvertes.length > 0
      ? `À encaisser : *${formatXaf(contexte.soldesXaf)}* sur ${contexte.commandesOuvertes.length} commande${contexte.commandesOuvertes.length > 1 ? "s" : ""}`
      : "Rien à encaisser en ce moment.",
    "",
    `Votre lien de boutique — partagez-le, mettez-le en Statut :\n${b.lienBoutique}`,
    ...(b.lienEspace ? [`Vos chiffres et votre reversement : ${b.lienEspace}`] : []),
    "",
    "Un paiement reçu ? Collez ici le SMS de votre opérateur — il devient le reçu. Une commande remise ? Écrivez « livrée CT-… ».",
    /* Le geste est ANNONCE : un mot-clé que personne ne connaît n'existe pas. */
    ...(b.enConges
      ? ["Prête à reprendre ? Écrivez « je reprends »."]
      : [
          "Vous partez ? Écrivez « congés » : votre boutique reste en ligne, sans prendre de commande.",
        ]),
  ];
  return {
    etat: ETAT_INITIAL,
    messages: [
      /* Trois boutons au plus. En congés, « Je reprends » prend la place de la
         carte à partager — c'est le geste du moment, et mettre en avant une
         boutique qui ne prend pas commande n'en est pas un. « Ajouter un
         article » reste : préparer sa rentrée est exactement ce qu'on fait
         pendant des congés. */
      boutons(
        vers,
        lignes.join("\n"),
        [
          ...(b.enConges ? [{ id: "rouvrir", titre: "Je reprends" }] : []),
          { id: "article", titre: "Ajouter un article" },
          ...(!b.enConges && b.nbArticles > 0
            ? [{ id: "carte", titre: "Ma carte à partager" }]
            : []),
          { id: "solde", titre: "Mes soldes" },
        ].slice(0, 3),
      ),
    ],
  };
}

/** Le verdict des sept controles, dit en langue simple dans le fil. */
export function messageVerdict(
  vers: string,
  v: { verdict: "accepte" | "accepte_sous_reserve" | "refuse"; reference: string | null },
): MessageSortant {
  if (v.verdict === "refuse") {
    return texte(
      vers,
      "Ce SMS n'a pas passé les contrôles. Ouvrez l'écran de preuve de la commande pour le détail, contrôle par contrôle.",
    );
  }
  const tete =
    v.verdict === "accepte"
      ? "✅ Paiement prouvé — les contrôles passent."
      : "🟡 Accepté sous réserve — un contrôle attend une confirmation.";
  const suite = v.reference ? ` ${v.reference} est à jour, le reçu est émis.` : "";
  return texte(vers, `${tete}${suite}`);
}
