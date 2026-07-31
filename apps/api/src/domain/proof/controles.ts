import type { CheckResult, CheckState, Verdict } from "@catalog/contracts";
import type { ParsedSms, Sens, SmsPattern } from "./motifs.ts";
import { decodeOrangeId, local9 } from "./outils.ts";

/**
 * Les sept controles.
 *
 * **Transposition de `docs/formats-sms-operateurs.md` §5.** La numerotation est
 * canonique (ADR 0009) et ne se renumerote pas : elle voyage jusqu'a l'interface
 * et jusqu'a la colonne `checks` de `payment_proof`.
 *
 * | # | Controle | Ce qu'il attrape |
 * |---|---|---|
 * | 1 | Format operateur reconnu | Le texte invente, la capture retapee |
 * | 2 | Montant conforme | Le sous-paiement deguise |
 * | 3 | Contrepartie | Le paiement destine a quelqu'un d'autre |
 * | 4 | Horodatage coherent | Le SMS anterieur a la commande, le SMS recycle |
 * | 5 | Unicite de l'identifiant **sur tout le reseau** | Le meme paiement reclame deux fois |
 * | 6 | Identifiant auto-coherent *(Orange)* | L'identifiant fabrique |
 * | 7 | Contre-signature de l'acheteuse | La collusion a une seule voix |
 *
 * **Les six premiers sont PURS.** Ils ne touchent ni la base ni le reseau, et le
 * controle n° 5 y renvoie toujours `pending` : le domaine ne peut pas savoir si
 * un identifiant est libre. C'est la contrainte `UNIQUE(operator,
 * operator_tx_id)` qui tranche, a l'INSERT — jamais un SELECT suivi d'un `if`,
 * qui perdrait la course entre deux vendeuses collant le meme identifiant a la
 * meme seconde.
 *
 * L'horloge est un PARAMETRE. Jamais lue ici.
 */

/** Fenetre de validite d'un horodatage, apres la creation de la commande. */
export const FENETRE_HORODATAGE_MS = 48 * 60 * 60_000;

export interface CommandePourControles {
  /** Total attendu, en francs entiers. */
  totalXaf: number;
  /** Ce qui est attendu maintenant : acompte, solde, ou total. */
  attenduXaf: number;
  creeA: Date;
  /** Numero de REVERSEMENT de la vendeuse, E.164 ou 9 chiffres. */
  reversementVendeuse: string | null;
  /** Numero de l'acheteuse, tel qu'enregistre a la commande. */
  telephoneAcheteuse: string | null;
  /** Vrai quand l'acheteuse a deja confirme depuis son lien de suivi. */
  contresigneeParAcheteuse: boolean;
}

export interface EntreeControles {
  pattern: SmsPattern;
  sms: ParsedSms;
  commande: CommandePourControles;
  now: Date;
}

const c = (n: number, id: string, state: CheckState, explanation: string): CheckResult => ({
  n,
  id,
  state,
  explanation,
});

/* ────────────────────────── 1. format operateur ────────────────────────── */

/**
 * Le motif a reconnu le message. Un motif **reconstitue** ne donne qu'un
 * avertissement : sa forme est deduite, pas observee.
 */
export function controle1Format(pattern: SmsPattern): CheckResult {
  if (pattern.aConfirmer) {
    return c(
      1,
      "format",
      "warn",
      `Message reconnu comme « ${pattern.label} », mais ce format n'a pas encore été vérifié sur une vraie capture. Le reçu restera « sous réserve ».`,
    );
  }
  return c(1, "format", "pass", `Message reconnu : ${pattern.label}.`);
}

/* ────────────────────────── 2. montant ────────────────────────── */

export function controle2Montant(sms: ParsedSms, commande: CommandePourControles): CheckResult {
  if (sms.amountXaf === commande.attenduXaf) {
    return c(2, "montant", "pass", `Le montant du SMS correspond à ce qui est attendu.`);
  }
  const ecart = sms.amountXaf - commande.attenduXaf;
  return c(
    2,
    "montant",
    "fail",
    ecart < 0
      ? `Le SMS annonce ${sms.amountXaf} F, il en manque ${-ecart} sur les ${commande.attenduXaf} F attendus.`
      : `Le SMS annonce ${sms.amountXaf} F, soit ${ecart} F de plus que les ${commande.attenduXaf} F attendus.`,
  );
}

/* ────────────────────────── 3. contrepartie ────────────────────────── */

/**
 * **Le controle qui depend du SENS du message.**
 *
 * C'est l'erreur la plus facile a commettre, et elle rejetterait TOUS les
 * paiements legitimes :
 *
 * - message **sortant** (celui de l'acheteuse) : la contrepartie est le
 *   DESTINATAIRE → comparer au numero de reversement de la vendeuse ;
 * - message **entrant** (celui de la vendeuse, qui fait autorite) : la
 *   contrepartie est l'EXPEDITEUR → comparer au numero de l'acheteuse ;
 * - message de **rechargement** : aucune contrepartie, rien a rapprocher.
 *
 * Un numero qui ne correspond pas est un **AVERTISSEMENT, jamais un refus**. La
 * double SIM et le paiement par un proche sont la norme au Cameroun ; c'est la
 * contre-signature qui tranche.
 *
 * Le seul echec possible : un message SORTANT dont le destinataire est un numero
 * exploitable et DIFFERENT du reversement de la vendeuse. La, l'argent est parti
 * ailleurs, et ce n'est pas une question de puce.
 */
export function controle3Contrepartie(
  pattern: SmsPattern,
  sms: ParsedSms,
  commande: CommandePourControles,
): CheckResult {
  if (pattern.sens === "rechargement") {
    return c(
      3,
      "contrepartie",
      "warn",
      "Ce message est un rechargement de compte : il ne désigne personne, donc il ne prouve aucune vente.",
    );
  }

  if (!sms.counterparty) {
    return c(
      3,
      "contrepartie",
      "warn",
      "Ce message ne contient pas de numéro exploitable. Ce n'est pas bloquant, mais la confirmation de l'acheteuse comptera davantage.",
    );
  }

  const attendu =
    pattern.sens === "sortant" ? commande.reversementVendeuse : commande.telephoneAcheteuse;

  if (!attendu) {
    return c(
      3,
      "contrepartie",
      "warn",
      pattern.sens === "sortant"
        ? "Aucun numéro de reversement enregistré : impossible de vérifier que l'argent est bien parti chez vous."
        : "Aucun numéro d'acheteuse enregistré sur cette commande : impossible de rapprocher l'expéditeur.",
    );
  }

  if (local9(sms.counterparty) === local9(attendu)) {
    return c(
      3,
      "contrepartie",
      "pass",
      pattern.sens === "sortant"
        ? "L'argent est bien parti vers votre numéro de reversement."
        : "L'expéditeur correspond au numéro de l'acheteuse.",
    );
  }

  if (pattern.sens === "sortant") {
    return c(
      3,
      "contrepartie",
      "fail",
      "Ce paiement est parti vers un autre numéro que votre numéro de reversement.",
    );
  }

  return c(
    3,
    "contrepartie",
    "warn",
    "L'argent vient d'un autre numéro que celui enregistré. C'est fréquent — deuxième puce, paiement par un proche — mais la confirmation de l'acheteuse comptera davantage.",
  );
}

/* ────────────────────────── 4. horodatage ────────────────────────── */

export function controle4Horodatage(
  sms: ParsedSms,
  commande: CommandePourControles,
  _now: Date,
  fenetreMs: number = FENETRE_HORODATAGE_MS,
): CheckResult {
  /**
   * Chez Orange, `at` provient du DECODAGE DE L'IDENTIFIANT, pas du texte. Si le
   * decodage echoue, `at` vaut `null`. Ne jamais appeler `toLocaleString` sans
   * avoir verifie `at instanceof Date`.
   */
  if (!(sms.at instanceof Date) || Number.isNaN(sms.at.getTime())) {
    return c(
      4,
      "horodatage",
      "fail",
      "Aucun horodatage exploitable — l'identifiant annonce une date impossible.",
    );
  }

  const delta = sms.at.getTime() - commande.creeA.getTime();
  if (delta < 0) {
    return c(
      4,
      "horodatage",
      "fail",
      "Ce paiement est daté AVANT la commande : il ne peut pas la régler.",
    );
  }
  if (delta > fenetreMs) {
    return c(
      4,
      "horodatage",
      "fail",
      "Ce paiement date de plus de 48 heures après la commande. Il concerne probablement une autre vente.",
    );
  }
  return c(4, "horodatage", "pass", "La date du paiement est cohérente avec la commande.");
}

/* ────────────────────────── 5. unicite reseau ────────────────────────── */

/**
 * **Toujours `pending` dans le domaine.**
 *
 * Le domaine ne peut pas savoir si un identifiant est libre : il ne touche pas la
 * base. La sequence est, dans cet ordre exact :
 *
 * 1. le domaine applique les six controles purs ; le n° 5 revient `pending` ;
 * 2. si aucun `fail`, la couche applicative **tente l'INSERT** ;
 * 3. la contrainte `UNIQUE(operator, operator_tx_id)` accepte ou leve ;
 * 4. une violation de contrainte est traduite en echec du controle n° 5.
 *
 * `resoudreControle5` est ce qui traduit l'etape 4.
 */
export function controle5Unicite(): CheckResult {
  return c(
    5,
    "unicite",
    "pending",
    "Vérification que ce paiement n'a pas déjà été utilisé — chez vous ou chez une autre vendeuse.",
  );
}

/** Traduit le verdict de la base en resultat de controle. */
export function resoudreControle5(libre: boolean): CheckResult {
  return libre
    ? c(5, "unicite", "pass", "Ce paiement n'avait jamais été utilisé.")
    : c(
        5,
        "unicite",
        "fail",
        "Ce paiement a déjà servi à régler une autre commande. Un même transfert ne peut payer qu'une fois.",
      );
}

/* ────────────────────────── 6. auto-coherence Orange ────────────────────────── */

/**
 * **Ce controle DISPARAIT chez MTN.**
 *
 * Les onze chiffres de MTN sont opaques : ils ne disent rien d'eux-memes, donc ils
 * ne peuvent pas se contredire. `decodeOrangeId` renvoie `null`, et on rend `null`
 * — pas un echec, pas un avertissement : le controle n'existe simplement pas pour
 * cet operateur.
 */
export function controle6AutoCoherence(sms: ParsedSms): CheckResult | null {
  const decode = decodeOrangeId(sms.txId);
  if (!decode) return null;
  if (!decode.valid) {
    return c(
      6,
      "auto_coherence",
      "fail",
      "L'identifiant Orange contient une date impossible. Un identifiant authentique porte sa propre date.",
    );
  }
  return c(
    6,
    "auto_coherence",
    "pass",
    "L'identifiant Orange porte une date cohérente avec lui-même.",
  );
}

/* ────────────────────────── 7. contre-signature ────────────────────────── */

/**
 * **Le sens du message change la NATURE de ce controle**, et c'est le point le
 * plus important de la fonction.
 *
 * - message **entrant** (celui de la vendeuse) : il fait autorite a lui seul.
 *   La contre-signature le renforce, donc son absence est `pending` — elle
 *   n'empeche rien ;
 * - message **sortant** (celui de l'acheteuse) : c'est une CORROBORATION,
 *   jamais une preuve (AGENTS.md §2). Son absence de contre-signature est donc
 *   un `warn`, ce qui plafonne le verdict a « accepté sous réserve ».
 *
 * Sans cette distinction, un SMS d'emission dont le destinataire est le numero
 * de reversement franchissait les six autres controles et produisait
 * « accepte » — c'est-a-dire exactement l'interdit « faire passer une commande
 * en prouve sur le seul SMS d'emission de l'acheteuse ». Le defaut a ete trouve
 * par la revue de securite du lot 15 ; voir l'ADR 0024.
 *
 * Le plafond se leve des que l'acheteuse contresigne : « en attente du message
 * entrant OU de la contre-signature » est bien une alternative.
 */
export function controle7Contresignature(
  commande: CommandePourControles,
  sens: Sens = "entrant",
): CheckResult {
  if (commande.contresigneeParAcheteuse) {
    return c(7, "contresignature", "pass", "L'acheteuse a confirmé avoir payé.");
  }
  if (sens === "sortant") {
    return c(
      7,
      "contresignature",
      "warn",
      "Ce message est celui de l'acheteuse, pas le vôtre : il corrobore le paiement sans le prouver. " +
        "Il faut votre SMS de réception, ou la confirmation de l'acheteuse depuis son lien de suivi.",
    );
  }
  return c(
    7,
    "contresignature",
    "pending",
    "En attente de la confirmation de l'acheteuse. Elle la donne depuis son lien de suivi.",
  );
}

/* ────────────────────────── l'ensemble ────────────────────────── */

export interface ResultatControles {
  checks: CheckResult[];
  verdict: Verdict;
}

/**
 * Verdict a partir de la liste de controles.
 *
 * - un seul `fail` **refuse** ;
 * - un `warn` fait passer en « accepte sous reserve » ;
 * - `pending` n'empeche rien : le controle n° 5 est toujours en attente dans le
 *   domaine, et le n° 7 tant que l'acheteuse n'a pas repondu.
 */
export function verdictDe(checks: readonly CheckResult[]): Verdict {
  if (checks.some((x) => x.state === "fail")) return "refuse";
  if (checks.some((x) => x.state === "warn")) return "accepte_sous_reserve";
  return "accepte";
}

/**
 * Applique les sept controles.
 *
 * Les six premiers sont purs ; le n° 5 revient `pending` et sera tranche par la
 * base. Le n° 6 est **absent** de la liste chez MTN plutot que d'y figurer en
 * succes : un controle qui n'existe pas ne doit pas ressembler a un controle
 * reussi.
 */
export function appliquerControles(entree: EntreeControles): ResultatControles {
  const { pattern, sms, commande, now } = entree;

  const checks: CheckResult[] = [
    controle1Format(pattern),
    controle2Montant(sms, commande),
    controle3Contrepartie(pattern, sms, commande),
    controle4Horodatage(sms, commande, now),
    controle5Unicite(),
  ];

  const six = controle6AutoCoherence(sms);
  if (six) checks.push(six);

  checks.push(controle7Contresignature(commande, pattern.sens));

  return { checks, verdict: verdictDe(checks) };
}

/**
 * Verdict final, une fois la base consultee.
 *
 * Remplace le `pending` du controle n° 5 par le verdict de la contrainte UNIQUE,
 * puis recalcule. C'est le seul endroit ou un verdict « accepte » peut naitre.
 */
export function finaliserAvecUnicite(
  resultat: ResultatControles,
  libre: boolean,
): ResultatControles {
  const checks = resultat.checks.map((x) => (x.n === 5 ? resoudreControle5(libre) : x));
  return { checks, verdict: verdictDe(checks) };
}
