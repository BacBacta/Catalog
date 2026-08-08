import { z } from "zod";
import { VILLE_MAX, VILLE_MIN, villeAcceptable } from "./villes.ts";

/**
 * `normalizePhone` vit desormais dans `phone.ts`, sans Zod : la boutique publique
 * l'importe et ne doit pas payer les schemas. Reexporte ici pour que les
 * appelants existants ne changent pas.
 */
export { normalizePhone } from "./phone.ts";

/**
 * Il n'existe pas de systeme d'adressage postal utilisable au Cameroun.
 * On ne collecte donc JAMAIS de champ « adresse » : quartier + point de
 * repere + telephone, et le point de retrait est un mode a part entiere.
 * Voir docs/adr/0005-pas-de-champ-adresse.md
 */

/**
 * Des EXEMPLES de quartiers, pas une couverture — ADR 0050.
 *
 * Ils ne couvrent que Douala et Yaounde, alors que la ville d'une boutique
 * est desormais libre : ailleurs, le quartier reste du texte libre, et c'est
 * assume. Leur provenance n'est documentee nulle part dans le depot : ils ne
 * valident donc RIEN, ils suggerent.
 */
export const QUARTIERS_SUGGERES = {
  Douala: [
    "Akwa",
    "Bonanjo",
    "Bonapriso",
    "Bonamoussadi",
    "Makepe",
    "Deido",
    "New-Bell",
    "Bepanda",
    "Ndokotti",
    "Logbaba",
    "Bali",
    "Kotto",
    "Cite des Palmiers",
    "PK 14",
  ],
  Yaounde: [
    "Bastos",
    "Essos",
    "Mvog-Mbi",
    "Mokolo",
    "Nlongkak",
    "Biyem-Assi",
    "Mendong",
    "Odza",
    "Nsam",
    "Emana",
    "Ngousso",
    "Mvan",
  ],
} as const;

/** Numero camerounais au format E.164 : +237 puis 9 chiffres commencant par 6 ou 2. */
export const phoneSchema = z
  .string()
  .regex(/^\+237[62]\d{8}$/, "numero camerounais attendu au format +237XXXXXXXXX");

const geoSchema = z.object({ lat: z.number(), lng: z.number() });

/**
 * La ville — ADR 0050. `.refine`, JAMAIS `.trim()` ni `.transform()` : ce
 * schema RELIT du JSON deja stocke, et un schema qui reecrit ce qu'il relit
 * rend toute comparaison ininterpretable.
 */
const villeSchema = z
  .string()
  .refine(villeAcceptable, `la ville tient entre ${VILLE_MIN} et ${VILLE_MAX} caracteres`);

export const deliverySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("livraison"),
    city: villeSchema,
    quartier: z.string().min(2),
    /** Obligatoire : c'est ce qui remplace l'adresse. */
    landmark: z.string().min(5, "un point de repere est indispensable au livreur"),
    phone: phoneSchema,
    geo: geoSchema.optional(),
  }),
  z.object({
    mode: z.literal("retrait"),
    /** Point de rendez-vous convenu, propose par la vendeuse. */
    pickupPoint: z.string().min(3),
    phone: phoneSchema,
  }),
]);

export type Delivery = z.infer<typeof deliverySchema>;
