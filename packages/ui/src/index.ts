/**
 * Primitives partagees. Aucune ne depend de Motion : les transitions sont
 * en CSS, pour tenir le budget de 30 Ko de JS de la boutique publique.
 */
export const TOKENS_HREF = "@catalog/ui/tokens.css";

/** Classes utilitaires reutilisees entre les deux frontends. */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");
