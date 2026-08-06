import { formatXaf } from "@catalog/contracts/money";
import { boutons, type MessageSortant, reaction, texte } from "./messages.ts";

/**
 * L'inscription d'une vendeuse DANS le fil — ADR 0047.
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
  | { nom: "article_photo"; nomArticle: string; prixXaf: number }
  /**
   * La photo LEGENDEE lue, en attente du « Publier » (ADR 0035) : on confirme
   * l'extrait, on ne devine pas en silence (AGENTS.md §7.7). C'est LE geste
   * du terrain — une photo, sa legende « nom prix », un appui.
   */
  | { nom: "article_confirme"; nomArticle: string; prixXaf: number; mediaId: string };

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
    case "article_confirme":
      return typeof e.nomArticle === "string" &&
        typeof e.prixXaf === "number" &&
        e.prixXaf > 0 &&
        typeof e.mediaId === "string"
        ? {
            nom: "article_confirme",
            nomArticle: e.nomArticle,
            prixXaf: Math.floor(e.prixXaf),
            mediaId: e.mediaId,
          }
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
 * Le mode conges — ADR 0039. `true` = fermer, `false` = rouvrir, `null` = ni
 * l'un ni l'autre.
 *
 * Il vit ICI, avec les autres gestes de vendeuse, et non dans la machine :
 * l'aiguilleur doit le reconnaitre AVANT de router. Sans cela, une vendeuse
 * qui a un achat en cours — le cas normal quand elle teste sa propre boutique,
 * ou qu'elle achete a une consoeur — verrait son « congés » partir au fil
 * ACHETEUSE, ou il ne veut rien dire. Le mot serait annonce par le menu et
 * inoperant la moitie du temps.
 */
export function demandeConges(texteBrut: string): boolean | null {
  const net = sansAccents(texteBrut.trim().toLowerCase());
  if (/^(?:conges|vacances|je pars|fermer|fermee|fermer la boutique)$/.test(net)) return true;
  if (/^(?:je reprends|reprendre|rouvrir|ouvrir|ouverte|de retour)$/.test(net)) return false;
  return null;
}

/** « Ma carte » — la carte-vitrine a poster en Statut (ADR 0037). */
export function demandeCarteVitrine(texteBrut: string): boolean {
  const net = sansAccents(texteBrut.trim().toLowerCase());
  return /^(?:ma carte|carte|ma vitrine|vitrine|affiche)$/.test(net);
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

/**
 * La legende d'une photo, lue comme « nom … prix » — ADR 0035.
 *
 * « Pagne wax 6 yards 15 000 » : le PRIX est le dernier groupe de chiffres
 * (espaces, points et virgules de milliers compris), la devise eventuelle
 * derriere lui s'ignore, et tout ce qui precede est le nom. « 6 yards » reste
 * donc dans le nom — seul le groupe FINAL est un prix. Le resultat n'est
 * jamais publie tel quel : la machine le fait CONFIRMER (§7.7).
 */
export function lireLegendeArticle(legende: string): { nom: string; prixXaf: number } | null {
  const net = legende.trim().replace(/\s+/g, " ");
  const motif = /^(.{2,80}?)[\s:—–-]+(\d[\d\s.,]*)\s*(?:f\s*cfa|fcfa|cfa|xaf|francs?|f)?\s*$/i.exec(
    net,
  );
  if (!motif?.[1] || !motif[2]) return null;
  const nom = motif[1].trim();
  const prix = lirePrix(motif[2]);
  if (nom.length < NOM_MIN || prix === null) return null;
  return { nom, prixXaf: prix };
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
  b: {
    nom: string;
    lienBoutique: string;
    lienParrainage: string;
    /**
     * L'URL de l'espace vendeuse (ADR 0035, T1) : reversement, chiffres,
     * photos suivantes. `null` quand la base n'est pas configuree — on ne
     * fabrique jamais une URL fausse, la phrase reste vraie sans lien.
     */
    lienEspace: string | null;
  },
): MessageSortant[] {
  return [
    texte(
      vers,
      `✅ *${b.nom}* est ouverte.\n\nVoici votre lien de boutique — partagez-le, mettez-le en statut WhatsApp :\n${b.lienBoutique}\n\nVos clientes commandent ici, et vous recevez un reçu vérifiable à chaque paiement prouvé.`,
    ),
    texte(
      vers,
      `Pour être payée d'avance, ajoutez votre numéro Mobile Money dans votre espace vendeuse — il demande sa propre vérification, c'est le numéro qui reçoit votre argent.${b.lienEspace ? `\nVotre espace vendeuse : ${b.lienEspace}` : ""}\n\nVotre lien de parrainage, si une consœur veut ouvrir la sienne :\n${b.lienParrainage}`,
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

/**
 * La confirmation d'une legende lue — en CITANT la photo quand l'identifiant
 * du message est connu : la reponse contextuelle de l'ADR 0035. On confirme
 * l'extrait, on ne devine pas (§7.7).
 */
export function messageConfirmationLegende(
  vers: string,
  a: { nom: string; prixXaf: number },
  citer?: string,
): MessageSortant {
  return boutons(
    vers,
    `J'ai lu : *${a.nom}* — *${formatXaf(a.prixXaf)}*. C'est bon ?`,
    [
      { id: "publier", titre: "Publier ✓" },
      { id: "corriger", titre: "Corriger" },
    ],
    citer ? { citer } : {},
  );
}

/* ────────────────────────── la machine ──────────────────────────────────── */

export interface Entree {
  genre: "texte" | "bouton" | "liste" | "image";
  texte?: string;
  id?: string;
  mediaId?: string;
  legende?: string;
  /** Le wamid entrant — pour REAGIR a la photo et la CITER (ADR 0035). */
  messageId?: string;
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
      /* Une photo legendee « nom prix » saute les deux questions : c'est le
         geste rapide de l'ADR 0035, confirme avant publication. Le bot REAGIT
         a la photo (accuse sans bruit) et la CITE dans sa question. */
      if (entree.genre === "image" && entree.mediaId && entree.legende) {
        const lu = lireLegendeArticle(entree.legende);
        if (lu) {
          return {
            etat: {
              nom: "article_confirme",
              nomArticle: lu.nom,
              prixXaf: lu.prixXaf,
              mediaId: entree.mediaId,
            },
            messages: [
              ...(entree.messageId ? [reaction(vers, entree.messageId, "👍")] : []),
              messageConfirmationLegende(vers, lu, entree.messageId),
            ],
          };
        }
      }
      const nom = entree.genre === "texte" ? (entree.texte ?? "").trim() : "";
      if (nom.length < NOM_MIN || nom.length > NOM_MAX) {
        return {
          etat,
          messages: [
            texte(
              vers,
              "*Quel est le nom de l'article ?*\nExemple : Pagne wax 6 yards\n\nPlus rapide : envoyez directement la photo, avec « nom prix » en légende.",
            ),
          ],
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

    case "article_confirme": {
      /* On confirme l'EXTRAIT, on ne devine pas (§7.7) : rien ne se publie
         sans le « Publier ». « Corriger » repart au chemin question par
         question — la photo est gardee de cote, elle se renverra. */
      if (entree.genre === "bouton" && entree.id === "publier") {
        return {
          etat: null,
          messages: [],
          effet: {
            type: "creer_article",
            nom: etat.nomArticle,
            prixXaf: etat.prixXaf,
            mediaId: etat.mediaId,
          },
        };
      }
      if (entree.genre === "bouton" && entree.id === "corriger") {
        return {
          etat: { nom: "article_nom" },
          messages: [
            texte(vers, "Reprenons. *Quel est le nom de l'article ?*\nExemple : Pagne wax 6 yards"),
          ],
        };
      }
      /* Une NOUVELLE photo legendee remplace la proposition en attente. */
      if (entree.genre === "image" && entree.mediaId && entree.legende) {
        const lu = lireLegendeArticle(entree.legende);
        if (lu) {
          return {
            etat: {
              nom: "article_confirme",
              nomArticle: lu.nom,
              prixXaf: lu.prixXaf,
              mediaId: entree.mediaId,
            },
            messages: [
              ...(entree.messageId ? [reaction(vers, entree.messageId, "👍")] : []),
              messageConfirmationLegende(vers, lu, entree.messageId),
            ],
          };
        }
      }
      return {
        etat,
        messages: [
          messageConfirmationLegende(vers, { nom: etat.nomArticle, prixXaf: etat.prixXaf }),
        ],
      };
    }
  }
}
