import type { Attributes, AttributeValue } from "@opentelemetry/api";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { analyserSms } from "../domain/proof/motifs.ts";

/**
 * **Le SMS brut ne figure dans AUCUNE trace.** C'est un critere de la definition
 * de terminé du lot 14, et c'est le fichier qui le tient.
 *
 * ── Pourquoi c'est plus grave qu'une fuite de donnees ordinaire ────────────
 *
 * Un SMS d'operateur porte le **solde du compte** de la vendeuse. Pas le montant
 * de la vente : le solde. « Votre nouveau solde: 12020 XAF. » Une trace part
 * chez un fournisseur d'observabilite, se garde des semaines, se lit par
 * quiconque a un acces en lecture au tableau de bord — un prestataire, un
 * stagiaire, un incident de configuration. Le lot 8 chiffre deja ce texte avant
 * qu'il entre en base ; le laisser ressortir par une trace annulerait ce
 * chiffrement en entier.
 *
 * ── Deux couches, parce qu'une seule se contourne ──────────────────────────
 *
 * 1. **Par construction.** Le code d'instrumentation ne pose que des attributs
 *    d'une liste fermee (`ATTRIBUTS_AUTORISES`). Le SMS n'y est pas, et ne peut
 *    pas y etre : la liste est verifiee par un test.
 * 2. **Par filet.** Ce processeur inspecte CHAQUE span avant l'export et retire
 *    tout ce qui n'est pas sur la liste, plus tout ce qui ressemble a un SMS
 *    d'operateur. Il couvre le chemin auquel personne ne pense — l'EXCEPTION.
 *    `span.recordException(e)` recopie le message et la pile d'appel dans un
 *    evenement ; il suffit qu'une erreur ait ete construite avec le texte du SMS
 *    quelque part pour qu'il parte. C'est la fuite la plus probable des deux,
 *    parce que personne ne l'ecrit exprès.
 *
 * La seconde couche n'est pas une ceinture de securite decorative : elle
 * COMPTE ce qu'elle attrape (`fuitesEvitees`). Une redaction silencieuse
 * masquerait le defaut qu'elle corrige.
 */

/* ────────────────────────── liste fermee ────────────────────────── */

/**
 * Les seules cles d'attribut qu'un span de Catalog a le droit de porter.
 *
 * Fermee, et pas « tout sauf le SMS ». Une liste de refus se contourne par
 * inadvertance : il suffit d'un attribut au nom neuf. Une liste
 * d'autorisation, elle, refuse par defaut — le pire cas est un attribut
 * manquant dans un tableau de bord, jamais un solde qui part chez un tiers.
 *
 * **Aucune de ces cles ne porte de montant en francs.** Le lot 3 l'a deja
 * decide pour la base — `payment_proof` n'a aucune colonne de solde —, et la
 * meme regle vaut ici. Un tableau de bord n'a pas besoin de savoir combien
 * gagne une vendeuse ; il a besoin de savoir si la preuve passe.
 */
export const ATTRIBUTS_AUTORISES: ReadonlySet<string> = new Set([
  /* Qui, sans dire qui : des identifiants opaques, jamais un numero. */
  "catalog.commande.id",
  "catalog.vendeuse.id",
  /* Ce qui s'est passe. */
  "catalog.preuve.operateur",
  "catalog.preuve.motif",
  "catalog.preuve.verdict",
  "catalog.preuve.a_confirmer",
  "catalog.preuve.controle_echoue",
  "catalog.preuve.identifiant_rejoue",
  "catalog.commande.etat_preuve",
  "catalog.commande.etape",
  "catalog.commande.transition_refusee",
  "catalog.rampe.operateur",
  "catalog.rampe.code_verifie",
  /* Le resultat, en un mot. */
  "catalog.issue",
  /* Attributs standard d'OpenTelemetry, poses par les instrumentations HTTP. */
  "http.request.method",
  "http.response.status_code",
  "url.path",
  "server.address",
  "service.name",
]);

/* ────────────────────────── detection ────────────────────────── */

/**
 * Marqueurs de contenu de SMS operateur, releves dans
 * `docs/formats-sms-operateurs.md` §2.
 *
 * Volontairement TROP LARGES. Un faux positif coute un attribut absent d'un
 * tableau de bord ; un faux negatif coute le solde d'une vendeuse chez un
 * tiers. Les deux ne se comparent pas.
 */
const MARQUEURS = [
  "transaction id",
  "id transaction",
  "nouveau solde",
  "votre solde",
  "you have received",
  "vous avez recu",
  "vous avez reçu",
  "transfert reussi",
  "transfert réussi",
  "rechargement reussi",
  "rechargement réussi",
  "votre paiement de",
  "mobile money",
  "frais:",
  "commission:",
];

/**
 * Au-dela de cette longueur, une chaine n'a rien a faire dans une trace.
 *
 * Le plus court des SMS de la specification fait 137 caracteres ; le plus long
 * en fait plus de 300. Aucun attribut legitime de ce produit n'approche ce
 * seuil — un identifiant d'operateur fait vingt-deux caracteres au pire, un
 * verdict en fait vingt.
 */
const LONGUEUR_MAX = 120;

/**
 * Est-ce du contenu de SMS operateur ?
 *
 * Trois epreuves, de la moins chere a la plus chere. La derniere appelle
 * l'analyseur du domaine : c'est ce qui fait que **le detecteur suit la
 * specification**. Le jour ou un motif est ajoute pour un nouvel operateur, ce
 * detecteur le reconnait sans qu'on ait pense a le mettre a jour ici.
 */
export function ressembleAUnSmsOperateur(valeur: string): boolean {
  if (valeur.length > LONGUEUR_MAX) return true;
  const bas = valeur.toLowerCase();
  if (MARQUEURS.some((m) => bas.includes(m))) return true;
  // L'analyse est le controle le plus sur, et le plus couteux. Une chaine
  // courte ne peut pas etre un SMS complet : on s'en dispense.
  if (valeur.length < 40) return false;
  return analyserSms(valeur).reconnu;
}

/** Ce qui remplace une valeur retiree. Explicite : un vide se lirait « absent ». */
export const REDACTE = "[redacté]";

/**
 * Un attribut passe-t-il ? Rend la valeur a conserver, ou `null` pour la
 * retirer.
 */
export function filtrerAttribut(cle: string, valeur: AttributeValue): AttributeValue | null {
  if (!ATTRIBUTS_AUTORISES.has(cle)) return null;
  if (typeof valeur === "string" && ressembleAUnSmsOperateur(valeur)) return null;
  if (Array.isArray(valeur)) {
    const suspect = valeur.some((v) => typeof v === "string" && ressembleAUnSmsOperateur(v));
    if (suspect) return null;
  }
  return valeur;
}

/* ────────────────────────── le processeur ────────────────────────── */

export interface CompteurDeFuites {
  /** Nombre de valeurs retirees depuis le demarrage. Jamais remis a zero. */
  fuitesEvitees: number;
}

/**
 * Le filet. Il s'insere AVANT l'exportateur et nettoie chaque span termine.
 *
 * `onEnd` recoit l'objet meme que l'exportateur va serialiser : le muter est le
 * seul point ou la redaction s'applique a tout, y compris aux attributs poses
 * par une instrumentation tierce qu'on ne controle pas. Le typage
 * d'OpenTelemetry declare `attributes` en lecture seule — c'est une intention
 * d'API, pas une immuabilite reelle —, d'ou les conversions ci-dessous, qui sont
 * assumees et commentees plutot que dissimulees.
 */
export class ProcesseurDeRedaction implements SpanProcessor, CompteurDeFuites {
  fuitesEvitees = 0;

  /**
   * Champ declare puis affecte, et NON une propriete de parametre.
   *
   * `constructor(private readonly suivant?: SpanProcessor)` compile sous `tsc`,
   * passe Vitest — qui utilise esbuild — et fait echouer le serveur A L'IMPORT :
   * Node retire les types sans les transformer, et une propriete de parametre
   * est une transformation. Voir `node-strip-only.test.ts`, qui lit les sources
   * pour empecher ce cas precis.
   */
  private readonly suivant: SpanProcessor | undefined;

  constructor(suivant?: SpanProcessor) {
    this.suivant = suivant;
  }

  onStart(): void {
    /* Rien : les attributs se posent apres le demarrage, on nettoie a la fin. */
  }

  onEnd(span: ReadableSpan): void {
    this.nettoyerAttributs(span.attributes as Attributes);

    /**
     * Les EVENEMENTS, et surtout les exceptions. `recordException` y recopie
     * `message` et `stack` : c'est le chemin par lequel un SMS part sans que
     * personne ait ecrit `setAttribute("sms", ...)`.
     */
    for (const evenement of span.events) {
      if (evenement.attributes) this.nettoyerAttributs(evenement.attributes, true);
      if (ressembleAUnSmsOperateur(evenement.name)) {
        (evenement as { name: string }).name = REDACTE;
        this.fuitesEvitees += 1;
      }
    }

    /**
     * Le message de statut. `span.setStatus({ message })` accepte n'importe
     * quelle chaine, et c'est souvent `e.message` qui y atterrit.
     */
    const statut = span.status as { message?: string };
    if (typeof statut.message === "string" && ressembleAUnSmsOperateur(statut.message)) {
      statut.message = REDACTE;
      this.fuitesEvitees += 1;
    }

    // Le NOM du span : il est choisi par nous, mais une instrumentation tierce
    // peut y mettre une URL, et une URL peut porter un parametre de requete.
    if (ressembleAUnSmsOperateur(span.name)) {
      (span as { name: string }).name = REDACTE;
      this.fuitesEvitees += 1;
    }

    this.suivant?.onEnd(span);
  }

  /**
   * Sur un span, la liste fermee s'applique ; sur un evenement, seule la
   * detection de contenu s'applique.
   *
   * La difference est deliberee : les attributs d'exception d'OpenTelemetry
   * (`exception.type`, `exception.message`, `exception.stacktrace`) sont
   * normalises et utiles au diagnostic. Les refuser en bloc rendrait les traces
   * inexploitables le jour d'un incident — c'est-a-dire le seul jour ou on les
   * regarde.
   */
  private nettoyerAttributs(attributs: Attributes, evenement = false): void {
    for (const cle of Object.keys(attributs)) {
      const valeur = attributs[cle];
      if (valeur === undefined) continue;
      const garde = evenement
        ? typeof valeur === "string" && ressembleAUnSmsOperateur(valeur)
          ? null
          : valeur
        : filtrerAttribut(cle, valeur);
      if (garde === null) {
        attributs[cle] = REDACTE;
        this.fuitesEvitees += 1;
      }
    }
  }

  async forceFlush(): Promise<void> {
    await this.suivant?.forceFlush();
  }

  async shutdown(): Promise<void> {
    await this.suivant?.shutdown();
  }
}
