import { formatXaf } from "@catalog/contracts/money";
import { villeAcceptable } from "@catalog/contracts/villes";
import {
  avancerComptoir,
  type EtatComptoir,
  normaliserEtatComptoir,
  phraseRefusComptoir,
  questionComptoir,
  recapComptoir,
  type VenteDeclaree,
} from "./comptoir-vendeuse.ts";
import { extraireSlugBoutique, INACTIVITE_MAX_MS, motCleGlobal } from "./conversation.ts";
import type { FormeNonLue } from "./entrees.ts";
import { motDeGeste } from "./geste.ts";
import { boutons, liste, type MessageSortant, reaction, texte } from "./messages.ts";
import { TEXTES } from "./textes.ts";

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

/**
 * Un geste d'ACHAT arrive pendant un formulaire vendeuse — ADR 0052.
 *
 * Le formulaire n'est ni detruit ni poursuivi de force : il est mis de cote,
 * et on POSE la question. Le slug voyage avec, sinon « Voir la boutique »
 * n'aurait plus de boutique ou aller.
 */
export interface GesteEnPause {
  slug: string;
}

export type EtatVendeuse =
  /** Inscription : le nom de la boutique. `parrain` vient du lien d'entree. */
  | { nom: "inscription_nom"; parrain?: string; enPause?: GesteEnPause }
  | { nom: "inscription_ville"; nomBoutique: string; parrain?: string; enPause?: GesteEnPause }
  /**
   * Le nom et la ville, RELUS avant d'ouvrir — ADR 0090, constat C-002.
   *
   * Jusqu'ici la boutique naissait du second message, sans que la vendeuse ait
   * jamais vu ce que le bot avait retenu. Mesure du 13/08/2026 : une question
   * tapee a l'etape du nom devenait le nom ET le slug PUBLIC de la boutique,
   * et aucun chemin de renommage n'existait nulle part.
   *
   * L'article legende a deja cette relecture (`article_confirme`) ; la
   * boutique, qui est plus difficile a defaire, ne l'avait pas.
   */
  | {
      nom: "inscription_confirme";
      nomBoutique: string;
      ville: string;
      parrain?: string;
      enPause?: GesteEnPause;
    }
  /** Ajout d'article — disponible a vie, pas seulement a l'inscription. */
  | { nom: "article_nom"; enPause?: GesteEnPause }
  | { nom: "article_prix"; nomArticle: string; enPause?: GesteEnPause }
  | { nom: "article_photo"; nomArticle: string; prixXaf: number; enPause?: GesteEnPause }
  /**
   * La photo LEGENDEE lue, en attente du « Publier » (ADR 0035) : on confirme
   * l'extrait, on ne devine pas en silence (AGENTS.md §7.7). C'est LE geste
   * du terrain — une photo, sa legende « nom prix », un appui.
   */
  | {
      nom: "article_confirme";
      nomArticle: string;
      prixXaf: number;
      mediaId: string;
      enPause?: GesteEnPause;
    }
  /**
   * Le comptoir vendeuse — rang 1 de l'ADR 0061. Un ETAT de cette machine et
   * non une seconde machine : meme persistance (`BotConversation.etat`), meme
   * horloge d'abandon, memes protections — le SMS colle traverse (regle 0 de
   * l'aiguillage), le lien de boutique se met en pause. « Deux horloges pour
   * une seule notion d'abandon se contrediraient un jour » ; deux persistances
   * aussi.
   */
  | { nom: "comptoir"; comptoir: EtatComptoir; enPause?: GesteEnPause };

/**
 * Un flux vendeuse abandonne PERIME — ADR 0048.
 *
 * Le fil ACHETEUSE perimait deja (`etatApresInactivite`, ADR 0032) ; le fil
 * vendeuse, lui, ne perimait pas. Or la regle 1 de l'aiguillage donne la
 * priorite absolue a une inscription en cours : un etat oublie avalait donc
 * TOUT message ulterieur, indefiniment. Constate le 07/08/2026 — un « Hi »
 * s'est vu repondre « *Hi* — son prix, en francs ? ».
 *
 * On rend `null`, pas un etat de repli : il n'y a rien a reprendre a mi-chemin
 * d'un formulaire, et le message suivant doit etre aiguille comme un premier
 * contact. Rien n'est perdu — ni boutique ni article n'existe avant l'effet.
 *
 * Meme delai que le fil acheteuse, volontairement : deux horloges pour une
 * seule notion d'abandon se contrediraient un jour.
 */
export function etatVendeuseApresInactivite(
  etat: EtatVendeuse,
  ageMs: number,
): EtatVendeuse | null {
  return ageMs < INACTIVITE_MAX_MS ? etat : null;
}

export type EffetVendeuse =
  /** « Voir la boutique » : le fil vendeuse se libere, l'achat reprend — ADR 0052. */
  | { type: "aller_boutique"; slug: string }
  | { type: "creer_boutique"; nomBoutique: string; ville: string; parrain?: string }
  | { type: "creer_article"; nom: string; prixXaf: number; mediaId?: string }
  /** La vente negociee, remise au moteur — l'UNIQUE moteur (ADR 0061). */
  | { type: "creer_vente"; vente: VenteDeclaree };

export interface ReactionVendeuse {
  etat: EtatVendeuse | null;
  messages: MessageSortant[];
  effet?: EffetVendeuse;
}

/** Relit un etat vendeuse persiste. Tout ce qui ne se relit pas vaut `null`. */
export function normaliserEtatVendeuse(brut: unknown): EtatVendeuse | null {
  const e = brut as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return null;
  /* La pause voyage avec l'etat — ADR 0052. Sans cette relecture, la question
     d'arbitrage partait, l'etat etait sauve SANS elle, et le message suivant
     re-arbitrait indefiniment : le genre de defaut qui ne se voit qu'en
     production, parce qu'il exige un aller-retour en base. */
  const pause = e.enPause as Record<string, unknown> | null | undefined;
  const enPause =
    pause && typeof pause === "object" && typeof pause.slug === "string"
      ? { enPause: { slug: pause.slug } }
      : {};
  switch (e.nom) {
    case "inscription_nom":
      return {
        nom: "inscription_nom",
        ...(typeof e.parrain === "string" ? { parrain: e.parrain } : {}),
        ...enPause,
      };
    case "inscription_ville":
      if (typeof e.nomBoutique !== "string") return null;
      return {
        nom: "inscription_ville",
        nomBoutique: e.nomBoutique,
        ...(typeof e.parrain === "string" ? { parrain: e.parrain } : {}),
        ...enPause,
      };
    case "inscription_confirme":
      return typeof e.nomBoutique === "string" && typeof e.ville === "string"
        ? {
            nom: "inscription_confirme",
            nomBoutique: e.nomBoutique,
            ville: e.ville,
            ...(typeof e.parrain === "string" ? { parrain: e.parrain } : {}),
            ...enPause,
          }
        : null;
    case "article_nom":
      return { nom: "article_nom", ...enPause };
    case "article_prix":
      return typeof e.nomArticle === "string"
        ? { nom: "article_prix", nomArticle: e.nomArticle, ...enPause }
        : null;
    case "article_photo":
      return typeof e.nomArticle === "string" && typeof e.prixXaf === "number" && e.prixXaf > 0
        ? {
            nom: "article_photo",
            nomArticle: e.nomArticle,
            prixXaf: Math.floor(e.prixXaf),
            ...enPause,
          }
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
            ...enPause,
          }
        : null;
    case "comptoir": {
      const comptoir = normaliserEtatComptoir(e.comptoir);
      return comptoir ? { nom: "comptoir", comptoir, ...enPause } : null;
    }
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
  const net = motDeGeste(texteBrut);
  const avecParrain = /^(?:je veux )?vendre avec ([a-z0-9][a-z0-9-]*)$/.exec(net);
  if (avecParrain?.[1]) return { parrain: avecParrain[1] };
  if (/^(?:je veux vendre|vendre|ouvrir ma boutique|devenir vendeuse|sell)$/.test(net)) return {};
  return null;
}

/** « Ajouter un article » — le geste d'une vendeuse deja installee. */
export function demandeAjoutArticle(texteBrut: string): boolean {
  const net = motDeGeste(texteBrut);
  return /^(?:ajouter(?: un)?(?: article)?|nouvel article|article)$/.test(net);
}

/** « Ma boutique » — le retour au fil vendeuse depuis un fil d'achat. */
export function demandeEspaceVendeuse(texteBrut: string): boolean {
  const net = motDeGeste(texteBrut);
  return /^(?:ma boutique|espace vendeuse|vendeuse)$/.test(net);
}

/**
 * « commandes » — le REGISTRE des commandes ouvertes (ADR 0107). C'est la
 * moitie « retrouver » du recapitulatif d'absence (ADR 0105) : la
 * notification informe, le registre retrouve.
 */
export function demandeRegistre(texteBrut: string): boolean {
  const net = motDeGeste(texteBrut);
  return /^(?:mes )?commandes$|^registre$/.test(net);
}

/**
 * « solde » — le chiffre que la vendeuse vient chercher. MESURE au banc du
 * 10/08/2026 : tape pendant qu'un achat etait en cours (elle venait de
 * parcourir sa propre boutique), le mot partait au fil acheteuse qui ne le
 * connait pas — juste apres une commande, l'instant precis ou elle le tape.
 */
export function demandeSoldes(texteBrut: string): boolean {
  const net = motDeGeste(texteBrut);
  return /^(?:solde|soldes)$/.test(net);
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
  const net = motDeGeste(texteBrut);
  if (/^(?:conges|vacances|je pars|fermer|fermee|fermer la boutique)$/.test(net)) return true;
  if (/^(?:je reprends|reprendre|rouvrir|ouvrir|ouverte|de retour)$/.test(net)) return false;
  return null;
}

/** « Ma carte » — la carte-vitrine a poster en Statut (ADR 0037). */
export function demandeCarteVitrine(texteBrut: string): boolean {
  const net = motDeGeste(texteBrut);
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
  /**
   * La ponctuation de FIN part avec le separateur — carte « Eau, » du banc du
   * 10/08/2026. « Eau, 1000 » ecrit avec une virgule est la facon la plus
   * naturelle de legender une photo, et le nom gardait la virgule jusque sur
   * la carte imprimee. La ponctuation INTERNE reste : « Eau, sachet » est un
   * nom, pas un accident.
   */
  const nom = motif[1].trim().replace(/[\s,;.:—–-]+$/, "");
  const prix = lirePrix(motif[2]);
  if (nom.length < NOM_MIN || prix === null) return null;
  return { nom, prixXaf: prix };
}

/* Le mot `annuler` existe depuis l'ADR 0034 ; il n'etait annonce nulle part
   au moment ou on en a besoin — une reponse refusee bouclait sans issue
   visible (ADR 0048). */
const QUESTION_NOM_ARTICLE =
  "*Quel est le nom de l'article ?*\nExemple : Pagne wax 6 yards\n\nPlus rapide : envoyez directement la photo, avec « nom prix » en légende.";

const SORTIE_DE_SECOURS = "\n\nPour sortir : tapez « annuler ».";

/**
 * La reponse qui CLOT un flux porte ses gestes — ADR 0110.
 *
 * « Annuler » et « menu » fermaient le fil en texte nu : les gestes suivants
 * n'existaient que comme mots a taper. Pire, la copie proposait « ajouter » a
 * une prospect SANS boutique — un mot que la regle 3 de l'aiguillage reserve
 * aux vendeuses installees : tape la, il partait au fil acheteuse et rendait
 * l'accueil generique. Le mot promis ne menait pas ou la phrase promettait.
 *
 * Les boutons dependent donc de QUI sort, et l'etat le dit :
 *
 * - une prospect (`inscription_*`) n'a pas de boutique : elle peut REPRENDRE
 *   (`vendre`, route vers l'inscription — regle 2) ou lire ce que le produit
 *   change (`comment`, route vers l'explication du fil acheteuse) ;
 * - une vendeuse installee (`article_*`, `comptoir`) retrouve ses deux gestes
 *   de tous les jours : `article` et `ma_boutique` — les identifiants du menu
 *   d'ouverture (ADR 0088), dont le routage bouton ET liste est deja tenu par
 *   les tests d'aiguillage.
 *
 * Les mots tapes restent reconnus : le bouton s'ajoute au mot, il ne le
 * remplace jamais (meme regle que les Flows, ADR 0063).
 */
function messageSortieFlux(vers: string, etat: EtatVendeuse, corps: string): MessageSortant {
  const prospect = etat.nom.startsWith("inscription_");
  return boutons(
    vers,
    corps,
    prospect
      ? [
          { id: "vendre", titre: "Reprendre" },
          { id: "comment", titre: "Comment ça marche ?" },
        ]
      : [
          { id: "article", titre: "Ajouter un article" },
          { id: "ma_boutique", titre: "Ma boutique" },
        ],
  );
}

/** Exportees : le formulaire d'article (flux.ts) refuse ce que la question refuse. */
export const NOM_MIN = 2;
export const NOM_MAX = 80;
const abandon = (t: string) => /^(?:annuler|stop|cancel)$/.test(motDeGeste(t));

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
  /**
   * Le premier article, quand l'ouverture l'a rendu du meme geste — ADR 0088.
   * Present, il FUSIONNE : une seule confirmation pour un seul formulaire.
   */
  premierArticle?: { nom: string; prixXaf: number; avecPhoto: boolean },
): MessageSortant[] {
  /**
   * UN SEUL message, et c'est une LISTE — banc du 19/28 du 13/08/2026.
   *
   * ── Ce qu'on a mesure ────────────────────────────────────────────────────
   *
   * La reduction de l'ADR 0086 avait ramene l'ouverture de cinq messages a
   * deux. Le banc en a compte QUATRE, parce que le formulaire d'article de
   * l'ecran 2 en ajoutait deux de plus : la confirmation de l'article, et le
   * mode d'emploi. Cinq liens bruts dans un fil ou le pouce cherche un seul
   * geste. Le porteur du produit : « une multiplication de messages et de
   * liens rendant touffu le chat, c'est confondant ».
   *
   * ── Pourquoi une liste, et pas des boutons ───────────────────────────────
   *
   * WhatsApp ne hierarchise pas : le quatrieme message pese autant que le
   * premier, et les boutons du premier ont deja defile. Trois boutons ne
   * tiennent pas tout ce qu'une vendeuse neuve peut vouloir faire, donc le
   * reste retombait en texte — c'est exactement ce qui produisait le mur.
   *
   * Le message LISTE porte jusqu'a dix lignes, chacune avec sa description :
   * un menu natif, ferme par defaut, qui range tout sans rien pousser. Une
   * seule bulle, et chaque geste possible y est nomme ET explique.
   *
   * ── Le lien reste du TEXTE, et c'est delibere ────────────────────────────
   *
   * `cta_url` est accepte depuis la mesure du 13/08 (ADR 0087) : on POURRAIT
   * en faire un bouton. On ne le fait pas ici. Ce lien-la, elle doit le
   * COPIER pour le coller dans son Statut — un bouton l'OUVRE, il ne le
   * donne pas. `cta_url` sert « va voir cette page » (recu, suivi, espace),
   * jamais « prends ceci et colle-le ailleurs ».
   *
   * ── Trois lignes, et pas une de plus ─────────────────────────────────────
   *
   * Chaque ligne promet un geste dont le routage est VERIFIE (`article`,
   * `carte`, `ma_boutique` — voir `aiguillage.ts`). Le reversement n'y est
   * pas : il vit dans « ma boutique », il a sa relance a ~20 h, et il
   * reparait a la premiere commande, la ou il coute. Une ligne de menu qui
   * ouvre sur rien est pire que pas de menu.
   */
  const article = premierArticle
    ? `\n*${premierArticle.nom}* — ${formatXaf(premierArticle.prixXaf)} est en ligne.${
        premierArticle.avecPhoto
          ? ""
          : "\nSans photo pour l'instant — envoyez-la quand vous voulez."
      }`
    : "";
  return [
    liste(
      vers,
      `✅ *${b.nom}* est ouverte.${article}\n\nVotre lien à partager — mettez-le en statut WhatsApp :\n${b.lienBoutique}`,
      "Que faire ?",
      [
        {
          id: "article",
          titre: "Ajouter un article",
          description: "Nom, prix, photo — en un seul formulaire",
        },
        {
          id: "carte",
          titre: "Ma carte à poster",
          description: "L'affiche de votre boutique, pour votre Statut",
        },
        {
          id: "ma_boutique",
          titre: "Ma boutique",
          description: "Vos articles, vos commandes, vos chiffres",
        },
      ],
      /* La seule legon qui ne tient dans aucune ligne de menu : ce qui se
         passe quand une commande arrive. Soixante caracteres au plus. */
      "Commandes ici. Remise faite ? « livrée » + la référence.",
    ),
  ];
}

/**
 * Le mode d'emploi, au moment ou la boutique devient reelle — tache #62.
 *
 * ── Pourquoi ICI, au premier article, et pas a la creation ────────────────
 *
 * A la creation, la vendeuse recoit deja trois messages (lien, reversement,
 * premier article) : un mode d'emploi de plus s'y noierait. Au premier
 * article publie, la boutique est MONTRABLE — c'est le moment ou elle va
 * recevoir sa premiere commande, donc le moment ou savoir quoi en faire
 * compte. Meme logique que la carte-vitrine (ADR 0037), qui part a cet
 * instant precis et pour la meme raison.
 *
 * ── Chaque ligne promet un geste qui EXISTE ───────────────────────────────
 *
 * « livree <reference> » (`demandeRemise`), « ma boutique »
 * (`demandeEspaceVendeuse`), « ajouter » (`demandeAjoutArticle`), « vendu »
 * (`demandeComptoir`). Rien d'autre : une ligne d'aide qui promet un mot que
 * le bot ne comprend pas est pire que pas d'aide du tout.
 *
 * Texte brut autosuffisant (AGENTS.md §2) : les liens sont un confort, la
 * phrase reste vraie sans eux — on ne fabrique jamais une URL fausse.
 */
export function messageOnboarding(
  vers: string,
  liens: { lienBoutique: string | null; lienEspace: string | null },
): MessageSortant {
  const boutique = liens.lienBoutique
    ? `4. Votre boutique en ligne, à partager partout :\n${liens.lienBoutique}`
    : "4. Votre boutique en ligne se partage depuis « ma carte ».";
  const reversement = liens.lienEspace
    ? `3. Pour être payé/e d'AVANCE, posez votre numéro Mobile Money :\n${liens.lienEspace}/reversement`
    : "3. Pour être payé/e d'AVANCE, posez votre numéro Mobile Money dans votre espace vendeur/se.";
  return texte(
    vers,
    `📖 *Votre boutique, mode d'emploi :*\n\n1. Les commandes arrivent ici, dans ce fil — un message vous prévient à chaque fois.\n2. Remise faite ? Écrivez « livrée » et la référence. Exemple : livrée CT-482910\n${reversement}\n${boutique}\n5. Votre affiche à poster en Statut : écrivez « ma carte » — ou touchez le bouton après chaque article.\n\nÀ tout moment : « ma boutique » pour le menu, « ajouter » pour un article, « vendu » pour déclarer une vente déjà négociée.`,
  );
}

export function messageArticlePublie(
  vers: string,
  a: { nom: string; prixXaf: number; avecPhoto: boolean },
  enConges = false,
  /**
   * Minutes avant que la PAGE WEB de la boutique porte cet article — ADR 0065.
   *
   * `null` quand aucune reconstruction n'a ete demandee, et c'est alors le
   * SILENCE qui est honnete : sans crochet configure, la page n'arrivera pas
   * d'elle-meme, et annoncer un delai serait une promesse qu'on ne tient pas.
   *
   * Le mot « en ligne » etait vrai pour le catalogue du fil et FAUX pour le
   * web : mesure du 11/08/2026, `chez-bea-test` repondait 404 pendant que le
   * bot annoncait la mise en ligne. C'est le web que la vendeuse va montrer.
   */
  pageWebDansMinutes: number | null = null,
): MessageSortant {
  const photo = a.avecPhoto ? "" : "\nSans photo pour l'instant — envoyez-la quand vous voulez.";
  /**
   * « En ligne » ne peut pas rester seul sur une boutique fermée — ADR 0057.
   *
   * C'est vrai ET trompeur : l'article s'affiche, et aucune commande ne peut
   * naitre. Le moment ou elle range son stock est precisement celui ou elle a
   * oublie qu'elle est fermee — c'est donc la qu'il faut le dire, pas dans un
   * ecran qu'elle ouvrira peut-etre.
   */
  const conges = enConges
    ? "\n\n🌴 Rappel : votre boutique est en congés — elle ne prend aucune commande. Écrivez « je reprends » quand vous êtes prêt/e."
    : "";
  const pageWeb =
    pageWebDansMinutes === null
      ? ""
      : `\nVotre page web se met à jour — elle portera cet article d'ici ${pageWebDansMinutes} minutes.`;
  return boutons(
    vers,
    `✅ *${a.nom}* — ${formatXaf(a.prixXaf)} est dans votre catalogue.${photo}${pageWeb}${conges}`,
    /**
     * Trois boutons au plus (borne de l'API), et « Ma carte » y entre depuis
     * le banc du 13/08 : le pack statut ne part plus TOUT SEUL a chaque
     * publication — trois messages d'affilee qui noyaient les boutons — il
     * s'obtient d'un appui, quand elle veut poster.
     */
    [
      ...(enConges ? [{ id: "rouvrir", titre: "Je reprends" }] : []),
      { id: "article", titre: "Autre article" },
      ...(enConges ? [] : [{ id: "carte", titre: "Ma carte" }]),
    ],
  );
}

/**
 * Le rappel qui accompagne un geste de vente pendant les congés — ADR 0057.
 *
 * Il dit ce qui est fermé ET ce qui reste ouvert : sans la seconde moitié,
 * une vendeuse peut croire que sa boutique a disparu, et ne fermera plus
 * jamais. Le ton ne dramatise pas — rien n'est cassé, rien n'est perdu, c'est
 * un état choisi qui dure peut-être trop.
 *
 * Le bouton porte le geste LUI-MEME. Renvoyer vers l'endroit où le geste se
 * trouve ferait remettre à plus tard, et « plus tard » est le mode d'échec
 * qu'on corrige.
 */
export function rappelConges(vers: string): MessageSortant {
  return boutons(
    vers,
    "🌴 Votre boutique est en congés : elle reste en ligne et vos client/es peuvent vous écrire, mais aucune nouvelle commande ne peut être créée.",
    [{ id: "rouvrir", titre: "Je reprends" }],
  );
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
  genre: "texte" | "bouton" | "liste" | "image" | "autre";
  texte?: string;
  id?: string;
  mediaId?: string;
  legende?: string;
  /** La forme qu'on ne sait pas lire, quand `genre` vaut « autre » (ADR 0049). */
  forme?: FormeNonLue;
  /** Le wamid entrant — pour REAGIR a la photo et la CITER (ADR 0035). */
  messageId?: string;
}

/**
 * Ce qui est en cours, dit en clair — ADR 0052.
 *
 * La question d'arbitrage doit NOMMER le travail qu'on propose d'abandonner,
 * sinon « on finit ça ? » ne veut rien dire pour quelqu'un qui a ete
 * interrompu il y a dix minutes par une cliente.
 */
function travailEnCours(etat: EtatVendeuse): string {
  switch (etat.nom) {
    case "inscription_nom":
      return "d'ouvrir votre boutique";
    case "inscription_ville":
    case "inscription_confirme":
      return `d'ouvrir *${etat.nomBoutique}*`;
    case "comptoir":
      return "de déclarer une vente";
    case "article_nom":
      return "d'ajouter un article";
    case "article_prix":
    case "article_photo":
    case "article_confirme":
      return `d'ajouter *${etat.nomArticle}*`;
  }
}

/**
 * La question d'arbitrage — ADR 0052. Deux boutons, rien de perdu d'un cote
 * comme de l'autre.
 */
export function questionArbitrage(etat: EtatVendeuse, slug: string, vers: string): MessageSortant {
  return boutons(
    vers,
    `Vous étiez en train ${travailEnCours(etat)}.\n\nOn finit ça, ou on va voir la boutique *${slug}* ?`,
    [
      { id: "pause:finir", titre: "Finir" },
      { id: "pause:aller", titre: "Voir la boutique" },
    ],
  );
}

/**
 * La QUESTION que pose l'etat courant — ADR 0049.
 *
 * A ne pas confondre avec les messages de reproche (« Je n'ai pas compris le
 * prix ») : quelqu'un qui envoie un vocal n'a rien fait de mal. On lui dit
 * qu'on ne sait pas l'ecouter, puis on lui REPOSE la question — sans quoi il
 * reste devant une explication, sans savoir ce qu'on attend de lui.
 */
export function questionDeLEtat(etat: EtatVendeuse, vers: string): MessageSortant {
  switch (etat.nom) {
    case "inscription_nom":
      return texte(vers, `${PREMIERE_QUESTION}${SORTIE_DE_SECOURS}`);
    case "inscription_ville":
      return texte(vers, `*Dans quelle ville vendez-vous ?*\nExemple : Douala${SORTIE_DE_SECOURS}`);
    case "inscription_confirme":
      return messageConfirmationBoutique(vers, etat.nomBoutique, etat.ville);
    case "article_nom":
      return texte(vers, `${QUESTION_NOM_ARTICLE}${SORTIE_DE_SECOURS}`);
    case "article_prix":
      return texte(
        vers,
        `*${etat.nomArticle}* — son prix, en francs ?\nExemple : 15000${SORTIE_DE_SECOURS}`,
      );
    case "article_photo":
      return boutons(
        vers,
        `J'attends la photo de *${etat.nomArticle}* — envoyez-la comme une image, depuis l'appareil photo ou la galerie.`,
        [{ id: "sans_photo", titre: "Sans photo" }],
      );
    case "article_confirme":
      return messageConfirmationLegende(vers, { nom: etat.nomArticle, prixXaf: etat.prixXaf });
    case "comptoir":
      return etat.comptoir.pas === "recap"
        ? boutonsRecapComptoir(etat.comptoir, vers)
        : texte(vers, `${questionComptoir(etat.comptoir)}${SORTIE_DE_SECOURS}`);
  }
}

/** Le recapitulatif du comptoir, avec ses trois boutons — jamais de creation muette. */
function boutonsRecapComptoir(
  etat: Extract<EtatComptoir, { pas: "recap" }>,
  vers: string,
): MessageSortant {
  return boutons(vers, recapComptoir(etat), [
    { id: "confirmer", titre: "Confirmer ✓" },
    { id: "corriger", titre: "Corriger" },
    { id: "annuler", titre: "Annuler" },
  ]);
}

/**
 * L'inscription et l'ajout d'article, etat par etat.
 *
 * `etat: null` en sortie veut dire « ce fil est termine » : le service repose
 * l'etat neutre et la conversation repart au fil vendeuse ordinaire.
 */
/**
 * La relecture avant ouverture — ADR 0090.
 *
 * Le nom est REPETE tel quel : la vendeuse doit voir ce que le bot a retenu, et
 * pas seulement s'entendre demander de confirmer. La phrase dit aussi que le
 * nom sera l'adresse publique — c'est ce qui rend la relecture utile plutot que
 * ceremonieuse.
 */
export function messageConfirmationBoutique(
  vers: string,
  nomBoutique: string,
  ville: string,
): MessageSortant {
  return boutons(
    vers,
    `J'ai lu : *${nomBoutique}*, à *${ville}*.\n\nCe nom sera aussi l'adresse de votre boutique en ligne, celle que vous partagerez. On ouvre ?`,
    [
      { id: "ouvrir", titre: "Ouvrir ✓" },
      { id: "corriger", titre: "Corriger" },
    ],
  );
}

export function reagirInscription(
  etat: EtatVendeuse,
  entree: Entree,
  vers: string,
): ReactionVendeuse {
  /**
   * La pause en cours se resout d'abord — ADR 0052. Deux boutons, et rien
   * d'autre : tout autre message RE-POSE la question au lieu de choisir a la
   * place de la personne. `annuler` sort, comme partout (traite plus bas).
   */
  if (etat.enPause) {
    const { enPause, ...sansPause } = etat;
    if (entree.genre === "bouton" && entree.id === "pause:finir") {
      const repris = sansPause as EtatVendeuse;
      return { etat: repris, messages: [questionDeLEtat(repris, vers)] };
    }
    if (entree.genre === "bouton" && entree.id === "pause:aller") {
      return { etat: null, messages: [], effet: { type: "aller_boutique", slug: enPause.slug } };
    }
    if (!(entree.genre === "texte" && entree.texte && abandon(entree.texte))) {
      return { etat, messages: [questionArbitrage(sansPause as EtatVendeuse, enPause.slug, vers)] };
    }
  }

  /**
   * Un LIEN DE BOUTIQUE pendant un formulaire — ADR 0052. On n'avale pas
   * (« Je n'ai pas compris le prix », le defaut du 07/08/2026) et on ne jette
   * pas : on met de cote et on demande.
   */
  if (entree.genre === "texte" && entree.texte && !etat.enPause) {
    const slug = extraireSlugBoutique(entree.texte);
    if (slug) {
      return {
        etat: { ...etat, enPause: { slug } },
        messages: [questionArbitrage(etat, slug, vers)],
      };
    }
  }

  /**
   * Le vocabulaire commun — ADR 0051. « aide » explique OU on en est au lieu
   * de repeter la question ; « menu » sort du formulaire comme « annuler »,
   * parce que personne ne devine que le mot de sortie est « annuler ».
   */
  if (entree.genre === "texte" && entree.texte) {
    const mot = motCleGlobal(entree.texte);
    if (mot === "aide") {
      return {
        etat,
        messages: [
          texte(
            vers,
            (etat.nom === "comptoir"
              ? "Vous êtes en train de déclarer une vente : je crée la commande et je vous rends le message de paiement à transférer à votre client/e."
              : "Vous êtes en train de créer votre boutique ou d'ajouter un article.") +
              SORTIE_DE_SECOURS,
          ),
          questionDeLEtat(etat, vers),
        ],
      };
    }
    if (mot === "menu") {
      return {
        etat: null,
        messages: [messageSortieFlux(vers, etat, "C'est mis de côté.")],
      };
    }
  }

  /* Abandonner marche partout, comme dans le fil acheteuse (ADR 0032). */
  if (entree.genre === "texte" && entree.texte && abandon(entree.texte)) {
    return {
      etat: null,
      messages: [messageSortieFlux(vers, etat, "C'est annulé.")],
    };
  }

  /* Une forme non lue — ADR 0049. Traitee AVANT le switch : la reponse est la
     meme partout, seule la question reposee change. Le fil vendeuse est en
     francais (ADR 0033), d'ou `TEXTES.fr`. */
  if (entree.genre === "autre") {
    const forme = entree.forme ?? "inconnue";
    return {
      etat,
      messages: [texte(vers, TEXTES.fr.formeNonLue(forme)), questionDeLEtat(etat, vers)],
    };
  }

  switch (etat.nom) {
    case "comptoir": {
      /* La machine du comptoir decide ; on ne fait qu'envelopper. `annuler` et
         `aide` sont deja passes plus haut, comme pour tous les etats. */
      const r = avancerComptoir(etat.comptoir, {
        texte: entree.genre === "texte" ? (entree.texte ?? "") : "",
        ...(entree.genre === "bouton" || entree.genre === "liste" ? { id: entree.id } : {}),
      });
      if (r.type === "creer" && r.vente) {
        return { etat: null, messages: [], effet: { type: "creer_vente", vente: r.vente } };
      }
      if (r.type === "abandon") {
        return {
          etat: null,
          messages: [messageSortieFlux(vers, etat, "C'est annulé — rien n'a été créé.")],
        };
      }
      const suivant: EtatVendeuse = { nom: "comptoir", comptoir: r.etat };
      const messages: MessageSortant[] =
        r.type === "refus" && r.motif
          ? [texte(vers, phraseRefusComptoir(r.motif)), questionDeLEtat(suivant, vers)]
          : [questionDeLEtat(suivant, vers)];
      return { etat: suivant, messages };
    }
    case "inscription_nom": {
      const nom = entree.genre === "texte" ? (entree.texte ?? "").trim() : "";
      if (nom.length < NOM_MIN || nom.length > NOM_MAX) {
        return {
          etat,
          messages: [
            texte(
              vers,
              "Il me faut le nom de votre boutique, en quelques mots.\nExemple : Chez Amina" +
                SORTIE_DE_SECOURS,
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
      /* Le MEME predicat que celui qui gardera la livraison — ADR 0050.
         Jusqu'ici cette porte acceptait 2 a 80 caracteres et la lecture
         n'acceptait que deux villes : l'ecart se payait chez l'acheteuse,
         trois semaines plus tard, au dernier appui. */
      if (!villeAcceptable(ville)) {
        return {
          etat,
          messages: [texte(vers, "Dites-moi la ville où vous vendez.\nExemple : Douala")],
        };
      }
      /* La boutique ne se cree PLUS ici — ADR 0090. Elle se relit d'abord :
         le nom devient une adresse publique, et rien ne permettait de le
         corriger apres coup. Une bulle de plus a l'ouverture, assumee et
         arbitree par le porteur du produit (elle revise l'ADR 0088). */
      return {
        etat: {
          nom: "inscription_confirme",
          nomBoutique: etat.nomBoutique,
          ville,
          ...(etat.parrain ? { parrain: etat.parrain } : {}),
        },
        messages: [messageConfirmationBoutique(vers, etat.nomBoutique, ville)],
      };
    }

    /**
     * La relecture — ADR 0090. « Ouvrir » cree, « Corriger » retourne au nom, et
     * tout le reste RE-POSE la question : on ne choisit pas a la place de la
     * vendeuse, exactement comme l'arbitrage de l'ADR 0052.
     */
    case "inscription_confirme": {
      const id = entree.genre === "bouton" || entree.genre === "liste" ? entree.id : "";
      if (id === "ouvrir") {
        /* La boutique se cree ICI ; le message de bienvenue part apres, avec le
           vrai lien — un slug ne s'invente pas (meme regle que la reference de
           commande, AGENTS.md). */
        return {
          etat: null,
          messages: [],
          effet: {
            type: "creer_boutique",
            nomBoutique: etat.nomBoutique,
            ville: etat.ville,
            ...(etat.parrain ? { parrain: etat.parrain } : {}),
          },
        };
      }
      if (id === "corriger") {
        return {
          etat: {
            nom: "inscription_nom",
            ...(etat.parrain ? { parrain: etat.parrain } : {}),
          },
          messages: [texte(vers, `${PREMIERE_QUESTION}${SORTIE_DE_SECOURS}`)],
        };
      }
      return {
        etat,
        messages: [messageConfirmationBoutique(vers, etat.nomBoutique, etat.ville)],
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
              "*Quel est le nom de l'article ?*\nExemple : Pagne wax 6 yards\n\nPlus rapide : envoyez directement la photo, avec « nom prix » en légende." +
                SORTIE_DE_SECOURS,
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
              "Je n'ai pas compris le prix. Écrivez-le en chiffres, sans virgule.\nExemple : 15000" +
                SORTIE_DE_SECOURS,
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
