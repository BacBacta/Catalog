import { formatXaf } from "@catalog/contracts/money";
import { texteEntreeBoutique } from "./entree-boutique.ts";

/**
 * Le PACK STATUT — ADR 0061, rang 3a.
 *
 * ── Le principe qui gouverne tout le rang ─────────────────────────────────
 *
 * **Catalog fabrique, la vendeuse poste.** Ni la Cloud API ni aucun outil
 * legitime ne publie un Statut WhatsApp a sa place — c'est une contrainte de
 * la plateforme, pas un choix qu'on pourrait revisiter. Tout ce qu'on peut
 * faire, c'est rendre le geste si court qu'elle le fasse : une image prete,
 * une legende prete, deux transferts.
 *
 * ── Pourquoi le Statut, et pas un autre canal ─────────────────────────────
 *
 * C'est la ou une vendeuse camerounaise montre deja ses articles, tous les
 * jours, a des gens qui la connaissent. On n'invente pas une audience : on
 * outille celle qu'elle a.
 *
 * ── Ce module est PUR ─────────────────────────────────────────────────────
 *
 * Il compose du texte. L'image est fabriquee par l'adaptateur de carte, avec
 * le meme gabarit 1080x1920 que la carte-vitrine (ADR 0037) — c'est deja le
 * format du Statut.
 */

export interface ArticlePourStatut {
  nom: string;
  prixXaf: number;
  /** Le slug avec son suffixe de six caracteres — la cle de relecture. */
  slugArticle: string;
}

export interface PackStatut {
  /**
   * Le mot-cle a PRE-REMPLIR dans le lien : il porte le canal `statut`, donc
   * chaque commande nee d'un Statut se compte comme telle (rang 0). Sans lui,
   * la vendeuse ne saurait jamais lequel de ses gestes rapporte.
   */
  motCle: string;
  /** La legende, prete a coller sous l'image. */
  legende: string;
}

/**
 * ── Ce que la legende dit, et ce qu'elle refuse de dire ───────────────────
 *
 * Elle porte **l'article, le prix, et comment commander**. Elle ne porte NI
 * rarete (« plus que 2 ! »), NI urgence fabriquee (« aujourd'hui seulement »),
 * NI promesse de gratuite : le stock ne se decompte pas tout seul (ADR 0038) et
 * le transfert hors reseau coute 2,22 % (AGENTS.md §2). Une legende qui
 * mentirait sur ces trois points se retournerait contre la vendeuse, devant
 * ses propres clientes.
 *
 * Le lien est un CONFORT, jamais le seul porteur d'information : certains
 * forfaits font echouer les liens externes (AGENTS.md §2). Le nom, le prix et
 * le mot-cle suffisent a commander sans lui.
 */
export function packStatut(e: {
  nomBoutique: string;
  slug: string;
  article: ArticlePourStatut;
  /** Le `wa.me` pre-rempli. Absent : la legende dit le mot-cle, pas le lien. */
  lien: string | null;
}): PackStatut {
  const motCle = texteEntreeBoutique({
    slug: e.slug,
    canal: "statut",
    slugArticle: e.article.slugArticle,
  });
  const lignes = [
    `${e.article.nom} — ${formatXaf(e.article.prixXaf)}`,
    "",
    `Dispo chez ${e.nomBoutique}.`,
    e.lien
      ? `Pour commander, écrivez-moi : ${e.lien}`
      : `Pour commander, envoyez-moi « ${motCle} ».`,
  ];
  return { motCle, legende: lignes.join("\n") };
}

/**
 * Le message qui ACCOMPAGNE l'image dans le fil de la vendeuse.
 *
 * Il est separe de la legende, et c'est essentiel : la legende part chez les
 * clientes, ce message-ci reste entre nous. Les melanger ferait poster a la
 * vendeuse une consigne qui lui etait destinee.
 */
export function consigneDuPack(): string {
  /* Pas de promesse de comptage : le canal est marqué à l'entrée mais n'est
     encore compté nulle part (ADR 0066), et l'écran des chiffres dit ce
     manque en toutes lettres. Promettre ici « se compteront à part » était le
     mensonge que `stats-instrumentation.test.ts` interdit côté drapeau —
     constat D1 de l'audit 2026-08. La phrase reviendra avec le compteur. */
  return (
    "📲 Votre carte pour le Statut. Transférez l'image, puis collez la légende " +
    "du message suivant."
  );
}
