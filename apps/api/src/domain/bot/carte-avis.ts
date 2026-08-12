import { CARTE_HAUTEUR, CARTE_LARGEUR } from "./carte-vitrine.ts";

/**
 * La carte d'AVIS VERIFIE — ADR 0061, rang 3c. C'est la boucle qui se referme.
 *
 * ── Pourquoi cette carte-la vaut plus que les autres ──────────────────────
 *
 * N'importe quelle vendeuse peut poster « mes clientes sont contentes ». Aucune
 * ne peut le PROUVER. Celle-ci le peut : l'avis qu'elle affiche est adosse a un
 * paiement prouve par le SMS de son operateur, controle par les sept controles
 * du produit. C'est le seul objet du catalogue qu'une concurrente ne peut pas
 * fabriquer.
 *
 * ── La regle qui ne se negocie pas ────────────────────────────────────────
 *
 * **Jamais de carte pour un avis non verifie.** Un avis non verifie existe — le
 * depot direct non trace le produit (AGENTS.md §2) — et il est honnete. Mais en
 * faire une carte qui dit « verifie par paiement » serait exactement la
 * reputation achetable que le produit refuse. L'appelant ne decide pas : cette
 * fonction ne sait composer qu'un avis verifie, et le service ne l'appelle que
 * la.
 *
 * ── Le mot de l'acheteuse, et ce qu'on en fait ────────────────────────────
 *
 * Il est FACULTATIF partout dans le produit, donc ici aussi. Present, il est
 * coupe — une carte n'est pas un mur de texte, et un mot tronque reste plus
 * vrai qu'un mot invente. Absent, la carte tient debout sur ses etoiles : la
 * note est le fait, le mot est le confort.
 *
 * ── Ce module est PUR ─────────────────────────────────────────────────────
 *
 * Il rend du SVG. L'adaptateur le pixelise, l'encode et le range — meme chaine
 * que la carte-vitrine, meme calibrage (ADR 0059), et pour la meme raison : le
 * QR doit rester scannable.
 */

/** Les couleurs de la marque, pas d'un theme d'ecran — comme la carte-vitrine. */
const VERT_FONCE = "#075e54";
const CREME = "#f4f1ea";
const ENCRE = "#1f2428";
const OR = "#d97706";

/** Au-dela, le mot cesse d'etre lisible a la taille d'une vignette de Statut. */
const MOT_MAX = 140;

export interface DonneesCarteAvis {
  nomBoutique: string;
  /** Entier de 1 a 5. La carte ne dessine pas de demi-etoile (lot 12). */
  note: number;
  /** Le mot de l'acheteuse. Absent : la carte tient sur ses etoiles. */
  mot?: string | undefined;
  /** Combien d'avis VERIFIES la boutique porte, celui-ci compris. */
  nbVerifies: number;
  /** Ce qui s'ecrit et se retape : `wa.me/<numero>`. */
  lienAffiche: string;
  /** Le mot-cle a envoyer une fois la conversation ouverte. */
  motCle: string;
  qrChemin?: string | undefined;
  qrTaille?: number | undefined;
}

/** Echappe pour le XML : un nom de boutique est saisi par une vendeuse. */
function xml(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function couper(t: string, max: number): string {
  const net = t.trim().replace(/\s+/g, " ");
  return net.length <= max ? net : `${net.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Coupe le mot en lignes d'environ `parLigne` caracteres, sans casser un mot.
 *
 * Une mesure de texte exacte demanderait de charger la police ; on approxime
 * par le nombre de caracteres, ce qui suffit pour un bloc de trois lignes et
 * evite d'embarquer une metrique de fonte dans un module pur.
 *
 * ── L'ellipse se pose ICI, et c'est un defaut trouve par un test ─────────
 *
 * Le mot etait deja coupe en amont a 140 caracteres, ellipse comprise. Mais
 * trois lignes de 34 n'en portent qu'une centaine : l'ellipse tombait hors du
 * bloc et disparaissait avec le reste. Une acheteuse lisait alors une phrase
 * tronquee qui se donnait pour entiere — le mot de quelqu'un d'autre, ampute
 * sans le dire. C'est la seule troncature du produit dont personne n'aurait
 * rien su.
 */
function enLignes(t: string, parLigne: number, maxLignes: number): string[] {
  const lignes: string[] = [];
  let courante = "";
  let reste = false;
  for (const m of t.split(" ")) {
    if (!courante) courante = m;
    else if (`${courante} ${m}`.length <= parLigne) courante = `${courante} ${m}`;
    else if (lignes.length + 1 === maxLignes) {
      lignes.push(courante);
      courante = "";
      reste = true;
      break;
    } else {
      lignes.push(courante);
      courante = m;
    }
  }
  if (courante) lignes.push(courante);
  if (reste && lignes.length > 0) {
    const derniere = lignes[lignes.length - 1] ?? "";
    lignes[lignes.length - 1] = `${derniere.replace(/[…\s]+$/, "")}…`;
  }
  return lignes;
}

export function composerCarteAvis(d: DonneesCarteAvis): string {
  const note = Math.min(5, Math.max(1, Math.round(d.note)));
  const etoiles = "★".repeat(note) + "☆".repeat(5 - note);
  const mot = d.mot ? couper(d.mot, MOT_MAX) : "";
  const lignesMot = mot ? enLignes(mot, 34, 3) : [];

  const qr = d.qrChemin
    ? `<g transform="translate(${CARTE_LARGEUR - 300} ${CARTE_HAUTEUR - 300}) scale(${
        240 / (d.qrTaille ?? 25)
      })"><path d="${d.qrChemin}" fill="${ENCRE}"/></g>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARTE_LARGEUR}" height="${CARTE_HAUTEUR}" viewBox="0 0 ${CARTE_LARGEUR} ${CARTE_HAUTEUR}">
  <rect width="${CARTE_LARGEUR}" height="${CARTE_HAUTEUR}" fill="${CREME}"/>
  <rect width="${CARTE_LARGEUR}" height="470" fill="${VERT_FONCE}"/>
  <text x="80" y="200" font-family="system-ui,sans-serif" font-size="64" font-weight="800" fill="#ffffff">${xml(
    couper(d.nomBoutique, 22),
  )}</text>
  <text x="80" y="300" font-family="system-ui,sans-serif" font-size="40" fill="#cfe9e4">Avis vérifié par paiement</text>
  <text x="80" y="390" font-family="system-ui,sans-serif" font-size="36" fill="#cfe9e4">${
    d.nbVerifies
  } avis vérifié${d.nbVerifies > 1 ? "s" : ""} sur Catalog</text>

  <text x="80" y="700" font-family="system-ui,sans-serif" font-size="130" fill="${OR}">${etoiles}</text>
${lignesMot
  .map(
    (l, i) =>
      `  <text x="80" y="${880 + i * 80}" font-family="system-ui,sans-serif" font-size="58" fill="${ENCRE}">${xml(
        l,
      )}</text>`,
  )
  .join("\n")}

  <rect x="0" y="1560" width="${CARTE_LARGEUR}" height="360" fill="${VERT_FONCE}"/>
  <text x="80" y="1670" font-family="system-ui,sans-serif" font-size="42" fill="#ffffff">${xml(
    d.lienAffiche,
  )}</text>
  <text x="80" y="1750" font-family="system-ui,sans-serif" font-size="36" fill="#cfe9e4">Écrivez « ${xml(
    couper(d.motCle, 30),
  )} »</text>
  <text x="80" y="1850" font-family="system-ui,sans-serif" font-size="30" fill="#9fc9c2">Chaque avis vérifié est adossé à un paiement prouvé.</text>
${qr}
</svg>`;
}
