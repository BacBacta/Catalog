import { formatXaf } from "@catalog/contracts/money";
import { villeAcceptable } from "@catalog/contracts/villes";
import { MESSAGE_REFUS_IMAGE, type PhotoIndisponible } from "../image.ts";
import {
  avancerComptoir,
  demandeComptoir,
  type EtatComptoir,
  normaliserEtatComptoir,
  phraseRefusComptoir,
  questionComptoir,
  recapComptoir,
  type VenteDeclaree,
} from "./comptoir-vendeuse.ts";
import { extraireSlugBoutique, INACTIVITE_MAX_MS, motCleGlobal } from "./conversation.ts";
import type { FormeNonLue } from "./entrees.ts";
import { boutons, liste, type MessageSortant, reaction, texte } from "./messages.ts";
import {
  ajouterBrouillon,
  type BrouillonRafale,
  brouillonsIncomplets,
  carteRafale,
  demandeToutPublier,
  lireCorrectionRafale,
  questionCorrectionRafale,
} from "./rafale.ts";
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
  | { nom: "comptoir"; comptoir: EtatComptoir; enPause?: GesteEnPause }
  /**
   * La RAFALE — ADR 0096. Des la deuxieme photo legendee, les propositions
   * s'accumulent en brouillons ; une seule carte recapitulative confirme
   * tout. `annonce` : la carte est-elle deja partie ? (le travail pg-boss ne
   * l'envoie qu'une fois, une photo de plus la re-arme).
   */
  | { nom: "rafale"; brouillons: BrouillonRafale[]; annonce?: boolean; enPause?: GesteEnPause }
  /** « corriger le N » : UN brouillon rouvert, les autres intacts. */
  | {
      nom: "rafale_correction";
      n: number;
      brouillons: BrouillonRafale[];
      enPause?: GesteEnPause;
    };

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
  | { type: "creer_vente"; vente: VenteDeclaree }
  /** La salve confirmee d'un geste — ADR 0096. Complets seulement. */
  | {
      type: "publier_rafale";
      brouillons: Array<{ nom: string; prixXaf: number; mediaId: string }>;
    };

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
    case "rafale": {
      const brouillons = normaliserBrouillons(e.brouillons);
      return brouillons
        ? { nom: "rafale", brouillons, annonce: e.annonce === true, ...enPause }
        : null;
    }
    case "rafale_correction": {
      const brouillons = normaliserBrouillons(e.brouillons);
      return brouillons &&
        typeof e.n === "number" &&
        Number.isInteger(e.n) &&
        e.n >= 1 &&
        e.n <= brouillons.length
        ? { nom: "rafale_correction", n: e.n, brouillons, ...enPause }
        : null;
    }
    default:
      return null;
  }
}

/** Les brouillons d'une rafale persistee. Tout ce qui ne se relit pas vaut `null`. */
function normaliserBrouillons(brut: unknown): BrouillonRafale[] | null {
  if (!Array.isArray(brut) || brut.length === 0) return null;
  const brouillons: BrouillonRafale[] = [];
  for (const b of brut as Array<Record<string, unknown> | null>) {
    if (!b || typeof b.mediaId !== "string" || !b.mediaId) return null;
    const nom = typeof b.nom === "string" && b.nom ? b.nom : null;
    const prixXaf =
      typeof b.prixXaf === "number" && Number.isInteger(b.prixXaf) && b.prixXaf > 0
        ? b.prixXaf
        : null;
    brouillons.push({
      nom,
      prixXaf,
      mediaId: b.mediaId,
      ...(typeof b.wamid === "string" && b.wamid ? { wamid: b.wamid } : {}),
    });
  }
  return brouillons;
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
 * « solde » — le chiffre que la vendeuse vient chercher. MESURE au banc du
 * 10/08/2026 : tape pendant qu'un achat etait en cours (elle venait de
 * parcourir sa propre boutique), le mot partait au fil acheteuse qui ne le
 * connait pas — juste apres une commande, l'instant precis ou elle le tape.
 */
export function demandeSoldes(texteBrut: string): boolean {
  const net = sansAccents(texteBrut.trim().toLowerCase());
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
 * Un mot que le MODE D'EMPLOI enseigne — constat C-01 de l'audit 2026-08.
 *
 * « vendu », « ajouter », « ma boutique », « ma carte »… sont annonces par
 * l'aide comme des commandes. Tape DANS le formulaire d'article, « vendu »
 * devenait le nom de l'article — la famille du « Hi » de l'ADR 0048 : le
 * texte capture par un etat qui n'aurait pas du le lire. On ne devine pas
 * l'intention (§7.7) : on DIT que ce mot est une commande, et on repose la
 * question.
 */
export function motDuModeDemploi(texteBrut: string): boolean {
  return (
    demandeAjoutArticle(texteBrut) ||
    demandeComptoir(texteBrut) ||
    demandeEspaceVendeuse(texteBrut) ||
    demandeInscription(texteBrut) !== null ||
    demandeSoldes(texteBrut) ||
    demandeCarteVitrine(texteBrut) ||
    demandeConges(texteBrut) !== null
  );
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

/** Exportees : le formulaire d'article (flux.ts) refuse ce que la question refuse. */
export const NOM_MIN = 2;
export const NOM_MAX = 80;
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
    ? `3. Pour être payée d'AVANCE, posez votre numéro Mobile Money :\n${liens.lienEspace}/reversement`
    : "3. Pour être payée d'AVANCE, posez votre numéro Mobile Money dans votre espace vendeuse.";
  return texte(
    vers,
    `📖 *Votre boutique, mode d'emploi :*\n\n1. Les commandes arrivent ici, dans ce fil — un message vous prévient à chaque fois.\n2. Remise faite ? Écrivez « livrée » et la référence. Exemple : livrée CT-482910\n${reversement}\n${boutique}\n5. Votre affiche à poster en Statut : écrivez « ma carte » — ou touchez le bouton après chaque article.\n\nÀ tout moment : « ma boutique » pour le menu, « ajouter » pour un article, « vendu » pour déclarer une vente déjà négociée.`,
  );
}

/**
 * Ce que le fil dit d'une photo qui manque — constat D3 de l'audit 2026-08.
 *
 * « Sans photo pour l'instant » etait la seule phrase, que la vendeuse n'ait
 * rien envoye ou que sa photo ait ete REFUSEE : elle renvoyait la meme photo,
 * echouait pareil, et concluait que ca ne marche pas. Quand la cause est
 * connue, elle se DIT — avec les memes messages que le chemin HTTP
 * (`MESSAGE_REFUS_IMAGE`), qui disent quoi faire.
 */
function causePhotoIndisponible(refus: PhotoIndisponible): string {
  return refus === "illisible"
    ? "elle est arrivée abîmée et n'a pas pu être lue. Renvoyez-la, ou choisissez-en une autre."
    : refus === "introuvable"
      ? "WhatsApp ne l'a pas fournie. Réessayez dans un moment."
      : MESSAGE_REFUS_IMAGE[refus];
}

function phrasePhotoAbsente(refus?: PhotoIndisponible | null): string {
  if (!refus) return "Sans photo pour l'instant — envoyez-la quand vous voulez.";
  return `La photo n'a pas pu être utilisée : ${causePhotoIndisponible(refus)}`;
}

export function messageArticlePublie(
  vers: string,
  a: { nom: string; prixXaf: number; avecPhoto: boolean; photoRefus?: PhotoIndisponible | null },
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
  const photo = a.avecPhoto ? "" : `\n${phrasePhotoAbsente(a.photoRefus)}`;
  /**
   * « En ligne » ne peut pas rester seul sur une boutique fermée — ADR 0057.
   *
   * C'est vrai ET trompeur : l'article s'affiche, et aucune commande ne peut
   * naitre. Le moment ou elle range son stock est precisement celui ou elle a
   * oublie qu'elle est fermee — c'est donc la qu'il faut le dire, pas dans un
   * ecran qu'elle ouvrira peut-etre.
   */
  const conges = enConges
    ? "\n\n🌴 Rappel : votre boutique est en congés — elle ne prend aucune commande. Écrivez « je reprends » quand vous êtes prête."
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
 * La carte de retour d'une SALVE publiée — ADR 0096. UNE carte, pas n :
 * « Publiés. Votre boutique passe à N articles. » (copie de la maquette).
 * Les photos refusées se DISENT, par numéro, avec les mêmes causes que
 * l'article unitaire (ADR 0092) ; les congés et le délai de la page web
 * suivent les mêmes règles que `messageArticlePublie`.
 */
export function messageRafalePubliee(
  vers: string,
  r: {
    publies: number;
    totalArticles: number;
    photosRefusees: Array<{ n: number; refus: PhotoIndisponible }>;
    /** Des brouillons que la base a refusés — rare, mais jamais silencieux. */
    rates: number;
    enConges: boolean;
    pageWebDansMinutes: number | null;
  },
): MessageSortant {
  const photos = r.photosRefusees.map(
    (p) => `\nLa photo du ${p.n} n'a pas pu être utilisée : ${causePhotoIndisponible(p.refus)}`,
  );
  const rates =
    r.rates > 0
      ? `\n${r.rates} article${r.rates > 1 ? "s" : ""} n'a pas pu être enregistré — renvoyez-le, rien d'autre n'est perdu.`
      : "";
  const pageWeb =
    r.pageWebDansMinutes === null
      ? ""
      : `\nVotre page web se met à jour — elle portera ces articles d'ici ${r.pageWebDansMinutes} minutes.`;
  const conges = r.enConges
    ? "\n\n🌴 Rappel : votre boutique est en congés — elle ne prend aucune commande. Écrivez « je reprends » quand vous êtes prête."
    : "";
  return boutons(
    vers,
    `✅ *Publiés.* Votre boutique passe à ${r.totalArticles} articles.${photos.join("")}${rates}${pageWeb}${conges}`,
    [
      ...(r.enConges ? [{ id: "rouvrir", titre: "Je reprends" }] : []),
      { id: "article", titre: "Autre article" },
      ...(r.enConges ? [] : [{ id: "carte", titre: "Ma carte" }]),
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
    "🌴 Votre boutique est en congés : elle reste en ligne et vos clientes peuvent vous écrire, mais aucune nouvelle commande ne peut être créée.",
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
      return `d'ouvrir *${etat.nomBoutique}*`;
    case "comptoir":
      return "de déclarer une vente";
    case "article_nom":
      return "d'ajouter un article";
    case "article_prix":
    case "article_photo":
    case "article_confirme":
      return `d'ajouter *${etat.nomArticle}*`;
    case "rafale":
    case "rafale_correction":
      return `de publier ${etat.brouillons.length} articles`;
  }
}

/**
 * La question d'arbitrage — ADR 0052. Deux boutons, rien de perdu d'un cote
 * comme de l'autre.
 */
export function questionArbitrage(etat: EtatVendeuse, slug: string, vers: string): MessageSortant {
  /* « annuler » est ANNONCE — residu D8 de l'audit 2026-08 : c'est la seule
     issue hors des deux boutons (ADR 0052), et une sortie de secours que la
     copie ne nomme pas n'existe pas pour qui en a besoin. */
  return boutons(
    vers,
    `Vous étiez en train ${travailEnCours(etat)}.\n\nOn finit ça, ou on va voir la boutique *${slug}* ?\n(« annuler » abandonne ce qui était en cours.)`,
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
    case "rafale":
      return carteRafale(vers, etat.brouillons);
    case "rafale_correction":
      return texte(
        vers,
        questionCorrectionRafale(etat.n, etat.brouillons[etat.n - 1] as BrouillonRafale),
      );
    case "comptoir":
      if (etat.comptoir.pas === "recap") return boutonsRecapComptoir(etat.comptoir, vers);
      if (etat.comptoir.pas === "choix") return listeChoixCorrection(etat.comptoir, vers);
      return texte(vers, `${questionComptoir(etat.comptoir)}${SORTIE_DE_SECOURS}`);
  }
}

/**
 * Le choix du fait a corriger — constat C-04. Une LISTE, pas des boutons :
 * quatre faits ne tiennent pas en trois boutons, et chaque ligne montre la
 * valeur actuelle pour que la vendeuse reconnaisse ce qui est faux.
 */
function listeChoixCorrection(
  etat: Extract<EtatComptoir, { pas: "choix" }>,
  vers: string,
): MessageSortant {
  return liste(vers, "Que faut-il corriger ? Le reste ne se retape pas.", "Choisir", [
    { id: "corr:article", titre: "L'article", description: etat.article },
    { id: "corr:prix", titre: "Le prix", description: formatXaf(etat.prixXaf) },
    { id: "corr:cliente", titre: "Le numéro", description: etat.cliente },
    { id: "corr:remise", titre: "La remise", description: etat.remise },
    { id: "retour", titre: "Rien — retour", description: "Revoir le récapitulatif" },
  ]);
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
              ? "Vous êtes en train de déclarer une vente : je crée la commande et je vous rends le message de paiement à transférer à votre cliente."
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
        messages: [
          texte(
            vers,
            "C'est mis de côté. Écrivez « vendre » pour reprendre, ou « ajouter » pour un article.",
          ),
        ],
      };
    }
  }

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
        return { etat: null, messages: [texte(vers, "C'est annulé — rien n'a été créé.")] };
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
      /**
       * Un mot du MODE D'EMPLOI ne devient jamais un nom d'article — constat
       * C-01. « vendu » tape ici ouvrait un article nomme « vendu » : la
       * vendeuse suivait l'aide a la lettre, et le formulaire la trahissait.
       * On le DIT (§7.7) et on repose la question — « annuler » reste la
       * sortie pour utiliser le mot pour de bon.
       */
      if (nom && motDuModeDemploi(nom)) {
        return {
          etat,
          messages: [
            texte(
              vers,
              `« ${nom} » est un mot du menu, pas un nom d'article. Pour l'utiliser, écrivez d'abord « annuler ».`,
            ),
            questionDeLEtat(etat, vers),
          ],
        };
      }
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
      /**
       * Une DEUXIEME photo : la salve commence — ADR 0096. La proposition en
       * attente devient le brouillon 1, la photo le brouillon 2, et plus
       * rien ne part qu'un 👍 par photo : la carte recapitulative arrivera a
       * la fermeture de la fenetre de regroupement, UNE fois. (Avant ce lot,
       * la nouvelle photo REMPLACAIT la proposition — la premiere etait
       * perdue en silence.)
       */
      if (entree.genre === "image" && entree.mediaId) {
        const lu = entree.legende ? lireLegendeArticle(entree.legende) : null;
        const premier: BrouillonRafale = {
          nom: etat.nomArticle,
          prixXaf: etat.prixXaf,
          mediaId: etat.mediaId,
        };
        const ajout = ajouterBrouillon([premier], {
          mediaId: entree.mediaId,
          lu,
          ...(entree.messageId ? { wamid: entree.messageId } : {}),
        });
        if (ajout.resultat !== "ajoute") {
          return { etat, messages: [] };
        }
        /* Avec un wamid, l'accuse est un 👍 — une reaction, pas une bulle :
           la carte attend la fenetre. Sans wamid (rare), on ne peut pas
           reagir : la carte part tout de suite, plutot qu'un silence. */
        return entree.messageId
          ? {
              etat: { nom: "rafale", brouillons: ajout.brouillons },
              messages: [reaction(vers, entree.messageId, "👍")],
            }
          : {
              etat: { nom: "rafale", brouillons: ajout.brouillons, annonce: true },
              messages: [carteRafale(vers, ajout.brouillons)],
            };
      }
      return {
        etat,
        messages: [
          messageConfirmationLegende(vers, { nom: etat.nomArticle, prixXaf: etat.prixXaf }),
        ],
      };
    }

    case "rafale": {
      /* Une photo de plus : elle s'accumule, un 👍 et rien d'autre — la
         carte arrivera a la fermeture de la fenetre. */
      if (entree.genre === "image" && entree.mediaId) {
        const lu = entree.legende ? lireLegendeArticle(entree.legende) : null;
        const ajout = ajouterBrouillon(etat.brouillons, {
          mediaId: entree.mediaId,
          lu,
          ...(entree.messageId ? { wamid: entree.messageId } : {}),
        });
        if (ajout.resultat === "deja_vu") {
          /* La relivraison Meta : deja la, silence (ADR 0040). */
          return { etat, messages: [] };
        }
        if (ajout.resultat === "plein") {
          return {
            etat: { ...etat, annonce: true },
            messages: [
              texte(
                vers,
                "10 articles attendent déjà — publiez-les d'abord, puis renvoyez cette photo.",
              ),
              carteRafale(vers, etat.brouillons),
            ],
          };
        }
        /* Meme regle qu'a l'ouverture de la rafale : 👍 avec wamid, carte sans. */
        return entree.messageId
          ? {
              etat: { nom: "rafale", brouillons: ajout.brouillons },
              messages: [reaction(vers, entree.messageId, "👍")],
            }
          : {
              etat: { nom: "rafale", brouillons: ajout.brouillons, annonce: true },
              messages: [carteRafale(vers, ajout.brouillons)],
            };
      }

      const idBouton = entree.genre === "bouton" ? (entree.id ?? "") : "";
      const texteTape = entree.genre === "texte" ? (entree.texte ?? "") : "";

      /* « corriger le 2 » — bouton ou texte : UN brouillon rouvert. */
      const nCorrige = idBouton.startsWith("corriger:")
        ? Number(idBouton.slice("corriger:".length))
        : lireCorrectionRafale(texteTape);
      if (nCorrige && nCorrige >= 1 && nCorrige <= etat.brouillons.length) {
        return {
          etat: { nom: "rafale_correction", n: nCorrige, brouillons: etat.brouillons },
          messages: [
            texte(
              vers,
              questionCorrectionRafale(nCorrige, etat.brouillons[nCorrige - 1] as BrouillonRafale),
            ),
          ],
        };
      }

      if (idBouton === "tout_publier" || demandeToutPublier(texteTape)) {
        const incomplets = brouillonsIncomplets(etat.brouillons);
        if (incomplets.length > 0) {
          /* On n'invente pas un nom (§7.7) : rien ne part tant qu'un
             brouillon n'en a pas. Le numero a corriger est NOMME. */
          return {
            etat: { ...etat, annonce: true },
            messages: [carteRafale(vers, etat.brouillons)],
          };
        }
        return {
          etat: null,
          messages: [],
          effet: {
            type: "publier_rafale",
            brouillons: etat.brouillons.map((b) => ({
              nom: b.nom as string,
              prixXaf: b.prixXaf as number,
              mediaId: b.mediaId,
            })),
          },
        };
      }

      /* Tout le reste — le « Publier » perime de la carte unitaire compris :
         la carte recapitulative se (re)montre, rien ne se decide a sa place. */
      return { etat: { ...etat, annonce: true }, messages: [carteRafale(vers, etat.brouillons)] };
    }

    case "rafale_correction": {
      const courant = etat.brouillons[etat.n - 1] as BrouillonRafale;
      const corrige = (b: BrouillonRafale): ReactionVendeuse => {
        const brouillons = etat.brouillons.map((x, i) => (i === etat.n - 1 ? b : x));
        return {
          etat: { nom: "rafale", brouillons, annonce: true },
          messages: [carteRafale(vers, brouillons)],
        };
      };
      /* Une photo legendee remplace AUSSI l'image du brouillon. */
      if (entree.genre === "image" && entree.mediaId) {
        const lu = entree.legende ? lireLegendeArticle(entree.legende) : null;
        return corrige({
          nom: lu?.nom ?? courant.nom,
          prixXaf: lu?.prixXaf ?? courant.prixXaf,
          mediaId: entree.mediaId,
          ...(entree.messageId ? { wamid: entree.messageId } : {}),
        });
      }
      if (entree.genre === "texte" && entree.texte) {
        /* Le MEME motif que la legende (ADR 0035) : le prix est le dernier
           groupe de chiffres, le nom est le reste. On ne le reecrit pas. */
        const lu = lireLegendeArticle(entree.texte);
        if (lu) return corrige({ ...courant, nom: lu.nom, prixXaf: lu.prixXaf });
      }
      return { etat, messages: [texte(vers, questionCorrectionRafale(etat.n, courant))] };
    }
  }
}
