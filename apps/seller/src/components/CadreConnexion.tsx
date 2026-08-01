import type { ReactNode } from "react";
import { Logotype } from "./icones.tsx";

/**
 * Le cadre des ecrans d'AUTHENTIFICATION (refonte ADR 0030) : logotype centre,
 * un `<h1>` par ecran, colonne etroite posee au centre de la hauteur. C'est le
 * premier ecran que voit une vendeuse — il porte la marque, la ou les ecrans
 * connectes portent son commerce.
 */
export function CadreConnexion({
  titre,
  note,
  children,
}: {
  titre: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="animate-entree mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col justify-center gap-5 px-5 py-10 font-sans">
      <header className="flex flex-col items-center gap-3 text-center">
        <Logotype taille={56} />
        <div className="flex flex-col gap-1">
          <p
            aria-hidden="true"
            className="text-caption font-bold uppercase tracking-[0.18em] text-brand-500"
          >
            Catalog
          </p>
          <h1 className="text-display font-bold tracking-[-0.01em] text-ink">{titre}</h1>
          {note ? <p className="mx-auto max-w-[30ch] text-caption text-muted">{note}</p> : null}
        </div>
      </header>
      {children}
    </main>
  );
}
