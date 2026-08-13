/**
 * Le temps qui reste a un defi de connexion WhatsApp.
 *
 * ── La mesure du 13/08/2026, et pourquoi ce fichier existe ────────────────
 *
 * Le defi voyage dans l'etat de navigation, et cet etat SURVIT au
 * rechargement — c'est `history.state`, le navigateur le restitue. L'ecran
 * d'attente, lui, repartait a `expireDansS` a chaque montage : une page
 * rechargee affichait un compte a rebours neuf de 5:00 sur un code mort
 * depuis longtemps. Le porteur du produit a envoye ce code trois fois. La
 * sonde de preproduction n'a vu AUCUN defi cree pendant ces essais : il n'y
 * en avait pas eu.
 *
 * La regle tient en une phrase : **une echeance est un INSTANT, pas une
 * duree**. On date la creation sur l'horloge de l'appareil, et le restant se
 * recalcule ; il ne se decremente pas. Les deux mesures viennent du meme
 * telephone, donc une horloge fausse ne fausse rien — seul l'ecart compte.
 *
 * Le repli quand la date de creation manque — un etat ecrit par un paquet
 * anterieur — n'invente pas de verdict : c'est le SERVEUR que l'ecran
 * interroge des le montage, et lui seul dit « inconnu ».
 */

export interface DefiWhatsApp {
  jeton: string;
  suivi: string;
  code: string;
  lien: string;
  expireDansS: number;
  /** Instant de creation, horloge de CE telephone (ms). Absent = etat ancien. */
  creeA?: number;
}

export function secondesRestantes(
  defi: Pick<DefiWhatsApp, "expireDansS" | "creeA">,
  maintenantMs: number,
): number {
  if (typeof defi.creeA !== "number" || !Number.isFinite(defi.creeA)) {
    return defi.expireDansS;
  }
  const finMs = defi.creeA + defi.expireDansS * 1000;
  return Math.max(0, Math.ceil((finMs - maintenantMs) / 1000));
}

/** « 4:07 » — la forme affichee, pour que l'ecran n'ait pas a la composer. */
export function enMinutesSecondes(restantS: number): string {
  const minutes = Math.floor(restantS / 60);
  const secondes = String(restantS % 60).padStart(2, "0");
  return `${minutes}:${secondes}`;
}
