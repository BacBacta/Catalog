/**
 * L'entree dans le bot depuis la boutique web — ADR 0066, rang 0 de l'ADR 0061.
 *
 * ── La fuite qu'on ferme ──────────────────────────────────────────────────
 *
 * Le bouton « Commander » pointait `wa.me/<numero personnel de la vendeuse>`.
 * L'acheteuse atterrissait dans une conversation humaine : **aucune commande
 * creee, pas de rampe, pas de preuve, pas de recu, pas de statistique**. Tout
 * ce qui a ete construit des lots 7 a 12 etait invisible depuis cette porte.
 *
 * ── Ce qui NE ferme PAS ───────────────────────────────────────────────────
 *
 * Le numero de la vendeuse reste sur la page, sous « Parler a la vendeuse ».
 * « L'acheteuse et la vendeuse continuent de se parler sur WhatsApp » est un
 * invariant produit (AGENTS.md §1), pas une etape transitoire. Ce qui change
 * est le ROLE : ce numero porte la relation, plus le comptoir.
 *
 * ── Pourquoi ce module n'importe rien du baril ────────────────────────────
 *
 * Il est charge par le navigateur. Un import depuis `@catalog/contracts`
 * ferait entrer les schemas Zod dans l'ilot — mesure : 20,6 Ko au lieu de 1,8
 * (lot 6). Le texte est donc compose ici, et le DOMAINE le relit
 * (`domain/bot/entree-boutique.ts`). Les deux formes sont tenues par des
 * tests des deux cotes.
 */

/**
 * Le numero du bot. C'est le meme pour TOUTES les boutiques — un seul WABA
 * (ADR 0034) —, ce qui est aussi pourquoi la carte-vitrine met le mot-cle de
 * la boutique en avant et le numero en ligne de service (ADR 0059).
 *
 * Sans la variable, la valeur est vide et l'appelant DOIT retomber sur le
 * numero de la vendeuse : un bouton « Commander » vers `wa.me/` sans numero
 * ouvrirait WhatsApp sur rien.
 */
export const NUMERO_BOT = (import.meta.env.PUBLIC_BOT_WHATSAPP ?? "").trim();

/**
 * Le lien qui depose l'acheteuse dans le fil du bot, sur LA boutique et — quand
 * elle vient d'une fiche produit — sur CET article.
 *
 * Le texte se lit comme une phrase parce qu'elle le voit dans son champ de
 * saisie avant de l'envoyer : `boutique chez-ngo web robe-wax-a1b2c3`.
 */
export function lienCommanderAuBot(
  _whatsappVendeuse: string,
  slugBoutique: string,
  slugArticle?: string,
): string {
  const texte = ["boutique", slugBoutique, "web", slugArticle].filter(Boolean).join(" ");
  return `https://wa.me/${NUMERO_BOT.replace(/\D/g, "")}?text=${encodeURIComponent(texte)}`;
}

/** Le bot est-il joignable ? Faux : la page garde le chemin d'avant. */
export function botDisponible(): boolean {
  return NUMERO_BOT.replace(/\D/g, "").length > 0;
}
