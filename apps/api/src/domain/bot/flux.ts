import { normalizePhone } from "@catalog/contracts/phone";
import { villeAcceptable } from "@catalog/contracts/villes";
import { lirePrix, NOM_MAX, NOM_MIN } from "./inscription.ts";
import type { PhotoCdnChiffree } from "./media.ts";
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

export type GenreFlux =
  | "livraison"
  | "inscription"
  | "ouverture"
  | "avis"
  | "article"
  | "reversement";

const GENRES: readonly GenreFlux[] = [
  "livraison",
  "inscription",
  "ouverture",
  "avis",
  "article",
  "reversement",
];

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
 * L'OUVERTURE en deux ecrans — ADR 0087. La boutique, et le premier article
 * s'il a ete rempli. Meta rend les deux ecrans dans UNE reponse (`navigate`
 * puis `complete`), donc une seule lecture suffit.
 */
export interface OuvertureLue {
  boutique: InscriptionLue;
  /** Absent quand le second ecran a ete laisse vide — il est FACULTATIF. */
  article?: ArticleLu;
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

/**
 * L'ouverture : la boutique, et l'article s'il tient debout.
 *
 * **La boutique commande.** Si elle ne se lit pas, rien ne se lit : on ne
 * fabrique pas un article sans boutique ou le ranger. L'article, lui, est
 * FACULTATIF au sens strict — un second ecran laisse vide ouvre quand meme
 * la boutique, et c'est le cas d'une vendeuse qui n'a pas sa photo sous la
 * main. Un article a moitie rempli (un nom sans prix) vaut ABSENT : la
 * meme tolerance que partout, et elle se dit dans le message qui suit.
 */
export function lireOuvertureFlux(brut: string): OuvertureLue | null {
  const boutique = lireInscriptionFlux(brut);
  if (!boutique) return null;
  const article = lireArticleFlux(brut);
  return { boutique, ...(article ? { article } : {}) };
}

/** Ce que le formulaire d'article rend — la meme forme que les questions. */
export interface ArticleLu {
  nom: string;
  prixXaf: number;
  /** Absent quand la vendeuse n'a rien mis : le stock est un champ de confort
      (ADR 0038), jamais une condition de publication. */
  stock?: number;
  /** L'identifiant WhatsApp de la photo du formulaire — le MEME identifiant
      que celui d'une photo envoyee dans le fil : il rejoint le pipeline image
      par le chemin deja en place (`creerArticleDepuisFil`). Absent quand la
      vendeuse n'a rien joint, ou que la forme recue n'est pas celle attendue. */
  mediaId?: string;
  /** La forme CDN chiffree (tache #72) — l'autre maniere documentee de livrer la photo. */
  photoCdn?: PhotoCdnChiffree;
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
 * ── La photo est MESUREE, facultative, et TOLERANTE ───────────────────────
 *
 * `PhotoPicker` a ete mesure sur notre WABA le 12/08/2026 — meme methode que
 * la localisation : formulaire jetable (brouillon 1713578936575692), verdict
 * lu dans `validation_errors`, brouillon supprime. ACCEPTE sans point de
 * terminaison, dans une action `complete`, en Flow JSON 7.0.
 *
 * La valeur recue est un TABLEAU d'objets media ; la doc Meta y annonce
 * l'identifiant (`id`), le nom de fichier et l'empreinte. Seul l'identifiant
 * nous sert : c'est le meme genre d'identifiant qu'une photo du fil, et il
 * emprunte le meme pipeline. La lecture est TOLERANTE comme le stock : une
 * forme inattendue rend une photo ABSENTE, jamais un echec — l'article se
 * publie sans photo et la vendeuse peut l'envoyer dans le fil, c'est-a-dire
 * exactement le comportement d'avant ce champ. Aucune regression possible.
 */
const MEDIA_ID_FORME = /^[\w.-]{1,128}$/;
/* Du base64 plausible, bornes larges : le DECODAGE et les verifications
   cryptographiques appartiennent a l'adaptateur — ici on ecarte seulement ce
   qui n'a aucune chance d'en etre. */
const B64_FORME = /^[A-Za-z0-9+/_-]{16,128}={0,2}$/;

function photoCdnDe(brut: Record<string, unknown>): PhotoCdnChiffree | undefined {
  const url = brut.cdn_url;
  const meta = brut.encryption_metadata;
  if (typeof url !== "string" || !url.startsWith("https://")) return undefined;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const m = meta as Record<string, unknown>;
  const champs = {
    encryptionKey: m.encryption_key,
    hmacKey: m.hmac_key,
    iv: m.iv,
    plaintextHash: m.plaintext_hash,
    encryptedHash: m.encrypted_hash,
  };
  for (const v of Object.values(champs)) {
    if (typeof v !== "string" || !B64_FORME.test(v)) return undefined;
  }
  return { url, ...(champs as Record<keyof typeof champs, string>) };
}

/**
 * Les DEUX formes documentees du media d'un Flow sans endpoint — tache #72 :
 * un `media_id` classique, ou `cdn_url` + `encryption_metadata` (fichier
 * chiffre sur le CDN, cles dans la reponse). Le banc du 12/08/2026 publiait
 * des articles sans photo : la seconde forme arrivait, personne ne la lisait.
 * Toujours TOLERANT : une forme inattendue est une photo absente, jamais un
 * formulaire refuse.
 */
function photoDe(
  valeur: unknown,
  reponseBrute: string,
): { mediaId: string } | { photoCdn: PhotoCdnChiffree } | undefined {
  if (!Array.isArray(valeur) || valeur.length === 0) return undefined;
  const premier = valeur[0];
  if (!premier || typeof premier !== "object" || Array.isArray(premier)) return undefined;
  const brut = premier as Record<string, unknown>;
  const id = brut.id ?? brut.media_id;
  if (typeof id === "string" && MEDIA_ID_FORME.test(id)) return { mediaId: id };
  /**
   * L'identifiant NUMERIQUE — la TROISIEME forme, mesuree le 15/08/2026 au
   * soir en preproduction (ADR 0104). Le squelette releve :
   * `tableau[1]:{ id: nombre, mime_type: chaine(10), sha256: chaine(44),
   * file_name: chaine(40) }`. Ni chaine, ni CDN chiffre : ce client livre
   * l'identifiant en nombre JSON, et l'exigence `typeof id === "string"`
   * declarait la photo absente — la vendeuse lisait « Sans photo pour
   * l'instant » sur un formulaire qu'elle venait de remplir avec sa photo.
   *
   * Le piege qui interdit la conversion naive : `JSON.parse` perd la
   * precision au-dela de 2^53, et un identifiant Meta peut depasser seize
   * chiffres — 27695141573488361 devient …360, un identifiant FAUX qui
   * produirait un 404 en ressemblant a un vrai. Au-dela de la zone sure,
   * l'identifiant exact se RELIT dans le texte brut de la reponse, ou les
   * chiffres sont intacts. Si cette relecture echoue, la photo vaut
   * ABSENTE : on ne fabrique jamais un identifiant approximatif.
   */
  if (typeof id === "number" && Number.isInteger(id) && id > 0) {
    if (Number.isSafeInteger(id)) return { mediaId: String(id) };
    const exact = idNumeriqueDuBrut(reponseBrute);
    return exact ? { mediaId: exact } : undefined;
  }
  const cdn = photoCdnDe(brut);
  return cdn ? { photoCdn: cdn } : undefined;
}

/**
 * Le premier `"id": <chiffres>` du texte brut. Dans les reponses d'article
 * et d'ouverture, le SEUL champ numerique nomme `id` (ou `media_id`) est
 * celui de la photo : `flow_token` et les champs de saisie sont des chaines.
 * Cette hypothese est structurelle au contrat de champs, tenu par le test
 * miroir de `flux-spec.test.ts` — un formulaire qui gagnerait un autre `id`
 * numerique devrait repasser ici.
 */
function idNumeriqueDuBrut(reponseBrute: string): string | null {
  const m = reponseBrute.match(/"(?:id|media_id)"\s*:\s*(\d{1,64})/);
  return m?.[1] ?? null;
}

/**
 * Le SQUELETTE du champ `photo` d'une reponse de formulaire — ADR 0104.
 *
 * Le 15/08/2026 au soir, un formulaire d'article rempli AVEC photo a produit
 * « Sans photo pour l'instant » : `photoDe` n'a pas reconnu la forme livree
 * par ce telephone. C'est le scenario de l'ADR 0079 — une forme que la
 * documentation ne decrit pas — et on ne la devine pas (AGENTS.md §7.7) :
 * on la MESURE, puis on ecrit la tolerance contre la forme reelle.
 *
 * Cette description rend types, cles et longueurs, et JAMAIS une valeur :
 * ni identifiant de media, ni URL de CDN (elle porte les cles de
 * dechiffrement), ni octets. C'est ce qui l'autorise a atterrir dans un
 * journal (meme regime que les traces, ADR 0023). Profondeur bornee : un
 * squelette n'a pas besoin d'etre exhaustif pour dire la forme.
 */
export function formePhotoFlux(brut: string): string | null {
  const d = objetDe(brut);
  if (!d || !("photo" in d)) return null;
  return decrire(d.photo, 0);
}

const PROFONDEUR_MAX = 3;

function decrire(v: unknown, profondeur: number): string {
  if (v === null) return "null";
  if (typeof v === "string") return `chaine(${v.length})`;
  if (typeof v === "number") return "nombre";
  if (typeof v === "boolean") return "booleen";
  if (Array.isArray(v)) {
    if (v.length === 0) return "tableau[0]";
    if (profondeur >= PROFONDEUR_MAX) return `tableau[${v.length}]`;
    return `tableau[${v.length}]:${decrire(v[0], profondeur + 1)}`;
  }
  if (typeof v === "object") {
    if (profondeur >= PROFONDEUR_MAX) return "objet";
    const champs = Object.entries(v as Record<string, unknown>)
      .slice(0, 8)
      .map(([k, val]) => `${k}: ${decrire(val, profondeur + 1)}`);
    return `{ ${champs.join(", ")} }`;
  }
  return typeof v;
}

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
  const photo = photoDe(d.photo, brut);
  /* 0 vaut ABSENT : c'est deja la convention de la base (`stock Int @default(0)`
     = « non annonce »), et « il en annonce zero » ne veut rien dire. */
  return { nom, prixXaf, ...(stock ? { stock } : {}), ...(photo ?? {}) };
}

/**
 * Le formulaire de REVERSEMENT — ADR 0097. UN SEUL ecran, et c'est
 * structurel : un Flow statique n'a aucun aller-retour serveur, donc le code
 * OTP n'existe pas encore quand l'ecran s'affiche. Il n'y a pas d'ecran
 * « saisissez le code » — le code part par SMS et se COLLE dans le fil.
 *
 * Les noms sont le CONTRAT avec `docs/flux-reversement.json`, tenu par le
 * test de spec — meme regime que le Flow de livraison (ADR 0055).
 */
export const CHAMPS_FLUX_REVERSEMENT = {
  numero: "numero",
  operateur: "operateur",
} as const;

/** Ce que le formulaire de reversement rend, une fois relu. */
export interface ReversementLu {
  /**
   * Le numero TEL QUE SAISI, seulement debrousaille. La normalisation
   * (`+237`, et les numeros nommes du banc — ADR 0058) appartient au
   * service : elle n'est pas pure au sens du banc, et c'est LUI qui refuse
   * avec le meme message que la route.
   */
  numeroBrut: string;
  /**
   * L'operateur DECLARE. Il ne s'enregistre jamais : l'opérateur retenu est
   * derive du prefixe par le service existant (`operateurDuNumero`). La
   * declaration sert de filet a faute de frappe — ADR 0097, decision 4.
   */
  operateur: "mtn" | "orange";
}

/**
 * Lit la reponse du formulaire de reversement. `null` des qu'un des deux
 * champs manque ou ne se lit pas : c'est le champ qu'un attaquant vise, on ne
 * fabrique rien a moitie. La validite du NUMERO, elle, se tranche au service
 * — meme phrase de refus que la route.
 */
export function lireReversementFlux(brut: string): ReversementLu | null {
  const d = objetDe(brut);
  if (!d) return null;
  const numeroBrut = champ(d, CHAMPS_FLUX_REVERSEMENT.numero);
  const operateur = champ(d, CHAMPS_FLUX_REVERSEMENT.operateur);
  /* Bornes LARGES : au moins huit chiffres pour ressembler a un numero, pas
     plus de 25 caracteres pour ecarter le collage accidentel d'un texte. */
  const chiffres = numeroBrut.replace(/\D/g, "");
  if (chiffres.length < 8 || numeroBrut.length > 25) return null;
  if (operateur !== "mtn" && operateur !== "orange") return null;
  return { numeroBrut, operateur };
}

/**
 * La carte d'invitation — copie de la maquette (`parcours-premium.html`).
 * Elle accompagne une reponse a un geste de la vendeuse ; elle n'est jamais
 * une bulle poussee seule (ADR 0086), et ne part que si le numero n'est pas
 * encore pose (ADR 0097, decision 5).
 */
export function invitationReversement(vers: string, fluxId: string): MessageFlux {
  return messageFlux(
    vers,
    fluxId,
    "💳 Être payée d'avance",
    jetonFlux("reversement"),
    "💡 Un dernier réglage et vos clientes paient *d'avance* : posez le numéro où l'argent arrive. Une fois, vérifié par code — c'est le champ qu'un fraudeur viserait, alors on le protège.",
  );
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
