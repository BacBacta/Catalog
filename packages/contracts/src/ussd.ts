/**
 * La rampe de paiement — SANS Zod, comme `phone.ts` et pour la meme raison.
 *
 * Ce module part dans le NAVIGATEUR de l'acheteuse : il est importe par l'ilot de
 * paiement de la boutique publique, dont le chemin critique est borne a 30 Ko.
 * Une fonction destinee au navigateur ne partage pas son module avec un schema
 * (voir l'en-tete de `phone.ts`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Catalog ne declenche aucun transfert. Il pre-remplit le clavier.**
 *
 * Un lien `tel:` porte la chaine USSD complete ; le composeur du telephone
 * s'ouvre garni, l'acheteuse appuie sur appeler, et la session de l'operateur
 * prend le relais. Pas d'application a installer, pas de permission a accorder,
 * et surtout : **le code secret se saisit chez l'operateur**. Catalog ne le voit
 * jamais et n'a aucun champ ou il pourrait etre saisi.
 *
 * **AUCUN code USSD n'est ecrit ici.** Ni `*126#`, ni `#150*50#`, ni aucun autre.
 * Ce module ne connait que des GABARITS venus de la configuration : les
 * operateurs changent leurs codes, et un code fige dans le code source se
 * remplace par un redeploiement, c'est-a-dire trop tard. La configuration vit
 * dans `apps/api/src/domain/ramp/config.ts` et se surcharge par l'environnement.
 */

import { normalizePhone } from "./phone.ts";

/* ────────────────────────────── la configuration ────────────────────────── */

/** Les deux seuls emplacements reconnus dans un gabarit. */
export const JETON_NUMERO = "{numero}";
export const JETON_MONTANT = "{montant}";

export interface CanalUssd {
  id: string;
  /** Ce que fait cette chaine, en langue simple. Affiche tel quel. */
  libelle: string;
  /** Gabarit : `{numero}` et `{montant}` y sont remplaces. Un gabarit sans
   *  emplacement est un code d'entree — il ouvre le menu, sans rien pre-remplir. */
  modele: string;
  /**
   * **Le drapeau du lot 9.** `true` uniquement pour ce qui a ete constate :
   * les codes d'entree, releves le 29/07/2026 dans la reponse de l'API de
   * l'agregateur. Toute chaine complete censee sauter les niveaux de menu reste
   * `false` tant que personne ne l'a composee sur un telephone reel a Douala.
   *
   * Une chaine `false` n'est pas cachee : elle est proposee AVEC le chemin
   * manuel, et l'ecran reste utilisable si elle echoue.
   */
  verifie: boolean;
}

export interface OperateurRampe {
  id: string;
  nom: string;
  /** Toujours `verifie: true` : c'est le chemin qui ne peut pas echouer. */
  codeEntree: CanalUssd;
  /** Peut etre vide : un operateur sans raccourci connu n'en invente pas. */
  raccourcis: CanalUssd[];
  /** Les etapes ecrites en clair, affichees SOUS le bouton, toujours. */
  etapes: string[];
  /**
   * Les intitules de menu exacts n'ont pas ete releves sur un telephone. Tant que
   * ce drapeau est `true`, l'interface dit que les libelles peuvent differer
   * plutot que de faire passer une supposition pour une consigne.
   */
  etapesAConfirmer: boolean;
  /**
   * Montant minimum accepte par l'operateur. Mesure le 29/07/2026 : Orange
   * refuse sous 10 F (erreur ER201), MTN accepte 5 F.
   */
  montantMinXaf: number;
}

export interface RampeConfig {
  version: number;
  operateurs: OperateurRampe[];
}

/* ───────────────────────────── construction ─────────────────────────────── */

export interface Versement {
  /** Numero de REVERSEMENT de la vendeuse — le destinataire des fonds. */
  numero: string;
  /** Entier de francs. Le franc CFA n'a pas de sous-unite. */
  montantXaf: number;
}

/**
 * Une chaine USSD ne contient que des chiffres, des etoiles et des dieses.
 *
 * Ce controle n'est pas cosmetique : la chaine part dans un lien `tel:`, et un
 * caractere de separation glisse par une configuration ou un numero mal forme y
 * ferait passer autre chose qu'un appel.
 */
const USSD_VALIDE = /^[*#0-9]+$/;

/** Numero au format national a neuf chiffres, tel que le composeur l'attend. */
export function numeroLocal(numero: string): string {
  const n = normalizePhone(numero);
  if (!n) throw new Error("numero de reversement non camerounais");
  return n.slice(-9);
}

/**
 * Remplit un gabarit.
 *
 * Un gabarit sans emplacement — le code d'entree — rend la chaine telle quelle :
 * c'est voulu, il ouvre le menu et l'acheteuse saisit elle-meme.
 */
export function chaineUssd(canal: CanalUssd, versement: Versement): string {
  const { montantXaf } = versement;
  if (!Number.isInteger(montantXaf) || montantXaf <= 0) {
    throw new Error("montant non entier ou nul");
  }

  let chaine = canal.modele;
  if (chaine.includes(JETON_NUMERO)) {
    chaine = chaine.split(JETON_NUMERO).join(numeroLocal(versement.numero));
  }
  if (chaine.includes(JETON_MONTANT)) {
    chaine = chaine.split(JETON_MONTANT).join(String(montantXaf));
  }

  if (!USSD_VALIDE.test(chaine)) throw new Error("chaine USSD invalide");
  return chaine;
}

/**
 * Lien `tel:` — **le diese DOIT etre encode `%23`**.
 *
 * Sans cet encodage le navigateur traite le `#` comme une ancre et tronque la
 * chaine : le composeur s'ouvre sur `tel:*126*1*1*677123456*7500`, sans le diese
 * final, et la session ne part jamais. C'est la panne la plus discrete du
 * parcours — le lien s'ouvre, rien ne se passe.
 *
 * L'etoile, elle, est valide telle quelle dans un URI `tel:`.
 */
export function lienTel(ussd: string): string {
  if (!USSD_VALIDE.test(ussd)) throw new Error("chaine USSD invalide");
  return `tel:${ussd.replace(/#/g, "%23")}`;
}

/* ─────────────────────────────── les chemins ────────────────────────────── */

export type TypeChemin = "raccourci" | "code_entree";

export interface Chemin {
  id: string;
  libelle: string;
  type: TypeChemin;
  ussd: string;
  tel: string;
  verifie: boolean;
}

/**
 * Les chemins proposes a l'acheteuse, dans l'ordre d'affichage.
 *
 * **Il y en a toujours au moins deux quand un raccourci existe**, et c'est la
 * regle du lot : un raccourci non verifie ne remplace jamais le code d'entree,
 * il s'ajoute au-dessus. Si le raccourci echoue — et personne ne peut affirmer
 * qu'il fonctionne tant qu'il n'a pas ete compose a Douala —, l'ecran reste
 * utilisable tel quel.
 */
export function cheminsDePaiement(operateur: OperateurRampe, versement: Versement): Chemin[] {
  const chemins: Chemin[] = [];
  for (const canal of operateur.raccourcis) {
    chemins.push(versChemin(canal, "raccourci", versement));
  }
  chemins.push(versChemin(operateur.codeEntree, "code_entree", versement));
  return chemins;
}

function versChemin(canal: CanalUssd, type: TypeChemin, versement: Versement): Chemin {
  const ussd = chaineUssd(canal, versement);
  return {
    id: canal.id,
    libelle: canal.libelle,
    type,
    ussd,
    tel: lienTel(ussd),
    verifie: canal.verifie,
  };
}

/**
 * Le montant tient-il le minimum de l'operateur ?
 *
 * Rendu plutot que leve : c'est une information a montrer a l'acheteuse avant
 * qu'elle compose, pas une erreur de programmation. Un refus ER201 apres l'appel
 * lui couterait une session pour rien.
 */
export function montantAcceptable(operateur: OperateurRampe, montantXaf: number): boolean {
  return Number.isInteger(montantXaf) && montantXaf >= operateur.montantMinXaf;
}

/** Un operateur de la configuration, par identifiant. `null` si inconnu. */
export function operateurParId(config: RampeConfig, id: string): OperateurRampe | null {
  return config.operateurs.find((o) => o.id === id) ?? null;
}
