/**
 * Les outils communs des analyseurs de SMS.
 *
 * **Transposition de `docs/formats-sms-operateurs.md` §4.** Ce fichier-la est une
 * SPECIFICATION, pas de la documentation : ses expressions ont ete ecrites contre
 * des messages reels et verifiees contre eux. La logique ci-dessous ne s'ecarte
 * pas de la sienne — seuls les types sont explicites.
 *
 * Module PUR : du texte vers des donnees. Pas de base, pas de reseau, pas
 * d'horloge implicite.
 */

/**
 * Les numeros arrivent tantot en 9 chiffres, tantot avec l'indicatif 237.
 *
 * C'est le premier piege de la specification : le SMS de RECEPTION porte
 * `237652000001` (douze chiffres) la ou les messages d'emission portent
 * `688000001` (neuf). Comparer sans normaliser rejette un paiement parfaitement
 * legitime.
 */
export const local9 = (s: string | null | undefined): string => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.startsWith("237") ? d.slice(3) : d;
};

/**
 * Montant en francs ENTIERS.
 *
 * Orange ecrit des decimales sur des montants qui n'en ont pas — `108762.45` —
 * alors que le franc CFA n'a pas de subdivision. Espaces et virgules sont des
 * separateurs de milliers, le point est decimal.
 * « 1 500 » → 1500 · « 1,500 » → 1500 · « 108762.45 » → 108762.
 *
 * Un montant illisible **leve**. Mieux vaut un refus qu'un `NaN` dans une colonne
 * `Int` : le NaN passerait la validation Zod en `number` et deviendrait `null` ou
 * zero en base, c'est-a-dire un paiement de zero franc marque comme prouve.
 */
export const xafInt = (s: string): number => {
  const brut = String(s);
  /**
   * **Ecart assume par rapport a la lettre de la specification**, au service de
   * son intention declaree — « mieux vaut un refus qu'un NaN dans une colonne
   * Int ». Voir ADR 0019.
   *
   * `Number("")` vaut ZERO, pas NaN. Sans ce controle, un montant fait
   * uniquement de separateurs passe : mesure, le texte
   * `You have received  ,  FCFA of …` est reconnu par `om.entrant` et produit un
   * paiement de **zero franc**, avec un identifiant valide et une contrepartie
   * correcte. C'est un faux paiement parfaitement forme.
   *
   * Un montant doit donc contenir au moins un chiffre.
   */
  if (!/\d/.test(brut)) throw new Error("montant illisible");
  const n = Number(brut.replace(/[\s\u00a0\u202f,]/g, ""));
  /**
   * Le message d'erreur ne porte PAS le montant. Il remonterait dans une trace,
   * et un fragment de SMS y entrainerait le solde du compte de la vendeuse.
   */
  if (!Number.isFinite(n)) throw new Error("montant illisible");
  return Math.round(n);
};

/**
 * Normalisation d'entree : espaces insecables, retours a la ligne, doublons.
 *
 * Un SMS colle depuis l'application Messages arrive avec des retours a la ligne
 * et parfois des espaces insecables. Les motifs sont ecrits contre du texte a
 * espaces simples.
 */
export const normalizeSms = (t: string): string =>
  t
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/* ────────────────────────── identifiant Orange ────────────────────────── */

/**
 * Types d'operation observes et deduits.
 *
 * `RC` et `MP` sont **observes** ; les autres sont deduits par convention et ne
 * servent qu'a l'affichage. Un prefixe inconnu n'invalide rien : on affiche le
 * prefixe brut.
 */
const OM_KIND: Record<string, string> = {
  RC: "rechargement",
  MP: "paiement marchand",
  TR: "transfert",
  PP: "transfert",
  CI: "dépôt",
  CO: "retrait",
};

/** Fragment reutilise dans les motifs Orange. */
export const OM_ID = String.raw`[A-Z]{2}\d{6}\.\d{4}\.[A-Z]\d{4,6}`;

export type OrangeId = {
  prefix: string;
  kind: string | null;
  seq: string;
  valid: boolean;
  at: Date | null;
};

/**
 * Decode un identifiant Orange, qui **se date lui-meme**.
 *
 * ```
 * RC 241204 . 1533 . B00001
 * ││  └date┘   └h m┘   └sequence┘
 * └ type d'operation
 * ```
 *
 * C'est ce qui rend le controle n° 6 possible, et gratuit. Les onze chiffres de
 * MTN sont opaques : ils ne disent rien d'eux-memes, donc ils ne peuvent pas se
 * contredire. Un identifiant Orange, si — `MP269932.1403.C73941` tombe, le mois
 * 99 n'existe pas.
 *
 * **Renvoie `null` sur un identifiant non-Orange.** C'est ainsi que le controle
 * n° 6 DISPARAIT chez MTN au lieu d'echouer.
 *
 * La normalisation en majuscules a lieu AVANT le decodage : les motifs Orange
 * portent le drapeau `i`, donc un identifiant peut arriver en minuscules. Sans
 * cela le controle n° 6 disparaitrait silencieusement au lieu de s'appliquer, et
 * deux casses du meme identifiant cohabiteraient dans une colonne UNIQUE.
 */
export function decodeOrangeId(id: string): OrangeId | null {
  const m = String(id ?? "")
    .trim()
    .toUpperCase()
    .match(/^([A-Z]{2})(\d{2})(\d{2})(\d{2})\.(\d{2})(\d{2})\.([A-Z]\d{4,6})$/);
  if (!m) return null;
  const [, prefix, yy, mm, dd, HH, MM, seq] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const valid = +mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31 && +HH < 24 && +MM < 60;
  return {
    prefix,
    kind: OM_KIND[prefix] ?? null,
    seq,
    valid,
    /**
     * `new Date(y, m, d, …)` construit en heure LOCALE du processus. Les dates
     * lues dans les SMS sont en heure du Cameroun : le serveur et les tests
     * doivent tourner avec `TZ=Africa/Douala`. Sans ce reglage, la fenetre de
     * 48 h du controle n° 4 derive d'une heure — et le test passe en local pour
     * echouer en CI.
     */
    at: valid ? new Date(2000 + +yy, +mm - 1, +dd, +HH, +MM) : null,
  };
}

/** Libelle d'affichage d'un identifiant Orange. Jamais persiste. */
export function libelleOrangeId(id: OrangeId): string {
  return id.kind ?? id.prefix;
}
