import type { EtapeEntonnoir, EtapeEntonnoirCle, Jour, PointSerie } from "@catalog/contracts";

/**
 * Series temporelles et entonnoir, pour l'ecran statistiques.
 *
 * Module PUR : pas de base, pas de reseau, pas d'horloge. Les bornes de la
 * periode arrivent en PARAMETRES — un domaine qui lit l'horloge produit des
 * graphiques qu'aucun test ne peut fixer.
 *
 * Le fuseau est `Africa/Douala`, UTC+1 sans heure d'ete. Les jours sont
 * manipules en chaines `AAAA-MM-JJ` et jamais en `Date` : une `Date` porte une
 * heure, et une heure porte un fuseau. Deux vendeuses ne doivent pas voir des
 * journees differentes selon le serveur qui a rendu la page.
 */

/**
 * `Jour` et `PointSerie` viennent de `@catalog/contracts` et ne sont PAS
 * redeclares ici : ils traversent la frontiere HTTP, donc leur forme appartient
 * au contrat (AGENTS.md §6). Le domaine tient la REGLE — un jour est en heure de
 * Douala, une serie n'a pas de trou — pas la forme.
 */
export type { EtapeEntonnoir, Jour, PointSerie } from "@catalog/contracts";

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const MS_PAR_JOUR = 86_400_000;

/** Jour suivant, en arithmetique de calendrier pure. */
function jourSuivant(j: Jour): Jour {
  const t = Date.parse(`${j}T00:00:00Z`);
  return new Date(t + MS_PAR_JOUR).toISOString().slice(0, 10);
}

/**
 * Serie continue entre deux bornes INCLUSES, trous combles a zero.
 *
 * **Le comblement n'est pas cosmetique.** Un jour sans vue est un jour a zero,
 * pas un jour absent : une courbe qui saute les jours creux relie le lundi au
 * jeudi par une droite et raconte une frequentation qui n'a pas eu lieu. C'est
 * exactement le genre de graphique qui fait prendre une mauvaise decision.
 *
 * Les jours hors bornes sont ignores plutot que d'etendre la periode : c'est
 * l'appelant qui decide de la fenetre affichee.
 */
export function serieContinue(points: readonly PointSerie[], du: Jour, au: Jour): PointSerie[] {
  if (!JOUR.test(du) || !JOUR.test(au)) throw new Error(`bornes invalides : ${du} → ${au}`);
  if (du > au) throw new Error(`bornes inversees : ${du} > ${au}`);

  const parJour = new Map<Jour, number>();
  for (const p of points) {
    if (!JOUR.test(p.jour)) throw new Error(`jour invalide : ${p.jour}`);
    if (!Number.isInteger(p.valeur) || p.valeur < 0) {
      throw new Error(`valeur invalide pour ${p.jour} : ${p.valeur}`);
    }
    // Plusieurs points le meme jour s'additionnent : la base peut avoir une
    // ligne par article, et la serie du jour est leur somme.
    if (p.jour >= du && p.jour <= au) {
      parJour.set(p.jour, (parJour.get(p.jour) ?? 0) + p.valeur);
    }
  }

  const serie: PointSerie[] = [];
  for (let j = du; j <= au; j = jourSuivant(j)) {
    serie.push({ jour: j, valeur: parJour.get(j) ?? 0 });
  }
  return serie;
}

/* ────────────────────────── entonnoir ────────────────────────── */

export interface Entonnoir {
  vues: number;
  commandes: number;
  payees: number;
  prouvees: number;
}

const LIBELLES: Record<EtapeEntonnoirCle, string> = {
  vues: "Articles vus",
  commandes: "Commandes passées",
  payees: "Commandes payées",
  prouvees: "Paiements prouvés",
};

/**
 * L'entonnoir, etape par etape, avec le taux de passage.
 *
 * **Le taux se calcule sur l'etape PRECEDENTE, pas sur le sommet.** Rapporte au
 * sommet, tout ressemble a une hemorragie et on ne voit plus OU ca fuit. Rapporte
 * a l'etape d'avant, la marche qui casse se lit d'un coup d'oeil — et c'est la
 * seule lecture qui mene a une action.
 *
 * Une etape qui remonte n'est pas corrigee en silence : elle est rendue telle
 * quelle, et le pourcentage depasse cent. Un entonnoir qui grossit est un defaut
 * de comptage, et le masquer le rendrait introuvable.
 */
export function etapesEntonnoir(e: Entonnoir): EtapeEntonnoir[] {
  const ordre: EtapeEntonnoirCle[] = ["vues", "commandes", "payees", "prouvees"];
  let precedent: number | null = null;

  return ordre.map((cle) => {
    const valeur = e[cle];
    if (!Number.isInteger(valeur) || valeur < 0) {
      throw new Error(`valeur d'entonnoir invalide pour ${cle} : ${valeur}`);
    }
    const pourcentPrecedent =
      precedent === null ? null : precedent === 0 ? 0 : Math.round((valeur * 100) / precedent);
    precedent = valeur;
    return { cle, libelle: LIBELLES[cle], valeur, pourcentPrecedent };
  });
}
