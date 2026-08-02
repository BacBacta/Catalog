import type { ReactNode } from "react";
import { Link } from "react-router";
import { IconeRetour } from "./icones.tsx";

/**
 * Cadre commun des ecrans vendeuse.
 *
 * Une seule colonne, largeur bornee, et un `<h1>` par page : la hierarchie de
 * titres est ce que le lecteur d'ecran utilise pour se reperer, et deux `h1` ou
 * zero la cassent. Le `<main>` est unique, ce qui rend le saut de navigation
 * utile.
 *
 * Refonte (ADR 0030) :
 * - le titre passe a `text-display` — la hierarchie h1 > h3 devient VISIBLE,
 *   pas seulement semantique ;
 * - `retour` affiche une fleche de retour explicite en tete d'ecran. Avant, la
 *   moitie des ecrans n'avaient aucune sortie hors le geste systeme ;
 * - l'ecran entier entre par `animate-entree` (8 px, 320 ms), neutralisee par
 *   `prefers-reduced-motion` via la regle globale de tokens.css.
 */
export function Ecran({
  titre,
  surtitre,
  retour,
  children,
  actions,
}: {
  titre: string;
  surtitre?: string;
  /** Destination de la fleche de retour. Absente = pas de fleche. */
  retour?: { vers: string; libelle: string };
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <main className="animate-entree mx-auto flex w-full max-w-[34rem] flex-col gap-4 px-5 pt-6 pb-8 font-sans">
      <header className="flex flex-col gap-1.5">
        {retour ? (
          <Link
            to={retour.vers}
            className="-ml-2 inline-flex min-h-[var(--size-touch)] w-fit items-center gap-1 rounded-field px-2 text-caption font-semibold text-ink-2 transition-colors duration-fast hover:bg-plane hover:text-ink"
          >
            <IconeRetour taille={18} />
            {retour.libelle}
          </Link>
        ) : null}
        {surtitre ? (
          <p className="text-caption font-semibold uppercase tracking-[0.08em] text-muted">
            {surtitre}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-display font-bold tracking-[-0.01em] text-ink">{titre}</h1>
          {actions}
        </div>
      </header>
      {children}
    </main>
  );
}
