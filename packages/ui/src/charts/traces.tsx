import type { ReactNode } from "react";
import { cx } from "../cx.ts";
import {
  aire,
  type Cadre,
  graduations,
  hautDEchelle,
  indicesAEtiqueter,
  jourCourt,
  ligne,
  nombre,
  projeter,
} from "./echelle.ts";

/**
 * Les trois traces du produit. **Aucune bibliotheque de graphiques** : un
 * `<svg>` pour la courbe, des boites en CSS pour les barres.
 *
 * Regles de trace, communes aux trois et non negociables une par une :
 *
 * - **une seule teinte quand il n'y a qu'une serie**, donc pas de legende — le
 *   titre dit deja ce qui est trace, et une legende a une entree repete le
 *   titre en prenant de la place ;
 * - **une legende des qu'il y a deux classes**, parce que la couleur seule ne
 *   doit jamais porter l'information (WCAG 1.4.1) ;
 * - **grille en filet PLEIN**, jamais pointille : un pointille se lit comme un
 *   seuil ou une projection alors que ce n'est qu'un repere ;
 * - **etiquettes selectives** — le premier, le dernier, le maximum — et jamais
 *   une valeur sur chaque point ;
 * - **le texte ne porte jamais la couleur de la donnee** : les libelles restent
 *   en encre, et c'est la pastille a cote qui porte l'identite. Une teinte
 *   claire est illisible en texte sur la surface.
 */

/* ────────────────────────── courbe ────────────────────────── */

const CADRE: Cadre = {
  largeur: 320,
  hauteur: 128,
  margeGauche: 34,
  margeDroite: 10,
  margeHaut: 12,
  margeBas: 22,
};

export interface CourbeProps {
  points: ReadonlyArray<{ jour: string; valeur: number }>;
}

/**
 * Une serie dans le temps, comblee a zero par le domaine avant d'arriver ici.
 *
 * **Ce composant ne comble rien lui-meme.** Une courbe qui saute les jours creux
 * relie le lundi au jeudi par une droite et raconte une frequentation qui n'a pas
 * eu lieu ; c'est `serieContinue` qui garantit la continuite, cote domaine, ou
 * elle est testee. Ici on trace ce qu'on recoit.
 *
 * Le composant ne connait pas l'unite de ce qu'il trace, et n'en a pas besoin :
 * le titre, le resume et la vue tableau sont portes par `Graphique`, qui
 * l'entoure. Un trace qui nommerait lui-meme son unite la nommerait une seconde
 * fois, et les deux finiraient par ne plus dire la meme chose.
 */
export function Courbe({ points }: CourbeProps) {
  const valeurs = points.map((p) => p.valeur);
  const haut = hautDEchelle(Math.max(0, ...valeurs));
  const paliers = graduations(haut);
  const projetes = projeter(valeurs, haut, CADRE);
  const base = CADRE.hauteur - CADRE.margeBas;
  const aEtiqueter = new Set(indicesAEtiqueter(valeurs));
  const dernier = projetes[projetes.length - 1];

  if (projetes.length === 0) {
    return (
      <p className="py-6 text-center text-caption text-ink-2">
        Aucun jour dans la période demandée.
      </p>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${CADRE.largeur} ${CADRE.hauteur}`}
      className="h-auto w-full"
      aria-hidden="true"
      focusable="false"
    >
      {/* Grille : filet plein, une nuance au-dessus de la surface. */}
      {paliers.map((v) => {
        const y =
          CADRE.margeHaut + (CADRE.hauteur - CADRE.margeHaut - CADRE.margeBas) * (1 - v / haut);
        return (
          <g key={v}>
            <line
              x1={CADRE.margeGauche}
              x2={CADRE.largeur - CADRE.margeDroite}
              y1={y}
              y2={y}
              stroke="var(--color-grille)"
              strokeWidth="1"
            />
            <text
              x={CADRE.margeGauche - 6}
              y={y + 3.5}
              textAnchor="end"
              fontSize="10"
              fill="var(--color-muted)"
            >
              {nombre(v)}
            </text>
          </g>
        );
      })}

      {/* Le lavis : la teinte de la serie a 10 %. Jamais un aplat sature — il
          pesserait plus a l'oeil que la courbe, qui porte la donnee. */}
      <polygon points={aire(projetes, base)} fill="var(--color-serie)" fillOpacity="0.1" />

      <polyline
        points={ligne(projetes)}
        fill="none"
        stroke="var(--color-serie)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Le point final, cercle a anneau de surface pour rester lisible la ou il
          croise la courbe ou le bord du cadre. */}
      {dernier ? (
        <circle
          cx={dernier.x}
          cy={dernier.y}
          r="4"
          fill="var(--color-serie)"
          stroke="var(--color-surface)"
          strokeWidth="2"
        />
      ) : null}

      {/* Etiquettes de date, aux seuls indices retenus. */}
      {projetes.map((p, i) =>
        aEtiqueter.has(i) ? (
          <text
            key={points[i]?.jour ?? i}
            x={Math.min(
              Math.max(p.x, CADRE.margeGauche + 8),
              CADRE.largeur - CADRE.margeDroite - 8,
            )}
            y={CADRE.hauteur - 6}
            textAnchor="middle"
            fontSize="10"
            fill="var(--color-muted)"
          >
            {jourCourt(points[i]?.jour ?? "")}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/* ────────────────────────── barres horizontales ────────────────────────── */

export interface BarreItem {
  cle: string;
  libelle: string;
  valeur: number;
  /** Ce qui s'affiche a droite de la valeur — un taux de passage, par exemple. */
  apres?: ReactNode;
  /** Met cette barre en avant : c'est elle qui porte l'histoire. */
  emphase?: boolean;
}

export interface BarresProps {
  items: readonly BarreItem[];
  /**
   * Une couleur par barre, dans l'ordre — la rampe ORDINALE de l'entonnoir.
   * Absente, toutes les barres prennent la teinte de serie unique : des
   * categories nominales (des articles) n'ont pas d'ordre, et les colorer par
   * leur valeur depenserait le canal d'identite a redire ce que la longueur dit
   * deja.
   */
  couleurs?: readonly string[];
  /** Unite, pour l'etiquette de valeur. */
  unite?: string;
}

/**
 * Barres horizontales, en CSS. Elles servent l'entonnoir et le classement des
 * articles.
 *
 * L'horizontale plutot que la verticale parce que les libelles sont longs —
 * « Commandes payées », un nom d'article — et qu'un libelle incline sous un axe
 * vertical est illisible sur un telephone.
 *
 * La longueur est rapportee au MAXIMUM de la serie et non au sommet de
 * l'entonnoir : c'est ce qui laisse voir la difference entre deux petites
 * valeurs, la ou une echelle sur le sommet les ecraserait toutes les deux a un
 * trait.
 */
export function Barres({ items, couleurs, unite }: BarresProps) {
  const max = Math.max(1, ...items.map((i) => i.valeur));

  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {items.map((item, i) => (
        <li key={item.cle} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span
              className={cx("text-caption", item.emphase ? "font-semibold text-ink" : "text-ink-2")}
            >
              {item.libelle}
            </span>
            <span className="text-caption tabular-nums text-ink">
              <strong className="font-semibold">{nombre(item.valeur)}</strong>
              {unite ? <span className="text-ink-2"> {unite}</span> : null}
              {item.apres ? <span className="text-ink-2"> · {item.apres}</span> : null}
            </span>
          </div>
          {/* La piste situe le maximum ; la barre est carree au depart et
              arrondie a son EXTREMITE DE DONNEE — l'arrondi marque ou la valeur
              s'arrete, il ne decore pas la ligne de base. */}
          <div aria-hidden="true" className="h-[10px] w-full bg-[var(--color-grille)]">
            {/*
              `minWidth` de 3 px sur une valeur NON NULLE.

              Un entonnoir descend souvent d'un facteur dix — 214 vues pour 18
              commandes — et la barre des dernieres marches tombe alors sous le
              pixel : elle disparait, et « 8 » se lit comme « 0 ». Ce n'est pas
              une distorsion d'echelle mais un plancher de RENDU, et il ne
              s'applique qu'a ce qui existe : zero reste zero, sans barre.
            */}
            <div
              className="h-full rounded-e-[4px]"
              style={{
                width: `${(item.valeur / max) * 100}%`,
                ...(item.valeur > 0 ? { minWidth: "3px" } : {}),
                background: couleurs?.[i] ?? "var(--color-serie)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────────── barre empilee ────────────────────────── */

export interface SegmentProps {
  cle: string;
  libelle: string;
  valeur: number;
  couleur: string;
  /** Part en pourcentage, deja arrondie par `empiler`. */
  pourcent: number;
  /** Position de depart, en pourcentage. */
  debut: number;
}

/**
 * Part-a-tout, trois classes au plus.
 *
 * Les segments sont separes par un **vide de 2 px en couleur de surface** et non
 * par un trait : un contour ajoute de l'encre qui n'est pas de la donnee, et
 * deux segments voisins se lisent tres bien grace au vide.
 *
 * La legende est obligatoire ici — il y a plus d'une classe — et elle porte la
 * valeur en clair. Personne ne doit avoir a estimer une longueur pour lire un
 * chiffre.
 */
export function BarreEmpilee({ segments }: { segments: readonly SegmentProps[] }) {
  const total = segments.reduce((s, x) => s + x.valeur, 0);

  if (total === 0) {
    return <div className="h-5 w-full rounded-pill bg-[var(--color-grille)]" aria-hidden="true" />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-pill">
        {segments
          .filter((s) => s.valeur > 0)
          .map((s) => (
            <div
              key={s.cle}
              className="h-full first:rounded-l-pill last:rounded-r-pill"
              style={{ width: `${s.pourcent}%`, background: s.couleur }}
            />
          ))}
      </div>

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {segments.map((s) => (
          <li key={s.cle} className="flex items-center gap-2 text-caption">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-[3px]"
              style={{ background: s.couleur }}
            />
            <span className="text-ink-2">{s.libelle}</span>
            <span className="ms-auto tabular-nums text-ink">
              <strong className="font-semibold">{nombre(s.valeur)}</strong>
              <span className="text-ink-2"> · {s.pourcent}&nbsp;%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
