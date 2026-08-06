import { formatXaf } from "@catalog/contracts/money";

/**
 * La composition de la carte-vitrine — ADR 0037. **Fonction pure** : des
 * donnees entrent, une chaine SVG sort. Pas de fichier, pas de bibliotheque,
 * pas d'horloge — elle se teste en lisant le SVG produit.
 *
 * Le gabarit est celui du Statut WhatsApp : 1080 x 1920. C'est la que se joue
 * l'acquisition de Catalog, et un lien `wa.me` nu n'y a aucun apercu.
 *
 * Les PHOTOS ne sont pas ici : l'adaptateur les compose par-dessus, aux
 * emplacements que ce module publie (`EMPLACEMENTS_PHOTOS`). Les encoder en
 * base64 dans le SVG gonflerait la chaine de centaines de kilo-octets.
 */

export const CARTE_LARGEUR = 1080;
export const CARTE_HAUTEUR = 1920;

/** Trois articles mis en avant : au-dela, la carte devient un catalogue. */
export const ARTICLES_MAX = 3;

/**
 * Ou l'adaptateur pose les photos, dans l'ordre des articles fournis.
 *
 * Les hauteurs laissent la place aux DEUX lignes de legende posees dessous —
 * la premiere carte rendue avait le nom du grand article masque par la
 * rangee suivante.
 */
export const EMPLACEMENTS_PHOTOS: ReadonlyArray<{
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}> = [
  { x: 90, y: 520, largeur: 900, hauteur: 420 },
  { x: 90, y: 1100, largeur: 435, hauteur: 300 },
  { x: 555, y: 1100, largeur: 435, hauteur: 300 },
];

export interface ArticleCarte {
  nom: string;
  prixXaf: number;
  /** Vrai quand une photo sera composee par-dessus l'emplacement. */
  avecPhoto: boolean;
}

export interface DonneesCarte {
  nomBoutique: string;
  ville: string;
  /** Le `wa.me` complet, pre-rempli — ce que le QR encode. */
  lien: string;
  /**
   * Ce qui est ECRIT sur la carte, et que quelqu'un peut retaper : le
   * `wa.me/<numero>` court, sans la partie encodee. Une URL avec `?text=` et
   * ses pourcents n'est saisissable par personne — le QR la porte, la carte
   * montre ce qui se tape.
   */
  lienAffiche: string;
  /** Le message a envoyer une fois la conversation ouverte : « boutique … ». */
  motCle: string;
  /** Le chemin SVG du QR, rendu par l'adaptateur. Absent : pas de QR. */
  qrChemin?: string;
  /** Cote du QR en unites de son propre systeme, pour la mise a l'echelle. */
  qrTaille?: number;
  reputation?: { note: number | null; nbVerifies: number };
  articles: ArticleCarte[];
}

/** Les couleurs de la carte — celles de la marque, pas d'un theme d'ecran. */
const VERT_FONCE = "#075e54";
const VERT = "#128c7e";
const CREME = "#f4f1ea";
const ENCRE = "#1f2428";

/** Aplats des emplacements sans photo : sobres, jamais criards. */
const APLATS = ["#0f766e", "#b45309", "#7c3aed"];

/**
 * Echappe le texte pour le XML. **Obligatoire** : un nom de boutique est saisi
 * par une vendeuse, et une esperluette suffirait a produire un SVG invalide,
 * donc une carte vide sans message d'erreur.
 */
function xml(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Coupe proprement : jamais plus de `max`, ellipse comprise. */
function couper(t: string, max: number): string {
  const net = t.trim();
  return net.length <= max ? net : `${net.slice(0, max - 1).trimEnd()}…`;
}

/** « 4.8 » → « 4,8 » : la carte est en francais. */
const noteFr = (n: number) => String(n).replace(".", ",");

export function composerCarte(d: DonneesCarte): string {
  const articles = d.articles.slice(0, ARTICLES_MAX);
  const rep = d.reputation;
  const lignesRep =
    rep && rep.nbVerifies > 0
      ? `★ ${rep.note != null ? `${noteFr(rep.note)} · ` : ""}${rep.nbVerifies} vente${rep.nbVerifies > 1 ? "s" : ""} prouvée${rep.nbVerifies > 1 ? "s" : ""}`
      : "Chaque paiement prouvé donne un reçu vérifiable";

  const cartouches = articles.map((a, i) => {
    const e = EMPLACEMENTS_PHOTOS[i];
    if (!e) return "";
    /* L'aplat est TOUJOURS dessine : il sert de fond a la photo que
       l'adaptateur composera par-dessus, et de secours si elle est illisible.
       L'initiale, elle, ne s'affiche que sans photo. */
    /* L'INITIALE, pas une ellipse : `couper(nom, 1)` rendait « … » — le
       premier rendu montrait trois points au lieu de la lettre. */
    const initiale = a.nom.trim().slice(0, 1).toUpperCase();
    const fond = `<rect x="${e.x}" y="${e.y}" width="${e.largeur}" height="${e.hauteur}" rx="18" fill="${APLATS[i % APLATS.length]}"/>${
      a.avecPhoto
        ? ""
        : `<text x="${e.x + e.largeur / 2}" y="${e.y + e.hauteur / 2 + 40}" font-size="120" font-weight="700" fill="#ffffff" text-anchor="middle" font-family="DejaVu Sans, sans-serif">${xml(initiale)}</text>`
    }`;
    /* Le bandeau de prix : pose SOUS l'emplacement, il ne masque jamais la
       photo que l'adaptateur composera. */
    const yTexte = e.y + e.hauteur + 58;
    const grand = i === 0;
    return `${fond}
      <text x="${e.x}" y="${yTexte}" font-size="${grand ? 40 : 30}" font-weight="700" fill="${ENCRE}" font-family="DejaVu Sans, sans-serif">${xml(couper(a.nom, grand ? 30 : 18))}</text>
      <text x="${e.x}" y="${yTexte + (grand ? 46 : 36)}" font-size="${grand ? 38 : 28}" fill="${VERT}" font-family="DejaVu Sans, sans-serif">${xml(formatXaf(a.prixXaf))}</text>`;
  });

  /* Le QR vient du generateur sous forme de chemin, dans son propre systeme
     d'unites : on le met a l'echelle plutot que de le supposer. */
  const qrCote = 210;
  const qr = d.qrChemin
    ? `<g transform="translate(90, 1640) scale(${(qrCote / (d.qrTaille ?? 25)).toFixed(4)})">
         <path d="${d.qrChemin}" fill="${ENCRE}"/>
       </g>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARTE_LARGEUR}" height="${CARTE_HAUTEUR}" viewBox="0 0 ${CARTE_LARGEUR} ${CARTE_HAUTEUR}">
  <rect width="${CARTE_LARGEUR}" height="${CARTE_HAUTEUR}" fill="${CREME}"/>
  <rect width="${CARTE_LARGEUR}" height="470" fill="${VERT_FONCE}"/>
  <text x="90" y="180" font-size="76" font-weight="700" fill="#ffffff" font-family="DejaVu Sans, sans-serif">${xml(couper(d.nomBoutique, 22))}</text>
  <text x="90" y="252" font-size="40" fill="#cfe6e1" font-family="DejaVu Sans, sans-serif">${xml(couper(d.ville, 30))}</text>
  <text x="90" y="360" font-size="34" fill="#ffffff" font-family="DejaVu Sans, sans-serif">${xml(lignesRep)}</text>
  <text x="90" y="416" font-size="30" fill="#9fd3c9" font-family="DejaVu Sans, sans-serif">Commandez sur WhatsApp — Catalog</text>
  ${cartouches.join("\n")}
  <rect x="0" y="1560" width="${CARTE_LARGEUR}" height="360" fill="${VERT_FONCE}"/>
  ${qr}
  <text x="350" y="1700" font-size="32" font-weight="700" fill="#ffffff" font-family="DejaVu Sans, sans-serif">Scannez, ou écrivez sur WhatsApp</text>
  <text x="350" y="1762" font-size="40" font-weight="700" fill="#ffffff" font-family="DejaVu Sans, sans-serif">${xml(couper(d.lienAffiche, 26))}</text>
  <text x="350" y="1814" font-size="30" fill="#9fd3c9" font-family="DejaVu Sans, sans-serif">puis : ${xml(couper(d.motCle, 28))}</text>
  <text x="350" y="1870" font-size="26" fill="#cfe6e1" font-family="DejaVu Sans, sans-serif">Reçu vérifiable à chaque paiement prouvé</text>
</svg>`;
}
