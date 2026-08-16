/**
 * Le harnais de simulation — audit du pipeline, 2026-08 (v2).
 *
 * ── Pourquoi il existe ─────────────────────────────────────────────────────
 *
 * L'audit v1 a conclu en LISANT le code ; c'est le défaut n° 3 de son propre
 * bilan : lire une fonction dit ce qu'elle prétend faire, seule une exécution
 * dit ce qu'elle fait. Ce module pilote les machines PURES du bot — les mêmes
 * objets que la production, sans base ni réseau — et rend trois choses :
 *
 * 1. un PILOTE : une suite de gestes entre, la suite des messages émis, les
 *    effets demandés et l'état final sortent ;
 * 2. un ENREGISTREUR : chaque scénario s'écrit en instantané lisible, pour
 *    qu'une régression de copie se voie dans un diff, pas dans une relecture ;
 * 3. un COMPTEUR de couverture : quelles cases (étape × geste) ont été
 *    réellement exercées — le chiffre du rapport, calculé et non déclaré.
 *
 * ── Ce que le harnais REJOUE du service, et ce qu'il ne rejoue pas ─────────
 *
 * L'aiguillage (`aiguiller`) et les trois machines sont appelés tels quels.
 * La mince couche de service que `bot.ts` ajoute autour est REJOUÉE à
 * l'identique quand elle décide du dialogue (démarrage d'inscription,
 * comptoir, `article_nom` pour une vendeuse installée, expirations) et
 * IGNORÉE quand elle touche la base ou le réseau (les effets sont rendus au
 * scénario au lieu d'être exécutés). Chaque écart entre ce harnais et
 * `bot.ts` est un défaut de l'un ou de l'autre — le signaler, jamais le
 * masquer ici.
 *
 * Déterministe par construction : l'horloge est un compteur que le scénario
 * avance, et rien ici ne lit `Date.now()` ni le réseau (« domaine-pur »
 * balaie aussi ce fichier).
 */

import { analyserSms } from "../../proof/motifs.ts";
import { aiguiller, type Fil } from "../aiguillage.ts";
import { COMPTOIR_DEPART, demandeComptoir } from "../comptoir-vendeuse.ts";
import {
  type BoutiqueBot,
  type BoutiqueVendeuse,
  type CommandeOuverte,
  type ContexteAcheteuse,
  type EffetBot,
  type Entree,
  ETAT_INITIAL,
  type EtatConv,
  etatApresInactivite,
  extraireSlugBoutique,
  reagirAcheteuse,
  reagirVendeuse,
  type StatutDerniereCommande,
} from "../conversation.ts";
import { genreDuJeton } from "../flux.ts";
import {
  demandeInscription,
  type EffetVendeuse,
  type EtatVendeuse,
  etatVendeuseApresInactivite,
  PREMIERE_QUESTION,
  questionDeLEtat,
  reagirInscription,
} from "../inscription.ts";
import { type MessageSortant, texte as messageTexte } from "../messages.ts";
import type { Langue } from "../textes.ts";

/* ────────────────────────── les fixtures ────────────────────────────────── */

export interface FixturesHarnais {
  /** Un compte vendeuse existe pour ce numéro. */
  estVendeuse: boolean;
  /** Les boutiques que le « service » sait résoudre, par slug. */
  boutiques?: Record<string, BoutiqueBot>;
  /** Le contexte du fil vendeuse — ce que le service chargerait. */
  vendeuse?: {
    commandesOuvertes: CommandeOuverte[];
    soldesXaf: number;
    boutique?: BoutiqueVendeuse | null;
  };
  derniereCommande?: StatutDerniereCommande | null;
  /** Identifiants de Flows posés — absents par défaut, comme en production. */
  fluxLivraisonId?: string;
  fluxAvisId?: string;
  fluxOuvertureId?: string;
}

/* ────────────────────────── le journal d'un pas ─────────────────────────── */

export interface PasJoue {
  /** L'état AVANT le pas, celui qui reçoit le geste. */
  machine: "acheteuse" | "inscription" | "vendeuse";
  etatAvant: string;
  genre: Entree["genre"];
  /** L'étiquette lisible du geste, pour l'instantané. */
  geste: string;
  fil: Fil;
  messages: MessageSortant[];
  effet?: EffetBot | EffetVendeuse;
  etatApres: string;
}

/** La case exercée, pour le compteur : `machine:état × genre`. */
export interface CaseExercee {
  machine: PasJoue["machine"];
  etat: string;
  genre: Entree["genre"];
}

/* ────────────────────────── le pilote ───────────────────────────────────── */

export class Pilote {
  private conv: EtatConv = ETAT_INITIAL;
  private vend: EtatVendeuse | null = null;
  private langue: Langue | undefined;
  private horlogeMs = 0;
  private dernierContactMs = 0;
  readonly journal: PasJoue[] = [];

  constructor(private readonly fixtures: FixturesHarnais) {}

  etatConv(): EtatConv {
    return this.conv;
  }
  etatVendeuse(): EtatVendeuse | null {
    return this.vend;
  }

  /**
   * Sème un état que seul le SERVICE sait atteindre — `reversement_code` se
   * pose après une émission d'OTP (base et réseau, hors harnais, ADR 0097).
   * Le point de départ est semé ; les gestes restent joués par les machines
   * réelles, comme partout.
   */
  poserEtatVendeuse(etat: EtatVendeuse): void {
    this.vend = etat;
  }

  /**
   * Joue UN geste. `avanceMs` sépare ce geste du précédent — 60 s par défaut,
   * le rythme d'une conversation ; 25 h rejoue « reprise après la fenêtre ».
   */
  jouer(entree: Entree, options: { avanceMs?: number; etiquette?: string } = {}): PasJoue {
    this.horlogeMs += options.avanceMs ?? 60_000;
    const age = this.horlogeMs - this.dernierContactMs;
    this.dernierContactMs = this.horlogeMs;

    /* Les expirations, comme le service les applique à la relecture. */
    this.conv = etatApresInactivite(this.conv, age);
    this.vend = this.vend ? etatVendeuseApresInactivite(this.vend, age) : null;

    const texteBrut = entree.genre === "texte" ? entree.texte : "";
    const smsReconnu = entree.genre === "texte" && analyserSms(texteBrut).reconnu;
    const fil = aiguiller(
      {
        genre: entree.genre,
        ...(entree.genre === "texte" ? { texte: entree.texte } : {}),
        ...(entree.genre === "bouton" || entree.genre === "liste" ? { id: entree.id } : {}),
      },
      {
        estVendeuse: this.fixtures.estVendeuse,
        etatVendeuseEnCours: this.vend !== null,
        smsReconnu,
        achatEnCours: this.conv.nom !== "accueil",
        formulaireArticle: entree.genre === "flux" && genreDuJeton(entree.reponse) === "article",
        formulaireReversement:
          entree.genre === "flux" && genreDuJeton(entree.reponse) === "reversement",
      },
    );

    const machine: PasJoue["machine"] =
      fil === "acheteuse" ? "acheteuse" : fil === "inscription" ? "inscription" : "vendeuse";
    const etatAvant = machine === "acheteuse" ? this.conv.nom : (this.vend?.nom ?? "(repos)");

    let messages: MessageSortant[] = [];
    let effet: EffetBot | EffetVendeuse | undefined;

    /* Comme bot.ts (entreePourMachine) : les fils vendeuse et inscription ne
       reçoivent jamais un Flow, une localisation ni un panier natif entiers —
       dégradés en « forme non lue ». Seul le fil acheteuse les lit tels quels. */
    const pourMachine: Exclude<
      Entree,
      { genre: "flux" } | { genre: "localisation" } | { genre: "commande" }
    > =
      entree.genre === "flux" || entree.genre === "commande"
        ? {
            genre: "autre",
            forme: "inconnue",
            ...(entree.messageId ? { messageId: entree.messageId } : {}),
          }
        : entree.genre === "localisation"
          ? {
              genre: "autre",
              forme: "localisation",
              ...(entree.messageId ? { messageId: entree.messageId } : {}),
            }
          : entree;

    if (fil === "acheteuse") {
      const r = reagirAcheteuse(this.conv, entree, this.contexteAcheteuse(texteBrut));
      this.conv = r.etat;
      messages = r.messages;
      effet = r.effet;
      if (r.langue) this.langue = r.langue;
    } else if (fil === "inscription") {
      const r = this.filInscription(pourMachine, texteBrut);
      messages = r.messages;
      effet = r.effet;
    } else {
      const r = reagirVendeuse(pourMachine, VERS, {
        smsReconnu,
        commandesOuvertes: this.fixtures.vendeuse?.commandesOuvertes ?? [],
        soldesXaf: this.fixtures.vendeuse?.soldesXaf ?? 0,
        boutique: this.fixtures.vendeuse?.boutique ?? null,
      });
      /* Le fil vendeuse rend toujours ETAT_INITIAL — il est sans mémoire. */
      messages = r.messages;
      effet = r.effet;
      /* L'effet « aller_boutique » du fil inscription passe par ici aussi. */
    }

    const pas: PasJoue = {
      machine,
      etatAvant,
      genre: entree.genre,
      geste: options.etiquette ?? etiquetteDe(entree),
      fil,
      messages,
      ...(effet ? { effet } : {}),
      etatApres: machine === "acheteuse" ? this.conv.nom : (this.vend?.nom ?? "(repos)"),
    };
    this.journal.push(pas);
    COUVERTURE.add(`${machine}:${etatAvant}:${entree.genre}`);
    return pas;
  }

  /**
   * La mince couche de service autour de `reagirInscription`, rejouée depuis
   * `bot.ts` (filInscription) : le démarrage quand aucun état n'existe.
   */
  private filInscription(
    entree: Exclude<Entree, { genre: "flux" } | { genre: "localisation" } | { genre: "commande" }>,
    texteBrut: string,
  ): { messages: MessageSortant[]; effet?: EffetVendeuse } {
    if (!this.vend) {
      const sellerId = this.fixtures.estVendeuse ? "seller-1" : null;
      if (sellerId && entree.genre === "texte" && demandeComptoir(texteBrut)) {
        this.vend = { nom: "comptoir", comptoir: COMPTOIR_DEPART };
        return { messages: [questionDeLEtat(this.vend, VERS)] };
      }
      if (sellerId) {
        /* Comme bot.ts:614-637 : une vendeuse installée SANS état en cours
           reçoit la QUESTION et l'entrée s'arrête là — sauf une PHOTO, qui
           traverse jusqu'à la machine (légendée, c'est déjà l'article).
           La première version du harnais faisait continuer TOUTE entrée :
           cette infidélité a produit le faux constat D6 de l'audit, attrapé
           par la vérification adverse. */
        this.vend = { nom: "article_nom" };
        if (entree.genre !== "image") {
          return { messages: [questionDeLEtat(this.vend, VERS)] };
        }
        const r = reagirInscription(this.vend, entree, VERS);
        this.vend = r.etat;
        return { messages: r.messages, ...(r.effet ? { effet: r.effet } : {}) };
      }
      const demande = entree.genre === "texte" ? demandeInscription(texteBrut) : {};
      this.vend = {
        nom: "inscription_nom",
        ...(demande?.parrain ? { parrain: demande.parrain } : {}),
      };
      return { messages: [messageTexte(VERS, PREMIERE_QUESTION)] };
    }
    const r = reagirInscription(this.vend, entree, VERS);
    this.vend = r.etat;
    return { messages: r.messages, ...(r.effet ? { effet: r.effet } : {}) };
  }

  private contexteAcheteuse(texteBrut: string): ContexteAcheteuse {
    /* Le service résout la boutique du slug du message, sinon de l'état. */
    const slug =
      (texteBrut ? extraireSlugBoutique(texteBrut) : null) ??
      ("slug" in this.conv ? (this.conv as { slug: string }).slug : null);
    return {
      vers: VERS,
      boutique: (slug && this.fixtures.boutiques?.[slug]) || null,
      derniereCommande: this.fixtures.derniereCommande ?? null,
      ...(this.langue ? { langue: this.langue } : {}),
      ...(this.fixtures.fluxLivraisonId ? { fluxLivraisonId: this.fixtures.fluxLivraisonId } : {}),
      ...(this.fixtures.fluxAvisId ? { fluxAvisId: this.fixtures.fluxAvisId } : {}),
    };
  }
}

const VERS = "237690000001";

/* ────────────────────────── l'enregistreur ──────────────────────────────── */

function etiquetteDe(entree: Entree): string {
  switch (entree.genre) {
    case "texte":
      return `« ${entree.texte.length > 64 ? `${entree.texte.slice(0, 61)}…` : entree.texte} »`;
    case "bouton":
      return `[bouton ${entree.id}]`;
    case "liste":
      return `[liste ${entree.id}]`;
    case "image":
      return `[photo${entree.legende ? ` « ${entree.legende} »` : " sans légende"}]`;
    case "localisation":
      return `[position ${entree.lat},${entree.lng}]`;
    case "autre":
      return `[${entree.forme}]`;
    case "flux":
      return "[réponse de formulaire]";
    case "commande":
      return `[panier natif : ${entree.lignes.map((l) => `${l.articleId}×${l.quantite}`).join(", ")}]`;
  }
}

/** Un message sortant (forme Meta brute), rendu lisible pour l'instantané. */
export function rendreMessage(m: MessageSortant): string {
  switch (m.type) {
    case "text":
      return `texte: ${m.text.body}`;
    case "reaction":
      return `réaction ${m.reaction.emoji} (sur le message cité)`;
    case "image":
      return `image: ${m.image.caption ?? "(sans légende)"}`;
    case "template":
      return `gabarit ${m.template.name}`;
    case "interactive": {
      const i = m.interactive;
      if (i.type === "button") {
        return `boutons[${i.action.buttons.map((b) => b.reply.id).join(" | ")}]: ${i.body.text}`;
      }
      if (i.type === "list") {
        const ids = i.action.sections.flatMap((s) => s.rows.map((r) => r.id));
        return `liste[${ids.join(" | ")}]: ${i.body.text}`;
      }
      if (i.type === "flow") {
        return `formulaire « ${i.action.parameters.flow_cta} »: ${i.body.text}`;
      }
      return `demande de position: ${i.body.text}`;
    }
  }
}

/**
 * L'instantané d'un scénario : chaque pas, ses messages, son effet. Écrit
 * pour être diffé — une copie qui change se voit à la ligne près.
 */
export function instantane(pilote: Pilote): string {
  const lignes: string[] = [];
  for (const [i, pas] of pilote.journal.entries()) {
    lignes.push(`── pas ${i + 1} · ${pas.machine}/${pas.etatAvant} ── ${pas.geste}`);
    if (pas.messages.length === 0) {
      lignes.push(pas.effet ? "   (aucun message — effet seul)" : "   ⚠ MUET");
    }
    for (const m of pas.messages) {
      lignes.push(`   ← ${rendreMessage(m)}`);
    }
    if (pas.effet) lignes.push(`   ⚙ effet: ${JSON.stringify(pas.effet)}`);
    if (pas.etatApres !== pas.etatAvant) lignes.push(`   → état: ${pas.etatApres}`);
  }
  return `${lignes.join("\n")}\n`;
}

/* ────────────────────────── le compteur ─────────────────────────────────── */

/**
 * Les cases exercées, tous tests confondus. Un `Set` module : les fichiers de
 * test du même processus y versent, et `tableauCouverture` lit le total.
 */
export const COUVERTURE = new Set<string>();

/** Les gestes qu'une case peut recevoir — la dimension de la matrice. */
export const GENRES_JOUABLES = [
  "texte",
  "bouton",
  "liste",
  "image",
  "flux",
  "localisation",
  "autre",
] as const;

/** Les états de chaque machine — la seconde dimension. */
export const ETATS_MACHINE: Record<PasJoue["machine"], readonly string[]> = {
  acheteuse: [
    "accueil",
    "catalogue",
    "quantite",
    "ajout",
    "mode",
    "ville",
    "details",
    "recap",
    "avis_mot",
  ],
  inscription: [
    "inscription_nom",
    "inscription_ville",
    "article_nom",
    "article_prix",
    "article_photo",
    "article_confirme",
    "comptoir",
    /* La rafale — ADR 0096 : un service neuf entre dans la matrice des son
       lot (regle de l'ADR 0095). */
    "rafale",
    "rafale_correction",
    /* Le code de reversement attendu — ADR 0097, meme regle. */
    "reversement_code",
  ],
  /* Le fil vendeuse est sans état : une seule ligne, le repos. */
  vendeuse: ["(repos)"],
};

export interface LigneCouverture {
  machine: string;
  possibles: number;
  exercees: number;
  pourcent: number;
  manquantes: string[];
}

export function tableauCouverture(): LigneCouverture[] {
  const lignes: LigneCouverture[] = [];
  for (const machine of Object.keys(ETATS_MACHINE) as Array<PasJoue["machine"]>) {
    const etats = ETATS_MACHINE[machine];
    const manquantes: string[] = [];
    let exercees = 0;
    for (const etat of etats) {
      for (const genre of GENRES_JOUABLES) {
        if (COUVERTURE.has(`${machine}:${etat}:${genre}`)) exercees += 1;
        else manquantes.push(`${etat}×${genre}`);
      }
    }
    const possibles = etats.length * GENRES_JOUABLES.length;
    lignes.push({
      machine,
      possibles,
      exercees,
      pourcent: Math.round((exercees / possibles) * 100),
      manquantes,
    });
  }
  return lignes;
}
