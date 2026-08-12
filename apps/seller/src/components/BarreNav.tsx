import { cx } from "@catalog/ui";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import {
  IconeAccueil,
  IconeArticles,
  IconeChiffres,
  IconeCommandes,
  IconeReglages,
} from "./icones.tsx";

/**
 * La barre de navigation inferieure — le squelette de la refonte (ADR 0030).
 *
 * Avant elle, l'app n'avait AUCUNE navigation persistante : l'accueil etait un
 * annuaire de cartes et chaque ecran un cul-de-sac dont on ne sortait que par
 * le retour du navigateur. Cinq destinations au pouce, toujours au meme
 * endroit, changent la nature de l'app plus que n'importe quelle couleur.
 *
 * Regles tenues :
 * - `<nav>` avec libelle, `aria-current="page"` pose par NavLink : le lecteur
 *   d'ecran sait ou il est.
 * - Chaque cible fait la hauteur de --size-touch, garantie par tokens.css.
 * - `env(safe-area-inset-bottom)` : la barre ne passe pas sous le geste
 *   systeme des telephones sans bouton.
 * - L'etat actif est porte par la couleur ET la graisse + un point : jamais la
 *   couleur seule (WCAG 1.4.1).
 */

const DESTINATIONS: Array<{ vers: string; libelle: string; icone: (p: object) => ReactNode }> = [
  { vers: "/", libelle: "Accueil", icone: IconeAccueil },
  { vers: "/articles", libelle: "Articles", icone: IconeArticles },
  { vers: "/commandes", libelle: "Commandes", icone: IconeCommandes },
  { vers: "/statistiques", libelle: "Chiffres", icone: IconeChiffres },
  { vers: "/reglages", libelle: "Reglages", icone: IconeReglages },
];

export function BarreNav() {
  return (
    <nav
      aria-label="Navigation principale"
      className={cx(
        "fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface shadow-nav",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <div className="mx-auto flex w-full max-w-[34rem] items-stretch">
        {DESTINATIONS.map(({ vers, libelle, icone: Icone }) => (
          <NavLink
            key={vers}
            to={vers}
            end={vers === "/"}
            className={({ isActive }) =>
              cx(
                "flex min-h-[var(--size-touch)] flex-1 flex-col items-center justify-center gap-0.5 py-2",
                "font-sans text-[0.6875rem] transition-colors duration-fast ease-out",
                isActive ? "font-bold text-brand-500" : "font-medium text-muted",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icone />
                <span>{libelle}</span>
                <span
                  aria-hidden="true"
                  className={cx(
                    "h-1 w-1 rounded-pill transition-opacity duration-fast",
                    isActive ? "bg-brand-500 opacity-100" : "opacity-0",
                  )}
                />
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
