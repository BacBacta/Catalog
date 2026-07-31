import type { ReactNode } from "react";
import { cx } from "../cx.ts";

/**
 * Le cadre commun de TOUT graphique du produit.
 *
 * **La vue tableau n'est pas une option, c'est un parametre obligatoire.** On
 * ne peut pas rendre un graphique sans fournir ses colonnes et ses lignes : la
 * regle « chaque graphique a une vue tableau consultable » cesse d'etre une
 * intention pour devenir une contrainte de compilation. C'est la meme mecanique
 * que le budget de poids de la boutique — une regle qu'on ne peut pas oublier
 * d'appliquer vaut mieux qu'une regle qu'on se rappelle d'appliquer.
 *
 * **Le resume precede toujours le trace.** Un `<svg>` nu est un sac de chemins :
 * un lecteur d'ecran y entre et n'en ressort avec rien. Le resume donne la
 * phrase — « 30 jours, 214 vues au total, maximum 28 le 12/07 » — et le tableau
 * donne les valeurs. Aucune des deux ne remplace l'autre.
 *
 * **`traceMuet` distingue les deux natures de trace.** Un `<svg>` est masque
 * aux lecteurs d'ecran, parce qu'il n'a rien a leur dire. Des barres en CSS
 * portent leur propre texte — libelle, valeur, taux — et les masquer jetterait
 * du contenu reel : elles restent lisibles.
 *
 * **Pas d'infobulle au survol, deliberement.** Le profil de reference est un
 * telephone tactile ou le survol n'existe pas : une valeur accessible seulement
 * au survol serait une valeur inaccessible. Le tableau est le canal de lecture
 * des valeurs, et il l'est pour tout le monde, au doigt comme au clavier.
 */

export interface LigneTableau {
  cle: string;
  /** En-tete de ligne — `<th scope="row">`. C'est ce qui nomme la valeur. */
  entete: ReactNode;
  cellules: ReactNode[];
}

export interface GraphiqueProps {
  titre: string;
  /** Une phrase sous le titre. C'est elle qui dit ce que le graphique raconte. */
  note?: ReactNode;
  /**
   * Ce qu'un lecteur d'ecran entend a la place du trace. Une phrase, pas une
   * liste de valeurs : la liste est dans le tableau.
   */
  resume: string;
  colonnes: string[];
  lignes: LigneTableau[];
  /**
   * Le trace est-il purement graphique ? Un `<svg>` l'est — `resume` parle a sa
   * place. Des barres en CSS ne le sont pas : leur texte est du contenu.
   */
  traceMuet?: boolean;
  /** Libelle de la commande d'ouverture du tableau. */
  libelleTableau?: string;
  /** Le trace : `<svg>` ou barres en CSS. */
  children: ReactNode;
  className?: string;
}

export function Graphique({
  titre,
  note,
  resume,
  colonnes,
  lignes,
  traceMuet = false,
  libelleTableau = "Voir les chiffres",
  children,
  className,
}: GraphiqueProps) {
  return (
    <figure data-slot="graphique" className={cx("m-0 flex flex-col gap-3 font-sans", className)}>
      <figcaption className="flex flex-col gap-1">
        <span className="text-title font-bold text-ink">{titre}</span>
        {note ? <span className="text-caption text-ink-2">{note}</span> : null}
      </figcaption>

      {/* Le resume porte le sens ; le detail est dans le tableau. */}
      <p className="sr-only">{resume}</p>
      <div data-slot="trace" {...(traceMuet ? { "aria-hidden": true } : {})}>
        {children}
      </div>

      <details data-slot="tableau" className="group">
        <summary
          className={
            "flex min-h-[var(--size-touch)] cursor-pointer list-none items-center gap-2 " +
            "rounded-field px-1 text-caption font-semibold text-ink-2 " +
            "marker:content-none [&::-webkit-details-marker]:hidden"
          }
        >
          {/* Le chevron est decoratif : le libelle porte deja l'action, et
              `<details>` annonce lui-meme son etat ouvert/ferme. */}
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className="shrink-0 transition-transform duration-[--duration-fast] group-open:rotate-90"
          >
            <path
              d="M4 2.5 8 6l-4 3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {libelleTableau}
        </summary>

        {/* `overflow-x-auto` sur le conteneur, jamais sur la page : un tableau a
            quatre colonnes deborde d'un telephone, et c'est le tableau qui doit
            defiler, pas l'ecran entier. */}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-caption tabular-nums">
            <caption className="sr-only">{titre}</caption>
            <thead>
              <tr>
                {colonnes.map((c, i) => (
                  <th
                    key={c}
                    scope="col"
                    className={cx(
                      "border-b border-line py-2 font-semibold text-ink-2",
                      i === 0 ? "text-left" : "text-right",
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.cle}>
                  <th
                    scope="row"
                    className="border-b border-line py-2 text-left font-normal text-ink"
                  >
                    {l.entete}
                  </th>
                  {l.cellules.map((cel, i) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: une cellule n'a d'identite que sa colonne, et les colonnes sont fixes.
                      key={i}
                      className="border-b border-line py-2 text-right text-ink"
                    >
                      {cel}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
