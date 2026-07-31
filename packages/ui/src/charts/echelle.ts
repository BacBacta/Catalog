/**
 * La geometrie des graphiques. **Aucun DOM, aucun React, aucune couleur** :
 * des nombres qui entrent, des nombres qui sortent.
 *
 * C'est ce qui rend les graphiques testables. Un `<svg>` ne se verifie qu'a
 * l'oeil ou par capture ; une echelle, une graduation et un choix d'etiquettes
 * se verifient sur des valeurs choisies — y compris les valeurs qui cassent :
 * la serie plate, la serie vide, le maximum a zero.
 *
 * **Il n'y a pas de bibliotheque de graphiques dans ce depot** et il n'y en aura
 * pas : la plus legere pese plus que le budget entier de la boutique publique.
 * Ce fichier est ce qu'on ecrit a la place, et il tient en deux cents lignes
 * parce qu'on ne trace que quatre formes.
 */

/* ────────────────────────── echelle verticale ────────────────────────── */

/**
 * Le HAUT de l'echelle, arrondi a une valeur ronde au-dessus du maximum.
 *
 * Une echelle qui s'arrete pile sur le maximum colle la pointe de la courbe au
 * bord du cadre, et la graduation du haut tombe sur un nombre comme 137 que
 * personne ne lit. On monte donc au 1-2-5 suivant (10, 20, 50, 100, 200…).
 *
 * Le cas `max = 0` renvoie 1 et non 0 : une echelle de hauteur nulle ferait une
 * division par zero, et le graphique d'une vendeuse qui n'a encore aucune vue
 * doit s'afficher — plat, sur une ligne de base, ce qui est la verite.
 */
export function hautDEchelle(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const pas of [1, 2, 5, 10]) {
    const candidat = pas * magnitude;
    if (candidat >= max) return candidat;
  }
  return 10 * magnitude;
}

/**
 * Les graduations de l'axe vertical, de zero au haut d'echelle inclus.
 *
 * Trois valeurs par defaut — zero, milieu, haut. Au-dela, les etiquettes se
 * chevauchent sur un telephone de 393 px de large, et une graduation illisible
 * ne graduee rien.
 *
 * **Une echelle basse en rend MOINS que demande, jamais deux fois la meme.**
 * Sur une vendeuse qui recoit au plus une commande par jour, le haut d'echelle
 * vaut 1 : trois graduations donneraient `[0, 1, 1]`, c'est-a-dire deux traits
 * etiquetes « 1 » dont un a MI-HAUTEUR. Un repere faux est pire qu'un repere
 * manquant — on lit la courbe dessus.
 */
export function graduations(haut: number, nombre = 3): number[] {
  if (nombre < 2) throw new Error(`il faut au moins deux graduations, recu ${nombre}`);
  const pas = haut / (nombre - 1);
  const valeurs = Array.from({ length: nombre }, (_, i) => Math.round(i * pas));
  return [...new Set(valeurs)];
}

/* ────────────────────────── courbe ────────────────────────── */

export interface Cadre {
  largeur: number;
  hauteur: number;
  /** Marges INTERIEURES, en unites du systeme de coordonnees du SVG. */
  margeGauche: number;
  margeDroite: number;
  margeHaut: number;
  margeBas: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Projette une serie de valeurs sur le cadre.
 *
 * Un seul point est centre horizontalement plutot que colle a gauche : une
 * journee unique n'est pas « le debut d'une tendance », et l'afficher au bord
 * suggererait une suite qui n'existe pas.
 */
export function projeter(valeurs: readonly number[], haut: number, cadre: Cadre): Point[] {
  const { largeur, hauteur, margeGauche, margeDroite, margeHaut, margeBas } = cadre;
  const utileX = largeur - margeGauche - margeDroite;
  const utileY = hauteur - margeHaut - margeBas;
  const n = valeurs.length;
  if (n === 0) return [];
  if (haut <= 0) throw new Error(`haut d'echelle invalide : ${haut}`);

  return valeurs.map((v, i) => ({
    x: n === 1 ? margeGauche + utileX / 2 : margeGauche + (utileX * i) / (n - 1),
    y: margeHaut + utileY * (1 - Math.min(v, haut) / haut),
  }));
}

/** Attribut `points` d'un `<polyline>`. Deux decimales : le reste est du poids. */
export function ligne(points: readonly Point[]): string {
  return points.map((p) => `${arrondi(p.x)},${arrondi(p.y)}`).join(" ");
}

/**
 * Le meme trace, referme sur la ligne de base — le lavis sous la courbe.
 *
 * Il est a 10 % d'opacite dans les composants : un aplat sature sous une courbe
 * pese plus lourd a l'oeil que la courbe elle-meme, alors que c'est la courbe
 * qui porte la donnee.
 */
export function aire(points: readonly Point[], base: number): string {
  if (points.length === 0) return "";
  const premier = points[0] as Point;
  const dernier = points[points.length - 1] as Point;
  return `${ligne(points)} ${arrondi(dernier.x)},${arrondi(base)} ${arrondi(premier.x)},${arrondi(base)}`;
}

function arrondi(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ────────────────────────── etiquettes selectives ────────────────────────── */

/**
 * Les indices a etiqueter directement — JAMAIS tous.
 *
 * Un nombre pose sur chaque point est un chaos que personne ne lit ; l'axe, la
 * legende et la vue tableau portent le reste. On garde ce qui raconte quelque
 * chose : le premier, le dernier, et le maximum.
 *
 * Le maximum est ecarte s'il tombe a moins de `ecart` positions d'une extremite,
 * parce que les deux etiquettes se chevaucheraient — et deux etiquettes qui se
 * marchent dessus valent moins qu'une seule.
 */
export function indicesAEtiqueter(valeurs: readonly number[], ecart = 3): number[] {
  const n = valeurs.length;
  if (n === 0) return [];
  if (n <= 2) return valeurs.map((_, i) => i);

  const garde = new Set<number>([0, n - 1]);
  let iMax = 0;
  for (let i = 1; i < n; i++) {
    if ((valeurs[i] as number) > (valeurs[iMax] as number)) iMax = i;
  }
  if (iMax >= ecart && iMax <= n - 1 - ecart && (valeurs[iMax] as number) > 0) garde.add(iMax);

  return [...garde].sort((a, b) => a - b);
}

/* ────────────────────────── barre empilee ────────────────────────── */

export interface SegmentEmpile {
  cle: string;
  valeur: number;
  /** Debut du segment, en pourcentage de la largeur. */
  debut: number;
  /** Largeur du segment, en pourcentage. Jamais negative. */
  largeur: number;
}

/**
 * Repartit des valeurs sur cent pour cent, sans perdre de reste a l'arrondi.
 *
 * Les largeurs sont calculees en cumule puis differenciees : arrondir chaque
 * part separement laisse une barre a 99,7 % ou a 100,4 %, c'est-a-dire un trou
 * ou un debordement visible d'un pixel sur un ecran de telephone. La meme
 * discipline que `splitDeposit` sur les montants, pour la meme raison — le
 * total doit etre exact, pas approximativement exact.
 *
 * Un total nul renvoie des segments de largeur nulle plutot que de diviser par
 * zero. C'est a l'appelant de decider ce qu'il affiche dans ce cas ; le
 * composant montre un etat vide.
 */
export function empiler(parts: ReadonlyArray<{ cle: string; valeur: number }>): SegmentEmpile[] {
  const total = parts.reduce((s, p) => s + p.valeur, 0);
  let cumul = 0;
  let precedent = 0;

  return parts.map((p) => {
    cumul += p.valeur;
    const fin = total > 0 ? Math.round((cumul * 1000) / total) / 10 : 0;
    const segment = {
      cle: p.cle,
      valeur: p.valeur,
      debut: precedent,
      largeur: Math.max(0, fin - precedent),
    };
    precedent = fin;
    return segment;
  });
}

/* ────────────────────────── formats ────────────────────────── */

/**
 * Nombre lisible en français : espace insecable etroit comme separateur de
 * milliers, tel que l'attend une lectrice francophone.
 *
 * `Intl` est utilise plutot qu'une regex maison : il est dans le navigateur, il
 * ne coute rien au paquet, et il connait la convention.
 */
const FORMAT = new Intl.NumberFormat("fr-FR");
export function nombre(n: number): string {
  return FORMAT.format(n);
}

/** Un jour `AAAA-MM-JJ` en `JJ/MM`, pour un axe qui n'a pas la place du reste. */
export function jourCourt(jour: string): string {
  const [, mois, jourDuMois] = jour.split("-");
  return `${jourDuMois}/${mois}`;
}
