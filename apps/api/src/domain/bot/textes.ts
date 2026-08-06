import { formatXaf } from "@catalog/contracts/money";

/**
 * Les textes du fil ACHETEUSE, par langue — ADR 0033, revise par l'ADR 0034.
 *
 * AGENTS.md demande les variantes anglais et pidgin « des la conception » pour
 * les messages sortants. Le francais et l'anglais sont COMPLETS et SERVIS. Le
 * pidgin est ECRIT et NON SERVI — c'est l'objet de l'ADR 0034, et la nuance
 * est toute la decision : un brouillon existe, il ne sort pas.
 *
 * Le typage garantit la parite des cles pour les TROIS langues : `Record<Langue,
 * TextesAcheteuse>` refuse de compiler s'il en manque une. La parite du contenu
 * — une fonction qui rendrait une chaine vide — est verifiee par execution dans
 * `couverture.test.ts`.
 *
 * Le fil VENDEUSE reste en francais : l'app vendeuse entiere l'est.
 */

/**
 * `wes` est le code ISO 639-3 du **pidgin camerounais** (Kamtok). Ce n'est pas
 * `pcm`, qui designe le pidgin nigerian : les deux se comprennent mais ne
 * s'ecrivent pas pareil, et prendre l'un pour l'autre serait deja une erreur de
 * langue.
 */
export type Langue = "fr" | "en" | "wes";

/**
 * **Le pidgin a-t-il ete relu par une locutrice ?**
 *
 * `false`, et c'est la seule valeur honnete aujourd'hui. Le catalogue `wes`
 * ci-dessous est un BROUILLON ecrit sans relecture — exactement ce que le §7.7
 * d'AGENTS.md interdit de promouvoir en silence. Il est donc ecrit, type, teste,
 * et **injoignable** : `langueDemandee` reconnait le mot « pidgin » mais ne rend
 * pas la langue, et `normaliserLangue` ramene au francais une conversation qui
 * aurait ete persistee en `wes`.
 *
 * Pourquoi l'ecrire quand meme ? Parce qu'une relecture a besoin d'un texte a
 * relire. « Reporte » laissait la page blanche ; celle-ci se corrige.
 *
 * **Passer ce drapeau a `true` est une decision, pas un reglage.** Elle demande
 * qu'une locutrice ait relu le catalogue `wes` en entier. Deux tests tiennent la
 * bascule : l'un verifie que rien n'est servi tant qu'il est `false`, l'autre que
 * l'aide en francais et en anglais annonce le pidgin des qu'il est `true` — on
 * ne peut donc pas ouvrir la langue sans la proposer, ni la proposer sans
 * l'ouvrir.
 */
export const PIDGIN_RELU = false;

/** Les langues qu'une acheteuse peut effectivement obtenir. */
export const LANGUES_SERVIES: readonly Langue[] = PIDGIN_RELU ? ["fr", "en", "wes"] : ["fr", "en"];

export interface TextesAcheteuse {
  boutiqueIntrouvable: string;
  aideAcheteuse: string;
  /** Le bouton qui ouvre l'inscription vendeuse — ADR 0047. */
  btnVendre: string;
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

/**
 * Le pidgin camerounais \u2014 **BROUILLON, non relu, non servi**.
 *
 * Il n'est joignable par personne tant que `PIDGIN_RELU` vaut `false`. Ce qui
 * suit est donc a relire, pas a croire : l'orthographe du Kamtok n'est pas
 * normalisee, et plusieurs choix ci-dessous sont des paris.
 *
 * Trois points a soumettre en priorite a la relecture :
 *
 * 1. **les libelles de boutons**, plafonnes a vingt caracteres par WhatsApp \u2014
 *    c'est la contrainte qui a le plus tordu les formulations ;
 * 2. **\u00ab how much \u00bb**, qui dit le PRIX et non la quantite. La question de
 *    quantite l'evite expres, au prix d'une tournure peut-etre lourde ;
 * 3. **les emprunts francais** \u2014 `kwata`, `farmasi`, `nomba` \u2014 plausibles a
 *    Douala, a confirmer.
 *
 * `langueChangee` porte l'avertissement de relecture : si quelqu'un ouvre la
 * langue avant qu'elle soit relue, l'acheteuse le lit des le premier message
 * (\u00a77.7 \u2014 \u00ab dans le code ET dans l'interface \u00bb).
 */
const wes: TextesAcheteuse = {
  boutiqueIntrouvable: "A no fit find dis shop. Check di link weh dem send you.",
  aideAcheteuse:
    "Na me be di Catalog katalog. Open some shop yi link, or write \u00ab boutique \u00bb plus yi short name (example: boutique chez-amina).",
  aideGestes:
    "Tri wod di work everywhere: \u00ab menu \u00bb (shop home), \u00ab annuler \u00bb (komot for di order weh you start), \u00ab suivi \u00bb (yua las order). If you wan tok wit person, di button \u00ab Tok wit di seller \u00bb dey for home. Write \u00ab fran\u00e7ais \u00bb or \u00ab english \u00bb for change langwej.",
  annule: "A don cancel-am \u2014 yua basket empty, you no order anytin.",
  langueChangee:
    "Wi go continue for Pidgin. Take notice: dis Pidgin never pass for correction by person weh yi sabi-am fine, so some wod fit no correct. Write \u00ab fran\u00e7ais \u00bb or \u00ab english \u00bb anytime.",

  accueilReputation: (note, nb) =>
    `\u2605 ${note != null ? `${note} \u00b7 ` : ""}${nb} sell weh dem don prove (review weh dem check)`,
  accueilPitch:
    "Order for hia \u2014 any pay weh dem prove di give resit weh you fit check. Di seller go ansa you for yi WhatsApp.",
  btnVoirArticles: "Si di ting dem",
  btnParlerVendeuse: "Tok wit di seller",
  parlerVendeuse: (nom, lien) => `For tok wit ${nom} direct, write yi for WhatsApp:\n${lien}`,

  catalogueVide: "Dis shop never put any ting for online.",
  btnAccueil: "Home",
  listeTitre: (nom, nb) => `*${nom}* \u2014 ${nb} ting${nb > 1 ? " dem" : ""}`,
  voirLaSuite: "Si di oda dem",

  stockRestant: (n) => (n <= 3 ? `Na only ${n} remain!` : `${n} dey for stock`),
  btnCommander: "Order-am",
  btnRetourCatalogue: "Go back for lis",

  questionQuantite: (nom, stock) =>
    `You wan how many \u00ab ${nom} \u00bb?${stock != null ? ` (${stock} dey)` : ""}`,
  btnAutreNombre: "Oda nomba",
  quantiteAutre: "Write di nomba weh you wan, for figure (example: 3).",
  quantiteIncomprise:
    "A no understand di nomba. Write-am for figure (example: 3) \u2014 or write \u00ab annuler \u00bb for stop.",
  quantiteTropHaute: (max) => `Na only ${max} remain. Write nomba weh i no pass ${max}.`,
  plusDeStock: (nom) =>
    `\u00ab ${nom} \u00bb no get oda one again pass weh dey already for yua basket.`,

  ajout: (nom, q) => `A don add: ${nom} \u00d7 ${q}.`,
  panierCorps: (lignes, total) =>
    [
      `\u{1F9FA} *Yua basket*`,
      ...lignes,
      `*Total: ${formatXaf(total)}* (delivery no dey inside)`,
      "",
      "Na weti nex?",
    ].join("\n"),
  btnPasserCommande: "Finish di order",
  btnAutreArticle: "Add oda ting",
  btnAnnuler: "Cancel",

  questionMode: (total) => `How you wan take receive yua order (${formatXaf(total)})?`,
  btnLivraison: "Dem bring-am",
  btnRetrait: "A go come take-am",
  modeParBoutons: "Choose wit di button dem for down.",
  questionDetailsLivraison:
    "Yua kwata, some place weh people sabi, den di nomba for call \u2014 for one message only.\nExample: Bonapriso, for front of di Rond-Point farmasi, 690 11 22 33",
  questionDetailsRetrait:
    "Na for weti place wi go meet, an na which nomba wi go call?\nExample: March\u00e9 central, entrance B, 690 11 22 33",
  detailsParTexte: "Write-am for one message, like for di example.",
  aideSansTelephone:
    "Di nomba for call di miss for di end of di message. Example: Bonapriso, for front of di farmasi, 690 11 22 33",
  aideSansLieu:
    "Tell me weh place wi go meet (example: March\u00e9 central, entrance B), den di nomba.",
  aideSansRepere:
    "A need di kwata, DEN some place weh people sabi afta comma. Example: Bonapriso, for front of di Rond-Point farmasi, 690 11 22 33",

  recapTitre: (nom) => `*Wetin you order \u2014 ${nom}*`,
  ligneArticle: (nom, q, pu) => `${nom} \u00d7 ${q} : ${formatXaf(pu)} for one`,
  ligneTotal: (total) => `Total: *${formatXaf(total)}*`,
  ligneAcompte: (acompte) => `Moni for confam am: *${formatXaf(acompte)}*`,
  ligneLivraison: (quartier, landmark) => `Dem go bring-am: ${quartier}, ${landmark}`,
  ligneRetrait: (pickupPoint) => `You go come take-am: ${pickupPoint}`,
  ligneTelephone: (tel) => `Nomba for call: ${tel}`,
  recapRien: "Notin never order yet. Check-am, den confam.",
  btnConfirmer: "Confam",
  btnCorriger: "Correct-am",
  recapParBoutons: "Use di button dem: confam, correct-am, or cancel.",

  confirmationTitre: (ref, nom) => `*Order ${ref} \u2014 ${nom}*`,
  ligneCode: (code) => `Code for check: ${code}`,
  suiteAcompte: (lien) =>
    `For pay di moni weh go confam di order, open: ${lien}\nAfta you pay, yua resit weh you fit check go dey for di same place.\nYua secret code na for yua operator yi screen ONLY you go type-am \u2014 never for hia.`,
  suiteSansAcompte: (lien) =>
    `Notin for pay before \u2014 you go pay wen dem bring-am.\nFollow yua order for hia: ${lien}`,
  commandeRatee: "Dis order no fit enter. Start again for di lis \u2014 notin loss.",
  stockInsuffisant: (nom) =>
    `Di stock for \u00ab ${nom} \u00bb don change an i no reach again. Start again for di lis \u2014 notin order.`,

  statutAucune: "No order dey for dis nomba. Open some shop yi link for order.",
  statutResteAPayer: (reste) => `Weti remain for pay: ${formatXaf(reste)}`,
  statutRegle: "Everytin don pay finish.",
  statutOuEstLeLien: "Yua link for follow di order dey for di confam message, for up for dis tok.",

  faqPrix: "Di price dem dey for di lis an for each ting \u2014 open \u00ab Si di ting dem \u00bb.",
  faqPhoto:
    "Each ting di show yi foto wen di seller don put one \u2014 open \u00ab Si di ting dem \u00bb.",
  faqVariante:
    "Size, colour an model, na wit di seller you go arrange-am direct \u2014 \u00ab Tok wit di seller \u00bb.",

  relanceAcompte: (ref, acompte) =>
    `Yua order ${ref} di wait yi *${formatXaf(acompte)}* moni for confam. Di link for pay dey for yua confam message, just for up. If di moni no come, di order go die by yisef.`,

  /* ───────────────────────────────────────────────────────────────────────
     Les 31 textes ci-dessous sont NOUVEAUX dans le `wes`.

     Ils sont arrives avec les ADR 0035 (rafale de photos, bloc paiement),
     0036 (l'apres-achat dans le fil), 0038 (panier visible) et 0039 (mode
     conges) pendant que le pidgin vivait sur une autre branche. La fusion
     les a reclames d'un coup : le typage exige la parite avec le `fr`, une
     cle manquante ne compile pas.

     **Ils n'ont PAS ete relus par une locutrice**, comme le reste du `wes`,
     et `PIDGIN_RELU` vaut toujours `false` : rien n'en sort. La relecture
     reste a faire, et elle se fait en un bloc — ADR 0034.
     ─────────────────────────────────────────────────────────────────────── */
  btnVendre: "Sell wit Catalog",
  panierVide: "Yua basket empty. Open « Si di ting dem » for put one inside.",
  btnMonPanier: "Ma basket",
  suiteSuivi: (lien) =>
    `Yua follow-up an yua resit weh you fit check dey for hia — keep dis link: ${lien}`,
  btnVoirPhotos: "Si di foto dem",
  rafaleAucunePhoto: "Dis shop never put foto — di ting dem dey for di lis.",
  panierAbandonneAilleurs:
    "New start for hia: di basket weh you bin start for di oda shop no bin keep.",
  ligneHorsLivraison: "(delivery no dey inside — na wit di seller you go arrange di transport)",
  apresConfirmation: (nom, lien) =>
    `For weti remain — delivery, question, explain — write ${nom} direct:\n${lien}`,
  blocPaiement: (b) =>
    [
      `\u{1F4B3} *For pay now: ${formatXaf(b.montantXaf)}*`,
      `${b.operateurNom ?? "Mobile Money"} : ${b.numeroAffiche}`,
      ...(b.codeEntree ? [`Dial ${b.codeEntree}, den follow di menu for send moni.`] : []),
      "Yua secret code na for yua operator yi screen ONLY you go type-am — never for hia.",
      ...(b.lienPayer ? [`One tap an di keyboard don full: ${b.lienPayer}`] : []),
      "Wen di seller paste yi SMS weh i receive, yua resit weh you fit check go comot — we go tell you for hia.",
    ].join("\n"),

  notifPaiementProuve: (ref, reste) =>
    [
      `✅ *Yua moni for ${ref} don confam* — di resit weh you fit check don comot.`,
      reste > 0
        ? `Weti remain for pay wen dem bring-am: ${formatXaf(reste)}.`
        : "Everytin don pay finish.",
      "Yua link for follow di order dey for di confam message, for up for dis tok.",
    ].join("\n"),
  notifLivree: (ref, nom) =>
    [
      `\u{1F4E6} *${ref} don mark say i don reach* by ${nom}.`,
      "You get one word for di shop?",
    ].join("\n"),

  btnContresigner: "A confam ✓",
  btnPasMoi: "Na no be me",
  btnDonnerAvis: "Talk ma mind",
  contresigneMerci: (ref) =>
    `\u{1F58B}\u{FE0F} *Tank you — yua confam don enter.*\n${ref} get two voice now: di seller yi own an yua own. Na di strongest proof weh Catalog fit make.`,
  contresigneImpossible:
    "Dis confam no get work again: either di moni never confam, or you don confam-am already. Notin change.",
  contesterConfirmation: (ref) =>
    `⚠\u{FE0F} You di talk say you no sabi dis moni for ${ref}.\nIf you confam, di order go *freeze* until some human tok — di seller no fit move-am again. Use-am only if na true.`,
  btnContesterOui: "Yes, a di complain",
  contesteEnregistre: (ref) =>
    `${ref} don mark. I no di move again until wuna settle di palava — tok wit di seller direct, na di fastest.`,
  avisInvitation: (nom) =>
    `How di order for *${nom}* take go?\nWeti you talk go helep di oda buyer dem.`,
  btnNoter: "Give di shop mark",
  avisLigne: (n) => "⭐".repeat(n),
  avisNoteEnregistree: (verifie) =>
    verifie
      ? "Tank you! Weti you talk don enter, dem mark-am *buy weh dem confam* — na because yua moni leave trace.\n\nYou get one word for add? Write-am now."
      : "Tank you! Weti you talk don enter.\nDem no mark-am « buy weh dem confam »: dis moni no get proof weh dem save.\n\nYou get one word for add? Write-am now.",
  btnSansMot: "No word",
  avisMotMerci: "I don add. Tank you say you take time.",
  avisImpossible: "Di talk di open wen di order don reach — na di seller go mark-am.",
  avisDejaDepose: "You don talk yua mind for dis order already. Tank you again!",
  apresAchatSansCommande: "No order dey for dis nomba. Open some shop yi link for order.",

  boutiqueFermeeAccueil:
    "\u{1F334} Di seller no di take new order now. You fit si di ting dem an write yi — i go tell you wen i start again.",
  boutiqueFermee: (nom) =>
    `\u{1F334} *${nom}* no di take new order now. Notin bin order. Write di seller: na only yi sabi wen i go start again.`,
};

export const TEXTES: Record<Langue, TextesAcheteuse> = { fr, en, wes };

/**
 * Un changement de langue demande par l'acheteuse, en toutes lettres.
 *
 * **Le pidgin est reconnu mais n'est pas rendu** tant qu'il n'est pas relu : on
 * sait ce que l'acheteuse a demande, on ne lui sert pas un brouillon. Elle reste
 * dans sa langue courante plutot que de recevoir un refus qu'elle n'a pas
 * demande \u2014 le bot ne sait pas dire \u00ab non \u00bb a une langue, et lui apprendre
 * co\u00fbterait un message de plus dans trois catalogues.
 */
export function langueDemandee(texteBrut: string): Langue | null {
  const net = texteBrut
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (net === "english" || net === "anglais") return servie("en");
  if (net === "francais" || net === "french") return servie("fr");
  if (net === "pidgin" || net === "kamtok" || net === "pidgin english") return servie("wes");
  return null;
}

/**
 * Ce que vaut une langue lue AILLEURS que dans le typage \u2014 la colonne
 * `bot_conversation.langue`, la charge utile d'un job pg-boss.
 *
 * Deux dangers, un seul garde : une valeur inconnue (colonne libre, generation
 * anterieure), et une valeur connue mais NON SERVIE. Le second est le vrai :
 * une conversation persistee en `wes` pendant que le drapeau etait a `true`
 * continuerait a recevoir du pidgin apres qu'on l'a referme.
 */
export function normaliserLangue(valeur: unknown): Langue {
  return LANGUES_SERVIES.find((l) => l === valeur) ?? "fr";
}

function servie(langue: Langue): Langue | null {
  return LANGUES_SERVIES.includes(langue) ? langue : null;
}
