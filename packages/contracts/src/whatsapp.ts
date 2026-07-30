import { formatXaf } from "./money.ts";
import { normalizePhone } from "./phone.ts";

/**
 * Le message WhatsApp de commande.
 *
 * **Le message doit etre AUTOSUFFISANT en texte brut.** C'est un invariant
 * produit, pas une preference de style : certaines acheteuses sont sur un forfait
 * ou les liens externes echouent — forfait « WhatsApp illimite » sans data
 * generale, cas courant au Cameroun. Si l'information n'est que derriere le lien,
 * la commande n'existe pas.
 *
 * Contenu canonique, ni plus ni moins (AGENTS.md) :
 * **article, quantite, prix unitaire, total, nom de la boutique.**
 *
 * La reference de commande et le code de verification n'y sont PAS. Ils
 * n'existent qu'une fois la commande creee, et les inventer ici produirait un
 * code que la page publique de verification ne connaitrait pas — c'est-a-dire
 * exactement la fausse preuve que le produit combat. Ils rejoignent le message au
 * lot 11.
 */

export interface LigneCommande {
  nom: string;
  quantite: number;
  prixUnitaireXaf: number;
}

export interface CommandeWhatsApp {
  boutique: string;
  lignes: readonly LigneCommande[];
}

/** Total, en entier de francs. Aucun flottant ne traverse ce calcul. */
export function totalCommandeXaf(lignes: readonly LigneCommande[]): number {
  let total = 0;
  for (const l of lignes) {
    if (!Number.isInteger(l.prixUnitaireXaf) || !Number.isInteger(l.quantite)) {
      throw new Error(`ligne non entiere : ${l.nom} ${l.quantite}x${l.prixUnitaireXaf}`);
    }
    if (l.quantite <= 0) throw new Error(`quantite invalide pour ${l.nom} : ${l.quantite}`);
    total += l.prixUnitaireXaf * l.quantite;
  }
  return total;
}

/**
 * Texte du message, en francais simple.
 *
 * Une ligne par article, avec sa quantite et son prix unitaire ; puis le total ;
 * puis le nom de la boutique. Un acheteur qui lit ce message sur un ecran de
 * telephone doit pouvoir verifier le calcul de tete.
 *
 * La ligne d'un seul article porte quand meme sa quantite et son prix unitaire.
 * Les omettre quand la quantite vaut un rendrait le message plus court et
 * l'accord impossible a verifier : c'est precisement le detail sur lequel une
 * contestation se joue.
 */
export function messageCommande(commande: CommandeWhatsApp): string {
  if (commande.lignes.length === 0) throw new Error("une commande a au moins une ligne");

  const lignes = commande.lignes.map(
    (l) =>
      `- ${l.nom} : ${l.quantite} x ${formatXaf(l.prixUnitaireXaf)} = ${formatXaf(
        l.prixUnitaireXaf * l.quantite,
      )}`,
  );

  return [
    "Bonjour, je voudrais commander :",
    ...lignes,
    `Total : ${formatXaf(totalCommandeXaf(commande.lignes))}`,
    `Boutique : ${commande.boutique}`,
  ].join("\n");
}

/**
 * Lien `wa.me` pre-rempli.
 *
 * Trois points sur l'encodage, et chacun casse le lien s'il est manque :
 *
 * 1. **le numero est en chiffres seulement**, sans `+` ni espace. `wa.me/+237…`
 *    ne s'ouvre pas ;
 * 2. **le texte passe par `encodeURIComponent`**. Un saut de ligne devient `%0A`,
 *    et c'est ce qui fait tenir la mise en forme du message ;
 * 3. **`encodeURIComponent` laisse passer `'`, `(`, `)` et `!`**, qui sont
 *    valides dans une chaine de requete. On ne les encode pas a la main : un
 *    double encodage afficherait `%27` dans le message de l'acheteuse.
 */
export function lienWhatsApp(phone: string, message: string): string {
  const n = normalizePhone(phone);
  if (!n) throw new Error(`numero non camerounais : ${phone}`);
  return `https://wa.me/${n.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

/** Le lien complet pour une commande. */
export function lienCommande(phone: string, commande: CommandeWhatsApp): string {
  return lienWhatsApp(phone, messageCommande(commande));
}
