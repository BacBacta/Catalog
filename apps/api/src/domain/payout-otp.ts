/**
 * L'OTP qui verifie le NUMERO DE REVERSEMENT.
 *
 * Le module `payout-phone.ts` decide du changement mais **ne voit jamais le
 * code** : il ne recoit que le fait « ce numero-la a ete verifie a telle heure ».
 * Ce fichier-ci est ce qui produit ce fait. Il est pur lui aussi : le temps et
 * l'alea arrivent en parametres.
 *
 * Deux differences volontaires avec l'OTP de connexion :
 *
 * 1. **Il ne passe pas par le plugin `phoneNumber` de Better Auth.** Celui-ci
 *    verifie le numero de CONNEXION et, utilise ici, il deplacerait le numero
 *    avec lequel la vendeuse se connecte. Le reversement est un second numero,
 *    souvent sur une autre puce : le verifier ne doit rien changer a sa
 *    connexion.
 * 2. **Le code n'est jamais stocke en clair.** Seule une empreinte HMAC l'est,
 *    comparee en temps constant. Une base lue ne donne pas les codes en cours.
 */

/** Duree de vie du code envoye par SMS. */
export const DUREE_OTP_MS = 5 * 60_000;

/** Nombre de saisies avant que le code soit brule. Six chiffres, trois essais. */
export const ESSAIS_MAX = 3;

/**
 * Code a six chiffres, tire d'une source cryptographique.
 *
 * Le modulo est rejete au-dela de la derniere borne complete : sans ce rejet,
 * les premiers chiffres sortiraient un peu plus souvent que les autres. C'est le
 * meme raisonnement que `verification-code.ts`, et l'ADR 0013 explique pourquoi
 * un generateur maison a congruence lineaire n'a pas sa place ici.
 */
export function genererCodeOtp(randomBytes: (n: number) => Uint8Array): string {
  const out: string[] = [];
  const limite = Math.floor(256 / 10) * 10; // 250
  while (out.length < 6) {
    for (const octet of randomBytes(12)) {
      if (octet >= limite) continue;
      out.push(String(octet % 10));
      if (out.length === 6) break;
    }
  }
  return out.join("");
}

/** Etat d'une ligne d'OTP, tel que la base la rend. */
export interface OtpEnregistre {
  id: string;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
}

export type RefusOtp =
  | "aucun_code_en_cours"
  | "code_expire"
  | "code_deja_utilise"
  | "trop_d_essais"
  | "code_incorrect";

export type VerdictOtp =
  | { ok: true; otpId: string; numero: string; verifieA: Date }
  /** `bruler` : la ligne doit etre consommee meme si la saisie a echoue. */
  | { ok: false; raison: RefusOtp; otpId?: string; bruler: boolean };

/**
 * Verifie une saisie contre la derniere ligne emise.
 *
 * L'ordre des controles compte : expiration et epuisement AVANT la comparaison
 * du code. Sinon un code expire mais juste renverrait « correct », et le nombre
 * d'essais deviendrait une suggestion.
 *
 * `comparer` est injecte pour que le domaine reste pur — c'est la comparaison en
 * temps constant, fournie par l'adaptateur.
 */
export function verifierCodeOtp(
  ligne: OtpEnregistre | null,
  saisie: { code: string; empreinte: (code: string) => string; now: Date },
  comparer: (a: string, b: string) => boolean,
): VerdictOtp {
  if (!ligne) return { ok: false, raison: "aucun_code_en_cours", bruler: false };
  if (ligne.consumedAt) {
    return { ok: false, raison: "code_deja_utilise", otpId: ligne.id, bruler: false };
  }
  if (saisie.now.getTime() > ligne.expiresAt.getTime()) {
    return { ok: false, raison: "code_expire", otpId: ligne.id, bruler: true };
  }
  if (ligne.attempts >= ESSAIS_MAX) {
    return { ok: false, raison: "trop_d_essais", otpId: ligne.id, bruler: true };
  }
  if (!comparer(ligne.codeHash, saisie.empreinte(saisie.code))) {
    // Le compteur d'essais s'incremente cote adaptateur ; on brule seulement au
    // dernier essai, pour laisser les deux precedents disponibles.
    return {
      ok: false,
      raison: "code_incorrect",
      otpId: ligne.id,
      bruler: ligne.attempts + 1 >= ESSAIS_MAX,
    };
  }
  return { ok: true, otpId: ligne.id, numero: ligne.phone, verifieA: saisie.now };
}
