/**
 * Le slug d'un article — **la seule ecriture de cette regle**.
 *
 * ── Pourquoi elle vit ICI, et pas dans l'un des deux appelants ────────────
 *
 * Deux paquets en ont besoin, et ils ne peuvent pas s'importer l'un l'autre :
 *
 * - `apps/shop` en fait ses URL (`/chez-bea/robe-wax-a1b2c3`) ;
 * - `apps/api` en fait les liens marques du bot (ADR 0061, rang 3).
 *
 * La regle de dependance interdit le pont direct : la boutique ne connait pas
 * l'API, l'API ne connait pas la boutique. L'ecrire deux fois etait la
 * tentation, et un test de parite aurait pu la surveiller — mais un test de
 * parite surveille une divergence, il ne l'empeche pas, et le jour ou elle
 * arriverait un lien de Statut menerait a une page 404.
 *
 * `packages/contracts` est le seul endroit que les deux ont deja le droit de
 * lire. La regle y est ecrite une fois.
 *
 * ── Ce module est SUR pour le navigateur ──────────────────────────────────
 *
 * Aucun schema Zod, aucun effet de bord au niveau du module : c'est une
 * fonction de chaine. Il s'importe donc par son sous-chemin `@catalog/
 * contracts/slug` — **jamais par le baril**, dont les declarations Zod
 * pesaient 20,6 Ko compresses au lieu de 1,8 (lot 6).
 */

/**
 * Le suffixe de six caracteres est ce qui rend le slug UNIQUE : deux articles
 * peuvent porter le meme nom chez la meme vendeuse, et c'est frequent — deux
 * lots de la meme robe, deux arrivages du meme tissu.
 *
 * Le repli `article` couvre un nom qui ne laisse aucun caractere exploitable :
 * uniquement des emoji, uniquement de la ponctuation, ou vide. Sans lui, le
 * slug commencerait par un tiret et l'URL serait laide sans etre fausse.
 */
export function slugArticle(nom: string, id: string): string {
  const base = nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "article"}-${id.slice(-6)}`;
}
