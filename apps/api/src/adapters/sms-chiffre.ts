import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Chiffrement du SMS brut, AU REPOS.
 *
 * **Pourquoi.** Le SMS operateur contient le SOLDE DU COMPTE de la vendeuse —
 * « Votre nouveau solde: 12020 XAF ». Ce n'est pas une donnee de paiement, c'est
 * sa situation financiere. Une sauvegarde de base qui fuit exposerait le solde de
 * chaque vendeuse du service.
 *
 * On le conserve quand meme, et il faut savoir pourquoi : c'est la piece qui
 * permet de rejouer l'analyse le jour ou un motif change, et de trancher un
 * litige. Le supprimer rendrait toute contestation ininstruisible.
 *
 * **AES-256-GCM**, pas CBC : GCM authentifie. Sans authentification, un texte
 * chiffre modifie se dechiffre en donnees quelconques et l'analyse repartirait
 * sur un message fabrique.
 *
 * Format stocke : `v1.<sel>.<nonce>.<etiquette>.<chiffre>`, en base64url. Le
 * prefixe de version est ce qui permettra de changer d'algorithme sans avoir a
 * deviner comment les anciennes lignes ont ete ecrites.
 */

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const LONGUEUR_SEL = 16;
const LONGUEUR_NONCE = 12;

const b64 = (b: Buffer) => b.toString("base64url");
const deB64 = (s: string) => Buffer.from(s, "base64url");

export interface ChiffreurSms {
  chiffrer(clair: string): string;
  dechiffrer(stocke: string): string;
}

/**
 * Chiffreur reel.
 *
 * La cle est derivee par `scrypt` a chaque appel — cout deliberement accepte : un
 * SMS est colle par une vendeuse, pas mille fois par seconde. Un sel par message
 * evite qu'une meme cle produise le meme materiel pour tous.
 *
 * **Aucune valeur de repli pour le secret.** Un secret par defaut serait le meme
 * partout, donc public, et le chiffrement ne serait qu'un decor.
 */
export class ChiffreurAesGcm implements ChiffreurSms {
  readonly #secret: string;

  constructor(secret: string | undefined = process.env.SMS_ENCRYPTION_KEY) {
    if (!secret || secret.length < 32) {
      throw new Error(
        "SMS_ENCRYPTION_KEY est requis et fait au moins 32 caracteres. Sans cle, " +
          "le SMS brut — qui porte le solde du compte de qui vend — serait " +
          "stocke en clair.",
      );
    }
    this.#secret = secret;
  }

  chiffrer(clair: string): string {
    const sel = randomBytes(LONGUEUR_SEL);
    const nonce = randomBytes(LONGUEUR_NONCE);
    const cle = scryptSync(this.#secret, sel, 32);
    const chiffreur = createCipheriv(ALGO, cle, nonce);
    const chiffre = Buffer.concat([chiffreur.update(clair, "utf8"), chiffreur.final()]);
    return [VERSION, b64(sel), b64(nonce), b64(chiffreur.getAuthTag()), b64(chiffre)].join(".");
  }

  dechiffrer(stocke: string): string {
    const parts = stocke.split(".");
    if (parts.length !== 5 || parts[0] !== VERSION) {
      // Le message d'erreur ne porte rien du contenu : il remonterait dans une
      // trace.
      throw new Error("format de SMS chiffre inattendu");
    }
    const [, sel, nonce, etiquette, chiffre] = parts as [string, string, string, string, string];
    const cle = scryptSync(this.#secret, deB64(sel), 32);
    const dechiffreur = createDecipheriv(ALGO, cle, deB64(nonce));
    dechiffreur.setAuthTag(deB64(etiquette));
    return Buffer.concat([dechiffreur.update(deB64(chiffre)), dechiffreur.final()]).toString(
      "utf8",
    );
  }
}

/**
 * Chiffreur inerte, pour les tests qui ne portent pas sur le chiffrement.
 *
 * **Il refuse de se construire en production.** Un chiffreur inerte actif en
 * production, ce sont les soldes de toutes les vendeuses en clair dans une
 * sauvegarde — panne silencieuse, et la pire de ce module.
 */
export class ChiffreurInerte implements ChiffreurSms {
  constructor(env: { NODE_ENV?: string | undefined } = process.env) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "ChiffreurInerte ne chiffre RIEN : en production, le solde de chaque " +
          "boutique serait en clair en base. Configurez SMS_ENCRYPTION_KEY.",
      );
    }
  }
  chiffrer(clair: string): string {
    return `inerte.${Buffer.from(clair, "utf8").toString("base64url")}`;
  }
  dechiffrer(stocke: string): string {
    return Buffer.from(stocke.replace(/^inerte\./, ""), "base64url").toString("utf8");
  }
}

/**
 * Choisit le chiffreur d'apres la configuration. Seul endroit ou le choix vit.
 *
 * Sans `SMS_ENCRYPTION_KEY`, on prend l'inerte — qui refusera de se construire en
 * production. Un oubli de configuration devient donc une panne immediate et
 * lisible plutot qu'une fuite differee.
 */
export function resolveChiffreurSms(env: NodeJS.ProcessEnv = process.env): ChiffreurSms {
  return env.SMS_ENCRYPTION_KEY
    ? new ChiffreurAesGcm(env.SMS_ENCRYPTION_KEY)
    : new ChiffreurInerte(env);
}
