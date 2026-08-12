/**
 * La chaine WhatsApp de la vendeuse — ADR 0061, rang 3b.
 *
 * ── Pourquoi une chaine, et pourquoi c'est ELLE qui la tient ──────────────
 *
 * Une chaine WhatsApp diffuse a des abonnes qui ont choisi de suivre. C'est
 * l'audience qu'une vendeuse construit une fois et garde — contrairement au
 * Statut, qui disparait en 24 h et ne touche que son carnet d'adresses.
 *
 * **Catalog ne cree ni n'alimente aucune chaine.** Aucun outil legitime ne le
 * peut : la Cloud API ne publie pas dans une chaine, et il n'existe pas d'API
 * de chaines. Comme pour le Statut (rang 3a), le produit fabrique et la
 * vendeuse poste. Ce qu'on ajoute ici est plus petit encore : on RANGE son
 * lien, on le montre sur sa page, et on lui donne des munitions marquees.
 *
 * ── Ce qu'on ne peut PAS verifier, et qui se dit ──────────────────────────
 *
 * Que la chaine existe, qu'elle soit a elle, qu'elle soit active : rien de
 * cela n'est verifiable sans API. On valide donc la FORME du lien, et rien
 * d'autre. Une vendeuse qui colle le lien d'une chaine qui n'est pas la sienne
 * obtiendra une page qui pointe ailleurs — c'est son lien, sur sa page, sous
 * sa responsabilite, exactement comme son numero WhatsApp.
 *
 * ── Ce module est PUR ─────────────────────────────────────────────────────
 */

/** « ma chaine » — le geste d'une vendeuse qui veut ranger ou revoir son lien. */
export function demandeChaine(texteBrut: string): boolean {
  const net = texteBrut.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return /^(?:ma chaine|chaine|ma chaine whatsapp|channel|my channel)$/.test(net);
}

/**
 * L'hote et le chemin d'une chaine WhatsApp.
 *
 * `whatsapp.com/channel/<identifiant>` — avec ou sans `www`, avec ou sans
 * `https://`. L'identifiant est la partie opaque que Meta attribue ; on ne
 * suppose ni sa longueur exacte ni son alphabet au-dela de ce qu'on a vu, on
 * exige seulement qu'il soit non vide et sans separateur de chemin.
 *
 * **On n'invente pas de format plus strict.** Un motif trop serre rejetterait
 * un lien parfaitement valide, et une vendeuse n'a aucun moyen de comprendre
 * pourquoi — alors qu'un lien accepte a tort produit une page qui pointe
 * ailleurs, ce qui se voit et se corrige.
 */
const LIEN_CHAINE =
  /^(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)\/?(?:\?[^\s]*)?$/i;

/**
 * Lit un lien de chaine et le rend sous sa forme CANONIQUE, ou `null`.
 *
 * La canonisation compte : deux vendeuses qui collent la meme chaine, l'une
 * depuis le partage mobile (`https://whatsapp.com/channel/X`) et l'autre depuis
 * le web (`www.whatsapp.com/channel/X?...`), doivent produire la meme chose —
 * sinon la page publique et la carte afficheraient deux liens differents pour
 * une seule chaine.
 *
 * Les parametres de suivi sont RETIRES : ils viennent du partage, ils
 * n'appartiennent pas au lien, et les republier ferait porter a la boutique
 * les traces d'un tiers.
 */
export function lireLienChaine(brut: string): string | null {
  const m = LIEN_CHAINE.exec(brut.trim());
  const identifiant = m?.[1];
  if (!identifiant) return null;
  return `https://whatsapp.com/channel/${identifiant}`;
}

/** « retirer » — la vendeuse reprend son lien. Le geste inverse existe toujours. */
export function demandeRetraitChaine(texteBrut: string): boolean {
  const net = texteBrut.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return /^(?:retirer|retire|enlever|supprimer|aucune|pas de chaine)$/.test(net);
}
