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
  /* `00237…` est la forme composee depuis un fixe, et elle circule : la
     reconnaitre ici evite qu'elle soit refusee ici et acceptee ailleurs
     (le bot la tolerait deja de son cote — ADR 0055). */
  const sansPrefixeInternational = digits.startsWith("00") ? digits.slice(2) : digits;
  const national = sansPrefixeInternational.startsWith("237")
    ? sansPrefixeInternational.slice(3)
    : sansPrefixeInternational;
  if (!/^[62]\d{8}$/.test(national)) return null;
  return `+237${national}`;
}

/**
 * Mise en forme LISIBLE, telle qu'on dicte un numero au Cameroun :
 * `6 77 12 34 56`.
 *
 * Elle sert la ou un numero doit etre recopie a la main sur un clavier de
 * telephone — le numero de reversement, dans le message WhatsApp et sur l'ecran
 * de paiement. Neuf chiffres colles se recopient mal, et un chiffre faux envoie
 * l'argent chez quelqu'un d'autre.
 *
 * Une saisie non reconnue est rendue telle quelle : mieux vaut afficher ce qu'on
 * a recu que de le mettre en forme de travers.
 */
export function formatPhone(input: string): string {
  const n = normalizePhone(input);
  if (!n) return input;
  const national = n.slice(-9);
  /* `690 11 22 33` — ADR 0051. Les TROIS premiers chiffres identifient
     l'operateur (69x Orange, 67x/68x MTN, 62x Nexttel), et l'operateur decide
     de tout ici : le code USSD, les frais hors reseau, quel SMS fera preuve.
     Les grouper garde cette information lisible ; `6 90` la coupait en deux.
     C'est aussi la forme des douze exemples des copies, et la seule que la
     saisie acceptait avant ce lot. */
  return `${national.slice(0, 3)} ${national.slice(3, 5)} ${national.slice(5, 7)} ${national.slice(7, 9)}`;
}
