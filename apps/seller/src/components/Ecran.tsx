import type { ReactNode } from "react";

/**
 * Cadre commun des ecrans vendeuse.
 *
 * Une seule colonne, largeur bornee, et un `<h1>` par page : la hierarchie de
 * titres est ce que le lecteur d'ecran utilise pour se reperer, et deux `h1` ou
 * zero la cassent. Le `<main>` est unique, ce qui rend le saut de navigation
 * utile.
 */
export function Ecran({
  titre,
  surtitre,
  children,
  actions,
}: {
  titre: string;
  surtitre?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-[34rem] flex-col gap-4 px-5 py-8 font-sans">
      <header className="flex flex-col gap-1">
        {surtitre ? (
          <p className="text-caption font-semibold uppercase tracking-[0.08em] text-muted">
            {surtitre}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-title font-bold text-ink">{titre}</h1>
          {actions}
        </div>
      </header>
      {children}
    </main>
  );
}
