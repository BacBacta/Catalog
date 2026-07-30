/**
 * Le numero de telephone camerounais — SANS Zod.
 *
 * Ce fichier est volontairement seul dans son module, et c'est une contrainte de
 * poids, pas de style. `normalizePhone` vivait dans `delivery.ts`, qui declare des
 * schemas Zod : l'importer depuis la boutique publique faisait entrer Zod dans le
 * chemin critique. Les schemas ont des effets de bord au niveau du module, donc
 * l'elagage ne les retire pas — mesure, l'ilot de la boutique pesait 20,6 Ko
 * compresses au lieu de 1,5.
 *
 * Regle qui en decoule, et qui vaut pour tout ce que la boutique importe :
 * **une fonction destinee au navigateur ne partage pas son module avec un schema.**
 */

/**
 * Normalise les saisies courantes vers E.164 (`+237XXXXXXXXX`).
 *
 * Accepte « 6 77 12 34 56 », « 677123456 », « 237677123456 »,
 * « +237 677 12 34 56 ». Renvoie `null` quand ce n'est pas reconnaissable :
 * refuser une mise en forme serait un echec de produit — personne n'ecrit son
 * numero en E.164 — mais deviner un numero serait pire.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "").replace(/^\+/, "");
  const national = digits.startsWith("237") ? digits.slice(3) : digits;
  if (!/^[62]\d{8}$/.test(national)) return null;
  return `+237${national}`;
}
