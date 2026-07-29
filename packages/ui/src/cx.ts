/**
 * Concatenation de classes. Volontairement minuscule.
 *
 * shadcn utilise `cn` = clsx + tailwind-merge. On s'en passe : les deux pesent
 * ~8 Ko compresses, et la boutique publique a un budget de 30 Ko de JS pour
 * TOUT son chemin critique. tailwind-merge ne sert qu'a resoudre des classes
 * contradictoires ; ici les classes sont ecrites a la main, donc il n'y a rien
 * a resoudre. Voir ADR 0012.
 */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");
