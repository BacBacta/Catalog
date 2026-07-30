import { formatXaf } from "./money.ts";
import { formatPhone, normalizePhone } from "./phone.ts";

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

/**
 * Le bloc de paiement, ajoute au message quand un versement est en cours.
 *
 * **Il ne remplace pas la rampe, il la double.** La rampe pre-remplit le clavier
 * par un lien `tel:` ; ce bloc ecrit le meme numero et le meme montant en TEXTE
 * BRUT, pour que l'acheteuse puisse payer a la main si le lien echoue — iPhone
 * bloque les liens USSD, un raccourci non verifie peut s'arreter en route, et un
 * forfait « WhatsApp seul » ne suit aucun lien externe.
 *
 * Il n'apparait QUE la ou un numero de reversement est connu, c'est-a-dire sur
 * l'ecran de paiement. La fiche article publique ne le porte pas : le numero de
 * reversement d'une vendeuse n'a rien a faire sur une page en cache CDN.
 */
export interface PaiementWhatsApp {
  /** Numero de reversement de la vendeuse — celui qui recoit les fonds. */
  numeroReversement: string;
  montantXaf: number;
}

/**
 * Ce qui identifie une commande DEJA CREEE (lot 11).
 *
 * Absent tant que la commande n'existe pas — c'est le sens du `?` sur
 * `CommandeWhatsApp.suivi`. Avant creation, ces deux champs ne s'inventent pas :
 * un code inconnu de la page publique de verification serait exactement la
 * fausse preuve que le produit combat.
 *
 * Le code de verification IDENTIFIE, il n'autorise rien. Le mettre dans un
 * message WhatsApp est donc sans danger, et c'est meme son usage : l'acheteuse
 * doit pouvoir controler le recu sans compte et sans lien. Le `buyerToken` du
 * suivi, lui, n'a RIEN a faire ici — il autorise la contre-signature, et un
 * message WhatsApp se transfere.
 */
export interface SuiviWhatsApp {
  reference: string;
  codeVerification: string;
}

/**
 * Formes acceptees, en expressions regulieres NUES.
 *
 * Volontairement non importees de `order.ts` : ce module est charge par la
 * boutique publique via le sous-chemin `./whatsapp`, et `order.ts` declare des
 * schemas Zod dont les effets de bord survivent a l'elagage — 20,6 Ko au lieu
 * de 1,8 (CLAUDE.md, lot 6). Un test de `contracts` verifie que ces deux
 * expressions acceptent exactement ce que les schemas Zod acceptent, pour que
 * la duplication ne devienne pas une divergence.
 */
const FORME_REFERENCE = /^CT-\d{3,8}$/;
const FORME_CODE = /^[ACDEFGHJKMNPQRTUVWXY34679]{4}-[ACDEFGHJKMNPQRTUVWXY34679]{4}$/;

export interface CommandeWhatsApp {
  boutique: string;
  lignes: readonly LigneCommande[];
  paiement?: PaiementWhatsApp;
  suivi?: SuiviWhatsApp;
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

  const paiement = commande.paiement
    ? [
        "",
        "Paiement mobile money :",
        `Numero : ${formatPhone(commande.paiement.numeroReversement)}`,
        `Montant : ${formatXaf(commande.paiement.montantXaf)}`,
      ]
    : [];

  /**
   * Le bloc de suivi. On LEVE plutot que d'ecrire une reference malformee :
   * une acheteuse qui recopie `CT-` suivi de rien sur la page de verification
   * obtient un refus qu'elle ne sait pas interpreter, et croit le vendeur
   * malhonnete. Mieux vaut que la commande ne parte pas.
   */
  const suivi = commande.suivi ? blocSuivi(commande.suivi) : [];

  return [
    "Bonjour, je voudrais commander :",
    ...lignes,
    `Total : ${formatXaf(totalCommandeXaf(commande.lignes))}`,
    `Boutique : ${commande.boutique}`,
    ...suivi,
    ...paiement,
  ].join("\n");
}

function blocSuivi(suivi: SuiviWhatsApp): string[] {
  if (!FORME_REFERENCE.test(suivi.reference)) {
    throw new Error(`reference de commande malformee : ${suivi.reference}`);
  }
  const code = suivi.codeVerification.toUpperCase();
  if (!FORME_CODE.test(code)) {
    throw new Error(`code de verification malforme : ${suivi.codeVerification}`);
  }
  return ["", `Commande : ${suivi.reference}`, `Code de verification : ${code}`];
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

/**
 * L'avis de versement, envoye par l'acheteuse APRES avoir compose.
 *
 * Ce n'est pas un message de commande et il ne s'y substitue pas : le contenu
 * canonique — article, quantite, prix unitaire, total, boutique — appartient a
 * `messageCommande`. Celui-ci ne porte que les deux faits dont la vendeuse a
 * besoin pour retrouver le paiement dans ses SMS, ecrits une seule fois dans le
 * depot pour qu'ils ne divergent pas entre l'ecran et le message.
 *
 * **Il n'affirme rien.** L'acheteuse dit ce qu'elle a fait ; c'est le SMS de
 * l'operateur, colle par la vendeuse, qui prouve. Un message WhatsApp — et a
 * plus forte raison une capture d'ecran — ne prouve aucun paiement.
 */
export function messageVersement(paiement: PaiementWhatsApp, reference?: string): string {
  return [
    "Bonjour, je viens de faire le transfert mobile money :",
    `Numero : ${formatPhone(paiement.numeroReversement)}`,
    `Montant : ${formatXaf(paiement.montantXaf)}`,
    ...(reference ? [`Commande : ${reference}`] : []),
    "Vous devriez recevoir le SMS de votre operateur.",
  ].join("\n");
}

export function lienVersement(
  phone: string,
  paiement: PaiementWhatsApp,
  reference?: string,
): string {
  return lienWhatsApp(phone, messageVersement(paiement, reference));
}
