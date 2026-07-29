import { z } from "zod";

/**
 * Il n'existe pas de systeme d'adressage postal utilisable au Cameroun.
 * On ne collecte donc JAMAIS de champ « adresse » : quartier + point de
 * repere + telephone, et le point de retrait est un mode a part entiere.
 * Voir docs/adr/0005-pas-de-champ-adresse.md
 */

export const QUARTIERS = {
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

export type City = keyof typeof QUARTIERS;

/** Numero camerounais au format E.164 : +237 puis 9 chiffres commencant par 6 ou 2. */
export const phoneSchema = z
  .string()
  .regex(/^\+237[62]\d{8}$/, "numero camerounais attendu au format +237XXXXXXXXX");

const geoSchema = z.object({ lat: z.number(), lng: z.number() });

export const deliverySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("livraison"),
    city: z.enum(["Douala", "Yaounde"]),
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

/** Normalise les saisies courantes vers E.164. Renvoie null si non reconnaissable. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "").replace(/^\+/, "");
  const national = digits.startsWith("237") ? digits.slice(3) : digits;
  if (!/^[62]\d{8}$/.test(national)) return null;
  return `+237${national}`;
}
