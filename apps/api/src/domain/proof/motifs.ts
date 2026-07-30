import type { OperatorKey } from "@catalog/contracts";
import { decodeOrangeId, local9, normalizeSms, OM_ID, xafInt } from "./outils.ts";

/**
 * Les cinq motifs de SMS operateurs.
 *
 * **Transposition litterale de `docs/formats-sms-operateurs.md` §4.** Les
 * expressions ci-dessous ont ete ecrites contre des messages reels et verifiees
 * contre eux. Elles se copient ; on ne les reecrit pas de memoire. Un motif ecrit
 * au juge se casse sur l'espace avant la parenthese fermante, sur le numero a
 * douze chiffres, ou sur l'anglais.
 *
 * Trois pieges que ces expressions absorbent, et qu'un analyseur naif manque :
 *
 * 1. le numero est en **douze chiffres avec indicatif** dans le SMS de reception
 *    (`237652000001`) et en **neuf** dans ceux d'emission (`688000001`) ;
 * 2. **espace avant la parenthese fermante** : `(237652000001 )` ;
 * 3. le libelle du champ identifiant change **trois fois chez le meme
 *    operateur** : `Transaction Id:`, `ID transaction`, `Transaction ID:`.
 */

export type Sens = "entrant" | "sortant" | "rechargement";

export type ParsedSms = {
  /** Toujours entier. Le franc CFA n'a pas de sous-unite. */
  amountXaf: number;
  /** Identifiant operateur, en MAJUSCULES. */
  txId: string;
  /** `null` si l'identifiant s'auto-invalide. */
  at: Date | null;
  /** 9 chiffres normalises, ou `null`. */
  counterparty: string | null;
  counterpartyName?: string | null;
  feeXaf?: number;
  /**
   * Champ « Commission » du SMS Orange, preleve par l'OPERATEUR. Ce n'est pas une
   * commission Catalog : l'interdit « ne jamais ecrire de code de commission »
   * porte sur un prelevement par Catalog, et reste absolu.
   */
  commissionXaf?: number;
  /**
   * **NE JAMAIS PERSISTER.** C'est le solde du compte de la vendeuse. Ce champ
   * existe parce que le motif le capture, et sert au seul diagnostic d'analyse en
   * memoire. Le lot 3 ne lui donne aucune colonne, deliberement.
   */
  soldeXaf?: number;
  /** Idem : diagnostic d'analyse uniquement. */
  soldeBrut?: string | null;
  reseauCible?: string;
};

export type SmsPattern = {
  id: string;
  label: string;
  /** Libelle d'affichage. NE VA PAS EN BASE. */
  operateur: "MTN MoMo" | "Orange Money";
  /**
   * Valeur persistee dans `payment_proof.operator`. C'est CELLE-CI qui compose la
   * cle `UNIQUE(operator, operator_tx_id)`. Ne jamais y ecrire `operateur`.
   */
  operatorKey: OperatorKey;
  sens: Sens;
  /**
   * Vrai uniquement pour un motif RECONSTITUE. Persiste tel quel dans
   * `payment_proof.pattern_a_confirmer` — meme nom, meme polarite, expres.
   *
   * Ce n'est pas un commentaire : il fait passer le controle n° 1 en
   * avertissement et plafonne le verdict a « accepte sous reserve ». Il ne se
   * promeut jamais sans une capture complete.
   */
  aConfirmer?: true;
  re: RegExp;
  map: (m: RegExpMatchArray) => ParsedSms;
};

/**
 * Tout identifiant est mis en MAJUSCULES avant controle et avant ecriture.
 *
 * Sans ca, `mp260729…` et `MP260729…` coexistent dans une colonne UNIQUE et le
 * controle n° 5 se contourne d'une touche majuscule.
 */
const up = (s: string): string => s.trim().toUpperCase();

/** Acces sur : les motifs garantissent la presence des groupes qu'ils lisent. */
const g = (m: RegExpMatchArray, i: number): string => m[i] as string;

/**
 * **L'ORDRE COMPTE, et il est verrouille par un test.**
 *
 * Les cinq motifs actuels sont mutuellement exclusifs — verifie : aucun message
 * d'exemple n'en satisfait deux. Le premier qui correspond gagne, donc l'ordre
 * n'a aujourd'hui aucun effet observable.
 *
 * Le test d'ordre existe quand meme, et il faut savoir pourquoi : le jour ou un
 * sixieme motif s'ajoute — le SMS Orange d'envoi, par exemple —, rien ne garantit
 * qu'il restera disjoint des autres. Le test verrouille l'appariement attendu de
 * chaque fixture, de sorte qu'un nouveau motif trop large **fasse echouer la CI**
 * au lieu d'intercepter silencieusement les messages d'un motif existant.
 */
export const PATTERNS: SmsPattern[] = [
  {
    id: "mtn.entrant",
    label: "MTN — réception",
    operateur: "MTN MoMo",
    operatorKey: "mtn",
    sens: "entrant",
    re: /Vous avez recu\s+(\d+)\s*XAF\s+de\s+(.+?)\s*\(\s*(237\d{9})\s*\)\s*sur votre compte Mobile Money\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2}).*?Transaction ID:\s*(\d{8,15})/is,
    map: (m) => ({
      amountXaf: +g(m, 1),
      counterpartyName: g(m, 2).trim(),
      counterparty: local9(g(m, 3)),
      at: new Date(+g(m, 4), +g(m, 5) - 1, +g(m, 6), +g(m, 7), +g(m, 8), +g(m, 9)),
      txId: up(g(m, 10)),
    }),
  },
  {
    id: "mtn.sortant.transfert",
    label: "MTN — transfert sortant",
    operateur: "MTN MoMo",
    operatorKey: "mtn",
    sens: "sortant",
    re: /Transfert\s+reussi\s+de\s+(\d+)\s*FCFA\s+au\s+(\d{9})\s+via\s+(.+?)\s+a\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s*\.\s*ID\s+transaction\s+(\d{8,15})/is,
    map: (m) => ({
      amountXaf: +g(m, 1),
      counterparty: local9(g(m, 2)),
      reseauCible: g(m, 3).trim(),
      at: new Date(+g(m, 4), +g(m, 5) - 1, +g(m, 6), +g(m, 7), +g(m, 8), +g(m, 9)),
      txId: up(g(m, 10)),
    }),
  },
  {
    id: "mtn.sortant.paiement",
    label: "MTN — paiement sortant",
    operateur: "MTN MoMo",
    operatorKey: "mtn",
    sens: "sortant",
    re: /Votre paiement de\s+(\d+)\s*XAF\s+a\s+(.+?)\s+a\s+ete\s+effectue\s+le\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\..*?nouveau solde:\s*(\d+)\s*XAF\.\s*Frais:\s*(\d+)\s*XAF\..*?Transaction Id:\s*(\d{8,15})/is,
    map: (m) => ({
      amountXaf: +g(m, 1),
      counterparty: null,
      /** « Transfer To non MoMo Account » : chaine libre non exploitable. */
      counterpartyName: g(m, 2).trim(),
      at: new Date(+g(m, 3), +g(m, 4) - 1, +g(m, 5), +g(m, 6), +g(m, 7), +g(m, 8)),
      soldeXaf: +g(m, 9),
      feeXaf: +g(m, 10),
      txId: up(g(m, 11)),
    }),
  },
  {
    id: "om.rechargement",
    label: "Orange — rechargement",
    operateur: "Orange Money",
    operatorKey: "orange",
    sens: "rechargement",
    re: new RegExp(
      String.raw`Rechargement\s+reussi\.\s*Montant de la transaction:\s*([\d.]+)\s*FCFA,\s*ID transaction:\s*(${OM_ID}),\s*Frais:\s*([\d.]+)\s*FCFA,\s*Commission:\s*([\d.]+)\s*FCFA(?:,\s*Nouveau solde:\s*([\d.]+)\s*FCFA)?`,
      "i",
    ),
    map: (m) => ({
      amountXaf: xafInt(g(m, 1)),
      counterparty: null,
      txId: up(g(m, 2)),
      feeXaf: xafInt(g(m, 3)),
      commissionXaf: xafInt(g(m, 4)),
      soldeBrut: m[5] ?? null,
      at: decodeOrangeId(g(m, 2))?.at ?? null,
    }),
  },
  {
    id: "om.entrant",
    label: "Orange — réception",
    operateur: "Orange Money",
    operatorKey: "orange",
    sens: "entrant",
    /** Capture TRONQUEE — voir `docs/formats-sms-operateurs.md` §1 et §7. */
    aConfirmer: true,
    re: new RegExp(
      String.raw`(?:You have received|Vous avez re[cç]u)\s+([\d\s.,]+?)\s*(?:FCFA|XAF)\s+(?:of|from|de)\s+([^,.]{1,48}?)\s*[,.].*?(${OM_ID})`,
      "is",
    ),
    map: (m) => ({
      amountXaf: xafInt(g(m, 1)),
      counterpartyName: /\d{9,}/.test(g(m, 2)) ? null : g(m, 2).trim(),
      counterparty: local9((g(m, 2).match(/\d{9,12}/) ?? [])[0] ?? "") || null,
      txId: up(g(m, 3)),
      at: decodeOrangeId(g(m, 3))?.at ?? null,
    }),
  },
];

/* ────────────────────────── l'analyse ────────────────────────── */

export type ResultatAnalyse =
  | { reconnu: true; pattern: SmsPattern; sms: ParsedSms }
  /**
   * Aucun motif ne correspond. Ce n'est pas une panne : un message tronque ou du
   * texte libre tape a la main doivent arriver ici, pas provoquer une exception.
   */
  | { reconnu: false; raison: "aucun_motif" | "montant_illisible" };

/**
 * Analyse un SMS colle par la vendeuse.
 *
 * Le texte est normalise d'abord — espaces insecables, retours a la ligne — puis
 * confronte aux motifs **dans l'ordre**. Le premier qui correspond gagne.
 *
 * Un montant illisible fait lever `xafInt` ; on le rattrape ici pour rendre un
 * refus explicable plutot qu'une exception qui remonterait jusqu'a la couche
 * HTTP avec le texte du SMS dans sa trace — or ce texte contient le solde du
 * compte de la vendeuse.
 */
export function analyserSms(texte: string): ResultatAnalyse {
  const t = normalizeSms(texte);
  for (const pattern of PATTERNS) {
    const m = t.match(pattern.re);
    if (!m) continue;
    try {
      return { reconnu: true, pattern, sms: pattern.map(m) };
    } catch {
      // `xafInt` a leve. On ne propage NI l'exception NI son message : il porte
      // un fragment du SMS.
      return { reconnu: false, raison: "montant_illisible" };
    }
  }
  return { reconnu: false, raison: "aucun_motif" };
}
