import { normalizePhone } from "@catalog/contracts/phone";
import { villeAcceptable } from "@catalog/contracts/villes";
import { lirePrix, NOM_MAX, NOM_MIN } from "./inscription.ts";
import type { MessageFlux } from "./messages.ts";
import type { Langue } from "./textes.ts";

/**
 * Le Flow de livraison — ADR 0055.
 *
 * ── ⚠️ CE QUI EST VERIFIE, ET CE QUI NE L'EST PAS ──────────────────────────
 *
 * L'API de notre cle 360dialog n'expose QUE deux points d'entree — les
 * gabarits et la configuration de reception. Mesure le 08/08/2026 : `/v1/configs/flows`,
 * `/v2/flows`, `/v1/flows` rendent tous 404. **Un Flow ne peut donc etre ni
 * cree ni teste depuis le depot.**
 *
 * Ce module est donc au meme regime que les raccourcis USSD (AGENTS.md §2) et
 * que l'adaptateur agregateur (§5) : le DOMAINE est ecrit et teste — la forme
 * du message, la lecture d'une reponse —, la jonction avec un Flow reel reste
 * a confirmer sur un telephone. Rien ne l'appelle tant que
 * `WABOT_FLUX_LIVRAISON_ID` est absent, et il l'est par defaut.
 *
 * ── Pourquoi le chemin question-par-question RESTE ────────────────────────
 *
 * Ce n'est pas une precaution transitoire. Un Flow exige un WhatsApp recent ;
 * sur un Android bas de gamme a Douala, il ne s'affiche pas. La saisie libre
 * est le seul chemin qui marche partout, et l'audit du 07/08/2026 le dit
 * explicitement. Le Flow est un RACCOURCI, jamais un remplacement.
 */

/**
 * Les noms de champs du Flow. Ils sont le CONTRAT avec la definition deposee
 * chez Meta (`docs/flux-livraison.md`) : les changer ici sans la redeployer
 * casse la lecture en silence.
 *
 * Aucun ne s'appelle « adresse » — il n'en existe pas au Cameroun (ADR 0005).
 */
export const CHAMPS_FLUX = {
  ville: "ville",
  quartier: "quartier",
  repere: "repere",
  telephone: "telephone",
  /**
   * La case « envoyer aussi ma position ». C'est une INTENTION, pas une
   * donnee de livraison : elle ne rejoint jamais l'objet enregistre, et un
   * test le tient.
   */
  position: "position",
} as const;

/** Ce que le Flow rend, une fois relu — la meme forme que la saisie libre. */
export interface LivraisonLue {
  mode: "livraison";
  city: string;
  quartier: string;
  landmark: string;
  phone: string;
}

/**
 * Lit la reponse d'un Flow. Rend `null` des qu'un champ obligatoire manque ou
 * qu'une valeur ne passe pas — **on ne fabrique jamais une livraison
 * partielle** : le repere et le telephone sont ce qui remplace l'adresse, et
 * une livraison sans eux n'est pas livrable.
 */
export function lireReponseFlux(brut: string): LivraisonLue | null {
  let donnees: unknown;
  try {
    donnees = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!donnees || typeof donnees !== "object" || Array.isArray(donnees)) return null;
  const d = donnees as Record<string, unknown>;

  const texte = (cle: string): string =>
    typeof d[cle] === "string" ? (d[cle] as string).trim() : "";

  const city = texte(CHAMPS_FLUX.ville);
  const quartier = texte(CHAMPS_FLUX.quartier);
  const landmark = texte(CHAMPS_FLUX.repere);
  const phone = normalizePhone(texte(CHAMPS_FLUX.telephone));

  /* Les memes bornes que `deliverySchema`, pour qu'un Flow ne puisse pas
     faire entrer ce que la saisie libre refuse. */
  if (!villeAcceptable(city)) return null;
  if (quartier.length < 2) return null;
  if (landmark.length < 5) return null;
  if (!phone) return null;

  return { mode: "livraison", city, quartier, landmark, phone };
}

/* ═══════════════════ TROIS formulaires, un seul fil ═══════════════════════
 *
 * Une reponse de Flow arrive TOUJOURS par le meme chemin (`nfm_reply`) : rien
 * dans le message ne dit quel formulaire a repondu. C'est le `flow_token`,
 * choisi par nous a l'envoi et renvoye tel quel par Meta, qui porte cette
 * information — et c'est pour cela qu'il ne porte jamais rien d'autre.
 *
 * ⚠️ L'echo du jeton dans `response_json` est le comportement DOCUMENTE de
 * Meta, pas une mesure faite ici : aucun Flow n'a encore ete depose sur notre
 * WABA. Le repli assume ci-dessous (« sans jeton = livraison ») rend l'erreur
 * benigne si le comportement differe : le seul Flow deploye avant eux est la
 * livraison.
 */

export type GenreFlux = "livraison" | "inscription" | "avis" | "article";

const GENRES: readonly GenreFlux[] = ["livraison", "inscription", "avis", "article"];

/**
 * Le jeton d'un envoi : le genre, puis une reference facultative.
 *
 * Il ne porte JAMAIS de secret (ADR 0021) — ni `buyerToken`, qui autorise la
 * contre-signature, ni le numero, que le fil porte deja. Ce qui part dans un
 * message que WhatsApp nous renverra doit pouvoir etre lu par n'importe qui.
 */
export function jetonFlux(genre: GenreFlux, reference = ""): string {
  return `${genre}:${reference}`;
}

/** Le genre d'un jeton relu, ou `null` s'il n'en designe aucun. */
export function genreDuJeton(brut: string): GenreFlux | null {
  const d = objetDe(brut);
  if (!d) return null;
  const jeton = typeof d.flow_token === "string" ? d.flow_token : "";
  /* Pas de jeton : c'est la livraison. Une reponse en vol au moment du
     deploiement, ou un Flow ancien encore publie, ne doit pas se perdre. */
  if (!jeton) return "livraison";
  const genre = jeton.split(":", 1)[0];
  return GENRES.find((g) => g === genre) ?? null;
}

function objetDe(brut: string): Record<string, unknown> | null {
  let donnees: unknown;
  try {
    donnees = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!donnees || typeof donnees !== "object" || Array.isArray(donnees)) return null;
  return donnees as Record<string, unknown>;
}

function champ(d: Record<string, unknown>, cle: string): string {
  return typeof d[cle] === "string" ? (d[cle] as string).trim() : "";
}

/** Ce que le formulaire d'inscription rend — la meme forme que les questions. */
export interface InscriptionLue {
  nomBoutique: string;
  ville: string;
  langue: Langue;
}

/**
 * Lit une inscription. Les MEMES bornes que la saisie libre : un formulaire ne
 * doit pas faire entrer ce que la question refuse.
 *
 * La langue est la seule tolerance — une valeur inconnue retombe sur le
 * francais plutot que de faire echouer une inscription entiere pour un champ
 * de confort.
 */
export function lireInscriptionFlux(brut: string): InscriptionLue | null {
  const d = objetDe(brut);
  if (!d) return null;
  const nomBoutique = champ(d, "boutique");
  const ville = champ(d, "ville");
  if (nomBoutique.length < 2) return null;
  if (!villeAcceptable(ville)) return null;
  const langueLue = champ(d, "langue");
  return { nomBoutique, ville, langue: langueLue === "en" ? "en" : "fr" };
}

/** Ce que le formulaire d'article rend — la meme forme que les questions. */
export interface ArticleLu {
  nom: string;
  prixXaf: number;
  /** Absent quand la vendeuse n'a rien mis : le stock est un champ de confort
      (ADR 0038), jamais une condition de publication. */
  stock?: number;
}

/** La borne du contrat produit (`productSchema.stock`) — pas une invention locale. */
const STOCK_MAX = 1_000_000;

/**
 * Lit un article. Les MEMES bornes que la saisie libre : le nom entre 2 et 80,
 * le prix par `lirePrix` — un formulaire ne fait pas entrer ce que la question
 * refuse (meme regle que l'inscription).
 *
 * ── Le stock est TOLERANT, le prix ne l'est pas ────────────────────────────
 *
 * Un prix illisible rend `null` : publier a un prix devine serait pire que
 * reposer la question. Un stock illisible, lui, devient ABSENT : c'est un
 * champ de confort (ADR 0038, il ne se decompte pas tout seul), et faire
 * echouer l'article entier pour lui serait la meme faute que faire echouer
 * une inscription pour la langue.
 *
 * ── PAS de photo ici, et c'est un point OUVERT ────────────────────────────
 *
 * `PhotoPicker` n'a jamais ete mesure sur notre WABA (meme methode que la
 * localisation : formulaire jetable, on lit ce que Meta refuse). Tant que la
 * mesure n'est pas faite, on ne suppose rien (AGENTS.md §7.7) : le formulaire
 * porte nom + prix + stock, la photo reste un envoi separe — et le chemin
 * photo legendee (« nom prix ») reste le geste le plus rapide du canal.
 */
export function lireArticleFlux(brut: string): ArticleLu | null {
  const d = objetDe(brut);
  if (!d) return null;
  const nom = champ(d, "nom");
  if (nom.length < NOM_MIN || nom.length > NOM_MAX) return null;
  const prixXaf = lirePrix(champ(d, "prix"));
  if (prixXaf === null) return null;
  const brutStock = champ(d, "stock");
  const stock =
    /^\d+$/.test(brutStock) && Number(brutStock) <= STOCK_MAX ? Number(brutStock) : undefined;
  /* 0 vaut ABSENT : c'est deja la convention de la base (`stock Int @default(0)`
     = « non annonce »), et « il en annonce zero » ne veut rien dire. */
  return { nom, prixXaf, ...(stock ? { stock } : {}) };
}

/** Ce que le formulaire d'avis rend. Le mot est facultatif — il l'est partout. */
export interface AvisLu {
  note: number;
  mot?: string;
}

/** La meme borne que la saisie libre du commentaire. */
const MOT_MAX = 1000;

/**
 * Lit un avis. La note est ENTIERE et bornee a 1..5, comme la machine le
 * verifie deja : une note fabriquee ne doit pas entrer par le formulaire.
 */
export function lireAvisFlux(brut: string): AvisLu | null {
  const d = objetDe(brut);
  if (!d) return null;
  const brutNote = champ(d, "note");
  if (!/^[1-5]$/.test(brutNote)) return null;
  const mot = champ(d, "mot").slice(0, MOT_MAX);
  return { note: Number(brutNote), ...(mot ? { mot } : {}) };
}

/**
 * La case « envoyer aussi ma position exacte » — sprint « le bot devient une
 * application ».
 *
 * ── Pourquoi une CASE et pas un champ de carte ────────────────────────────
 *
 * Mesure du 11/08/2026, sur un formulaire jetable depose puis supprime :
 * `LocationPicker`, `LocationRequest`, `MapPicker` et `Location` sont TOUS
 * refuses par Meta (« Invalid value found for property 'type' »), tandis que
 * le temoin `OptIn` passe. **Il n'existe pas de composant de localisation
 * dans les formulaires.** Le seul objet qui sait capter un point est le
 * message natif `location_request_message`, qui vit hors du formulaire.
 *
 * La case porte donc l'INTENTION ; la demande native, envoyee juste apres le
 * recapitulatif, fait la capture. Sans elle, une acheteuse qui remplit le
 * formulaire ne se verrait jamais proposer sa position — le formulaire saute
 * l'etape ou la demande partait.
 *
 * Tolerante a la forme : `true` booleen comme "true" en chaine. Absente vaut
 * NON — on ne demande jamais une position que personne n'a proposee.
 */
export function veutPositionFlux(brut: string): boolean {
  const d = objetDe(brut);
  if (!d) return false;
  const v = d[CHAMPS_FLUX.position];
  return v === true || v === "true";
}

/**
 * Le message qui ouvre le Flow. `flow_token` est jetable et propre a cet
 * envoi : le jeton acheteuse (`buyerToken`, ADR 0021) autorise la
 * contre-signature et ne voyage jamais dans un message que WhatsApp renverra.
 */
export function messageFlux(
  vers: string,
  fluxId: string,
  libelleBouton: string,
  jeton: string,
  corps = "Remplissez vos informations de livraison.",
): MessageFlux {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "interactive",
    interactive: {
      type: "flow",
      body: { text: corps },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: fluxId,
          flow_cta: libelleBouton,
          flow_action: "navigate",
          flow_token: jeton,
        },
      },
    },
  };
}
