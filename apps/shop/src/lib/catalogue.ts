/**
 * Les donnees de la boutique publique, lues AU MOMENT DE LA CONSTRUCTION.
 *
 * La boutique est un site statique servi depuis le CDN : cette lecture n'a lieu
 * qu'une fois, a la construction. Aucune requete de base n'existe au moment ou
 * une acheteuse ouvre la page — c'est ce qui permet de tenir un LCP sous 2,5 s
 * sur un reseau mobile sature depuis Douala alors que l'origine est en Europe
 * (ADR 0003).
 *
 * **Ce module ne connait pas Prisma, et ne doit jamais le connaitre.** Il lit un
 * instantane JSON produit par `apps/api/scripts/exporter-catalogue.mjs`. Faire
 * entrer un client de base dans le graphe d'un paquet dont la contrainte est de
 * peser moins de 30 Ko de JavaScript serait une inversion de la regle de
 * dependance.
 *
 * **Sans instantane, aucune page de boutique n'est construite.** Pas de boutique
 * de demonstration, pas de donnees de repli : une fausse boutique publiee sous le
 * nom d'une vraie vendeuse serait pire qu'une page absente. La construction
 * reussit quand meme, avec un avertissement.
 */

/* ────────────────────────── l'instantane brut ────────────────────────── */

export interface ArticleBrut {
  id: string;
  nom: string;
  prixXaf: number;
  stock: number;
  variantes: unknown;
  imageCle: string | null;
  imageLargeur: number | null;
  imageHauteur: number | null;
}

export interface BoutiqueBrute {
  slug: string;
  nom: string;
  ville: string;
  quartier: string | null;
  pointDeRetrait: string | null;
  whatsapp: string;
  reversementVerifie: boolean;
  enConges?: boolean;
  notes: number[];
  articles: ArticleBrut[];
}

export interface Instantane {
  version: number;
  boutiques: BoutiqueBrute[];
}

/* ────────────────────────── la forme affichee ────────────────────────── */

export interface ImagePublique {
  avif: string;
  webp: string;
  /** Dimensions de l'objet stocke. Elles sont posees sur `<img>`. */
  largeur: number;
  hauteur: number;
}

export interface ArticlePublic {
  id: string;
  slug: string;
  nom: string;
  prixXaf: number;
  /** `null` quand la vendeuse ne suit pas son stock. Ce n'est pas « zero ». */
  stock: number | null;
  variantes: string[];
  image: ImagePublique | null;
}

export interface BoutiquePublique {
  slug: string;
  nom: string;
  ville: string;
  quartier: string | null;
  pointDeRetrait: string | null;
  /** Numero WhatsApp : le numero de CONNEXION, jamais celui de reversement. */
  whatsapp: string;
  verifiee: boolean;
  /**
   * Mode conges — ADR 0039. La boutique reste publiee et lisible ; elle
   * n'invite simplement plus a commander. Le verrou qui compte est dans le bot,
   * qui lit la base a chaque message : ces pages sont figees a la construction.
   */
  enConges: boolean;
  note: { moyenne: number; nombre: number } | null;
  articles: ArticlePublic[];
}

/**
 * Base publique des objets media.
 *
 * **Les photos de catalogue sont du contenu public**, et c'est une revision
 * assumee de l'ADR 0016 : il posait « les objets ne sont jamais publics », ce qui
 * vaut pour tout ce qui est sensible mais pas pour une photo dont l'usage entier
 * est d'etre montree a des acheteuses. Une URL signee expire en quinze minutes ;
 * une page statique en cache CDN vit des jours. Les deux sont incompatibles, et
 * c'est la page qui a raison. Voir ADR 0017.
 *
 * Les cles restent OPAQUES : ni identifiant de vendeuse, ni nom de fichier.
 * Public ne veut pas dire enumerable.
 */
export const MEDIA_BASE = process.env.MEDIA_PUBLIC_BASE ?? "/media";

export function imagePublique(
  cle: string | null,
  largeur: number | null,
  hauteur: number | null,
  base: string = MEDIA_BASE,
): ImagePublique | null {
  // Sans dimensions connues, on n'affiche PAS l'image. Un `<img>` sans largeur ni
  // hauteur fait sauter la page quand la photo arrive, et le budget de decalage
  // visuel est de 0,1. Mieux vaut un cadre vide qu'une page qui bouge.
  if (!cle || !largeur || !hauteur || largeur <= 0 || hauteur <= 0) return null;
  return {
    avif: `${base}/${cle}.avif`,
    webp: `${base}/${cle}.webp`,
    largeur,
    hauteur,
  };
}

/**
 * Identifiant d'URL d'un article.
 *
 * Les diacritiques sont retirees : une URL qui porte « é » se partage mal par
 * copier-coller dans WhatsApp, et le partage WhatsApp est le canal du produit.
 * Le suffixe garantit l'unicite sans exiger une colonne de plus — deux articles
 * peuvent legitimement s'appeler « pagne wax ».
 */
/**
 * Le slug d'article vit dans `@catalog/contracts/slug` — **une seule
 * ecriture** (ADR 0073). Le bot en a besoin pour ses liens marques, et les
 * deux paquets ne peuvent pas s'importer l'un l'autre : la regle est donc
 * remontee dans le seul endroit que les deux ont deja le droit de lire.
 *
 * Reexporte ici pour que les appelants existants ne changent pas.
 */
import { slugArticle } from "@catalog/contracts/slug";

export { slugArticle };

/** Variantes : une forme inattendue est ignoree, jamais devinee. */
export function variantes(valeur: unknown): string[] {
  if (!Array.isArray(valeur)) return [];
  return valeur.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/**
 * Moyenne des avis VERIFIES, arrondie au dixieme.
 *
 * `null` quand il n'y en a aucun : une boutique sans avis n'est pas une boutique
 * mal notee, et afficher « 0 sur 5 » a une nouvelle vendeuse la condamnerait.
 */
export function noteMoyenne(notes: readonly number[]): { moyenne: number; nombre: number } | null {
  const valides = notes.filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
  if (valides.length === 0) return null;
  const somme = valides.reduce((s, n) => s + n, 0);
  return { moyenne: Math.round((somme / valides.length) * 10) / 10, nombre: valides.length };
}

/** Mise en forme d'une boutique. Fonction pure : testable sans base ni fichier. */
export function versBoutiquePublique(
  b: BoutiqueBrute,
  base: string = MEDIA_BASE,
): BoutiquePublique {
  return {
    slug: b.slug,
    nom: b.nom,
    ville: b.ville,
    quartier: b.quartier,
    pointDeRetrait: b.pointDeRetrait,
    whatsapp: b.whatsapp,
    /**
     * Le badge ne dit pas « vendeuse de confiance » — nous n'avons aucun moyen de
     * l'attester. Il dit que le numero sur lequel elle encaisse a ete verifie par
     * un code recu sur ce numero. C'est un fait controlable, et c'est le seul
     * qu'on puisse afficher a ce stade.
     */
    verifiee: b.reversementVerifie,
    /**
     * Mode conges — ADR 0039.
     *
     * L'instantane est fige a la CONSTRUCTION : une vendeuse qui ferme a midi
     * ne change pas ces pages avant la prochaine publication. Ce n'est pas un
     * defaut a rattraper ici — c'est pourquoi le verrou qui compte est dans le
     * bot, qui lit la base a chaque message. Ce drapeau-ci evite d'inviter a
     * commander pour rien ; il ne garantit rien a lui seul.
     */
    enConges: b.enConges === true,
    note: noteMoyenne(b.notes ?? []),
    articles: (b.articles ?? []).map((a) => ({
      id: a.id,
      slug: slugArticle(a.nom, a.id),
      nom: a.nom,
      prixXaf: a.prixXaf,
      stock: a.stock > 0 ? a.stock : null,
      variantes: variantes(a.variantes),
      image: imagePublique(a.imageCle, a.imageLargeur, a.imageHauteur, base),
    })),
  };
}

/**
 * L'instantane est charge par `import.meta.glob`, et non par `node:fs`.
 *
 * Deux raisons, et la seconde est celle qui a coute une construction :
 *
 * 1. **le module ne touche pas au systeme de fichiers**, ce qui le rend testable
 *    sans preparer de repertoire ;
 * 2. **un chemin relatif a `import.meta.url` ne survit pas au regroupement.**
 *    Astro deplace ce module dans `dist/.prerender/`, ou le chemin calcule ne
 *    pointe plus sur rien : la construction reussissait en annoncant zero
 *    boutique. `import.meta.glob` est resolu par le regroupeur, a la source.
 *
 * Le glob rend un objet vide quand le fichier n'existe pas — ce qui est
 * exactement le comportement voulu quand aucun instantane n'a ete produit.
 */
const MODULES = import.meta.glob<Instantane>("../data/catalogue.json", {
  eager: true,
  import: "default",
});

export function chargerBoutiques(
  instantane: Instantane | null = premierInstantane(),
): BoutiquePublique[] {
  if (!instantane) {
    console.warn(
      "[boutique] instantane absent : aucune page de boutique n'est construite. " +
        "C'est volontaire — lancez `pnpm shop:snapshot` avec une base.",
    );
    return [];
  }
  if (instantane.version !== 1) {
    // Lever plutot que deviner : un instantane d'une autre version pourrait
    // produire des pages plausibles et fausses.
    throw new Error(`instantane de version ${instantane.version} inattendue`);
  }
  return (instantane.boutiques ?? []).map((b) => versBoutiquePublique(b));
}

function premierInstantane(): Instantane | null {
  return (Object.values(MODULES)[0] as Instantane | undefined) ?? null;
}
