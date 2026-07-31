/**
 * Envoi de SMS sortants — INTERFACE seulement.
 *
 * Le domaine ne connait aucun fournisseur. C'est la meme regle que pour les
 * agregateurs de paiement, et pour la meme raison : le marche camerounais des
 * passerelles SMS bouge, et on doit pouvoir en changer sans toucher au metier.
 *
 * Aucun fournisseur n'est code en dur nulle part. Les implementations vivent
 * dans `src/adapters/` et se choisissent par configuration.
 */

export interface SmsMessage {
  /** Destinataire au format E.164 : +237XXXXXXXXX. */
  to: string;
  /** Texte brut. Pas de HTML, pas de lien indispensable. */
  text: string;
  /**
   * Etiquette de journalisation. Ne contient JAMAIS le code lui-meme :
   * un OTP dans un log est un OTP compromis.
   */
  kind: "otp_connexion" | "otp_reversement" | "rappel_solde" | "expiration";
  /**
   * La valeur BRUTE qui a servi a composer `text` — le code a six chiffres, le
   * montant, la reference.
   *
   * ── Pourquoi elle voyage a cote de la phrase ──────────────────────────────
   *
   * Un canal SMS envoie une phrase. **Un modele WhatsApp n'accepte pas de
   * phrase** : Meta approuve un gabarit — « {{1}} is your verification code » —
   * et l'API attend le PARAMETRE, pas le texte fini. Sans ce champ, l'adaptateur
   * WhatsApp devrait re-extraire le code de la phrase par une expression
   * reguliere, qui se casserait a la premiere reformulation d'un libelle. Un
   * canal ne doit pas dependre de la ponctuation d'un autre.
   *
   * Optionnelle a dessein : un adaptateur SMS l'ignore, et rien de ce qui
   * existait avant ce champ n'a besoin d'etre reecrit.
   */
  valeur?: string;
}

export interface SmsSender {
  readonly name: string;
  /**
   * Envoie, ou leve. Un echec doit remonter : un OTP qu'on croit envoye et qui
   * ne part pas laisse la vendeuse devant un champ qu'elle ne pourra jamais
   * remplir, sans rien pour le lui dire.
   */
  send(message: SmsMessage): Promise<void>;
}

/**
 * Le texte des messages sortants.
 *
 * En francais simple. Les variantes anglais et pidgin sont prevues des la
 * conception (AGENTS.md) : la signature accepte une langue, meme si seule la
 * premiere est ecrite aujourd'hui. Le pidgin n'est pas reserve aux regions
 * anglophones.
 */
export type Langue = "fr" | "en" | "pcm";

const TEXTES: Record<SmsMessage["kind"], Record<Langue, (code: string) => string>> = {
  otp_connexion: {
    fr: (c) => `Catalog : votre code de connexion est ${c}. Il expire dans 5 minutes.`,
    en: (c) => `Catalog: your sign-in code is ${c}. It expires in 5 minutes.`,
    pcm: (c) => `Catalog: your code na ${c}. E go expire for 5 minutes.`,
  },
  otp_reversement: {
    fr: (c) =>
      `Catalog : code ${c} pour confirmer que c'est bien sur ce numero que vous voulez etre payee.`,
    en: (c) => `Catalog: code ${c} to confirm this is the number where you want to be paid.`,
    pcm: (c) => `Catalog: code ${c} to confirm say na dis number you wan collect your money.`,
  },
  rappel_solde: {
    fr: (c) => `Catalog : il reste ${c} a encaisser sur cette commande.`,
    en: (c) => `Catalog: ${c} still to collect on this order.`,
    pcm: (c) => `Catalog: ${c} still dey to collect for dis order.`,
  },
  expiration: {
    fr: (c) => `Catalog : la commande ${c} n'a pas ete payee et va expirer.`,
    en: (c) => `Catalog: order ${c} has not been paid and will expire.`,
    pcm: (c) => `Catalog: order ${c} no don pay, e go expire.`,
  },
};

export function texteSms(kind: SmsMessage["kind"], valeur: string, langue: Langue = "fr"): string {
  return TEXTES[kind][langue](valeur);
}
