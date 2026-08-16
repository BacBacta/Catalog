/**
 * Le contrat de synchronisation du catalogue Commerce Manager — ADR 0108.
 *
 * Defini ICI et implemente dans `adapters/catalogue-meta.ts`, comme le
 * stockage : la regle de dependance veut que le domaine ne connaisse aucun
 * fournisseur. `retailer_id` chez Meta est l'identifiant de l'article en
 * base — aucune table de correspondance, aucune seconde verite.
 */

export interface FicheCatalogue {
  /** L'identifiant de l'article en base — devient `retailer_id` chez Meta. */
  id: string;
  nom: string;
  prixXaf: number;
  description?: string | undefined;
  /** URL PUBLIQUE de la declinaison JPEG (ADR 0017) — exigee : pas d'image, pas de fiche. */
  imageUrl: string;
  /** La page publique de la boutique — Meta exige un lien de site par fiche. */
  lienBoutique: string;
  /** `false` retire la fiche de la vente sans l'effacer (conges). */
  disponible: boolean;
}

export interface SynchroniseurCatalogue {
  readonly nom: string;
  /** Pousse (cree ou remplace) des fiches. Leve si le LOT entier est refuse. */
  pousser(fiches: readonly FicheCatalogue[]): Promise<void>;
  /** Retire des fiches par identifiant d'article. Idempotent : absent = deja fait. */
  retirer(articleIds: readonly string[]): Promise<void>;
}
