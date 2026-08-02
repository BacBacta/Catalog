import { formatXaf } from "@catalog/contracts/money";
import { boutons, type MessageSortant, texte } from "./messages.ts";

/**
 * L'inscription d'une vendeuse DANS le fil — ADR 0034.
 *
 * Module PUR : pas de base, pas de reseau, pas d'horloge. Il rend des etats,
 * des messages et au plus un effet ; le service execute.
 *
 * ── Pourquoi tout se passe ici et pas sur le web ───────────────────────────
 *
 * Le message entrant ATTESTE le numero — c'est exactement ce que fait l'ADR
 * 0027 en sens inverse, et c'est la meme force qu'un OTP : Meta nous donne le
 * `wa_id`, personne d'autre ne peut l'usurper. Une vendeuse qui ecrit au
 * numero Catalog a donc deja prouve ce qu'un code SMS aurait prouve. Lui
 * demander d'ouvrir un navigateur et de se reconnecter serait ajouter une
 * ceremonie qui n'apprend rien.
 *
 * ── La frontiere que ce module NE FRANCHIT PAS ─────────────────────────────
 *
 * **Le numero de reversement ne se pose jamais ici.** Il a son OTP propre, et
 * c'est un invariant d'AGENTS.md §2 : c'est le champ qu'un attaquant
 * chercherait a detourner. Une boutique nee dans le fil vend donc en
 * `sans_prepaiement` jusqu'a ce que sa vendeuse pose son reversement dans
 * l'espace vendeuse — le code sait deja faire (ADR 0031).
 *
 * ── Une seule langue ───────────────────────────────────────────────────────
 *
 * Le francais, comme tout le fil vendeuse (decision de l'ADR 0033) : l'espace
 * vendeuse entier est en francais, une inscription bilingue deboucherait sur
 * une application qui ne l'est pas.
 */

/* ────────────────────────── les etats ───────────────────────────────────── */

export type EtatVendeuse =
  /** Inscription : le nom de la boutique. `parrain` vient du lien d'entree. */
  | { nom: "inscription_nom"; parrain?: string }
  | { nom: "inscription_ville"; nomBoutique: string; parrain?: string }
  /** Ajout d'article — disponible a vie, pas seulement a l'inscription. */
  | { nom: "article_nom" }
  | { nom: "article_prix"; nomArticle: string }
  | { nom: "article_photo"; nomArticle: string; prixXaf: number };

export type EffetVendeuse =
  | { type: "creer_boutique"; nomBoutique: string; ville: string; parrain?: string }
  | { type: "creer_article"; nom: string; prixXaf: number; mediaId?: string };

export interface ReactionVendeuse {
  etat: EtatVendeuse | null;
  messages: MessageSortant[];
  effet?: EffetVendeuse;
}

/** Relit un etat vendeuse persiste. Tout ce qui ne se relit pas vaut `null`. */
export function normaliserEtatVendeuse(brut: unknown): EtatVendeuse | null {
  const e = brut as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return null;
  switch (e.nom) {
    case "inscription_nom":
      return {
        nom: "inscription_nom",
        ...(typeof e.parrain === "string" ? { parrain: e.parrain } : {}),
      };
    case "inscription_ville":
      if (typeof e.nomBoutique !== "string") return null;
      return {
        nom: "inscription_ville",
        nomBoutique: e.nomBoutique,
        ...(typeof e.parrain === "string" ? { parrain: e.parrain } : {}),
      };
    case "article_nom":
      return { nom: "article_nom" };
    case "article_prix":
      return typeof e.nomArticle === "string"
        ? { nom: "article_prix", nomArticle: e.nomArticle }
        : null;
    case "article_photo":
      return typeof e.nomArticle === "string" && typeof e.prixXaf === "number" && e.prixXaf > 0
        ? { nom: "article_photo", nomArticle: e.nomArticle, prixXaf: Math.floor(e.prixXaf) }
        : null;
    default:
      return null;
  }
}

/* ────────────────────────── lectures pures ──────────────────────────────── */

const sansAccents = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * « Je veux vendre » — et son PARRAINAGE.
 *
 * Le lien de parrainage pre-remplit « vendre avec <slug> » : le slug d'une
 * vendeuse deja installee. C'est le seul porteur de l'attribution — on ne
 * devine jamais un parrain autrement.
 */
export function demandeInscription(texteBrut: string): { parrain?: string } | null {
  const net = sansAccents(texteBrut.trim().toLowerCase());
  const avecParrain = /^(?:je veux )?vendre avec ([a-z0-9][a-z0-9-]*)$/.exec(net);
  if (avecParrain?.[1]) return { parrain: avecParrain[1] };
  if (/^(?:je veux vendre|vendre|ouvrir ma boutique|devenir vendeuse|sell)$/.test(net)) return {};
  return null;
}

/** « Ajouter un article » — le geste d'une vendeuse deja installee. */
export function demandeAjoutArticle(texteBrut: string): boolean {
  const net = sansAccents(texteBrut.trim().toLowerCase());
  return /^(?:ajouter(?: un)?(?: article)?|nouvel article|article)$/.test(net);
}

/** « Ma boutique » — le retour au fil vendeuse depuis un fil d'achat. */
export function demandeEspaceVendeuse(texteBrut: string): boolean {
  const net = sansAccents(texteBrut.trim().toLowerCase());
  return /^(?:ma boutique|espace vendeuse|vendeuse)$/.test(net);
}

/**
 * Un prix ecrit a la main. Le franc n'a pas de sous-unite (ADR 0004) : tout ce
 * qui n'est pas un chiffre disparait, y compris les separateurs de milliers,
 * la devise et les espaces. « 15 000 FCFA » et « 15.000 » valent 15 000.
 */
export function lirePrix(texteBrut: string): number | null {
  const chiffres = texteBrut.replace(/[^\d]/g, "");
  if (!chiffres) return null;
  const n = Number(chiffres);
  if (!Number.isInteger(n) || n <= 0 || n > 100_000_000) return null;
  return n;
}

const NOM_MIN = 2;
const NOM_MAX = 80;
const abandon = (t: string) =>
  /^(?:annuler|stop|cancel)$/.test(sansAccents(t.trim().toLowerCase()));

/* ────────────────────────── les messages ────────────────────────────────── */

export const PREMIERE_QUESTION =
  "Bienvenue ! Ouvrons votre boutique — ça prend deux minutes, ici même.\n\n*Comment s'appelle votre boutique ?*\nExemple : Chez Amina";

export function messageBoutiqueCreee(
  vers: string,
  b: { nom: string; lienBoutique: string; lienParrainage: string },
): MessageSortant[] {
  return [
    texte(
      vers,
      `✅ *${b.nom}* est ouverte.\n\nVoici votre lien de boutique — partagez-le, mettez-le en statut WhatsApp :\n${b.lienBoutique}\n\nVos clientes commandent ici, et vous recevez un reçu vérifiable à chaque paiement prouvé.`,
    ),
    texte(
      vers,
      `Pour être payée d'avance, ajoutez votre numéro Mobile Money dans votre espace vendeuse — il demande sa propre vérification, c'est le numéro qui reçoit votre argent.\n\nVotre lien de parrainage, si une consœur veut ouvrir la sienne :\n${b.lienParrainage}`,
    ),
    boutons(vers, "Ajoutons votre premier article ?", [
      { id: "article", titre: "Premier article" },
      { id: "plus_tard", titre: "Plus tard" },
    ]),
  ];
}

export function messageArticlePublie(
  vers: string,
  a: { nom: string; prixXaf: number; avecPhoto: boolean },
): MessageSortant {
  const photo = a.avecPhoto ? "" : "\nSans photo pour l'instant — envoyez-la quand vous voulez.";
  return boutons(vers, `✅ *${a.nom}* — ${formatXaf(a.prixXaf)} est en ligne.${photo}`, [
    { id: "article", titre: "Autre article" },
    { id: "ma_boutique", titre: "Ma boutique" },
  ]);
}

/* ────────────────────────── la machine ──────────────────────────────────── */

export interface Entree {
  genre: "texte" | "bouton" | "liste" | "image";
  texte?: string;
  id?: string;
  mediaId?: string;
  legende?: string;
}

/**
 * L'inscription et l'ajout d'article, etat par etat.
 *
 * `etat: null` en sortie veut dire « ce fil est termine » : le service repose
 * l'etat neutre et la conversation repart au fil vendeuse ordinaire.
 */
export function reagirInscription(
  etat: EtatVendeuse,
  entree: Entree,
  vers: string,
): ReactionVendeuse {
  /* Abandonner marche partout, comme dans le fil acheteuse (ADR 0032). */
  if (entree.genre === "texte" && entree.texte && abandon(entree.texte)) {
    return {
      etat: null,
      messages: [
        texte(
          vers,
          "C'est annulé. Écrivez « vendre » pour reprendre, ou « ajouter » pour un article.",
        ),
      ],
    };
  }

  switch (etat.nom) {
    case "inscription_nom": {
      const nom = entree.genre === "texte" ? (entree.texte ?? "").trim() : "";
      if (nom.length < NOM_MIN || nom.length > NOM_MAX) {
        return {
          etat,
          messages: [
            texte(
              vers,
              "Il me faut le nom de votre boutique, en quelques mots.\nExemple : Chez Amina",
            ),
          ],
        };
      }
      return {
        etat: {
          nom: "inscription_ville",
          nomBoutique: nom,
          ...(etat.parrain ? { parrain: etat.parrain } : {}),
        },
        messages: [
          texte(
            vers,
            `*${nom}* — c'est noté.\n\n*Dans quelle ville vendez-vous ?*\nExemple : Douala`,
          ),
        ],
      };
    }

    case "inscription_ville": {
      const ville = entree.genre === "texte" ? (entree.texte ?? "").trim() : "";
      if (ville.length < NOM_MIN || ville.length > NOM_MAX) {
        return {
          etat,
          messages: [texte(vers, "Dites-moi la ville où vous vendez.\nExemple : Douala")],
        };
      }
      /* La boutique se cree ICI ; le message de bienvenue part apres, avec le
         vrai lien — un slug ne s'invente pas (meme regle que la reference de
         commande, AGENTS.md). */
      return {
        etat: null,
        messages: [],
        effet: {
          type: "creer_boutique",
          nomBoutique: etat.nomBoutique,
          ville,
          ...(etat.parrain ? { parrain: etat.parrain } : {}),
        },
      };
    }

    case "article_nom": {
      const nom = entree.genre === "texte" ? (entree.texte ?? "").trim() : "";
      if (nom.length < NOM_MIN || nom.length > NOM_MAX) {
        return {
          etat,
          messages: [texte(vers, "*Quel est le nom de l'article ?*\nExemple : Pagne wax 6 yards")],
        };
      }
      return {
        etat: { nom: "article_prix", nomArticle: nom },
        messages: [texte(vers, `*${nom}* — son prix, en francs ?\nExemple : 15000`)],
      };
    }

    case "article_prix": {
      const prix = entree.genre === "texte" ? lirePrix(entree.texte ?? "") : null;
      if (prix === null) {
        return {
          etat,
          messages: [
            texte(
              vers,
              "Je n'ai pas compris le prix. Écrivez-le en chiffres, sans virgule.\nExemple : 15000",
            ),
          ],
        };
      }
      return {
        etat: { nom: "article_photo", nomArticle: etat.nomArticle, prixXaf: prix },
        messages: [
          boutons(
            vers,
            `${etat.nomArticle} — ${formatXaf(prix)}.\n\n*Envoyez maintenant la photo de l'article.* Prenez-la ici, elle sera allégée automatiquement.`,
            [{ id: "sans_photo", titre: "Sans photo" }],
          ),
        ],
      };
    }

    case "article_photo": {
      if (entree.genre === "image" && entree.mediaId) {
        return {
          etat: null,
          messages: [],
          effet: {
            type: "creer_article",
            nom: etat.nomArticle,
            prixXaf: etat.prixXaf,
            mediaId: entree.mediaId,
          },
        };
      }
      if (entree.genre === "bouton" && entree.id === "sans_photo") {
        return {
          etat: null,
          messages: [],
          effet: { type: "creer_article", nom: etat.nomArticle, prixXaf: etat.prixXaf },
        };
      }
      return {
        etat,
        messages: [
          boutons(
            vers,
            "J'attends la photo — envoyez-la comme une image, depuis l'appareil photo ou la galerie.",
            [{ id: "sans_photo", titre: "Sans photo" }],
          ),
        ],
      };
    }
  }
}
