/**
 * ── LE HARNAIS — piloter les machines, au lieu de les lire ────────────────
 *
 * Ce fichier existe parce qu'un audit precedent a conclu en LISANT le code,
 * et s'est trompe. Lire une fonction dit ce qu'elle PRETEND faire ; seule une
 * execution dit ce qu'elle fait.
 *
 * Les machines du domaine sont pures (AGENTS.md §4) : ni base, ni reseau, ni
 * horloge implicite. Elles se pilotent donc integralement ici, sans rien
 * simuler d'autre que le pouce de la personne.
 *
 * Trois pieces, et chacune ferme un defaut de l'audit v1 :
 *
 * 1. **Le pilote** joue une suite de gestes et rend ce qui SORT — les
 *    messages, l'etat final, les effets demandes. C'est la reponse au defaut
 *    « lecture prise pour verification ».
 * 2. **Le rendu** normalise chaque message en texte lisible, pour qu'une
 *    regression de copie se voie dans un diff au lieu d'une relecture.
 * 3. **Le compteur** enregistre les cases reellement exercees. C'est la
 *    reponse au defaut « couverture declaree, pas mesuree » : le rapport ne
 *    porte plus une affirmation, il porte un chiffre.
 *
 * Le harnais n'affirme RIEN de lui-meme. Il rend des faits ; ce sont les
 * tests qui jugent.
 */

import {
  type Entree,
  ETAT_INITIAL as ETAT_ACHETEUSE_INITIAL,
  type EtatConv,
  reagirAcheteuse,
  reagirVendeuse,
} from "../conversation.ts";
import type { FormeNonLue } from "../entrees.ts";
import { type EtatVendeuse, reagirInscription } from "../inscription.ts";
import type { MessageSortant } from "../messages.ts";

/* ───────────────────────────── les gestes ──────────────────────────────── */

/**
 * Le vocabulaire du pouce. Chaque constructeur porte son ETIQUETTE de
 * couverture : c'est elle qu'on compte, pas la valeur — « texte » et « texte
 * sans accents » sont deux cases distinctes, et c'est tout l'interet.
 */
export interface Geste {
  /** L'etiquette de couverture — ce qui est compte. */
  readonly genre: string;
  /** Ce que la machine recoit. `null` pour le silence : rien n'est envoye. */
  readonly entree: Entree | null;
  /** Ce qu'on lit dans la transcription. */
  readonly libelle: string;
}

const geste = (genre: string, entree: Entree | null, libelle: string): Geste => ({
  genre,
  entree,
  libelle,
});

export const t = (texte: string): Geste =>
  geste("texte", { genre: "texte", texte }, `texte « ${texte} »`);

/** Le meme texte, sans accents — une saisie de telephone bas de gamme. */
export const tSansAccents = (texte: string): Geste => {
  const nu = texte.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return geste("texte-sans-accents", { genre: "texte", texte: nu }, `texte nu « ${nu} »`);
};

/** Une faute de frappe : on echange deux lettres au milieu. */
export const tFaute = (texte: string): Geste => {
  const i = Math.max(1, Math.floor(texte.length / 2));
  const abime =
    texte.length > 3 ? texte.slice(0, i - 1) + texte[i] + texte[i - 1] + texte.slice(i + 1) : texte;
  return geste("texte-faute", { genre: "texte", texte: abime }, `faute « ${abime} »`);
};

export const tAnglais = (texte: string): Geste =>
  geste("texte-anglais", { genre: "texte", texte }, `anglais « ${texte} »`);

export const b = (id: string): Geste => geste("bouton", { genre: "bouton", id }, `bouton [${id}]`);

export const l = (id: string): Geste => geste("liste", { genre: "liste", id }, `liste [${id}]`);

export const img = (mediaId: string, legende?: string): Geste =>
  geste(
    legende ? "image-legendee" : "image",
    { genre: "image", mediaId, ...(legende ? { legende } : {}) },
    legende ? `photo « ${legende} »` : "photo",
  );

export const flux = (reponse: string): Geste =>
  geste("flux", { genre: "flux", reponse }, `flux ${reponse.slice(0, 40)}`);

/** Une reponse de Flow TRONQUEE — le reseau a coupe au milieu du JSON. */
export const fluxTronque = (reponse: string): Geste =>
  geste(
    "flux-tronque",
    { genre: "flux", reponse: reponse.slice(0, Math.floor(reponse.length / 2)) },
    "flux tronqué",
  );

export const loc = (lat: number, lng: number): Geste =>
  geste("localisation", { genre: "localisation", lat, lng }, `point ${lat},${lng}`);

export const autre = (forme: FormeNonLue): Geste =>
  geste(`forme-${forme}`, { genre: "autre", forme }, `forme non lue : ${forme}`);

/**
 * LE SILENCE — elle ne repond rien.
 *
 * Ce n'est pas un geste vide : c'est le geste le plus frequent du produit, et
 * celui qu'aucun test n'exercait. Le pilote ne transmet RIEN a la machine, et
 * la transcription montre que l'etat n'a pas bouge — ce qui rend visible une
 * conversation abandonnee dans un etat sans issue.
 */
export const silence = (): Geste => geste("silence", null, "— silence —");

/* ───────────────────────── le rendu, lisible ───────────────────────────── */

interface FormeMessage {
  type?: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    body?: { text?: string };
    footer?: { text?: string };
    action?: {
      buttons?: Array<{ reply?: { id?: string; title?: string } }>;
      button?: string;
      sections?: Array<{ rows?: Array<{ id?: string; title?: string; description?: string }> }>;
      name?: string;
      parameters?: Record<string, unknown>;
    };
  };
  image?: { link?: string; caption?: string };
  reaction?: { emoji?: string };
  template?: { name?: string };
}

/**
 * Un message, en une ou plusieurs lignes lisibles.
 *
 * Le format est stable et volontairement pauvre : c'est ce qui rend un diff
 * d'instantane utile. On garde les IDENTIFIANTS des boutons et des lignes —
 * ce sont eux qui routent, jamais les libelles (ADR 0031).
 */
export function rendre(m: MessageSortant): string[] {
  const f = m as unknown as FormeMessage;
  if (f.type === "text") return [`TEXTE  ${(f.text?.body ?? "").trim()}`];
  if (f.type === "reaction") return [`RÉACTION  ${f.reaction?.emoji ?? "?"}`];
  if (f.type === "image")
    return [`IMAGE  ${f.image?.caption ? `« ${f.image.caption.trim()} »` : "(sans légende)"}`];
  if (f.type === "template") return [`GABARIT  ${f.template?.name ?? "?"}`];
  if (f.type === "interactive") {
    const i = f.interactive;
    const lignes = [`INTERACTIF(${i?.type ?? "?"})  ${(i?.body?.text ?? "").trim()}`];
    if (i?.footer?.text) lignes.push(`  pied: ${i.footer.text}`);
    for (const bt of i?.action?.buttons ?? []) {
      lignes.push(`  bouton [${bt.reply?.id ?? "?"}] « ${bt.reply?.title ?? ""} »`);
    }
    if (i?.action?.button) lignes.push(`  menu « ${i.action.button} »`);
    for (const s of i?.action?.sections ?? []) {
      for (const r of s.rows ?? []) {
        lignes.push(
          `  ligne [${r.id ?? "?"}] « ${r.title ?? ""} »${r.description ? ` — ${r.description}` : ""}`,
        );
      }
    }
    if (i?.action?.name) lignes.push(`  action ${i.action.name}`);
    return lignes;
  }
  return [`?  ${JSON.stringify(m).slice(0, 120)}`];
}

/* ──────────────────────── le compteur de couverture ─────────────────────── */

/**
 * Les cases exercees, accumulees pendant l'execution.
 *
 * Une case est le couple (etape, genre de geste). C'est la granularite qui
 * compte : « le catalogue repond a un bouton » et « le catalogue repond a un
 * vocal » sont deux questions differentes, et la seconde est celle qui a
 * surpris le produit deux fois.
 *
 * Le registre est un module partage : tous les scenarios d'un MEME fichier de
 * test l'alimentent, et le tableau se lit a la fin. Vitest isole les fichiers
 * entre eux — le rapport de couverture vit donc dans un seul fichier, par
 * construction.
 */
const REGISTRE = new Map<string, Set<string>>();

export function noterCase(etape: string, genre: string): void {
  const cases = REGISTRE.get(etape) ?? new Set<string>();
  cases.add(genre);
  REGISTRE.set(etape, cases);
}

export function reinitialiserCouverture(): void {
  REGISTRE.clear();
}

export interface LigneCouverture {
  etape: string;
  possibles: number;
  exercees: number;
  pourcent: number;
  manquants: string[];
}

/**
 * Le tableau, calcule — jamais declare.
 *
 * `attendus` est la liste des genres qu'une etape DEVRAIT supporter. C'est
 * elle qui fait la difference entre « on a tout essaye » et « on a essaye ce
 * qui nous arrangeait » : le denominateur est fixe d'avance, pas deduit de ce
 * qu'on a joue.
 */
export function couverture(attendus: Record<string, readonly string[]>): LigneCouverture[] {
  return Object.entries(attendus)
    .map(([etape, genres]) => {
      const joues = REGISTRE.get(etape) ?? new Set<string>();
      const manquants = genres.filter((g) => !joues.has(g));
      const exercees = genres.length - manquants.length;
      return {
        etape,
        possibles: genres.length,
        exercees,
        pourcent: genres.length === 0 ? 100 : Math.round((exercees / genres.length) * 100),
        manquants,
      };
    })
    .sort((a, b) => a.pourcent - b.pourcent);
}

/** Le tableau en markdown, pour le rapport — §7 du prompt d'audit. */
export function tableauCouverture(lignes: LigneCouverture[]): string {
  const entete = "| Étape | Cases possibles | Exercées | % | Non exercées |\n|---|---|---|---|---|";
  const corps = lignes
    .map(
      (l) =>
        `| ${l.etape} | ${l.possibles} | ${l.exercees} | ${l.pourcent} % | ${
          l.manquants.length ? l.manquants.join(", ") : "—"
        } |`,
    )
    .join("\n");
  return `${entete}\n${corps}`;
}

/* ──────────────────────────── les pilotes ──────────────────────────────── */

/**
 * ── TROIS natures, et pas deux — trouve EN EXECUTANT le harnais ───────────
 *
 * La premiere version n'en connaissait que deux : « ca repond » ou « c'est
 * muet ». La toute premiere execution a montre un troisieme cas, et il est
 * majeur : une vendeuse colle son SMS de paiement, la machine rend **zero
 * message** et un effet `verifier_sms`. Elle n'est pas muette — elle DELEGUE.
 *
 * Compter ce cas comme « repond » aurait rendu la mesure fausse dans le sens
 * le plus dangereux : rassurante. Le verdict depend alors entierement du
 * service, et c'est LA qu'il faut aller verifier. Le harnais ne peut pas le
 * savoir ; il peut le DIRE.
 */
export type NaturePas = "repond" | "differe" | "muet" | "silence";

export interface Pas {
  geste: string;
  messages: string[];
  etatApres: string;
  effet: string | null;
  nature: NaturePas;
}

export interface Parcours {
  nom: string;
  pas: Pas[];
  /** L'etat final, pour qu'un test puisse conclure sans relire la suite. */
  etatFinal: string;
  /** Un pas sans message ET sans effet — personne ne repondra jamais. */
  aUnPasMuet: boolean;
  /**
   * Un pas qui delegue au service. Ce n'est PAS un defaut ; c'est une dette
   * de verification : la reponse existe peut-etre, hors de portee du harnais.
   */
  pasDifferes: string[];
}

const nommerEtat = (e: unknown): string => {
  if (e === null || e === undefined) return "∅";
  const o = e as { nom?: string };
  return typeof o.nom === "string" ? o.nom : JSON.stringify(e).slice(0, 40);
};

function natureDe(messages: string[], effet: string | null): NaturePas {
  if (messages.length > 0) return "repond";
  return effet ? "differe" : "muet";
}

const nommerEffet = (e: unknown): string | null => {
  if (!e) return null;
  const o = e as { type?: string };
  return typeof o.type === "string" ? o.type : "?";
};

export interface ContexteVendeuseHarnais {
  smsReconnu?: boolean;
  commandesOuvertes?: Parameters<typeof reagirVendeuse>[2]["commandesOuvertes"];
  soldesXaf?: number;
  boutique?: Parameters<typeof reagirVendeuse>[2]["boutique"];
}

/**
 * Pilote le fil VENDEUSE INSTALLEE (`reagirVendeuse`).
 *
 * Cette machine est sans etat persistant : chaque geste part du contexte. Le
 * pilote ne thread donc rien, et c'est fidele au produit.
 */
export function piloterVendeuse(
  nom: string,
  etape: string,
  gestes: readonly Geste[],
  ctx: ContexteVendeuseHarnais = {},
): Parcours {
  const pas: Pas[] = [];
  let muet = false;
  const differes: string[] = [];
  for (const g of gestes) {
    noterCase(etape, g.genre);
    if (!g.entree) {
      pas.push({
        geste: g.libelle,
        messages: [],
        etatApres: "(inchangé)",
        effet: null,
        nature: "silence",
      });
      continue;
    }
    const r = reagirVendeuse(g.entree, "237600000000", {
      smsReconnu: ctx.smsReconnu ?? false,
      commandesOuvertes: ctx.commandesOuvertes ?? [],
      soldesXaf: ctx.soldesXaf ?? 0,
      boutique: ctx.boutique ?? null,
    });
    const messages = r.messages.flatMap(rendre);
    const effet = nommerEffet(r.effet);
    const nature = natureDe(messages, effet);
    if (nature === "muet") muet = true;
    if (nature === "differe") differes.push(`${g.libelle} → ${effet ?? "?"}`);
    pas.push({ geste: g.libelle, messages, etatApres: nommerEtat(r.etat), effet, nature });
  }
  return {
    nom,
    pas,
    etatFinal: pas.at(-1)?.etatApres ?? "∅",
    aUnPasMuet: muet,
    pasDifferes: differes,
  };
}

/** Pilote le fil d'INSCRIPTION — la machine qui porte un etat, geste apres geste. */
export function piloterInscription(
  nom: string,
  etape: string,
  gestes: readonly Geste[],
  depart: EtatVendeuse,
): Parcours {
  const pas: Pas[] = [];
  let etat: EtatVendeuse | null = depart;
  let muet = false;
  const differes: string[] = [];
  for (const g of gestes) {
    noterCase(etape, g.genre);
    if (!g.entree) {
      pas.push({
        geste: g.libelle,
        messages: [],
        etatApres: nommerEtat(etat),
        effet: null,
        nature: "silence",
      });
      continue;
    }
    /* Un etat nul veut dire « sorti du tunnel » : rejouer dessus n'a pas de
       sens, et le dire vaut mieux que de lever. */
    if (etat === null) {
      pas.push({
        geste: g.libelle,
        messages: [],
        etatApres: "∅ (hors tunnel)",
        effet: null,
        nature: "silence",
      });
      continue;
    }
    /**
     * ── Un FAIT que le harnais rend visible ────────────────────────────────
     *
     * Le type d'entree de la machine d'inscription ne connait ni
     * `localisation` ni `flux` : ces deux genres sont interceptes plus haut,
     * dans le service, et n'atteignent jamais cette machine.
     *
     * Le compilateur l'a dit en refusant le harnais. On ne le contourne pas
     * par un cast : on l'ENREGISTRE. Une acheteuse qui envoie un point pendant
     * une inscription, ou un Flow qui arrive dans un etat qui ne l'attend pas,
     * suit un chemin de service — c'est LA qu'il faut aller voir, et la
     * transcription le dit au lieu de le masquer.
     */
    if (g.entree.genre === "localisation" || g.entree.genre === "flux") {
      pas.push({
        geste: g.libelle,
        messages: [],
        etatApres: `${nommerEtat(etat)} (geste traité hors machine — voir bot.ts)`,
        effet: null,
        nature: "differe",
      });
      continue;
    }
    const r = reagirInscription(etat, g.entree, "237600000000");
    const messages = r.messages.flatMap(rendre);
    const effet = nommerEffet(r.effet);
    const nature = natureDe(messages, effet);
    if (nature === "muet") muet = true;
    if (nature === "differe") differes.push(`${g.libelle} → ${effet ?? "?"}`);
    etat = r.etat;
    pas.push({ geste: g.libelle, messages, etatApres: nommerEtat(etat), effet, nature });
  }
  return { nom, pas, etatFinal: nommerEtat(etat), aUnPasMuet: muet, pasDifferes: differes };
}

/** Pilote le fil ACHETEUSE — le plus long, et celui qui n'a jamais eu de banc. */
export function piloterAcheteuse(
  nom: string,
  etape: string,
  gestes: readonly Geste[],
  ctx: Parameters<typeof reagirAcheteuse>[2],
  depart: EtatConv = ETAT_ACHETEUSE_INITIAL,
): Parcours {
  const pas: Pas[] = [];
  let etat: EtatConv = depart;
  let muet = false;
  const differes: string[] = [];
  for (const g of gestes) {
    noterCase(etape, g.genre);
    if (!g.entree) {
      pas.push({
        geste: g.libelle,
        messages: [],
        etatApres: nommerEtat(etat),
        effet: null,
        nature: "silence",
      });
      continue;
    }
    const r = reagirAcheteuse(etat, g.entree, ctx);
    const messages = r.messages.flatMap(rendre);
    const effet = nommerEffet(r.effet);
    const nature = natureDe(messages, effet);
    if (nature === "muet") muet = true;
    if (nature === "differe") differes.push(`${g.libelle} → ${effet ?? "?"}`);
    etat = r.etat;
    pas.push({ geste: g.libelle, messages, etatApres: nommerEtat(etat), effet, nature });
  }
  return { nom, pas, etatFinal: nommerEtat(etat), aUnPasMuet: muet, pasDifferes: differes };
}

/* ───────────────────────── la transcription ────────────────────────────── */

/**
 * Le parcours en texte, pour instantane.
 *
 * Volontairement plat et sans horodatage : un instantane qui change a chaque
 * execution ne prouve rien. Ce qui doit changer, c'est la COPIE — et alors le
 * diff le montre en une ligne.
 */
export function transcrire(p: Parcours): string {
  const lignes = [`# ${p.nom}`, ""];
  for (const pas of p.pas) {
    lignes.push(`→ ${pas.geste}`);
    if (pas.messages.length === 0) lignes.push("  (rien)");
    for (const m of pas.messages) lignes.push(`  ${m}`);
    lignes.push(
      `  [${pas.nature}] état: ${pas.etatApres}${pas.effet ? ` · effet: ${pas.effet}` : ""}`,
    );
    lignes.push("");
  }
  return lignes.join("\n");
}
