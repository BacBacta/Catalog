/**
 * Les fixtures de SMS operateurs.
 *
 * **Tous ces messages sont pseudonymises.** Numeros, noms commerciaux,
 * identifiants et soldes ont ete remplaces par des valeurs de forme STRICTEMENT
 * IDENTIQUE : meme longueur, memes separateurs, memes espaces parasites, memes
 * melanges de devise. Tout ce dont un analyseur depend est preserve ; rien de ce
 * qui identifie une personne ne l'est.
 *
 * **Ne jamais committer ici un SMS reel non pseudonymise**, ni en test, ni en
 * fixture, ni en commentaire. Les captures d'origine restent hors du depot.
 *
 * Source : `docs/formats-sms-operateurs.md` §2 et §6. Ce fichier-la est la
 * specification ; celui-ci en decoule.
 */

/** MTN — paiement sortant. Capture reelle du 23/06/2026, confirmee. */
export const MTN_PAIEMENT_SORTANT =
  "Votre paiement de 17000 XAF a Transfer To non MoMo Account a ete effectue le 2026-06-23 14:03:21. Votre nouveau solde: 12020 XAF. Frais: 378 XAF. Message: -. Transaction Id: 17600000001. Prix Cassés chez MoMo pour tout le monde ! 0 F sur tes transferts et -25% sur tes retraits Hors Taxe.";

/**
 * MTN — transfert sortant inter-reseaux. Capture reelle, confirmee.
 *
 * Deux pieges de ponctuation a preserver mot pour mot : **espace AVANT le point**
 * dans `14:03:21 .`, et **pas d'espace APRES le point** dans
 * `17600000001.Nouveau`.
 */
export const MTN_TRANSFERT_SORTANT =
  "Transfert reussi de 17000 FCFA au 688000001 via Orange Cameroun a 2026-06-23 14:03:21 . ID transaction 17600000001.Nouveau solde 12020 FCFA.";

/**
 * MTN — reception. Capture reelle, confirmee.
 *
 * **C'est le message qui fait autorite** : celui que la vendeuse recoit quand
 * elle est payee. Trois pieges : numero a douze chiffres avec indicatif, espace
 * avant la parenthese fermante, expediteur en raison sociale avec des espaces.
 */
export const MTN_RECEPTION =
  "Vous avez recu 26800 XAF de ALPHA TRADING SARL (237652000001 ) sur votre compte Mobile Money 2026-06-23 09:50:32. Message de l'expediteur:. Votre nouveau solde est de 29398 FCFA. Frais: 0 XAF. Transaction ID: 17600000002.Prix Cassés chez MoMo pour tout le monde !";

/** Orange — rechargement. Capture reelle du 29/07/2026, confirmee. */
export const ORANGE_RECHARGEMENT =
  "Rechargement reussi. Montant de la transaction: 650 FCFA, ID transaction: RC241204.1533.B00001, Frais: 0 FCFA, Commission: 0 FCFA, Nouveau solde: 108762.45 FCFA";

// RECONSTITUÉ — ne prouve pas le format, voir docs/formats-sms-operateurs.md §7
/**
 * Orange — reception. **Ce message n'existe pas.**
 *
 * Il est fabrique, une seule fois, dans la specification, pour donner au motif
 * `om.entrant` de quoi etre exerce. Il est recopie d'elle plutot que reinvente
 * ici — ainsi personne ne le prend pour une capture, et tout le monde teste la
 * meme chose.
 *
 * Ce qui vient de la capture reelle : l'amorce `You have received`, la devise
 * `FCFA`, la preposition `of`. **Tout le reste est deduit** — la presence d'un
 * numero, la ponctuation, l'ordre des champs, le libelle `ID transaction`, la
 * presence meme d'un solde. C'est pourquoi le motif porte `aConfirmer`.
 */
export const ORANGE_RECEPTION_RECONSTITUE =
  "You have received 17000 FCFA of 237677000001, ID transaction: MP260623.1403.C73941, Frais: 0 FCFA, Nouveau solde: 108762.45 FCFA";

/** Meme message, avec un identifiant dont le MOIS 99 n'existe pas. */
export const ORANGE_RECEPTION_ID_IMPOSSIBLE = ORANGE_RECEPTION_RECONSTITUE.replace(
  "MP260623.1403.C73941",
  "MP269932.1403.C73941",
);

/** Meme message, identifiant en MINUSCULES. */
export const ORANGE_RECEPTION_ID_MINUSCULES = ORANGE_RECEPTION_RECONSTITUE.replace(
  "MP260623.1403.C73941",
  "mp260623.1403.c73941",
);

/** Montant a virgule de milliers : `xafInt` doit rendre 1500, jamais NaN. */
export const ORANGE_RECEPTION_MONTANT_VIRGULE = ORANGE_RECEPTION_RECONSTITUE.replace(
  "17000 FCFA of",
  "1,500 FCFA of",
);

/* ────────────────────────── ce qui NE DOIT PAS etre reconnu ────────────────────────── */

/** La capture tronquee, telle qu'elle est. La troncature ne doit pas passer. */
export const ORANGE_TRONQUE = "You have received 650 FCFA of";

/** Du texte libre tape a la main par quelqu'un qui invente un paiement. */
export const TEXTE_LIBRE =
  "bonjour tantine jai envoye les 17000 francs ce matin par momo merci de preparer ma commande";

/* ────────────────────────── entree sale ────────────────────────── */

/**
 * Le meme SMS de reception MTN, avec des espaces insecables et des retours a la
 * ligne — ce que produit reellement un copier-coller depuis l'application
 * Messages. La normalisation doit tout absorber.
 */
export const MTN_RECEPTION_SALE = MTN_RECEPTION.replace(/ /g, (_m: string, ...args: unknown[]) => {
  const i = args[0] as number;
  // Espace fine insecable, espace insecable, retour a la ligne indente : les
  // trois formes qu'un copier-coller depuis Messages produit reellement.
  if (i % 7 === 0) return "\u202f";
  if (i % 11 === 0) return "\n  ";
  return "\u00a0";
});
