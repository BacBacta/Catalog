import { formatXaf } from "@catalog/contracts/money";

/**
 * Le resume du matin — ADR 0100 (lot P6). Module PUR : la date du jour et
 * les faits arrivent en parametres, rien n'est lu nulle part.
 *
 * ── Le silence est une sortie de plein droit ──────────────────────────────
 *
 * Une boutique sans fait d'hier et sans reste a faire rend `null` — pas de
 * « rien a signaler » : un message quotidien vide est du bruit quotidien, et
 * le silence fait partie du service (note de la maquette).
 *
 * ── L'honnetete des chiffres (ADR 0022) ───────────────────────────────────
 *
 * Chaque ligne n'existe que si son fait existe, et LES VISITES n'apparaissent
 * que si elles sont reellement comptees (`instrumentees`) — le resume ne sera
 * pas le premier endroit ou le produit invente un chiffre. Aucune donnee de
 * SMS n'entre ici (ADR 0023). Le fil vendeuse est en FRANCAIS (ADR 0033) —
 * l'ecart au prompt du lot est dit dans l'ADR 0100.
 */

export interface FaitsDHier {
  /** Commandes creees hier. */
  commandes: number;
  /** Paiements PROUVES hier — les preuves acceptees, pas les declares. */
  paiementsProuves: number;
  /** Vrai UNIQUEMENT si un chemin de code compte les vues (ADR 0022). */
  visites: { instrumentees: boolean; n: number };
  /** Les avis recus hier — le dernier mot se cite, jamais invente. */
  avis: ReadonlyArray<{ note: number; mot?: string | undefined }>;
}

export interface AFaireAujourdhui {
  /** Les references des commandes encore a l'etape « recue ». */
  aPreparer: readonly string[];
  /** Les acomptes attendus dont AUCUN franc n'est arrive. */
  smsAttendus: number;
  /** Le total encore a encaisser, toutes commandes ouvertes. */
  resteAEncaisserXaf: number;
}

/** La date du jour, en francais, heure de Douala — « samedi 16 août ». */
export function jourEnFrancais(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Africa/Douala",
  }).format(date);
}

/** La cle de deduplication : le jour LOCAL vecu, fige en texte. */
export function jourLocal(date: Date): string {
  const fmt = new Intl.DateTimeFormat("fr-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Douala",
  });
  return fmt.format(date);
}

/**
 * La carte du matin, ou `null`. `premierResume` : la premiere carte annonce
 * l'opt-out — un service pousse sans porte de sortie n'est pas un service.
 */
export function resumeDuMatin(e: {
  nomVendeuse: string;
  dateDuJour: Date;
  faits: FaitsDHier;
  aFaire: AFaireAujourdhui;
  premierResume: boolean;
}): string | null {
  const { faits, aFaire } = e;
  const rienHier =
    faits.commandes === 0 &&
    faits.paiementsProuves === 0 &&
    faits.avis.length === 0 &&
    (!faits.visites.instrumentees || faits.visites.n === 0);
  const rienAFaire = aFaire.aPreparer.length === 0 && aFaire.smsAttendus === 0;
  if (rienHier && rienAFaire) return null;

  const lignesHier: string[] = [];
  if (faits.commandes > 0) lignesHier.push(`🛒 Commandes : ${faits.commandes}`);
  if (faits.paiementsProuves > 0) {
    lignesHier.push(`✅ Paiements prouvés : ${faits.paiementsProuves}`);
  }
  if (faits.visites.instrumentees && faits.visites.n > 0) {
    lignesHier.push(`👀 Visites de la boutique : ${faits.visites.n}`);
  }
  if (faits.avis.length === 1 && faits.avis[0]) {
    const a = faits.avis[0];
    lignesHier.push(`⭐ Avis reçu : ${a.mot ? `« ${a.mot} »` : `${a.note}/5`}`);
  } else if (faits.avis.length > 1) {
    lignesHier.push(`⭐ Avis reçus : ${faits.avis.length}`);
  }

  const gestes: string[] = [];
  if (aFaire.aPreparer.length > 0) {
    const refs = aFaire.aPreparer.slice(0, 3).join(", ");
    const reste = aFaire.aPreparer.length - Math.min(3, aFaire.aPreparer.length);
    gestes.push(`préparer ${refs}${reste > 0 ? ` (+${reste})` : ""}`);
  }
  if (aFaire.smsAttendus > 0) {
    gestes.push(
      `${aFaire.smsAttendus} SMS de paiement attendu${aFaire.smsAttendus > 1 ? "s" : ""} — collez-les ici dès qu'ils sonnent`,
    );
  }

  return [
    `☀️ *Votre matin · ${jourEnFrancais(e.dateDuJour)}*`,
    ...(lignesHier.length > 0
      ? [`Bonjour ${e.nomVendeuse} — hier chez vous :`, ...lignesHier]
      : [`Bonjour ${e.nomVendeuse} !`]),
    ...(gestes.length > 0 ? ["", `À faire aujourd'hui : ${gestes.join(" · ")}.`] : []),
    ...(aFaire.resteAEncaisserXaf > 0
      ? [`À encaisser en tout : *${formatXaf(aFaire.resteAEncaisserXaf)}*.`]
      : []),
    "Bonne journée 🌞",
    ...(e.premierResume ? ["", "Pour ne plus recevoir ce résumé : écrivez « stop résumé »."] : []),
  ].join("\n");
}

/**
 * « stop résumé » / « résumé » — l'opt-out et son inverse (ADR 0100).
 * `true` = arreter, `false` = reprendre, `null` = ni l'un ni l'autre.
 */
export function demandeResume(texteBrut: string): boolean | null {
  const net = texteBrut
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/^stop\s+resume$/.test(net)) return true;
  if (/^resume$/.test(net)) return false;
  return null;
}
