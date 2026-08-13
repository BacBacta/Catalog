/**
 * Le jeton du lien de suivi de l'acheteuse.
 *
 * **Il autorise ; le code de verification, lui, identifie.** La distinction est
 * le coeur de la securite du lot 10 :
 *
 * - la reference `CT-1043` se devine — elle est sequentielle et voyage en clair
 *   dans la conversation WhatsApp ;
 * - le code de verification est PUBLIC des qu'un recu est montre : c'est son
 *   role, n'importe qui doit pouvoir controler le paiement avec ;
 * - donc ni l'un ni l'autre ne peut ouvrir la contre-signature. Sinon il
 *   suffirait d'essayer des references, ou d'avoir vu un recu, pour valider le
 *   paiement de quelqu'un d'autre — et la contre-signature perdrait ce qui fait
 *   toute sa valeur : etre la voix de l'AUTRE partie, celle qui n'a rien a
 *   gagner a mentir.
 *
 * Module PUR : l'alea arrive en parametre, comme pour le code de verification.
 * Aucun `Math.random()`, aucun `crypto` importe ici — c'est ce qui rend le test
 * deterministe et l'implementation remplacable.
 */

/**
 * Alphabet base64url, sans remplissage.
 *
 * 64 caracteres : un octet donne exactement six bits utiles apres masquage,
 * **sans rejet ni modulo biaise**. Contrairement au code de verification, ce
 * jeton ne se dicte pas au telephone — il voyage dans un lien —, donc rien
 * n'oblige a ecarter les caracteres ambigus, et on prefere l'entropie par
 * caractere.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Longueur du jeton, en caracteres.
 *
 * 32 caracteres de base64url = **192 bits**. C'est tres au-dela du necessaire,
 * et c'est voulu : ce jeton est le seul secret du parcours acheteuse, il n'a
 * pas de second facteur, il n'expire pas tant que la commande vit, et il ne
 * coute rien a rallonger. Un jeton court serait la seule piece a attaquer.
 */
export const LONGUEUR_JETON = 32;

/** Le jeton, en clair. Il ne se journalise pas : c'est un secret de porteur. */
export function genererJetonSuivi(
  randomBytes: (n: number) => Uint8Array,
  longueur: number = LONGUEUR_JETON,
): string {
  const out: string[] = [];
  while (out.length < longueur) {
    for (const octet of randomBytes(longueur)) {
      // Masque de six bits : chaque octet donne un caractere, sans rejet.
      out.push(ALPHABET[octet & 63] as string);
      if (out.length === longueur) break;
    }
  }
  return out.join("");
}

/**
 * Un jeton recu d'une URL a-t-il la forme attendue ?
 *
 * Ce controle n'est PAS une authentification — c'est la base qui tranche, sur
 * une colonne UNIQUE. Il evite seulement d'aller interroger la base avec une
 * chaine qui ne peut de toute facon correspondre a rien, et il empeche une
 * saisie fantaisiste d'atteindre la couche de donnees.
 */
export function jetonBienForme(valeur: string): boolean {
  return (
    typeof valeur === "string" && new RegExp(`^[A-Za-z0-9_-]{${LONGUEUR_JETON}}$`).test(valeur)
  );
}

/**
 * Le lien de suivi complet.
 *
 * La base d'URL arrive en parametre : le domaine ne connait ni environnement ni
 * nom de domaine.
 */
export function lienDeSuivi(base: string, jeton: string): string {
  return `${base.replace(/\/$/, "")}/suivi/${jeton}`;
}

/** Le lien public de verification d'un recu. Le code y voyage : il est public. */
export function lienDeVerification(base: string, code: string): string {
  return `${base.replace(/\/$/, "")}/v/${encodeURIComponent(code)}`;
}

/**
 * La MEME page, sous la forme dont le produit DEPEND (lot 10, ADR 0021) :
 * `/v/?c=<code>` marche sans la reecriture de `public/_redirects` — en dev,
 * en previsualisation, derriere n'importe quel CDN. C'est CELLE-CI qui part
 * dans un message : la jolie URL est un decor, celle-la est un contrat.
 */
export function lienDeVerificationPortable(base: string, code: string): string {
  return `${base.replace(/\/$/, "")}/v/?c=${encodeURIComponent(code)}`;
}
