import { formatXaf } from "@catalog/contracts/money";
import { boutons, type MessageSortant } from "./messages.ts";

/**
 * La rafale de photos legendees — ADR 0096, lot P1 de la cible premium.
 *
 * Le geste reel d'une vendeuse est la SALVE, comme pour un Statut : cinq
 * photos legendees « nom prix » en quelques secondes. Avant ce module,
 * chaque photo produisait sa carte de confirmation — le mur que l'ADR 0086
 * interdit. Ici, les photos s'accumulent en BROUILLONS et une seule carte
 * recapitulative confirme tout.
 *
 * Module PUR : pas d'horloge, pas de base. La legende arrive DEJA LUE
 * (`lireLegendeArticle`, ADR 0035 — le motif ne se reecrit pas), la fenetre
 * de regroupement est portee par l'appelant (un travail pg-boss deborde par
 * conception), et ce module ne fait que tenir la liste et composer la carte.
 */

export interface BrouillonRafale {
  /** `null` : la legende n'etait pas lisible — on n'invente pas un nom (§7.7). */
  nom: string | null;
  prixXaf: number | null;
  mediaId: string;
  /** Le wamid de la photo : l'idempotence de l'ADR 0040, tenue AUSSI ici. */
  wamid?: string;
}

/** La borne des listes (ADR 0035) — gardee meme sur une carte a boutons. */
export const RAFALE_MAX = 10;

/**
 * La fenetre de regroupement : 30 s apres la DERNIERE photo. Assez long pour
 * une salve tapee lentement, assez court pour que la carte arrive pendant
 * que la vendeuse regarde encore son telephone. Chaque photo replanifie.
 */
export const FENETRE_RAFALE_MS = 30_000;

export type AjoutRafale =
  | { resultat: "ajoute"; brouillons: BrouillonRafale[] }
  /** La photo relivree par Meta : deja la, rien ne bouge. */
  | { resultat: "deja_vu" }
  /** La borne : la photo de trop N'ENTRE PAS, la carte invite a publier. */
  | { resultat: "plein" };

export function ajouterBrouillon(
  brouillons: readonly BrouillonRafale[],
  photo: { mediaId: string; lu: { nom: string; prixXaf: number } | null; wamid?: string },
): AjoutRafale {
  if (photo.wamid && brouillons.some((b) => b.wamid === photo.wamid)) {
    return { resultat: "deja_vu" };
  }
  if (brouillons.length >= RAFALE_MAX) return { resultat: "plein" };
  return {
    resultat: "ajoute",
    brouillons: [
      ...brouillons,
      {
        nom: photo.lu?.nom ?? null,
        prixXaf: photo.lu?.prixXaf ?? null,
        mediaId: photo.mediaId,
        ...(photo.wamid ? { wamid: photo.wamid } : {}),
      },
    ],
  };
}

/** « corriger le 2 » tape — la correction adressable par numero. */
export function lireCorrectionRafale(texteBrut: string): number | null {
  const m = /^corriger(?:\s+(?:le|la|l))?\s*(\d{1,2})$/.exec(
    texteBrut.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase(),
  );
  const n = m?.[1] ? Number(m[1]) : null;
  return n && n >= 1 ? n : null;
}

/** « tout publier » tape vaut l'appui — ADR 0051. */
export function demandeToutPublier(texteBrut: string): boolean {
  return /^tout publier$/.test(texteBrut.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase());
}

/** Les numeros (1..n) des brouillons qu'on ne peut PAS publier tels quels. */
export function brouillonsIncomplets(brouillons: readonly BrouillonRafale[]): number[] {
  return brouillons.flatMap((b, i) => (b.nom === null || b.prixXaf === null ? [i + 1] : []));
}

/**
 * Le numero que vise le bouton « Corriger le N » : le premier brouillon SANS
 * NOM s'il y en a un — c'est lui qui bloque la publication —, sinon le
 * dernier ajoute, le plus probablement fautif. Le corps de la carte enseigne
 * la forme tapee, qui vise n'importe quel numero.
 */
export function numeroACorriger(brouillons: readonly BrouillonRafale[]): number {
  return brouillonsIncomplets(brouillons)[0] ?? brouillons.length;
}

const tronque = (nom: string): string => (nom.length > 40 ? `${nom.slice(0, 39)}…` : nom);

function ligneBrouillon(n: number, b: BrouillonRafale): string {
  if (b.nom === null || b.prixXaf === null) {
    return `${n}. (sans nom — la légende n'a pas pu être lue)`;
  }
  return `${n}. ${tronque(b.nom)} — ${formatXaf(b.prixXaf)}`;
}

/**
 * LA carte de la rafale — « n articles prets a publier ». Rien ne se publie
 * sans elle : c'est la confirmation de l'ADR 0035, groupee.
 */
export function carteRafale(vers: string, brouillons: readonly BrouillonRafale[]): MessageSortant {
  const n = brouillons.length;
  const sansNom = brouillonsIncomplets(brouillons);
  const cible = numeroACorriger(brouillons);
  const corps = [
    `📸 Lu dans vos légendes — *${n} article${n > 1 ? "s" : ""} prêt${n > 1 ? "s" : ""} à publier* :`,
    "",
    ...brouillons.map((b, i) => ligneBrouillon(i + 1, b)),
    "",
    sansNom.length > 0
      ? `Le ${sansNom.join(", le ")} attend son nom : écrivez « corriger le ${sansNom[0]} », puis nom et prix en un message.`
      : `Rien ne se publie sans vous. Pour corriger : écrivez « corriger le ${cible} ».`,
  ].join("\n");
  return boutons(vers, corps, [
    { id: "tout_publier", titre: "✅ Tout publier" },
    { id: `corriger:${cible}`, titre: `✏️ Corriger le ${cible}` },
  ]);
}

/** La question d'une correction ciblee : UNE reponse, pas un formulaire rejoue. */
export function questionCorrectionRafale(n: number, b: BrouillonRafale): string {
  const actuel =
    b.nom !== null && b.prixXaf !== null
      ? `Le ${n} est « ${tronque(b.nom)} — ${formatXaf(b.prixXaf)} ».`
      : `Le ${n} n'a pas encore de nom.`;
  return `${actuel}\n*Nom et prix, en un message.*\nExemple : Pagne wax 6 yards 15000\nVous pouvez aussi renvoyer la photo, légendée « nom prix ».`;
}
