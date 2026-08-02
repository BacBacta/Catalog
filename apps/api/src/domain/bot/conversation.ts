import { formatXaf } from "@catalog/contracts/money";
import { formatPhone } from "@catalog/contracts/phone";
import { planDePaiement } from "../order/paiement.ts";
import { boutons, liste, type MessageSortant, texte } from "./messages.ts";

/**
 * La machine de conversation du bot — ADR 0031, revisee par l'ADR 0032. Pure :
 * pas de base, pas de reseau, pas d'horloge implicite. Elle recoit l'etat,
 * l'entree et les donnees deja chargees ; elle rend le nouvel etat, les
 * messages a envoyer, et au plus UN effet d'ecriture que la couche service
 * execute.
 *
 * Pas d'intelligence artificielle : un menu deterministe, comme un USSD.
 * La meme entree dans le meme etat produit toujours la meme reponse — c'est
 * ce qui rend la machine testable, et ce qui rend le bot previsible pour une
 * acheteuse qui le decouvre.
 *
 * Trois regles de l'ADR 0032, tenues ici :
 * - **aucun etat n'est un piege** : « menu », « annuler » et « aide » marchent
 *   partout, en texte comme en bouton ;
 * - **rien ne se cree sans recapitulatif** : l'effet `creer_commande` ne sort
 *   que de l'etat `recap`, sur l'appui explicite de « Confirmer » ;
 * - la copie destinee a l'acheteuse s'ecrit en francais accentue — la
 *   convention ASCII vaut pour les commentaires, pas pour elle.
 */

/* ────────────────────────── donnees fournies par le service ─────────────── */

export interface ArticleBot {
  id: string;
  nom: string;
  prixXaf: number;
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
   * La reputation du lot 12 — l'argument de confiance du produit, dit a
   * l'accueil. `nbVerifies` a zero : la ligne ne s'affiche pas ; on ne fait
   * pas dire « 0 vente » a une vendeuse qui debute.
   */
  reputation?: { note: number | null; nbVerifies: number };
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
}

/* ────────────────────────── l'etat persiste ─────────────────────────────── */

export type LivraisonBrouillon =
  | { mode: "livraison"; city: string; quartier: string; landmark: string; phone: string }
  | { mode: "retrait"; pickupPoint: string; phone: string };

export type EtatConv =
  | { nom: "accueil" }
  | { nom: "catalogue"; slug: string; page: number }
  | { nom: "quantite"; slug: string; articleId: string }
  | { nom: "mode"; slug: string; articleId: string; quantite: number }
  | {
      nom: "details";
      slug: string;
      articleId: string;
      quantite: number;
      mode: "livraison" | "retrait";
    }
  | {
      nom: "recap";
      slug: string;
      articleId: string;
      quantite: number;
      mode: "livraison" | "retrait";
      livraison: LivraisonBrouillon;
    };

export const ETAT_INITIAL: EtatConv = { nom: "accueil" };

/**
 * Peremption d'un etat de conversation.
 *
 * Sans elle, un « bonjour » envoye trois semaines apres un flux abandonne en
 * plein etat `details` serait analyse comme une adresse. Au-dela de ce delai,
 * le flux de commande retombe sur le catalogue de la meme boutique : le
 * prochain message re-oriente au lieu d'etre avale.
 */
export const INACTIVITE_MAX_MS = 24 * 60 * 60 * 1000;

export function etatApresInactivite(etat: EtatConv, ageMs: number): EtatConv {
  if (ageMs < INACTIVITE_MAX_MS) return etat;
  if (etat.nom === "accueil" || etat.nom === "catalogue") return etat;
  return { nom: "catalogue", slug: etat.slug, page: 0 };
}

/* ────────────────────────── entree et reaction ──────────────────────────── */

export type Entree =
  | { genre: "texte"; texte: string }
  | { genre: "bouton"; id: string }
  | { genre: "liste"; id: string };

export interface BrouillonCommande {
  slug: string;
  articleId: string;
  quantite: number;
  livraison: LivraisonBrouillon;
}

export type EffetBot =
  | { type: "creer_commande"; brouillon: BrouillonCommande }
  | { type: "verifier_sms"; texte: string };

export interface Reaction {
  etat: EtatConv;
  messages: MessageSortant[];
  effet?: EffetBot;
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
 * Les trois mots-cles valables PARTOUT. En correspondance exacte : un quartier
 * qui s'appellerait « Menu » n'existe pas, mais un repere qui CONTIENT le mot
 * existe surement — d'ou l'egalite stricte, pas la recherche.
 */
function motCleGlobal(texteBrut: string): "menu" | "annuler" | "aide" | null {
  const net = sansAccents(texteBrut.trim().toLowerCase());
  if (net === "menu" || net === "accueil") return "menu";
  if (net === "annuler" || net === "stop") return "annuler";
  if (net === "aide" || net === "help") return "aide";
  return null;
}

/**
 * Une question sur la commande en cours. Cherchee seulement HORS flux de
 * commande : dans l'etat `details`, « livraison » fait partie de la reponse
 * attendue, pas d'une question.
 */
function demandeStatut(texteBrut: string): boolean {
  const net = sansAccents(texteBrut.trim().toLowerCase());
  return /\b(commandes?|suivis?|statuts?|livraisons?)\b/.test(net);
}

const PAR_PAGE = 8; // 8 articles + « voir la suite » restent sous les 10 lignes.

const AIDE_ACHETEUSE =
  "Je suis le catalogue Catalog. Ouvrez le lien d'une boutique, ou écrivez « boutique » suivi de son nom court (ex. : boutique chez-amina).";

const AIDE_GESTES =
  "Trois mots marchent partout : « menu » (accueil de la boutique), « annuler » (abandonner la commande en cours), « suivi » (votre dernière commande). Pour un humain, le bouton « Parler à la vendeuse » est à l'accueil.";

/* ────────────────────────── le fil acheteuse ────────────────────────────── */

export function reagirAcheteuse(
  etat: EtatConv,
  entree: Entree,
  vers: string,
  boutique: BoutiqueBot | null,
  derniereCommande: StatutDerniereCommande | null = null,
): Reaction {
  /* Un slug dans le texte remet TOUJOURS la conversation sur la boutique :
     c'est le geste du lien partage, il prime sur tout etat anterieur. */
  if (entree.genre === "texte" && extraireSlugBoutique(entree.texte)) {
    if (!boutique) {
      return {
        etat: ETAT_INITIAL,
        messages: [texte(vers, "Cette boutique est introuvable. Vérifiez le lien reçu.")],
      };
    }
    return accueilBoutique(vers, boutique);
  }

  const mot = entree.genre === "texte" ? motCleGlobal(entree.texte) : null;

  if (!boutique) {
    if (entree.genre === "texte" && demandeStatut(entree.texte)) {
      return { etat: ETAT_INITIAL, messages: [messageStatut(vers, derniereCommande)] };
    }
    return { etat: ETAT_INITIAL, messages: [texte(vers, AIDE_ACHETEUSE)] };
  }

  const id = entree.genre === "texte" ? null : entree.id;

  /* Les gestes globaux, valables dans tout etat — bouton OU mot-cle. */
  if (id === "menu" || mot === "menu") return accueilBoutique(vers, boutique);
  if (id === "annuler" || mot === "annuler") {
    const accueil = accueilBoutique(vers, boutique);
    return {
      etat: accueil.etat,
      messages: [texte(vers, "C'est annulé — rien n'a été commandé."), ...accueil.messages],
    };
  }
  if (mot === "aide") {
    return { etat, messages: [texte(vers, AIDE_GESTES)] };
  }
  if (id === "vendeuse") {
    if (!boutique.whatsappVendeuse) return accueilBoutique(vers, boutique);
    const chiffres = boutique.whatsappVendeuse.replace(/\D/g, "");
    return {
      etat: { nom: "catalogue", slug: boutique.slug, page: 0 },
      messages: [
        texte(
          vers,
          `Pour parler directement à ${boutique.nom}, écrivez-lui sur son WhatsApp :\nhttps://wa.me/${chiffres}`,
        ),
      ],
    };
  }
  if (id === "catalogue" || id?.startsWith("cat:")) {
    const page = id?.startsWith("cat:") ? Number(id.slice(4)) || 0 : 0;
    return pageCatalogue(vers, boutique, page);
  }
  if (id?.startsWith("art:")) {
    const page = etat.nom === "catalogue" ? etat.page : 0;
    return ficheArticle(vers, boutique, id.slice(4), page);
  }
  if (id?.startsWith("cmd:")) {
    const article = boutique.articles.find((a) => a.id === id.slice(4));
    if (!article) return accueilBoutique(vers, boutique);
    return {
      etat: { nom: "quantite", slug: boutique.slug, articleId: article.id },
      messages: [questionQuantite(vers, article.nom)],
    };
  }

  /* La question « ou est ma commande ? » — hors flux de commande seulement. */
  if (
    (etat.nom === "accueil" || etat.nom === "catalogue") &&
    entree.genre === "texte" &&
    demandeStatut(entree.texte)
  ) {
    return { etat, messages: [messageStatut(vers, derniereCommande)] };
  }

  switch (etat.nom) {
    case "quantite": {
      let quantite: number | null = null;
      if (id === "qte:1") quantite = 1;
      else if (id === "qte:2") quantite = 2;
      else if (id === "qte:autre") {
        return {
          etat,
          messages: [texte(vers, "Écrivez le nombre voulu, en chiffres (ex. : 3).")],
        };
      } else if (entree.genre === "texte") {
        const n = Number(entree.texte.trim());
        if (Number.isInteger(n) && n > 0 && n <= 99) quantite = n;
      }
      if (quantite === null) {
        return {
          etat,
          messages: [
            texte(
              vers,
              "Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner.",
            ),
          ],
        };
      }
      const article = boutique.articles.find((a) => a.id === etat.articleId);
      const sousTotal = article ? ` (${formatXaf(article.prixXaf * quantite)})` : "";
      return {
        etat: { nom: "mode", slug: etat.slug, articleId: etat.articleId, quantite },
        messages: [
          boutons(vers, `Comment recevoir votre commande${sousTotal} ?`, [
            { id: "mode:livraison", titre: "Livraison" },
            { id: "mode:retrait", titre: "Point de retrait" },
            { id: "annuler", titre: "Annuler" },
          ]),
        ],
      };
    }

    case "mode": {
      /* Le mode s'accepte au bouton comme au mot tape : forcer le bouton a qui
         a deja ecrit « livraison » serait un refus de comprendre. */
      const tape = entree.genre === "texte" ? sansAccents(entree.texte.trim().toLowerCase()) : "";
      const mode =
        id === "mode:livraison" || tape === "livraison"
          ? "livraison"
          : id === "mode:retrait" || tape === "retrait" || tape === "point de retrait"
            ? "retrait"
            : null;
      if (!mode) {
        return {
          etat,
          messages: [
            boutons(vers, "Choisissez avec les boutons ci-dessous.", [
              { id: "mode:livraison", titre: "Livraison" },
              { id: "mode:retrait", titre: "Point de retrait" },
              { id: "annuler", titre: "Annuler" },
            ]),
          ],
        };
      }
      const question =
        mode === "livraison"
          ? "Votre quartier, un repère, puis le numéro à appeler — en un seul message.\nExemple : Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33"
          : "Où se retrouve-t-on, et quel numéro appeler ?\nExemple : Marché central, entrée B, 690 11 22 33";
      return {
        etat: {
          nom: "details",
          slug: etat.slug,
          articleId: etat.articleId,
          quantite: etat.quantite,
          mode,
        },
        messages: [texte(vers, question)],
      };
    }

    case "details": {
      if (entree.genre !== "texte") {
        return {
          etat,
          messages: [texte(vers, "Écrivez-le en un message, comme dans l'exemple.")],
        };
      }
      const lu = lireDetailsLivraison(entree.texte, etat.mode, boutique.ville);
      if (!lu.ok) {
        return { etat, messages: [texte(vers, lu.aide)] };
      }
      const article = boutique.articles.find((a) => a.id === etat.articleId);
      if (!article) return accueilBoutique(vers, boutique);
      /**
       * RIEN ne se cree ici : on montre ce qui a ete compris — livraison
       * relue comprise — et on attend « Confirmer ». C'est le seul endroit ou
       * l'acheteuse peut voir une adresse mal decoupee AVANT qu'elle entre
       * dans une commande (ADR 0032).
       */
      return {
        etat: {
          nom: "recap",
          slug: etat.slug,
          articleId: etat.articleId,
          quantite: etat.quantite,
          mode: etat.mode,
          livraison: lu.livraison,
        },
        messages: [messageRecap(vers, boutique, article, etat.quantite, lu.livraison)],
      };
    }

    case "recap": {
      if (id === "confirmer") {
        return {
          /* La boutique reste en contexte : le fil n'oublie pas ou il est. */
          etat: { nom: "catalogue", slug: etat.slug, page: 0 },
          messages: [], // la confirmation part APRES la creation, avec la vraie reference
          effet: {
            type: "creer_commande",
            brouillon: {
              slug: etat.slug,
              articleId: etat.articleId,
              quantite: etat.quantite,
              livraison: etat.livraison,
            },
          },
        };
      }
      if (id === "corriger") {
        const article = boutique.articles.find((a) => a.id === etat.articleId);
        if (!article) return accueilBoutique(vers, boutique);
        return {
          etat: { nom: "quantite", slug: etat.slug, articleId: etat.articleId },
          messages: [questionQuantite(vers, article.nom)],
        };
      }
      return {
        etat,
        messages: [
          boutons(vers, "Utilisez les boutons : confirmer, corriger, ou annuler.", [
            { id: "confirmer", titre: "Confirmer" },
            { id: "corriger", titre: "Corriger" },
            { id: "annuler", titre: "Annuler" },
          ]),
        ],
      };
    }

    default:
      return accueilBoutique(vers, boutique);
  }
}

function questionQuantite(vers: string, nomArticle: string): MessageSortant {
  return boutons(vers, `Combien de « ${nomArticle} » voulez-vous ?`, [
    { id: "qte:1", titre: "1" },
    { id: "qte:2", titre: "2" },
    { id: "qte:autre", titre: "Un autre nombre" },
  ]);
}

/** « 4.8 » → « 4,8 » : une note s'ecrit en francais. */
const noteFr = (note: number) => String(note).replace(".", ",");

function accueilBoutique(vers: string, b: BoutiqueBot): Reaction {
  const rep = b.reputation;
  const lignes = [
    `*${b.nom}* — ${b.ville}`,
    ...(rep && rep.nbVerifies > 0
      ? [
          `★ ${rep.note != null ? `${noteFr(rep.note)} · ` : ""}${rep.nbVerifies} vente${
            rep.nbVerifies > 1 ? "s" : ""
          } prouvée${rep.nbVerifies > 1 ? "s" : ""} (avis vérifiés)`,
        ]
      : []),
    "Commandez ici — chaque paiement prouvé donne un reçu vérifiable. La vendeuse vous répond sur son WhatsApp.",
  ];
  const choix = [
    { id: "catalogue", titre: "Voir les articles" },
    ...(b.whatsappVendeuse ? [{ id: "vendeuse", titre: "Parler à la vendeuse" }] : []),
  ];
  const image = b.articles.find((a) => a.imageUrl)?.imageUrl;
  return {
    etat: { nom: "catalogue", slug: b.slug, page: 0 },
    messages: [boutons(vers, lignes.join("\n"), choix, image ? { image } : {})],
  };
}

function pageCatalogue(vers: string, b: BoutiqueBot, page: number): Reaction {
  const debut = page * PAR_PAGE;
  const tranche = b.articles.slice(debut, debut + PAR_PAGE);
  if (tranche.length === 0) {
    /* Jamais de cul-de-sac : meme vide, la boutique offre une sortie. */
    const choix = b.whatsappVendeuse
      ? [{ id: "vendeuse", titre: "Parler à la vendeuse" }]
      : [{ id: "menu", titre: "Accueil" }];
    return {
      etat: { nom: "catalogue", slug: b.slug, page: 0 },
      messages: [boutons(vers, "Cette boutique n'a pas encore d'article en ligne.", choix)],
    };
  }
  const lignes = tranche.map((a) => ({
    id: `art:${a.id}`,
    titre: a.nom,
    description: formatXaf(a.prixXaf),
  }));
  if (b.articles.length > debut + PAR_PAGE) {
    lignes.push({ id: `cat:${page + 1}`, titre: "Voir la suite", description: "" });
  }
  const total = b.articles.length;
  return {
    etat: { nom: "catalogue", slug: b.slug, page },
    messages: [
      liste(
        vers,
        `*${b.nom}* — ${total} article${total > 1 ? "s" : ""}`,
        "Voir les articles",
        lignes,
      ),
    ],
  };
}

function ficheArticle(vers: string, b: BoutiqueBot, articleId: string, page: number): Reaction {
  const article = b.articles.find((a) => a.id === articleId);
  if (!article) return pageCatalogue(vers, b, 0);
  return {
    /* La page courante est conservee : « Retour au catalogue » y ramene, au
       lieu de renvoyer une acheteuse de la page 3 a la page 0. */
    etat: { nom: "catalogue", slug: b.slug, page },
    messages: [
      boutons(
        vers,
        `*${article.nom}*\n${formatXaf(article.prixXaf)}`,
        [
          { id: `cmd:${article.id}`, titre: "Commander" },
          { id: `cat:${page}`, titre: "Retour au catalogue" },
        ],
        article.imageUrl ? { image: article.imageUrl } : {},
      ),
    ],
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
): { ok: true; livraison: BrouillonCommande["livraison"] } | { ok: false; aide: string } {
  const net = texteBrut.trim().replace(/\s+/g, " ");
  const telephone = /(\+?237)?\s*([62]\d(?:\s*\d){7})\s*$/.exec(net);
  if (!telephone?.[2]) {
    return {
      ok: false,
      aide: "Il me manque le numéro à appeler, à la fin du message. Exemple : Bonapriso, en face de la pharmacie, 690 11 22 33",
    };
  }
  const phone = `+237${telephone[2].replace(/\s/g, "")}`;
  const sansTel = net.slice(0, telephone.index).replace(/[,\s]+$/, "");

  if (mode === "retrait") {
    if (sansTel.length < 3) {
      return {
        ok: false,
        aide: "Dites-moi où se retrouver (ex. : Marché central, entrée B), puis le numéro.",
      };
    }
    return { ok: true, livraison: { mode: "retrait", pickupPoint: sansTel, phone } };
  }

  const virgule = sansTel.indexOf(",");
  const quartier = (virgule === -1 ? sansTel : sansTel.slice(0, virgule)).trim();
  const landmark = (virgule === -1 ? "" : sansTel.slice(virgule + 1)).trim();
  if (quartier.length < 2 || landmark.length < 5) {
    return {
      ok: false,
      aide: "Il me faut le quartier, PUIS un repère après une virgule. Exemple : Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33",
    };
  }
  return {
    ok: true,
    livraison: { mode: "livraison", city: villeBoutique, quartier, landmark, phone },
  };
}

/** La ligne de livraison, relue telle que comprise — recap ET confirmation. */
function ligneLivraison(l: LivraisonBrouillon): string {
  return l.mode === "livraison"
    ? `Livraison : ${l.quartier}, ${l.landmark}`
    : `Retrait : ${l.pickupPoint}`;
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
  article: ArticleBot,
  quantite: number,
  livraison: LivraisonBrouillon,
): MessageSortant {
  const total = article.prixXaf * quantite;
  const plan = planDePaiement(total, b.reversementPose ? "acompte" : "sans_prepaiement");
  const lignes = [
    `*Récapitulatif — ${b.nom}*`,
    `${article.nom} × ${quantite} : ${formatXaf(article.prixXaf)} l'unité`,
    `Total : *${formatXaf(total)}*`,
    ...(plan.duAvantXaf > 0 && plan.duAvantXaf < total
      ? [`Acompte pour confirmer : *${formatXaf(plan.duAvantXaf)}*`]
      : []),
    ligneLivraison(livraison),
    `Numéro à appeler : ${formatPhone(livraison.phone)}`,
    "",
    "Rien n'est encore commandé. Vérifiez, puis confirmez.",
  ];
  return boutons(vers, lignes.join("\n"), [
    { id: "confirmer", titre: "Confirmer" },
    { id: "corriger", titre: "Corriger" },
    { id: "annuler", titre: "Annuler" },
  ]);
}

/** La reponse a « ou est ma commande ? ». Sans commande : on le dit, sans inventer. */
function messageStatut(vers: string, s: StatutDerniereCommande | null): MessageSortant {
  if (!s) {
    return texte(
      vers,
      "Aucune commande enregistrée sur ce numéro. Ouvrez le lien d'une boutique pour commander.",
    );
  }
  const lignes = [
    `*${s.reference} — ${s.boutique}*`,
    s.libelle,
    s.resteXaf > 0 ? `Reste à payer : ${formatXaf(s.resteXaf)}` : "Tout est réglé.",
    "Votre lien de suivi est dans le message de confirmation, plus haut dans ce fil.",
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
    articleNom: string;
    quantite: number;
    prixUnitaireXaf: number;
    totalXaf: number;
    duAvantXaf: number;
    livraison: LivraisonBrouillon;
    /**
     * Le lien de SUIVI (jeton d'acheteuse). Avec un acompte attendu, c'est
     * aussi la ou l'on paie ; sans acompte, ce n'est QUE le suivi — la copie
     * ne dit jamais « payer » quand il n'y a rien a payer d'avance.
     */
    lienSuivi: string | null;
  },
): MessageSortant[] {
  const lignes = [
    `*Commande ${c.reference} — ${c.boutique}*`,
    `${c.articleNom} × ${c.quantite} : ${formatXaf(c.prixUnitaireXaf)} l'unité`,
    `Total : *${formatXaf(c.totalXaf)}*`,
    ...(c.duAvantXaf > 0 && c.duAvantXaf < c.totalXaf
      ? [`Acompte pour confirmer : *${formatXaf(c.duAvantXaf)}*`]
      : []),
    ligneLivraison(c.livraison),
    `Numéro à appeler : ${formatPhone(c.livraison.phone)}`,
    `Code de vérification : ${c.codeVerification}`,
  ];
  const corps = lignes.join("\n");
  if (!c.lienSuivi) return [texte(vers, corps)];
  const suite =
    c.duAvantXaf > 0
      ? `Pour payer l'acompte, ouvrez : ${c.lienSuivi}\nAprès le paiement, votre reçu vérifiable vous attend au même endroit.\nVotre code secret ne se tape QUE sur l'écran de votre opérateur — jamais ici.`
      : `Rien à payer d'avance — vous payez à la réception.\nSuivez votre commande ici : ${c.lienSuivi}`;
  return [texte(vers, corps), texte(vers, suite)];
}

/* ────────────────────────── le fil vendeuse ─────────────────────────────── */

export interface CommandeOuverte {
  id: string;
  reference: string;
  resteXaf: number;
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
  },
): Reaction {
  if (entree.genre === "texte" && contexte.smsReconnu) {
    return {
      etat: ETAT_INITIAL,
      messages: [],
      effet: { type: "verifier_sms", texte: entree.texte },
    };
  }

  const mot = entree.genre === "texte" ? entree.texte.trim().toLowerCase() : "";
  if (mot === "solde" || mot === "soldes") {
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
