import type { ComponentProps, ReactNode } from "react";

/**
 * Le jeu d'icones de l'app vendeuse — dessine ici, trait 1,7, grille 24.
 *
 * Pas de lucide-react ni d'autre bibliotheque : une icone utilisee vaut
 * ~300 octets en ligne, la bibliotheque entiere en vaut des milliers, et le
 * lot 2 a pose la regle pour la boutique comme pour l'app. Chaque icone est
 * decorative (`aria-hidden`) : le sens est TOUJOURS porte par le texte voisin,
 * jamais par le dessin seul.
 */

type IconeProps = Omit<ComponentProps<"svg">, "children"> & { taille?: number };

function Icone({ taille = 22, children, ...props }: IconeProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconeAccueil = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M4 10.5 12 4l8 6.5" />
    <path d="M6 9.5V19a1 1 0 0 0 1 1h3.2v-4.6a1.8 1.8 0 0 1 3.6 0V20H17a1 1 0 0 0 1-1V9.5" />
  </Icone>
);

export const IconeArticles = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M12.6 3.6h5.2a2 2 0 0 1 2 2v5.2a2 2 0 0 1-.6 1.4l-7.2 7.2a2 2 0 0 1-2.8 0l-4.6-4.6a2 2 0 0 1 0-2.8l7.2-7.2a2 2 0 0 1 .8-.2Z" />
    <circle cx="15.8" cy="8.2" r="1.3" fill="currentColor" stroke="none" />
  </Icone>
);

export const IconeCommandes = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M5 4.5h14a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" />
    <path d="M8 9h8M8 12.8h8M8 16.5h4.6" />
  </Icone>
);

export const IconeChiffres = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M4.5 19.5v-6.2" />
    <path d="M9.5 19.5V9.6" />
    <path d="M14.5 19.5v-7.6" />
    <path d="M19.5 19.5V5.8" />
  </Icone>
);

export const IconeReglages = (p: IconeProps) => (
  <Icone {...p}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 3.2v2.3M12 18.5v2.3M20.8 12h-2.3M5.5 12H3.2M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6M18.2 18.2l-1.6-1.6M7.4 7.4 5.8 5.8" />
  </Icone>
);

export const IconeRetour = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Icone>
);

export const IconeChevron = (p: IconeProps) => (
  <Icone {...p}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </Icone>
);

export const IconePlus = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icone>
);

export const IconeRecu = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M6 3.8h12v16.4l-2.4-1.6-2.4 1.6-1.2-.8-1.2.8-2.4-1.6L6 20.2Z" />
    <path d="M9 8.4h6M9 12h6" />
  </Icone>
);

export const IconeAppareil = (p: IconeProps) => (
  <Icone {...p}>
    <rect x="7" y="3" width="10" height="18" rx="2" />
    <path d="M10.5 17.8h3" />
  </Icone>
);

export const IconeBoutique = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M4 9.5 5.5 4h13L20 9.5" />
    <path d="M4 9.5a2.6 2.6 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.6 2.6 0 0 0 5.3 0" />
    <path d="M5.5 12.5V20h13v-7.5" />
    <path d="M9.5 20v-4.8h5V20" />
  </Icone>
);

/**
 * Le logotype : une etiquette de prix inclinee, l'oeillet en evidence — le
 * catalogue, sans lettre ni mot, donc lisible dans toutes les langues du
 * marche. Sert a l'ecran de connexion et a l'icone PWA.
 */
export function Logotype({ taille = 44 }: { taille?: number }) {
  return (
    <svg aria-hidden="true" width={taille} height={taille} viewBox="0 0 48 48" fill="none">
      <rect width="48" height="48" rx="12" fill="var(--color-brand-fill)" />
      <path
        d="M23.2 12.4h9.1a3.3 3.3 0 0 1 3.3 3.3v9.1a3.3 3.3 0 0 1-.97 2.33l-9.53 9.53a3.3 3.3 0 0 1-4.66 0l-7.11-7.11a3.3 3.3 0 0 1 0-4.66l9.53-9.53a3.3 3.3 0 0 1 2.33-.97Z"
        fill="var(--color-brand-on-fill)"
        fillOpacity="0.16"
        stroke="var(--color-brand-on-fill)"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="29.4" cy="18.6" r="2.5" fill="var(--color-brand-on-fill)" />
    </svg>
  );
}
