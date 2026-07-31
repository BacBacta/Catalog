/**
 * Les accuses de livraison de SMS — interpretation PURE.
 *
 * ── A quoi ils servent ICI, et ce n'est pas au confort ────────────────────
 *
 * `sms-provider.ts` posait, comme troisieme decision non tranchee : « le
 * comportement en cas d'echec partiel — une passerelle qui accepte le message
 * puis ne le delivre pas est le cas courant, et il ne se voit pas depuis un code
 * HTTP 200 ». Orange fournit la reponse : un accuse de livraison poste vers
 * notre serveur.
 *
 * Et il repond a une seconde question, plus urgente encore : **est-ce que les
 * vendeuses MTN recoivent leur code ?** Les deux offres SMS d'Orange partagent
 * le meme chemin technique, et seule la souscription de l'application les
 * distingue (voir `adapters/sms-orange.ts`). Aucun test ne peut le verifier.
 * L'accuse de livraison, ventile par operateur, le mesure en production — c'est
 * le seul controle automatique de cette couverture.
 *
 * ── Le piege : « impossible » ne veut PAS dire « non delivre » ────────────
 *
 * La documentation Orange est explicite, et c'est la nuance qui compte le plus
 * dans ce fichier : derriere un `DeliveryImpossible`, **le SMS peut avoir ete
 * delivre quand meme** — un telephone hors reseau ou dechargé plus de vingt-
 * quatre heures produit ce statut. Il apparait aussi pour un numero fixe ou un
 * numero qui n'est plus attribue.
 *
 * Traiter `DeliveryImpossible` comme une preuve de non-delivrance ferait donc
 * conclure a une panne de couverture la ou il n'y a que des telephones eteints.
 * Seul `DeliveredToTerminal` est une information sure.
 *
 * Module PUR : aucune horloge, aucun reseau, aucune base.
 */

/** Le vocabulaire d'Orange, tel quel. On ne le traduit pas en base. */
export const STATUTS_ORANGE = [
  "DeliveredToTerminal",
  "DeliveredToNetwork",
  "MessageWaiting",
  "DeliveryUncertain",
  "DeliveryImpossible",
] as const;

export type StatutOrange = (typeof STATUTS_ORANGE)[number];

/**
 * Ce qu'on en conclut, en trois etats — et un quatrieme qui dit qu'on ne sait
 * pas.
 *
 * `certain` distingue ce sur quoi on peut raisonner de ce qui n'est qu'un
 * indice. **Une seule valeur est certaine**, et c'est voulu : compter les
 * echecs comme surs gonflerait un taux de panne avec des telephones eteints.
 */
export type EtatLivraison = "livre" | "en_cours" | "echec_possible" | "inconnu";

export interface Verdict {
  etat: EtatLivraison;
  /** Vrai uniquement quand l'information ne peut plus changer ni se tromper. */
  certain: boolean;
  /** Ce qu'on dirait a un exploitant qui lit un tableau de bord. */
  explication: string;
}

const VERDICTS: Record<StatutOrange, Verdict> = {
  DeliveredToTerminal: {
    etat: "livre",
    certain: true,
    explication: "Le message est arrivé sur le téléphone. C'est la seule information sûre.",
  },
  DeliveredToNetwork: {
    etat: "en_cours",
    certain: false,
    explication:
      "Remis au réseau, pas encore au téléphone. L'accusé final peut arriver jusqu'à 24 h plus tard.",
  },
  MessageWaiting: {
    etat: "en_cours",
    certain: false,
    explication: "En file d'attente chez l'opérateur. État temporaire.",
  },
  DeliveryUncertain: {
    etat: "inconnu",
    certain: false,
    explication:
      "L'opérateur a perdu la trace du message — typiquement passé à un autre réseau. Ni succès ni échec.",
  },
  DeliveryImpossible: {
    etat: "echec_possible",
    certain: false,
    explication:
      "Échec annoncé, mais NON concluant : un téléphone éteint plus de 24 h, un numéro fixe ou " +
      "un numéro désaffecté produisent le même statut, et le message a pu arriver quand même.",
  },
};

/**
 * Interprete un statut d'Orange. Un statut inconnu — l'operateur en ajoute un —
 * ne fait pas echouer : il compte comme `inconnu`, et le tableau de bord le
 * montrera. Lever ici ferait tomber une route de rappel pour un mot nouveau.
 */
export function interpreter(statut: string): Verdict {
  return (
    VERDICTS[statut as StatutOrange] ?? {
      etat: "inconnu",
      certain: false,
      explication: `Statut « ${statut} » non répertorié. À vérifier auprès de l'opérateur.`,
    }
  );
}

/* ────────────────────────── l'operateur, approche ────────────────────────── */

export type OperateurProbable = "mtn" | "orange" | "camtel" | "inconnu";

/**
 * L'operateur DEDUIT du prefixe — et le mot « probable » est dans le nom pour
 * une raison.
 *
 * **La portabilite du numero rend cette deduction approximative.** Un abonne qui
 * a porte son numero garde son prefixe d'origine tout en etant chez un autre
 * operateur. Ce n'est donc pas une verite, c'est un indicateur.
 *
 * Il reste utile pour ce qu'on lui demande : reperer un ECART SYSTEMATIQUE. Si
 * les numeros en 67 et 68 n'arrivent jamais alors que ceux en 69 arrivent
 * toujours, la portabilite n'explique pas l'ecart — la souscription a la
 * mauvaise offre Orange, si.
 *
 * **Jamais utilise pour une decision metier**, seulement pour une mesure. Aucune
 * regle de preuve, de paiement ou d'authentification ne lit cette fonction.
 *
 * Plages d'attribution (a confirmer au terrain, comme le reste) :
 * MTN `67`, `68`, `650`–`654` · Orange `69`, `655`–`659` · Camtel `62`.
 */
export function operateurProbable(numero: string): OperateurProbable {
  const chiffres = numero.replace(/\D/g, "");
  const national = chiffres.startsWith("237") ? chiffres.slice(3) : chiffres;
  if (national.length !== 9) return "inconnu";

  if (national.startsWith("62")) return "camtel";
  if (national.startsWith("67") || national.startsWith("68")) return "mtn";
  if (national.startsWith("69")) return "orange";

  const trois = national.slice(0, 3);
  if (trois >= "650" && trois <= "654") return "mtn";
  if (trois >= "655" && trois <= "659") return "orange";
  return "inconnu";
}

/* ────────────────────────── la notification ────────────────────────── */

export interface AccuseLivraison {
  /** Le numero destinataire, tel qu'Orange le rend (`tel:+237…`), nettoye. */
  numero: string;
  statut: string;
  /** L'identifiant de correlation renvoye par Orange, s'il en pose un. */
  correlation: string | null;
}

/**
 * Lit le corps poste par Orange, ou rend `null`.
 *
 * Forme recopiee de la documentation, pas ecrite de memoire :
 *
 * ```json
 * { "deliveryInfoNotification": {
 *     "callbackData": "…",
 *     "deliveryInfo": { "address": "tel:+237…", "deliveryStatus": "…" } } }
 * ```
 *
 * **Tolerante par choix.** Un corps inattendu rend `null` et l'appelant repond
 * quand meme 200 : Orange attend un 200, et lui rendre une erreur ne ferait
 * revenir personne — on perdrait la mesure ET on ferait sonner une alarme chez
 * l'operateur.
 */
export function lireAccuse(corps: unknown): AccuseLivraison | null {
  const n = (corps as { deliveryInfoNotification?: unknown } | null)?.deliveryInfoNotification;
  if (!n || typeof n !== "object") return null;

  const info = (n as { deliveryInfo?: unknown }).deliveryInfo;
  if (!info || typeof info !== "object") return null;

  const adresse = (info as { address?: unknown }).address;
  const statut = (info as { deliveryStatus?: unknown }).deliveryStatus;
  if (typeof adresse !== "string" || typeof statut !== "string") return null;

  const correlation = (n as { callbackData?: unknown }).callbackData;
  return {
    numero: adresse.replace(/^tel:/, "").trim(),
    statut: statut.trim(),
    correlation: typeof correlation === "string" && correlation ? correlation : null,
  };
}
