import { type GenreFlux, jetonFlux } from "../../domain/bot/flux.ts";

/**
 * Le vocabulaire de gestes du harnais — audit de pipeline, phase 2.
 *
 * ── Pourquoi une liste FERMEE ─────────────────────────────────────────────
 *
 * L'audit precedent declarait des couches « couvertes » sans compter. Un
 * chiffre de couverture n'a de sens que si le denominateur est pose d'avance :
 * ces vingt-deux familles SONT le denominateur, et elles ne se completent pas
 * en cours de route pour faire monter un pourcentage.
 *
 * Elles ne sont pas choisies par gout. Chacune correspond a un geste qu'une
 * vendeuse ou une acheteuse fait reellement sur WhatsApp, et que le bot doit
 * donc encaisser :
 *
 * - les cinq premieres sont du TEXTE, parce que le texte est ce qui arrive le
 *   plus et ce qui se predit le moins — faute de frappe, accents absents
 *   (clavier telephone), anglais (AGENTS.md : les operateurs eux-memes ecrivent
 *   dans les deux langues), pidgin ;
 * - `bouton_ancien` existe parce qu'un fil WhatsApp ne se referme jamais : le
 *   bouton d'un message d'il y a trois jours reste appuyable, et il arrive dans
 *   un etat qui ne l'attend plus ;
 * - `vocal`, `sticker`, `document` sont les formes que le bot ne sait PAS lire
 *   (ADR 0049) ; le vocal vient en tete parce que c'est le geste d'une vendeuse
 *   qui tape lentement, et c'etait la sortie muette du produit ;
 * - `silence` et `reprise_25h` ne sont pas des messages : ce sont des ABSENCES,
 *   et l'absence est ce qu'aucun test de fonction ne mesure. La reprise passe la
 *   fenetre de 24 h de `INACTIVITE_MAX_MS`, deliberement — 25, pas 23 ;
 * - `double_envoi` rejoue la MEME livraison, avec le meme identifiant : c'est
 *   la relivraison de Meta (ADR 0040), pas un second message.
 *
 * Module PUR : aucun acces base, aucune horloge. Il fabrique des livraisons.
 */

export type FamilleGeste =
  | "texte_juste"
  | "texte_faute"
  | "texte_sans_accents"
  | "anglais"
  | "pidgin"
  | "bouton_attendu"
  | "bouton_ancien"
  | "ligne_liste"
  | "flux_valide"
  | "flux_tronque"
  | "photo"
  | "photo_legendee"
  | "vocal"
  | "sticker"
  | "document"
  | "localisation"
  | "hors_sujet"
  | "silence"
  | "double_envoi"
  | "retour_arriere"
  | "abandon"
  | "reprise_25h";

/** L'ordre est celui du prompt d'audit, §3. Il sert de colonne de tableau. */
export const FAMILLES: readonly FamilleGeste[] = [
  "texte_juste",
  "texte_faute",
  "texte_sans_accents",
  "anglais",
  "pidgin",
  "bouton_attendu",
  "bouton_ancien",
  "ligne_liste",
  "flux_valide",
  "flux_tronque",
  "photo",
  "photo_legendee",
  "vocal",
  "sticker",
  "document",
  "localisation",
  "hors_sujet",
  "silence",
  "double_envoi",
  "retour_arriere",
  "abandon",
  "reprise_25h",
];

/**
 * Les INTENTIONS du §3 — ce que la personne cherche a faire, independamment de
 * la forme de son geste.
 *
 * Elles ne sont pas une seconde dimension du tableau de couverture : une
 * intention n'est pas observable dans une livraison Meta, elle est dans la tete
 * de la personne. Elles servent a ETIQUETER un scenario, pour qu'on puisse dire
 * « aucun scenario ne teste "joindre un humain" a l'etape details » — ce qui
 * est un trou d'audit, pas un trou de code.
 */
export type Intention =
  | "avancer"
  | "corriger"
  | "revenir"
  | "abandonner"
  | "comprendre"
  | "verifier_serieux"
  | "joindre_humain"
  | "recommencer";

export const INTENTIONS: readonly Intention[] = [
  "avancer",
  "corriger",
  "revenir",
  "abandonner",
  "comprendre",
  "verifier_serieux",
  "joindre_humain",
  "recommencer",
];

/**
 * Un geste joue par le harnais.
 *
 * `attente` est en MILLISECONDES et s'applique AVANT la livraison : c'est ainsi
 * que `silence` et `reprise_25h` se disent sans horloge implicite. Le temps
 * arrive en parametre, comme partout dans ce depot.
 */
export interface Geste {
  famille: FamilleGeste;
  /** Ce que la personne cherchait a faire. Etiquette, jamais un comportement. */
  intention: Intention;
  /** Millisecondes ecoulees avant ce geste. Zero par defaut. */
  attente?: number;
  /**
   * La livraison a pousser. Absente pour `silence` : le temps passe, rien
   * n'arrive — et c'est precisement le cas que le produit doit encaisser.
   */
  livraison?: (de: string, messageId: string) => unknown;
  /** Rejoue la livraison PRECEDENTE, identifiant compris — ADR 0040. */
  rejeu?: boolean;
  /** Ce que le geste represente, en clair, pour l'instantane. */
  libelle: string;
}

/* ────────────────────────── formes de livraison ─────────────────────────── */

/**
 * L'enveloppe Cloud API — `entry[].changes[].value.messages[]`.
 *
 * C'est la forme de PRODUCTION (Meta directe et 360dialog). Le parseur lit
 * aussi la forme plate du bac a sable, et les tests existants l'utilisent ;
 * le harnais prend la forme de production a dessein — un audit qui mesure le
 * bac a sable ne mesure pas ce qui tourne devant les vendeuses.
 */
function enveloppe(message: Record<string, unknown>): unknown {
  return { entry: [{ changes: [{ value: { messages: [message] } }] }] };
}

const base = (de: string, messageId: string) => ({ from: de, id: messageId });

export function livraisonTexte(corps: string) {
  return (de: string, messageId: string) =>
    enveloppe({ ...base(de, messageId), type: "text", text: { body: corps } });
}

export function livraisonBouton(id: string) {
  return (de: string, messageId: string) =>
    enveloppe({
      ...base(de, messageId),
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id } },
    });
}

export function livraisonListe(id: string) {
  return (de: string, messageId: string) =>
    enveloppe({
      ...base(de, messageId),
      type: "interactive",
      interactive: { type: "list_reply", list_reply: { id } },
    });
}

export function livraisonFlux(reponse: string) {
  return (de: string, messageId: string) =>
    enveloppe({
      ...base(de, messageId),
      type: "interactive",
      interactive: { type: "nfm_reply", nfm_reply: { response_json: reponse } },
    });
}

export function livraisonImage(mediaId: string, legende?: string) {
  return (de: string, messageId: string) =>
    enveloppe({
      ...base(de, messageId),
      type: "image",
      image: { id: mediaId, ...(legende ? { caption: legende } : {}) },
    });
}

export function livraisonLocalisation(lat: number, lng: number) {
  return (de: string, messageId: string) =>
    enveloppe({
      ...base(de, messageId),
      type: "location",
      location: { latitude: lat, longitude: lng },
    });
}

/** Une forme que le bot ne sait pas lire — ADR 0049. */
export function livraisonForme(type: "audio" | "sticker" | "document" | "video" | "contacts") {
  return (de: string, messageId: string) =>
    enveloppe({ ...base(de, messageId), type, [type]: { id: "media-non-lu" } });
}

/* ────────────────────────── constructeurs de gestes ─────────────────────── */

const MINUTE = 60_000;
export const VINGT_CINQ_HEURES = 25 * 60 * 60 * 1000;

export function texteJuste(corps: string, intention: Intention = "avancer"): Geste {
  return {
    famille: "texte_juste",
    intention,
    livraison: livraisonTexte(corps),
    libelle: `texte « ${corps} »`,
  };
}

export function texteFaute(corps: string, intention: Intention = "avancer"): Geste {
  return {
    famille: "texte_faute",
    intention,
    livraison: livraisonTexte(corps),
    libelle: `texte mal orthographié « ${corps} »`,
  };
}

export function texteSansAccents(corps: string, intention: Intention = "avancer"): Geste {
  return {
    famille: "texte_sans_accents",
    intention,
    livraison: livraisonTexte(corps),
    libelle: `texte sans accents « ${corps} »`,
  };
}

export function anglais(corps: string, intention: Intention = "avancer"): Geste {
  return {
    famille: "anglais",
    intention,
    livraison: livraisonTexte(corps),
    libelle: `anglais « ${corps} »`,
  };
}

/**
 * Le pidgin est ECRIT et NON SERVI — ADR 0034, `PIDGIN_RELU = false`.
 *
 * Le harnais l'ENVOIE quand meme, et c'est le point : ce qui est ferme, c'est
 * la SORTIE en pidgin, pas l'entree. Une acheteuse ecrit en kamtok aujourd'hui,
 * et ce qu'elle recoit en retour doit rester comprehensible. Ce geste mesure
 * ca, il n'ouvre rien.
 */
export function pidgin(corps: string, intention: Intention = "avancer"): Geste {
  return {
    famille: "pidgin",
    intention,
    livraison: livraisonTexte(corps),
    libelle: `pidgin « ${corps} »`,
  };
}

export function bouton(id: string, intention: Intention = "avancer"): Geste {
  return {
    famille: "bouton_attendu",
    intention,
    livraison: livraisonBouton(id),
    libelle: `bouton « ${id} »`,
  };
}

/**
 * Le bouton d'un message ANCIEN. Un fil WhatsApp ne se referme pas : l'appui
 * arrive dans un etat qui ne l'attend plus, parfois des jours apres.
 */
export function boutonAncien(id: string, intention: Intention = "revenir"): Geste {
  return {
    famille: "bouton_ancien",
    intention,
    attente: 5 * MINUTE,
    livraison: livraisonBouton(id),
    libelle: `bouton d'un message ancien « ${id} »`,
  };
}

export function ligneListe(id: string, intention: Intention = "avancer"): Geste {
  return {
    famille: "ligne_liste",
    intention,
    livraison: livraisonListe(id),
    libelle: `ligne de liste « ${id} »`,
  };
}

export function fluxValide(genre: GenreFlux, charge: Record<string, unknown>): Geste {
  return {
    famille: "flux_valide",
    intention: "avancer",
    livraison: livraisonFlux(JSON.stringify({ flow_token: jetonFlux(genre), ...charge })),
    libelle: `formulaire ${genre} complet`,
  };
}

/**
 * Un Flow TRONQUE — le jeton est la, les champs manquent.
 *
 * C'est le cas qui compte : une reponse illisible ne doit pas faire echouer le
 * travail en cours, seulement rendre la main a la question. Une reponse SANS
 * jeton ne serait pas un formulaire tronque, ce serait un autre message.
 */
export function fluxTronque(genre: GenreFlux): Geste {
  return {
    famille: "flux_tronque",
    intention: "avancer",
    livraison: livraisonFlux(JSON.stringify({ flow_token: jetonFlux(genre) })),
    libelle: `formulaire ${genre} tronqué`,
  };
}

export function photo(mediaId = "media-photo"): Geste {
  return {
    famille: "photo",
    intention: "avancer",
    livraison: livraisonImage(mediaId),
    libelle: "photo sans légende",
  };
}

export function photoLegendee(legende: string, mediaId = "media-photo-legendee"): Geste {
  return {
    famille: "photo_legendee",
    intention: "avancer",
    livraison: livraisonImage(mediaId, legende),
    libelle: `photo légendée « ${legende} »`,
  };
}

export function vocal(): Geste {
  return {
    famille: "vocal",
    intention: "avancer",
    livraison: livraisonForme("audio"),
    libelle: "message vocal",
  };
}

export function sticker(): Geste {
  return {
    famille: "sticker",
    intention: "comprendre",
    livraison: livraisonForme("sticker"),
    libelle: "sticker",
  };
}

export function document(): Geste {
  return {
    famille: "document",
    intention: "avancer",
    livraison: livraisonForme("document"),
    libelle: "document joint",
  };
}

/** Douala, Bonapriso — un point reel, pas un zero deguise. */
export function localisation(lat = 4.0383, lng = 9.7089): Geste {
  return {
    famille: "localisation",
    intention: "avancer",
    livraison: livraisonLocalisation(lat, lng),
    libelle: `position (${lat}, ${lng})`,
  };
}

export function horsSujet(corps: string): Geste {
  return {
    famille: "hors_sujet",
    intention: "comprendre",
    livraison: livraisonTexte(corps),
    libelle: `hors-sujet « ${corps} »`,
  };
}

/**
 * Le SILENCE. Rien n'est envoye ; seul le temps passe.
 *
 * C'est le geste que l'audit v1 n'a jamais joue, et c'est celui qui revele la
 * famille de defauts « muet » : apres cette attente, la personne n'a RIEN recu,
 * et la question est de savoir si le produit a prevu quelque chose.
 */
export function silence(minutes = 30): Geste {
  return {
    famille: "silence",
    intention: "comprendre",
    attente: minutes * MINUTE,
    libelle: `silence de ${minutes} min`,
  };
}

/** La relivraison de Meta : meme identifiant, meme charge — ADR 0040. */
export function doubleEnvoi(): Geste {
  return {
    famille: "double_envoi",
    intention: "avancer",
    rejeu: true,
    libelle: "relivraison du même message",
  };
}

export function retourArriere(corps = "retour"): Geste {
  return {
    famille: "retour_arriere",
    intention: "revenir",
    livraison: livraisonTexte(corps),
    libelle: `retour en arrière « ${corps} »`,
  };
}

export function abandon(corps = "annuler"): Geste {
  return {
    famille: "abandon",
    intention: "abandonner",
    livraison: livraisonTexte(corps),
    libelle: `abandon « ${corps} »`,
  };
}

/**
 * La reprise APRES la fenetre — 25 h, pas 23.
 *
 * `INACTIVITE_MAX_MS` vaut 24 h : ce geste tombe de l'autre cote, la ou l'etat
 * doit avoir perime. C'est la seule facon de verifier que la peremption existe
 * autrement qu'en lisant la constante.
 */
export function reprise25h(corps = "bonjour"): Geste {
  return {
    famille: "reprise_25h",
    intention: "recommencer",
    attente: VINGT_CINQ_HEURES,
    livraison: livraisonTexte(corps),
    libelle: `reprise après 25 h « ${corps} »`,
  };
}
