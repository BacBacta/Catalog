/**
 * Le lien d'ENTREE dans une boutique — ADR 0066, rang 0 de l'ADR 0061.
 *
 * ── Un seul texte, trois informations ─────────────────────────────────────
 *
 * `boutique chez-ngo web robe-wax-a1b2c3`
 *   ├── quelle BOUTIQUE   : chez-ngo
 *   ├── par ou on ARRIVE  : web
 *   └── quel ARTICLE      : celui dont l'identifiant finit par a1b2c3
 *
 * ── Pourquoi ca se lit comme une phrase ───────────────────────────────────
 *
 * Ce texte est PRE-REMPLI dans un lien `wa.me` : l'acheteuse le voit dans son
 * champ de saisie avant de l'envoyer, et peut le modifier. Un identifiant
 * technique — un cuid de vingt-cinq caracteres — la ferait hesiter, ou effacer.
 * D'ou le slug d'article, qui porte le nom pour elle et les six derniers
 * caracteres de l'identifiant pour nous.
 *
 * ── Ce qu'il ne porte JAMAIS ──────────────────────────────────────────────
 *
 * Aucun secret. Ce lien s'affiche dans une barre d'adresse, se copie, se
 * transfere. Ni jeton acheteuse (ADR 0021), ni numero : que des identifiants
 * publics.
 */

/**
 * D'ou vient l'acheteuse. **Liste FERMEE** : sans elle, le premier mot venu
 * deviendrait une source de trafic, et les statistiques diraient n'importe
 * quoi avec aplomb.
 *
 * `direct` est un canal a part entiere — celui d'un lien partage de la main a
 * la main —, pas un fourre-tout : une entree SANS marque reste sans canal, et
 * c'est une information differente.
 */
export const CANAUX = ["statut", "chaine", "carte", "web", "direct"] as const;

export type Canal = (typeof CANAUX)[number];

export interface EntreeBoutique {
  slug: string;
  /** Absent quand le lien ne le porte pas. On n'invente pas d'origine. */
  canal?: Canal;
  /**
   * Les six derniers caracteres de l'identifiant de l'article, extraits du
   * slug ecrit par `slugArticle`. Le service resout ; ce module ne connait
   * aucun article.
   */
  articleSuffixe?: string;
}

/** Le suffixe que `slugArticle` colle en fin : six caracteres alphanumeriques. */
const SUFFIXE = /-([a-z0-9]{6})$/;

export function lireEntreeBoutique(texteBrut: string): EntreeBoutique | null {
  const net = texteBrut.trim().toLowerCase();

  const mots = net.split(/\s+/).filter(Boolean);
  let slug: string | null = null;
  let reste: string[] = [];

  const marque = mots.indexOf("boutique");
  if (marque !== -1 && mots[marque + 1]) {
    const candidat = mots[marque + 1] as string;
    if (/^[a-z0-9][a-z0-9-]*$/.test(candidat)) {
      slug = candidat;
      reste = mots.slice(marque + 2);
    }
  } else if (mots.length >= 1 && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(mots[0] as string)) {
    /* Le slug nu, pour qui le retape de memoire. */
    slug = mots[0] as string;
    reste = mots.slice(1);
  }
  if (!slug) return null;

  const canal = CANAUX.find((c) => reste.includes(c));

  /* L'article : le premier mot restant qui porte un suffixe exploitable et
     qui n'est pas un canal. */
  const article = reste.find((m) => m !== canal && SUFFIXE.test(m));
  const suffixe = article ? SUFFIXE.exec(article)?.[1] : undefined;

  return {
    slug,
    ...(canal ? { canal } : {}),
    ...(suffixe ? { articleSuffixe: suffixe } : {}),
  };
}

/**
 * Le texte a PRE-REMPLIR dans un lien d'entree. Ecrit ici pour que les deux
 * bouts — celui qui compose et celui qui relit — ne puissent pas diverger.
 */
export function texteEntreeBoutique(entree: {
  slug: string;
  canal?: Canal;
  slugArticle?: string;
}): string {
  return ["boutique", entree.slug, entree.canal, entree.slugArticle].filter(Boolean).join(" ");
}
