import { type Attributes, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { ATTRIBUTS_AUTORISES, filtrerAttribut } from "./redaction.ts";

/**
 * Les traces des parcours critiques.
 *
 * **Ce module ne demarre rien.** Il expose un tracer et un seul helper ; le SDK
 * se branche dans `demarrage.ts`, qui n'est importe que par le serveur. C'est ce
 * qui permet aux tests et aux routes de s'instrumenter sans qu'un exportateur
 * OTLP tente de joindre un collecteur qui n'existe pas — quand aucun SDK n'est
 * enregistre, l'API d'OpenTelemetry rend un tracer sans effet, et le code
 * instrumente tourne exactement pareil.
 *
 * ── Les quatre parcours du lot 14, et celui qui n'existe pas ───────────────
 *
 * Le blueprint en demande quatre : creation de commande, ouverture de la rampe,
 * soumission de preuve, contre-signature. Trois sont instrumentes.
 *
 * **Il n'y a pas de route de creation de commande dans la v1.** Ce n'est pas un
 * oubli de ce lot : aucun lot ne l'a demandee, la boutique publique compose un
 * message WhatsApp et la commande naît ailleurs. `PARCOURS.commandeCreee` existe
 * donc, nomme et pret, mais aucun appelant ne le declenche — et c'est dit ici
 * plutot que laisse a constater dans un tableau de bord vide six mois plus tard
 * (AGENTS.md §7.7).
 */

export const NOM_SERVICE = "catalog-api";

/** Les noms de span, en un seul endroit. Un nom qui derive casse un tableau de bord. */
export const PARCOURS = {
  /** AUCUN APPELANT : la route de creation de commande n'existe pas en v1. */
  commandeCreee: "catalog.commande.creation",
  rampeOuverte: "catalog.rampe.ouverture",
  preuveSoumise: "catalog.preuve.soumission",
  contresignature: "catalog.preuve.contresignature",
  etapeAvancee: "catalog.commande.etape",
  paiementDeclare: "catalog.commande.paiement_declare",
} as const;

export const tracer = () => trace.getTracer(NOM_SERVICE);

/**
 * Attributs filtres AVANT d'atteindre le SDK.
 *
 * Le processeur de redaction les rattraperait de toute facon, mais il compte
 * alors une fuite evitee — et une fuite evitee doit vouloir dire « quelqu'un a
 * failli faire une betise », pas « le code normal fonctionne ». Filtrer ici
 * garde ce compteur utile.
 */
function attributsSurs(attributs: Attributes): Attributes {
  const sortie: Attributes = {};
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (valeur === undefined) continue;
    const garde = filtrerAttribut(cle, valeur);
    if (garde !== null) sortie[cle] = garde;
  }
  return sortie;
}

/**
 * Enveloppe un parcours critique dans un span.
 *
 * **L'erreur est enregistree, puis relancee.** Une trace qui avale l'exception
 * changerait le comportement du produit pour les besoins de l'observabilite,
 * ce qui est l'inverse du contrat : observer ne modifie pas.
 *
 * L'exception est enregistree par son TYPE et non par son message : c'est le
 * type qui sert au diagnostic, et c'est le message qui, lui, peut porter un
 * texte de SMS. Le processeur de redaction couvrirait le cas ; on ne lui donne
 * simplement pas l'occasion.
 */
export async function avecSpan<T>(
  nom: string,
  attributs: Attributes,
  travail: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(nom, { attributes: attributsSurs(attributs) }, async (span) => {
    try {
      return await travail(span);
    } catch (e) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: e instanceof Error ? e.constructor.name : "erreur",
      });
      span.recordException({ name: e instanceof Error ? e.name : "Error" });
      throw e;
    } finally {
      span.end();
    }
  });
}

/** Pose des attributs sur un span en cours, en passant par le meme filtre. */
export function poser(span: Span, attributs: Attributes): void {
  for (const [cle, valeur] of Object.entries(attributsSurs(attributs))) {
    if (valeur !== undefined) span.setAttribute(cle, valeur);
  }
}

/**
 * L'issue d'un parcours, en un mot, sur une liste fermee.
 *
 * Une chaine libre ici produirait une cardinalite non bornee dans les
 * tableaux de bord — et c'est ce qui rend un tableau de bord illisible bien
 * avant qu'il devienne cher.
 */
export type Issue =
  | "acceptee"
  | "acceptee_sous_reserve"
  | "refusee"
  | "identifiant_rejoue"
  | "non_reconnue"
  | "introuvable"
  | "refus_transition";

export function poserIssue(span: Span, issue: Issue): void {
  span.setAttribute("catalog.issue", issue);
}

/** Le garde du garde : toute cle posee ici doit etre sur la liste fermee. */
export const CLES_UTILISEES: readonly string[] = [
  "catalog.commande.id",
  "catalog.vendeuse.id",
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
  "catalog.issue",
];

if (process.env.NODE_ENV !== "production") {
  for (const cle of CLES_UTILISEES) {
    if (!ATTRIBUTS_AUTORISES.has(cle)) {
      throw new Error(`cle de trace hors liste fermee : ${cle}`);
    }
  }
}
