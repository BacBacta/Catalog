import { formatXaf } from "@catalog/contracts/money";

/**
 * Les textes du fil ACHETEUSE, par langue — ADR 0033.
 *
 * AGENTS.md demande les variantes anglais et pidgin « dès la conception » pour
 * les messages sortants. Ici : le francais et l'anglais sont COMPLETS — le
 * typage garantit la parite, une cle manquante ne compile pas. Le pidgin est
 * REPORTE, et c'est un signalement (§7.7), pas un oubli : l'ecrire sans
 * relecture par un locuteur reviendrait a inventer une langue plausible.
 * L'ajouter sera un membre d'union et un objet de plus, rien d'autre.
 *
 * Le fil VENDEUSE reste en francais pour l'instant : l'app vendeuse entiere
 * est en francais, une langue seule ne changerait rien a son experience.
 */

export type Langue = "fr" | "en";

export interface TextesAcheteuse {
  boutiqueIntrouvable: string;
  aideAcheteuse: string;
  aideGestes: string;
  annule: string;
  langueChangee: string;

  accueilReputation: (note: string | null, nbVerifies: number) => string;
  accueilPitch: string;
  btnVoirArticles: string;
  btnParlerVendeuse: string;
  parlerVendeuse: (nomBoutique: string, lien: string) => string;

  catalogueVide: string;
  btnAccueil: string;
  listeTitre: (nomBoutique: string, nb: number) => string;
  voirLaSuite: string;

  stockRestant: (n: number) => string;
  btnCommander: string;
  btnRetourCatalogue: string;

  questionQuantite: (nomArticle: string, stock: number | null) => string;
  btnAutreNombre: string;
  quantiteAutre: string;
  quantiteIncomprise: string;
  quantiteTropHaute: (max: number) => string;
  plusDeStock: (nomArticle: string) => string;

  ajout: (nomArticle: string, quantite: number, sousTotalXaf: number) => string;
  panierCorps: (totalXaf: number) => string;
  btnPasserCommande: string;
  btnAutreArticle: string;
  btnAnnuler: string;

  questionMode: (totalXaf: number) => string;
  btnLivraison: string;
  btnRetrait: string;
  modeParBoutons: string;
  questionDetailsLivraison: string;
  questionDetailsRetrait: string;
  detailsParTexte: string;
  aideSansTelephone: string;
  aideSansLieu: string;
  aideSansRepere: string;

  recapTitre: (nomBoutique: string) => string;
  ligneArticle: (nom: string, quantite: number, prixUnitaireXaf: number) => string;
  ligneTotal: (totalXaf: number) => string;
  ligneAcompte: (acompteXaf: number) => string;
  ligneLivraison: (quartier: string, landmark: string) => string;
  ligneRetrait: (pickupPoint: string) => string;
  ligneTelephone: (telAffiche: string) => string;
  recapRien: string;
  btnConfirmer: string;
  btnCorriger: string;
  recapParBoutons: string;

  confirmationTitre: (reference: string, nomBoutique: string) => string;
  ligneCode: (code: string) => string;
  suiteAcompte: (lien: string) => string;
  suiteSansAcompte: (lien: string) => string;
  commandeRatee: string;
  stockInsuffisant: (nomArticle: string) => string;

  statutAucune: string;
  statutResteAPayer: (resteXaf: number) => string;
  statutRegle: string;
  statutOuEstLeLien: string;

  faqPrix: string;
  faqPhoto: string;
  faqVariante: string;

  relanceAcompte: (reference: string, acompteXaf: number) => string;
}

const fr: TextesAcheteuse = {
  boutiqueIntrouvable: "Cette boutique est introuvable. Vérifiez le lien reçu.",
  aideAcheteuse:
    "Je suis le catalogue Catalog. Ouvrez le lien d'une boutique, ou écrivez « boutique » suivi de son nom court (ex. : boutique chez-amina).",
  aideGestes:
    "Trois mots marchent partout : « menu » (accueil de la boutique), « annuler » (abandonner la commande en cours), « suivi » (votre dernière commande). Pour un humain, le bouton « Parler à la vendeuse » est à l'accueil. Write « english » for English.",
  annule: "C'est annulé — le panier est vide, rien n'a été commandé.",
  langueChangee: "D'accord, on continue en français. Write « english » to switch back.",

  accueilReputation: (note, nb) =>
    `★ ${note != null ? `${note} · ` : ""}${nb} vente${nb > 1 ? "s" : ""} prouvée${nb > 1 ? "s" : ""} (avis vérifiés)`,
  accueilPitch:
    "Commandez ici — chaque paiement prouvé donne un reçu vérifiable. La vendeuse vous répond sur son WhatsApp.",
  btnVoirArticles: "Voir les articles",
  btnParlerVendeuse: "Parler à la vendeuse",
  parlerVendeuse: (nom, lien) =>
    `Pour parler directement à ${nom}, écrivez-lui sur son WhatsApp :\n${lien}`,

  catalogueVide: "Cette boutique n'a pas encore d'article en ligne.",
  btnAccueil: "Accueil",
  listeTitre: (nom, nb) => `*${nom}* — ${nb} article${nb > 1 ? "s" : ""}`,
  voirLaSuite: "Voir la suite",

  stockRestant: (n) => (n <= 3 ? `Plus que ${n} en stock !` : `${n} en stock`),
  btnCommander: "Commander",
  btnRetourCatalogue: "Retour au catalogue",

  questionQuantite: (nom, stock) =>
    `Combien de « ${nom} » voulez-vous ?${stock != null ? ` (${stock} en stock)` : ""}`,
  btnAutreNombre: "Un autre nombre",
  quantiteAutre: "Écrivez le nombre voulu, en chiffres (ex. : 3).",
  quantiteIncomprise:
    "Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner.",
  quantiteTropHaute: (max) => `Il n'en reste que ${max}. Écrivez un nombre jusqu'à ${max}.`,
  plusDeStock: (nom) =>
    `« ${nom} » n'a plus d'exemplaire disponible en plus de ce qui est déjà dans votre panier.`,

  ajout: (nom, q, sousTotal) =>
    `Ajouté : ${nom} × ${q}.\nPanier : *${formatXaf(sousTotal)}*. Et ensuite ?`,
  panierCorps: (total) => `Panier : *${formatXaf(total)}*. Et ensuite ?`,
  btnPasserCommande: "Passer commande",
  btnAutreArticle: "Autre article",
  btnAnnuler: "Annuler",

  questionMode: (total) => `Comment recevoir votre commande (${formatXaf(total)}) ?`,
  btnLivraison: "Livraison",
  btnRetrait: "Point de retrait",
  modeParBoutons: "Choisissez avec les boutons ci-dessous.",
  questionDetailsLivraison:
    "Votre quartier, un repère, puis le numéro à appeler — en un seul message.\nExemple : Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33",
  questionDetailsRetrait:
    "Où se retrouve-t-on, et quel numéro appeler ?\nExemple : Marché central, entrée B, 690 11 22 33",
  detailsParTexte: "Écrivez-le en un message, comme dans l'exemple.",
  aideSansTelephone:
    "Il me manque le numéro à appeler, à la fin du message. Exemple : Bonapriso, en face de la pharmacie, 690 11 22 33",
  aideSansLieu: "Dites-moi où se retrouver (ex. : Marché central, entrée B), puis le numéro.",
  aideSansRepere:
    "Il me faut le quartier, PUIS un repère après une virgule. Exemple : Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33",

  recapTitre: (nom) => `*Récapitulatif — ${nom}*`,
  ligneArticle: (nom, q, pu) => `${nom} × ${q} : ${formatXaf(pu)} l'unité`,
  ligneTotal: (total) => `Total : *${formatXaf(total)}*`,
  ligneAcompte: (acompte) => `Acompte pour confirmer : *${formatXaf(acompte)}*`,
  ligneLivraison: (quartier, landmark) => `Livraison : ${quartier}, ${landmark}`,
  ligneRetrait: (pickupPoint) => `Retrait : ${pickupPoint}`,
  ligneTelephone: (tel) => `Numéro à appeler : ${tel}`,
  recapRien: "Rien n'est encore commandé. Vérifiez, puis confirmez.",
  btnConfirmer: "Confirmer",
  btnCorriger: "Corriger",
  recapParBoutons: "Utilisez les boutons : confirmer, corriger, ou annuler.",

  confirmationTitre: (ref, nom) => `*Commande ${ref} — ${nom}*`,
  ligneCode: (code) => `Code de vérification : ${code}`,
  suiteAcompte: (lien) =>
    `Pour payer l'acompte, ouvrez : ${lien}\nAprès le paiement, votre reçu vérifiable vous attend au même endroit.\nVotre code secret ne se tape QUE sur l'écran de votre opérateur — jamais ici.`,
  suiteSansAcompte: (lien) =>
    `Rien à payer d'avance — vous payez à la réception.\nSuivez votre commande ici : ${lien}`,
  commandeRatee:
    "Cette commande n'a pas pu être enregistrée. Reprenez au catalogue — rien n'a été perdu.",
  stockInsuffisant: (nom) =>
    `Le stock de « ${nom} » a changé entre-temps et ne suffit plus. Reprenez au catalogue — rien n'a été commandé.`,

  statutAucune:
    "Aucune commande enregistrée sur ce numéro. Ouvrez le lien d'une boutique pour commander.",
  statutResteAPayer: (reste) => `Reste à payer : ${formatXaf(reste)}`,
  statutRegle: "Tout est réglé.",
  statutOuEstLeLien:
    "Votre lien de suivi est dans le message de confirmation, plus haut dans ce fil.",

  faqPrix:
    "Les prix sont affichés dans la liste des articles et sur chaque fiche — ouvrez « Voir les articles ».",
  faqPhoto:
    "Chaque fiche montre la photo de l'article quand la vendeuse en a mis une — ouvrez « Voir les articles ».",
  faqVariante:
    "Tailles, couleurs et modèles se précisent directement avec la vendeuse — bouton « Parler à la vendeuse ».",

  relanceAcompte: (ref, acompte) =>
    `Votre commande ${ref} attend son acompte de *${formatXaf(acompte)}* pour être confirmée. Le lien de paiement est dans votre message de confirmation, juste au-dessus. Sans acompte, la commande expirera d'elle-même.`,
};

const en: TextesAcheteuse = {
  boutiqueIntrouvable: "This shop could not be found. Check the link you received.",
  aideAcheteuse:
    "I am the Catalog storefront. Open a shop link, or write “boutique” followed by its short name (e.g.: boutique chez-amina).",
  aideGestes:
    "Three words work everywhere: “menu” (shop home), “cancel” (drop the current order), “status” (your last order). For a human, the “Talk to the seller” button is on the home screen. Écrivez « français » pour le français.",
  annule: "Cancelled — your cart is empty, nothing was ordered.",
  langueChangee: "OK, English it is. Écrivez « français » pour revenir au français.",

  accueilReputation: (note, nb) =>
    `★ ${note != null ? `${note} · ` : ""}${nb} verified sale${nb > 1 ? "s" : ""} (verified reviews)`,
  accueilPitch:
    "Order here — every proven payment comes with a verifiable receipt. The seller replies on her WhatsApp.",
  btnVoirArticles: "See the items",
  btnParlerVendeuse: "Talk to the seller",
  parlerVendeuse: (nom, lien) => `To talk to ${nom} directly, write on WhatsApp:\n${lien}`,

  catalogueVide: "This shop has no items online yet.",
  btnAccueil: "Home",
  listeTitre: (nom, nb) => `*${nom}* — ${nb} item${nb > 1 ? "s" : ""}`,
  voirLaSuite: "See more",

  stockRestant: (n) => (n <= 3 ? `Only ${n} left!` : `${n} in stock`),
  btnCommander: "Order",
  btnRetourCatalogue: "Back to the list",

  questionQuantite: (nom, stock) =>
    `How many “${nom}” do you want?${stock != null ? ` (${stock} in stock)` : ""}`,
  btnAutreNombre: "Another number",
  quantiteAutre: "Write the number you want, in digits (e.g.: 3).",
  quantiteIncomprise:
    "I did not understand the number. Write it in digits (e.g.: 3) — or “cancel” to stop.",
  quantiteTropHaute: (max) => `Only ${max} left. Write a number up to ${max}.`,
  plusDeStock: (nom) => `“${nom}” has no more units available beyond what is already in your cart.`,

  ajout: (nom, q, sousTotal) =>
    `Added: ${nom} × ${q}.\nCart: *${formatXaf(sousTotal)}*. What next?`,
  panierCorps: (total) => `Cart: *${formatXaf(total)}*. What next?`,
  btnPasserCommande: "Check out",
  btnAutreArticle: "Add another item",
  btnAnnuler: "Cancel",

  questionMode: (total) => `How should you receive your order (${formatXaf(total)})?`,
  btnLivraison: "Delivery",
  btnRetrait: "Pickup point",
  modeParBoutons: "Choose with the buttons below.",
  questionDetailsLivraison:
    "Your neighbourhood, a landmark, then the phone number to call — in one message.\nExample: Bonapriso, opposite the Rond-Point pharmacy, 690 11 22 33",
  questionDetailsRetrait:
    "Where do we meet, and what number should we call?\nExample: Central market, entrance B, 690 11 22 33",
  detailsParTexte: "Write it in one message, like in the example.",
  aideSansTelephone:
    "I am missing the phone number to call, at the end of the message. Example: Bonapriso, opposite the pharmacy, 690 11 22 33",
  aideSansLieu: "Tell me where to meet (e.g.: Central market, entrance B), then the number.",
  aideSansRepere:
    "I need the neighbourhood, THEN a landmark after a comma. Example: Bonapriso, opposite the Rond-Point pharmacy, 690 11 22 33",

  recapTitre: (nom) => `*Summary — ${nom}*`,
  ligneArticle: (nom, q, pu) => `${nom} × ${q} : ${formatXaf(pu)} each`,
  ligneTotal: (total) => `Total: *${formatXaf(total)}*`,
  ligneAcompte: (acompte) => `Deposit to confirm: *${formatXaf(acompte)}*`,
  ligneLivraison: (quartier, landmark) => `Delivery: ${quartier}, ${landmark}`,
  ligneRetrait: (pickupPoint) => `Pickup: ${pickupPoint}`,
  ligneTelephone: (tel) => `Number to call: ${tel}`,
  recapRien: "Nothing is ordered yet. Check, then confirm.",
  btnConfirmer: "Confirm",
  btnCorriger: "Edit",
  recapParBoutons: "Use the buttons: confirm, edit, or cancel.",

  confirmationTitre: (ref, nom) => `*Order ${ref} — ${nom}*`,
  ligneCode: (code) => `Verification code: ${code}`,
  suiteAcompte: (lien) =>
    `To pay the deposit, open: ${lien}\nAfter payment, your verifiable receipt is waiting at the same place.\nYour secret code is typed ONLY on your operator's screen — never here.`,
  suiteSansAcompte: (lien) =>
    `Nothing to pay upfront — you pay on delivery.\nFollow your order here: ${lien}`,
  commandeRatee: "This order could not be saved. Start again from the list — nothing was lost.",
  stockInsuffisant: (nom) =>
    `The stock of “${nom}” changed in the meantime and is no longer enough. Start again from the list — nothing was ordered.`,

  statutAucune: "No order recorded for this number. Open a shop link to order.",
  statutResteAPayer: (reste) => `Left to pay: ${formatXaf(reste)}`,
  statutRegle: "All settled.",
  statutOuEstLeLien: "Your tracking link is in the confirmation message, earlier in this thread.",

  faqPrix: "Prices are shown in the item list and on each item — open “See the items”.",
  faqPhoto: "Each item shows its photo when the seller added one — open “See the items”.",
  faqVariante:
    "Sizes, colours and models are agreed directly with the seller — “Talk to the seller”.",

  relanceAcompte: (ref, acompte) =>
    `Your order ${ref} is waiting for its *${formatXaf(acompte)}* deposit to be confirmed. The payment link is in your confirmation message, just above. Without the deposit, the order will expire on its own.`,
};

export const TEXTES: Record<Langue, TextesAcheteuse> = { fr, en };

/** Un changement de langue demande par l'acheteuse, en toutes lettres. */
export function langueDemandee(texteBrut: string): Langue | null {
  const net = texteBrut
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (net === "english" || net === "anglais") return "en";
  if (net === "francais" || net === "french") return "fr";
  return null;
}
