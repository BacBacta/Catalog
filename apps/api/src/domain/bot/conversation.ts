import { formatXaf } from "@catalog/contracts/money";
import { boutons, liste, type MessageSortant, texte } from "./messages.ts";

/**
 * La machine de conversation du bot — ADR 0031. Pure : pas de base, pas de
 * reseau, pas d'horloge implicite. Elle recoit l'etat, l'entree et les
 * donnees deja chargees ; elle rend le nouvel etat, les messages a envoyer,
 * et au plus UN effet d'ecriture que la couche service execute.
 *
 * Pas d'intelligence artificielle : un menu deterministe, comme un USSD.
 * La meme entree dans le meme etat produit toujours la meme reponse — c'est
 * ce qui rend la machine testable, et ce qui rend le bot previsible pour une
 * acheteuse qui le decouvre.
 */

/* ────────────────────────── donnees fournies par le service ─────────────── */

export interface ArticleBot {
  id: string;
  nom: string;
  prixXaf: number;
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
  articles: ArticleBot[];
}

/* ────────────────────────── l'etat persiste ─────────────────────────────── */

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
    };

export const ETAT_INITIAL: EtatConv = { nom: "accueil" };

/* ────────────────────────── entree et reaction ──────────────────────────── */

export type Entree =
  | { genre: "texte"; texte: string }
  | { genre: "bouton"; id: string }
  | { genre: "liste"; id: string };

export interface BrouillonCommande {
  slug: string;
  articleId: string;
  quantite: number;
  livraison:
    | { mode: "livraison"; city: string; quartier: string; landmark: string; phone: string }
    | { mode: "retrait"; pickupPoint: string; phone: string };
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

const PAR_PAGE = 8; // 8 articles + « voir la suite » restent sous les 10 lignes.

const AIDE_ACHETEUSE =
  "Je suis le catalogue Catalog. Ouvrez le lien d'une boutique, ou ecrivez « boutique » suivi de son nom court (ex. : boutique chez-amina).";

/* ────────────────────────── le fil acheteuse ────────────────────────────── */

export function reagirAcheteuse(
  etat: EtatConv,
  entree: Entree,
  vers: string,
  boutique: BoutiqueBot | null,
): Reaction {
  /* Un slug dans le texte remet TOUJOURS la conversation sur la boutique :
     c'est le geste du lien partage, il prime sur tout etat anterieur. */
  if (entree.genre === "texte" && extraireSlugBoutique(entree.texte)) {
    if (!boutique) {
      return {
        etat: ETAT_INITIAL,
        messages: [texte(vers, "Cette boutique est introuvable. Verifiez le lien recu.")],
      };
    }
    return accueilBoutique(vers, boutique);
  }

  if (!boutique) {
    return { etat: ETAT_INITIAL, messages: [texte(vers, AIDE_ACHETEUSE)] };
  }

  const id = entree.genre === "texte" ? null : entree.id;

  /* Les gestes globaux, valables dans tout etat. */
  if (id === "menu") return accueilBoutique(vers, boutique);
  if (id === "catalogue" || id?.startsWith("cat:")) {
    const page = id?.startsWith("cat:") ? Number(id.slice(4)) || 0 : 0;
    return pageCatalogue(vers, boutique, page);
  }
  if (id?.startsWith("art:")) return ficheArticle(vers, boutique, id.slice(4));
  if (id?.startsWith("cmd:")) {
    const article = boutique.articles.find((a) => a.id === id.slice(4));
    if (!article) return accueilBoutique(vers, boutique);
    return {
      etat: { nom: "quantite", slug: boutique.slug, articleId: article.id },
      messages: [
        boutons(vers, `Combien de « ${article.nom} » voulez-vous ?`, [
          { id: "qte:1", titre: "1" },
          { id: "qte:2", titre: "2" },
          { id: "qte:autre", titre: "Un autre nombre" },
        ]),
      ],
    };
  }

  switch (etat.nom) {
    case "quantite": {
      let quantite: number | null = null;
      if (id === "qte:1") quantite = 1;
      else if (id === "qte:2") quantite = 2;
      else if (id === "qte:autre") {
        return {
          etat,
          messages: [texte(vers, "Ecrivez le nombre voulu, en chiffres (ex. : 3).")],
        };
      } else if (entree.genre === "texte") {
        const n = Number(entree.texte.trim());
        if (Number.isInteger(n) && n > 0 && n <= 99) quantite = n;
      }
      if (quantite === null) {
        return {
          etat,
          messages: [
            texte(vers, "Je n'ai pas compris le nombre. Ecrivez-le en chiffres (ex. : 3)."),
          ],
        };
      }
      return {
        etat: { nom: "mode", slug: etat.slug, articleId: etat.articleId, quantite },
        messages: [
          boutons(vers, "Comment recevoir votre commande ?", [
            { id: "mode:livraison", titre: "Livraison" },
            { id: "mode:retrait", titre: "Point de retrait" },
          ]),
        ],
      };
    }

    case "mode": {
      const mode = id === "mode:livraison" ? "livraison" : id === "mode:retrait" ? "retrait" : null;
      if (!mode) {
        return {
          etat,
          messages: [
            boutons(vers, "Choisissez avec les boutons ci-dessous.", [
              { id: "mode:livraison", titre: "Livraison" },
              { id: "mode:retrait", titre: "Point de retrait" },
            ]),
          ],
        };
      }
      const question =
        mode === "livraison"
          ? "Votre quartier, un repere, puis le numero a appeler — en un seul message.\nExemple : Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33"
          : "Ou se retrouve-t-on, et quel numero appeler ?\nExemple : Marche central, entree B, 690 11 22 33";
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
        return { etat, messages: [texte(vers, "Ecrivez-le en un message, comme dans l'exemple.")] };
      }
      const lu = lireDetailsLivraison(entree.texte, etat.mode, boutique.ville);
      if (!lu.ok) {
        return { etat, messages: [texte(vers, lu.aide)] };
      }
      return {
        etat: ETAT_INITIAL,
        messages: [], // la confirmation part APRES la creation, avec la vraie reference
        effet: {
          type: "creer_commande",
          brouillon: {
            slug: etat.slug,
            articleId: etat.articleId,
            quantite: etat.quantite,
            livraison: lu.livraison,
          },
        },
      };
    }

    default:
      return accueilBoutique(vers, boutique);
  }
}

function accueilBoutique(vers: string, b: BoutiqueBot): Reaction {
  const corps = `*${b.nom}* — ${b.ville}\nCommandez ici, la vendeuse vous repond sur son WhatsApp.`;
  const choix = [
    { id: "catalogue", titre: "Voir les articles" },
    ...(b.whatsappVendeuse ? [{ id: "vendeuse", titre: "Parler a la vendeuse" }] : []),
  ];
  return {
    etat: { nom: "catalogue", slug: b.slug, page: 0 },
    messages: [boutons(vers, corps, choix)],
  };
}

function pageCatalogue(vers: string, b: BoutiqueBot, page: number): Reaction {
  const debut = page * PAR_PAGE;
  const tranche = b.articles.slice(debut, debut + PAR_PAGE);
  if (tranche.length === 0) {
    return {
      etat: { nom: "catalogue", slug: b.slug, page: 0 },
      messages: [texte(vers, "Cette boutique n'a pas encore d'article en ligne.")],
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

function ficheArticle(vers: string, b: BoutiqueBot, articleId: string): Reaction {
  const article = b.articles.find((a) => a.id === articleId);
  if (!article) return pageCatalogue(vers, b, 0);
  return {
    etat: { nom: "catalogue", slug: b.slug, page: 0 },
    messages: [
      boutons(vers, `*${article.nom}*\n${formatXaf(article.prixXaf)}`, [
        { id: `cmd:${article.id}`, titre: "Commander" },
        { id: "catalogue", titre: "Retour au catalogue" },
      ]),
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
      aide: "Il me manque le numero a appeler, a la fin du message. Exemple : Bonapriso, en face de la pharmacie, 690 11 22 33",
    };
  }
  const phone = `+237${telephone[2].replace(/\s/g, "")}`;
  const sansTel = net.slice(0, telephone.index).replace(/[,\s]+$/, "");

  if (mode === "retrait") {
    if (sansTel.length < 3) {
      return {
        ok: false,
        aide: "Dites-moi ou se retrouver (ex. : Marche central, entree B), puis le numero.",
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
      aide: "Il me faut le quartier, PUIS un repere apres une virgule. Exemple : Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33",
    };
  }
  return {
    ok: true,
    livraison: { mode: "livraison", city: villeBoutique, quartier, landmark, phone },
  };
}

/**
 * La confirmation, envoyee APRES que la commande existe : la reference et le
 * code ne s'inventent pas (AGENTS.md — contenu canonique, autosuffisant en
 * texte brut).
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
    lienPaiement: string | null;
  },
): MessageSortant[] {
  const lignes = [
    `*Commande ${c.reference} — ${c.boutique}*`,
    `${c.articleNom} × ${c.quantite} : ${formatXaf(c.prixUnitaireXaf)} l'unite`,
    `Total : *${formatXaf(c.totalXaf)}*`,
    ...(c.duAvantXaf > 0 && c.duAvantXaf < c.totalXaf
      ? [`Acompte pour confirmer : *${formatXaf(c.duAvantXaf)}*`]
      : []),
    `Code de verification : ${c.codeVerification}`,
  ];
  const corps = lignes.join("\n");
  if (c.lienPaiement) {
    return [
      texte(vers, corps),
      texte(
        vers,
        `Pour payer : ${c.lienPaiement}\nVotre code secret ne se tape QUE sur l'ecran de votre operateur — jamais ici.`,
      ),
    ];
  }
  return [texte(vers, corps)];
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
        ? "Rien a encaisser : toutes vos commandes sont soldees."
        : `Soldes a encaisser : *${formatXaf(contexte.soldesXaf)}* sur ${n} commande${n > 1 ? "s" : ""}.\n${contexte.commandesOuvertes
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
        "Collez ici le SMS de votre operateur pour prouver un paiement, ou ecrivez « solde ». Le reste — articles, photos, chiffres — vit dans votre espace vendeuse.",
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
      "Ce SMS n'a pas passe les controles. Ouvrez l'ecran de preuve de la commande pour le detail, controle par controle.",
    );
  }
  const tete =
    v.verdict === "accepte"
      ? "✅ Paiement prouve — les controles passent."
      : "🟡 Accepte sous reserve — un controle attend une confirmation.";
  const suite = v.reference ? ` ${v.reference} est a jour, le recu est emis.` : "";
  return texte(vers, `${tete}${suite}`);
}
