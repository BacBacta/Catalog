import { formatXaf } from "@catalog/contracts/money";
import type { FormeNonLue } from "./entrees.ts";

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
  /** Le bouton qui ouvre l'inscription vendeuse — ADR 0034. */
  btnVendre: string;
  aideGestes: string;
  annule: string;
  /**
   * Ce qu'on repond a une forme qu'on ne sait pas lire — ADR 0049. Une phrase
   * PAR forme : dire « je ne sais pas ecouter les vocaux » a quelqu'un qui a
   * partage sa position serait une reponse fausse, donc un silence deguise.
   */
  formeNonLue: (forme: FormeNonLue) => string;
  /**
   * Ce qu'on dit quand NOTRE traitement casse — ADR 0049. Un silence apres un
   * message est indiscernable d'une panne definitive ; une phrase qui invite a
   * reessayer coute une ligne et sauve la conversation.
   */
  pannePassagere: string;
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

  /** L'accuse de reception de l'ajout ; le total suit dans `panierCorps`. */
  ajout: (nomArticle: string, quantite: number) => string;
  /**
   * Le panier montre ses LIGNES, pas seulement son total. Sans elles, la
   * premiere fois qu'une acheteuse voit ce qu'elle a mis dedans est le
   * recapitulatif — trop tard pour corriger sereinement.
   */
  panierCorps: (lignes: readonly string[], totalXaf: number) => string;
  panierVide: string;
  btnMonPanier: string;
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
  /** Le lien de suivi seul, quand le bloc paiement a deja tout dit du paiement. */
  suiteSuivi: (lien: string) => string;
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

  /** « Voir en photos » — la rafale d'images (ADR 0035). */
  btnVoirPhotos: string;
  rafaleAucunePhoto: string;
  /** Changer de boutique laisse l'ancien panier — et on le DIT (T7). */
  panierAbandonneAilleurs: string;
  /** En mode livraison, le total ne comprend jamais la course. */
  ligneHorsLivraison: string;
  /** Apres la confirmation : la conversation continue chez la vendeuse. */
  apresConfirmation: (nomBoutique: string, lien: string) => string;
  /**
   * Le bloc paiement en texte brut, autosuffisant (AGENTS.md) : montant,
   * numero, code d'entree venu de la CONFIGURATION — jamais d'une constante.
   * `lienPayer` est un confort, jamais le seul porteur.
   */
  blocPaiement: (b: {
    montantXaf: number;
    numeroAffiche: string;
    operateurNom: string | null;
    codeEntree: string | null;
    lienPayer: string | null;
  }) => string;

  /** Paiement prouve — la notification de l'acheteuse. Aucun jeton re-projete. */
  notifPaiementProuve: (reference: string, resteXaf: number) => string;
  /** Commande livree — l'invitation a noter, via le lien deja recu. */
  notifLivree: (reference: string, nomBoutique: string) => string;

  /* ─── l'apres-achat DANS le fil — ADR 0036 ─── */
  btnContresigner: string;
  btnPasMoi: string;
  btnDonnerAvis: string;
  /** Le « oui » de l'acheteuse : la preuve passe a deux voix. */
  contresigneMerci: (reference: string) => string;
  /** La contre-signature n'a pas d'objet (preuve absente, deja contresignee…). */
  contresigneImpossible: string;
  /** La contestation se CONFIRME : un appui malheureux gelerait la commande. */
  contesterConfirmation: (reference: string) => string;
  btnContesterOui: string;
  contesteEnregistre: (reference: string) => string;
  /** L'invitation a noter, avec sa liste d'etoiles. */
  avisInvitation: (nomBoutique: string) => string;
  btnNoter: string;
  avisLigne: (etoiles: number) => string;
  /** La note est enregistree ; le mot vient ensuite (ADR 0036, decision 5). */
  avisNoteEnregistree: (verifie: boolean) => string;
  btnSansMot: string;
  avisMotMerci: string;
  avisImpossible: string;
  avisDejaDepose: string;
  /** Aucune commande dans ce fil : on le dit, on n'invente pas. */
  apresAchatSansCommande: string;

  /* ─── le mode conges — ADR 0039 ─── */
  /**
   * Dit A L'ACCUEIL, a la place de l'argument de vente : une acheteuse doit
   * l'apprendre avant de choisir, pas apres avoir tout saisi.
   *
   * Aucune date de retour n'est promise nulle part. La vendeuse n'en saisit
   * pas, et une date depassee en silence serait un mensonge de plus.
   */
  boutiqueFermeeAccueil: string;
  /** Le refus, quand un ancien bouton du fil tente encore de commander. */
  boutiqueFermee: (nomBoutique: string) => string;
}

const fr: TextesAcheteuse = {
  boutiqueIntrouvable: "Cette boutique est introuvable. Vérifiez le lien reçu.",
  aideAcheteuse:
    "Je suis Catalog. Ouvrez le lien d'une boutique pour commander — ou ouvrez la vôtre, ici même, en deux minutes.",
  btnVendre: "Vendre avec Catalog",
  aideGestes:
    "Quatre mots marchent partout : « menu » (accueil de la boutique), « panier » (ce que vous avez choisi), « annuler » (abandonner la commande en cours), « suivi » (votre dernière commande). Pour un humain, le bouton « Parler à la vendeuse » est à l'accueil. Write « english » for English.",
  annule: "C'est annulé — le panier est vide, rien n'a été commandé.",
  pannePassagere:
    "Quelque chose n'a pas marché de mon côté — ce n'est pas vous. Réessayez dans un instant, ou écrivez « menu ».",
  formeNonLue: (forme) =>
    ({
      vocal:
        "Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « nom prix » en légende.",
      video:
        "Je ne sais pas encore regarder les vidéos. Une photo, elle, je la lis : envoyez-la avec « nom prix » en légende.",
      document:
        "Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots.",
      sticker: "Joli. Mais je ne sais lire que le texte, les photos et les boutons.",
      localisation:
        "Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en face de… »).",
      contact: "Je ne sais pas encore lire une fiche contact. Écrivez-moi le numéro en chiffres.",
      inconnue:
        "Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton.",
    })[forme],
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

  stockRestant: (n) =>
    n <= 3 ? `Plus que ${n} disponible${n > 1 ? "s" : ""}` : `${n} disponibles`,
  btnCommander: "Commander",
  btnRetourCatalogue: "Retour au catalogue",

  questionQuantite: (nom, stock) =>
    `Combien de « ${nom} » voulez-vous ?${stock != null ? ` (${stock} en stock)` : ""}`,
  btnAutreNombre: "Un autre nombre",
  quantiteAutre: "Écrivez le nombre voulu, en chiffres (ex. : 3).",
  quantiteIncomprise:
    "Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner.",
  quantiteTropHaute: (max) => `La vendeuse en annonce ${max}. Écrivez un nombre jusqu'à ${max}.`,
  plusDeStock: (nom) =>
    `« ${nom} » n'a plus d'exemplaire disponible en plus de ce qui est déjà dans votre panier.`,

  ajout: (nom, q) => `✅ Ajouté : ${nom} × ${q}.`,
  panierCorps: (lignes, total) =>
    [
      `🧺 *Votre panier*`,
      ...lignes,
      `*Total : ${formatXaf(total)}* (hors livraison)`,
      "",
      "Et ensuite ?",
    ].join("\n"),
  panierVide: "Votre panier est vide. Ouvrez « Voir les articles » pour en ajouter un.",
  btnMonPanier: "Mon panier",
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
  suiteSuivi: (lien) =>
    `Votre suivi et votre reçu vérifiable vivent ici — gardez ce lien : ${lien}`,
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

  btnVoirPhotos: "Voir en photos",
  rafaleAucunePhoto:
    "Cette boutique n'a pas encore mis de photos — les articles sont dans la liste.",
  panierAbandonneAilleurs:
    "Nouveau départ ici : le panier commencé dans l'autre boutique n'a pas été gardé.",
  ligneHorsLivraison: "(hors livraison — le prix de la course se convient avec la vendeuse)",
  apresConfirmation: (nom, lien) =>
    `Pour la suite — livraison, questions, précisions — écrivez directement à ${nom} :\n${lien}`,
  blocPaiement: (b) =>
    [
      `💳 *À payer maintenant : ${formatXaf(b.montantXaf)}*`,
      `${b.operateurNom ?? "Mobile Money"} : ${b.numeroAffiche}`,
      ...(b.codeEntree
        ? [`Composez ${b.codeEntree}, puis suivez le menu de transfert d'argent.`]
        : []),
      "Votre code secret se tape UNIQUEMENT sur l'écran de votre opérateur — jamais ici.",
      ...(b.lienPayer ? [`En un tap, le clavier pré-rempli : ${b.lienPayer}`] : []),
      "Dès que la vendeuse colle son SMS de réception, votre reçu vérifiable est émis — vous serez prévenue ici.",
    ].join("\n"),

  notifPaiementProuve: (ref, reste) =>
    [
      `✅ *Votre paiement sur ${ref} est prouvé* — le reçu vérifiable est émis.`,
      reste > 0 ? `Reste à payer à la remise : ${formatXaf(reste)}.` : "Tout est réglé.",
      "Votre lien de suivi est dans le message de confirmation, plus haut dans ce fil.",
    ].join("\n"),
  notifLivree: (ref, nom) =>
    [`📦 *${ref} est marquée livrée* par ${nom}.`, "Un mot sur la boutique ?"].join("\n"),

  btnContresigner: "Je confirme ✓",
  btnPasMoi: "Ce n'est pas moi",
  btnDonnerAvis: "Donner mon avis",
  contresigneMerci: (ref) =>
    `🖋️ *Merci — votre confirmation est enregistrée.*\n${ref} porte désormais deux voix : celle de la vendeuse et la vôtre. C'est la preuve la plus solide que Catalog sache produire.`,
  contresigneImpossible:
    "Cette confirmation n'a plus d'objet : ou le paiement n'est pas encore prouvé, ou vous l'avez déjà confirmé. Rien n'a changé.",
  contesterConfirmation: (ref) =>
    `⚠️ Vous dites ne pas reconnaître ce paiement sur ${ref}.\nConfirmer *gèle la commande* jusqu'à ce qu'un humain tranche — la vendeuse ne pourra plus l'avancer. À n'utiliser que si c'est bien le cas.`,
  btnContesterOui: "Oui, je conteste",
  contesteEnregistre: (ref) =>
    `${ref} est signalée. Elle n'avance plus tant que le désaccord n'est pas réglé — parlez-en directement à la vendeuse, c'est le plus rapide.`,
  avisInvitation: (nom) =>
    `Comment s'est passée votre commande chez *${nom}* ?\nVotre avis aide les prochaines acheteuses.`,
  btnNoter: "Noter la boutique",
  avisLigne: (n) => "⭐".repeat(n),
  avisNoteEnregistree: (verifie) =>
    verifie
      ? "Merci ! Votre avis est en ligne, marqué *achat vérifié* — parce que votre paiement a laissé une trace.\n\nUn mot à ajouter ? Écrivez-le maintenant."
      : "Merci ! Votre avis est en ligne.\nIl n'est pas marqué « achat vérifié » : ce paiement n'a pas de preuve enregistrée.\n\nUn mot à ajouter ? Écrivez-le maintenant.",
  btnSansMot: "Sans commentaire",
  avisMotMerci: "C'est ajouté. Merci d'avoir pris le temps.",
  avisImpossible:
    "L'avis s'ouvre une fois la commande livrée — la vendeuse la marquera comme telle.",
  avisDejaDepose: "Vous avez déjà donné votre avis sur cette commande. Merci encore !",
  apresAchatSansCommande:
    "Aucune commande enregistrée sur ce numéro. Ouvrez le lien d'une boutique pour commander.",

  boutiqueFermeeAccueil:
    "🌴 La vendeuse ne prend pas de nouvelle commande en ce moment. Vous pouvez voir les articles et lui écrire — elle vous dira quand elle reprend.",
  boutiqueFermee: (nom) =>
    `🌴 *${nom}* ne prend pas de nouvelle commande en ce moment. Rien n'a été commandé. Écrivez à la vendeuse : elle seule sait quand elle reprend.`,
};

const en: TextesAcheteuse = {
  boutiqueIntrouvable: "This shop could not be found. Check the link you received.",
  aideAcheteuse:
    "I am Catalog. Open a shop link to order — or open your own, right here, in two minutes.",
  btnVendre: "Sell with Catalog",
  aideGestes:
    "Four words work everywhere: “menu” (shop home), “cart” (what you picked), “cancel” (drop the current order), “status” (your last order). For a human, the “Talk to the seller” button is on the home screen. Écrivez « français » pour le français.",
  annule: "Cancelled — your cart is empty, nothing was ordered.",
  pannePassagere:
    'Something went wrong on my side — it\'s not you. Try again in a moment, or write "menu".',
  formeNonLue: (forme) =>
    ({
      vocal:
        'I can\'t listen to voice notes yet. Write to me in a few words — or send the photo, with "name price" as the caption.',
      video:
        'I can\'t watch videos yet. A photo I can read: send it with "name price" as the caption.',
      document: "I can't open documents yet. Write me what it says, in a few words.",
      sticker: "Nice. But I can only read text, photos and buttons.",
      localisation:
        'Thank you — I can\'t use a shared location yet. Write me your neighbourhood and a landmark ("opposite the…").',
      contact: "I can't read a contact card yet. Write me the number in digits.",
      inconnue: "I can't read this type of message yet. Write to me, or tap a button.",
    })[forme],
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

  stockRestant: (n) => (n <= 3 ? `Only ${n} available` : `${n} available`),
  btnCommander: "Order",
  btnRetourCatalogue: "Back to the list",

  questionQuantite: (nom, stock) =>
    `How many “${nom}” do you want?${stock != null ? ` (${stock} in stock)` : ""}`,
  btnAutreNombre: "Another number",
  quantiteAutre: "Write the number you want, in digits (e.g.: 3).",
  quantiteIncomprise:
    "I did not understand the number. Write it in digits (e.g.: 3) — or “cancel” to stop.",
  quantiteTropHaute: (max) => `The seller lists ${max}. Write a number up to ${max}.`,
  plusDeStock: (nom) => `“${nom}” has no more units available beyond what is already in your cart.`,

  ajout: (nom, q) => `✅ Added: ${nom} × ${q}.`,
  panierCorps: (lignes, total) =>
    [
      `🧺 *Your cart*`,
      ...lignes,
      `*Total: ${formatXaf(total)}* (delivery not included)`,
      "",
      "What next?",
    ].join("\n"),
  panierVide: "Your cart is empty. Open “See the items” to add one.",
  btnMonPanier: "My cart",
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
  suiteSuivi: (lien) =>
    `Your tracking and your verifiable receipt live here — keep this link: ${lien}`,
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

  btnVoirPhotos: "See photos",
  rafaleAucunePhoto: "This shop has no photos yet — the items are in the list.",
  panierAbandonneAilleurs: "Fresh start here: the cart begun in the other shop was not kept.",
  ligneHorsLivraison: "(delivery not included — the fare is agreed with the seller)",
  apresConfirmation: (nom, lien) =>
    `For what comes next — delivery, questions, details — write to ${nom} directly:\n${lien}`,
  blocPaiement: (b) =>
    [
      `💳 *To pay now: ${formatXaf(b.montantXaf)}*`,
      `${b.operateurNom ?? "Mobile Money"}: ${b.numeroAffiche}`,
      ...(b.codeEntree ? [`Dial ${b.codeEntree}, then follow the money-transfer menu.`] : []),
      "Your secret code is typed ONLY on your operator's screen — never here.",
      ...(b.lienPayer ? [`One tap, keypad pre-filled: ${b.lienPayer}`] : []),
      "As soon as the seller pastes her reception SMS, your verifiable receipt is issued — you will be notified here.",
    ].join("\n"),

  notifPaiementProuve: (ref, reste) =>
    [
      `✅ *Your payment on ${ref} is proven* — the verifiable receipt is issued.`,
      reste > 0 ? `Left to pay on delivery: ${formatXaf(reste)}.` : "All settled.",
      "Your tracking link is in the confirmation message, earlier in this thread.",
    ].join("\n"),
  notifLivree: (ref, nom) =>
    [`📦 *${ref} is marked delivered* by ${nom}.`, "A word about the shop?"].join("\n"),

  btnContresigner: "I confirm ✓",
  btnPasMoi: "That is not me",
  btnDonnerAvis: "Leave a review",
  contresigneMerci: (ref) =>
    `🖋️ *Thank you — your confirmation is recorded.*\n${ref} now carries two voices: the seller's and yours. It is the strongest proof Catalog can produce.`,
  contresigneImpossible:
    "This confirmation no longer applies: either the payment is not proven yet, or you already confirmed it. Nothing changed.",
  contesterConfirmation: (ref) =>
    `⚠️ You say you do not recognise this payment on ${ref}.\nConfirming *freezes the order* until a human settles it — the seller will not be able to move it forward. Use this only if it is really the case.`,
  btnContesterOui: "Yes, I dispute it",
  contesteEnregistre: (ref) =>
    `${ref} is flagged. It will not move until the disagreement is settled — talking to the seller directly is the fastest way.`,
  avisInvitation: (nom) =>
    `How did your order with *${nom}* go?\nYour review helps the next buyers.`,
  btnNoter: "Rate the shop",
  avisLigne: (n) => "⭐".repeat(n),
  avisNoteEnregistree: (verifie) =>
    verifie
      ? "Thank you! Your review is online, marked *verified purchase* — because your payment left a trace.\n\nAnything to add? Write it now."
      : "Thank you! Your review is online.\nIt is not marked “verified purchase”: this payment has no recorded proof.\n\nAnything to add? Write it now.",
  btnSansMot: "No comment",
  avisMotMerci: "Added. Thank you for taking the time.",
  avisImpossible: "Reviews open once the order is delivered — the seller will mark it as such.",
  avisDejaDepose: "You already reviewed this order. Thanks again!",
  apresAchatSansCommande: "No order recorded for this number. Open a shop link to order.",

  boutiqueFermeeAccueil:
    "🌴 The seller is not taking new orders right now. You can still browse the items and write to her — she will tell you when she is back.",
  boutiqueFermee: (nom) =>
    `🌴 *${nom}* is not taking new orders right now. Nothing was ordered. Write to the seller: only she knows when she is back.`,
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
