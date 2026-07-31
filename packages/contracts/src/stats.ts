import { z } from "zod";
import type { proofStateSchema } from "./proof.ts";

/**
 * Ce que l'ecran statistiques recoit. **Source de verite unique** des deux cotes
 * de la frontiere HTTP : la route serialise ces formes, l'app vendeuse les lit,
 * et aucun des deux ne redeclare le type a la main (AGENTS.md §6).
 *
 * Ce fichier ne contient AUCUNE regle de calcul. Les regles vivent dans
 * `apps/api/src/domain/stats` — repartition des ventes, comblement des series,
 * taux d'etape a etape — et elles y sont testees sans base et sans reseau. Ici,
 * on decrit seulement ce qui voyage.
 *
 * **Un chiffre absent se dit `null`, jamais zero.** C'est la meme regle que la
 * note du lot 12 et que `pourcentProuve` : zero se lit « aucune vendeuse ne
 * colle ses SMS », alors que la verite est « on n'a encore rien a mesurer ».
 */

/** Un jour, au format `AAAA-MM-JJ`, en heure de Douala. */
export const jourSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "jour attendu au format AAAA-MM-JJ");
export type Jour = z.infer<typeof jourSchema>;

/**
 * La fenetre observee, bornes INCLUSES.
 *
 * Elle voyage avec les chiffres plutot que d'etre deduite a l'ecran : deux
 * endroits qui recalculent « les trente derniers jours » finissent par ne pas
 * tomber sur le meme jour de bascule, et l'ecran afficherait alors une periode
 * qui n'est pas celle des chiffres qu'il montre.
 */
export const periodeSchema = z.object({
  du: jourSchema,
  au: jourSchema,
  /** Nombre de jours inclus, bornes comprises. */
  jours: z.number().int().positive(),
});
export type Periode = z.infer<typeof periodeSchema>;

export const pointSerieSchema = z.object({
  jour: jourSchema,
  valeur: z.number().int().nonnegative(),
});
export type PointSerie = z.infer<typeof pointSerieSchema>;

/* ────────────────────────── part des ventes prouvees ────────────────────────── */

/**
 * L'indicateur le plus important du produit : la mesure du CONTOURNEMENT.
 *
 * Trois classes et non deux. `contresigne` porte deux voix independantes sur le
 * meme identifiant d'operateur — c'est la preuve la plus forte du produit, et
 * la confondre avec `prouve` effacerait exactement ce que la contre-signature
 * apporte.
 *
 * `pourcent` compte `contresigne` AVEC `prouve` : il est plus fort, pas
 * different. Il vaut `null` quand `total` est nul.
 */
export const repartitionVentesSchema = z.object({
  prouve: z.number().int().nonnegative(),
  contresigne: z.number().int().nonnegative(),
  nonTrace: z.number().int().nonnegative(),
  /**
   * Denominateur : les ventes RETENUES. Les commandes en attente et les
   * commandes contestees n'y sont pas — une vente dont on ignore encore si elle
   * a ete payee ne dit rien du contournement.
   */
  total: z.number().int().nonnegative(),
});
export type RepartitionVentes = z.infer<typeof repartitionVentesSchema>;

/**
 * La repartition, PLUS le pourcentage — c'est ce qui voyage sur le fil.
 *
 * Le pourcentage n'est pas dans la repartition parce qu'il n'est pas de meme
 * nature : les quatre premiers champs sont des comptes, celui-ci est une
 * lecture. Le domaine calcule l'un a partir des autres (`pourcentProuve`), et
 * la route les assemble.
 */
export const partVentesProuveesSchema = repartitionVentesSchema.extend({
  pourcent: z.number().int().min(0).max(100).nullable(),
});
export type PartVentesProuvees = z.infer<typeof partVentesProuveesSchema>;

/* ────────────────────────── entonnoir ────────────────────────── */

export const etapeEntonnoirCleSchema = z.enum(["vues", "commandes", "payees", "prouvees"]);
export type EtapeEntonnoirCle = z.infer<typeof etapeEntonnoirCleSchema>;

/**
 * Une marche de l'entonnoir.
 *
 * `pourcentPrecedent` se rapporte a l'etape d'AVANT, pas au sommet : rapporte
 * au sommet, tout ressemble a une hemorragie et on ne voit plus ou ca fuit.
 * `null` sur la premiere marche, qui n'a pas de precedente.
 */
export const etapeEntonnoirSchema = z.object({
  cle: etapeEntonnoirCleSchema,
  libelle: z.string(),
  valeur: z.number().int().nonnegative(),
  pourcentPrecedent: z.number().int().nonnegative().nullable(),
});
export type EtapeEntonnoir = z.infer<typeof etapeEntonnoirSchema>;

/* ────────────────────────── articles ────────────────────────── */

export const articleVuSchema = z.object({
  id: z.string(),
  nom: z.string(),
  vues: z.number().int().nonnegative(),
});
export type ArticleVu = z.infer<typeof articleVuSchema>;

/* ────────────────────────── la reponse entiere ────────────────────────── */

/**
 * `instrumentation` dit ce que la mesure SAIT, pas ce qu'elle espere.
 *
 * `vuesInstrumentees` vaut `false` tant qu'aucun chemin de code n'ecrit dans
 * `product_view` : la boutique publique est un site statique qui ne compte pas
 * encore ses pages vues. Sans ce drapeau, une vendeuse lirait « 0 vue » comme
 * « personne ne regarde ma boutique » alors que la verite est « rien ne compte
 * encore ». C'est une information manquante signalee, pas comblee (AGENTS.md
 * §7.7) — et l'ecran la dit en toutes lettres.
 */
export const instrumentationSchema = z.object({
  vuesInstrumentees: z.boolean(),
});
export type Instrumentation = z.infer<typeof instrumentationSchema>;

export const statsVendeuseSchema = z.object({
  periode: periodeSchema,
  partVentesProuvees: partVentesProuveesSchema,
  vuesParJour: z.array(pointSerieSchema),
  commandesParJour: z.array(pointSerieSchema),
  entonnoir: z.array(etapeEntonnoirSchema),
  articlesLesPlusVus: z.array(articleVuSchema),
  instrumentation: instrumentationSchema,
});
export type StatsVendeuse = z.infer<typeof statsVendeuseSchema>;

/**
 * Les libelles des etats de preuve, tels qu'ils s'ecrivent a l'ecran.
 *
 * Ils sont ici et non dans `packages/ui` : `blocks.tsx` ne connait deliberement
 * aucun vocabulaire du domaine, et la correspondance « etat → libelle »
 * appartient au contrat, pas au design system. Les trois classes de la part des
 * ventes prouvees en sont un sous-ensemble.
 */
export const LIBELLE_ETAT_PREUVE: Record<z.infer<typeof proofStateSchema>, string> = {
  attendu: "En attente",
  declare_non_trace: "Non tracé",
  prouve: "Prouvé",
  contresigne: "Contresigné",
  conteste: "Contesté",
};
