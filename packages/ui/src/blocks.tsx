import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx.ts";
import { Badge, type BadgeTone, Skeleton } from "./primitives/basics.tsx";

/**
 * Blocs metier presentationnels. Aucun ne connait le vocabulaire du domaine :
 * ils recoivent un ton et un libelle.
 *
 * C'est deliberé. Les vocabulaires — mode de paiement, etat de la preuve, etape
 * de la commande — sont figes dans `packages/contracts` au lot 3. Les redeclarer
 * ici en creerait une seconde source de verite de part et d'autre d'une
 * frontiere, ce qu'AGENTS.md §6 interdit. La correspondance
 * « etat du domaine → ton » appartient donc a l'appelant, pas a ce fichier.
 */

/* ────────────────────────── StatusBadge ────────────────────────── */

export interface StatusBadgeProps extends ComponentProps<"span"> {
  tone: BadgeTone;
  label: string;
}

/**
 * La couleur ne porte JAMAIS l'information seule (WCAG 1.4.1) : le libelle est
 * toujours present en texte, et le point colore n'est qu'un renfort. Un
 * utilisateur daltonien lit « Prouve », pas « le vert ».
 */
export function StatusBadge({ tone, label, className, ...props }: StatusBadgeProps) {
  return (
    <Badge tone={tone} className={className} {...props}>
      <span aria-hidden="true" className="size-2 rounded-pill bg-current" />
      {label}
    </Badge>
  );
}

/* ────────────────────────── StatTile ────────────────────────── */

export interface StatTileProps extends Omit<ComponentProps<"div">, "children"> {
  label: string;
  /** Le chiffre. Passer un <MoneyDisplay> quand c'est un montant. */
  value: ReactNode;
  note?: ReactNode;
  loading?: boolean;
}

export function StatTile({ label, value, note, loading, className, ...props }: StatTileProps) {
  return (
    <div
      data-slot="stat-tile"
      className={cx(
        "flex flex-col gap-1 rounded-card border border-line bg-surface p-5 font-sans shadow-card",
        className,
      )}
      {...props}
    >
      <span className="text-caption font-semibold uppercase tracking-[0.06em] text-muted">
        {label}
      </span>
      {loading ? (
        <>
          <Skeleton className="h-9 w-32" />
          <span className="sr-only">Chargement du chiffre…</span>
        </>
      ) : (
        <span className="text-ink">{value}</span>
      )}
      {note ? <span className="text-caption text-ink-2">{note}</span> : null}
    </div>
  );
}

/* ────────────────────────── Les quatre etats ────────────────────────── */

/**
 * Chaque ecran du produit doit avoir ses quatre etats : chargement, vide,
 * erreur, HORS LIGNE. Le dernier n'est pas un cas rare au Cameroun — il est
 * aussi frequent que le mode connecte, et un ecran qui l'oublie affiche une
 * erreur incomprehensible a quelqu'un qui a simplement perdu le reseau.
 *
 * Les pictogrammes sont des SVG en ligne. Pas de lucide-react : une
 * bibliotheque d'icones sur le chemin critique de la boutique publique coute
 * plus que le budget entier de 30 Ko.
 */

function StateShell({
  icon,
  title,
  children,
  action,
  tone = "neutral",
  role,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "danger" | "warn";
  role?: "alert" | "status";
}) {
  const accent =
    tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-brand-500";
  return (
    <div
      data-slot="state"
      {...(role ? { role } : {})}
      className="flex flex-col items-center gap-2 px-6 py-10 text-center font-sans"
    >
      <span aria-hidden="true" className={accent}>
        {icon}
      </span>
      <p className="text-title font-bold text-ink">{title}</p>
      <p className="max-w-[32ch] text-body text-ink-2">{children}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

/** Geometrie commune. `aria-hidden` est pose explicitement sur chaque <svg>
 *  plutot que diffuse ici : une regle de lint ne voit pas a travers un spread,
 *  et un pictogramme decoratif non masque est une vraie gene au lecteur d'ecran. */
const ICON = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none" } as const;

export function EmptyState({
  title = "Rien ici pour l'instant",
  children,
  action,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <StateShell
      role="status"
      title={title}
      action={action}
      icon={
        <svg {...ICON} aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.7" />
          <path d="M3 10h18" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      }
    >
      {children}
    </StateShell>
  );
}

export function ErrorState({
  title = "Quelque chose n'a pas marché",
  children,
  action,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <StateShell
      role="alert"
      tone="danger"
      title={title}
      action={action}
      icon={
        <svg {...ICON} aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
          <path d="M12 7.5v5.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <circle cx="12" cy="16.4" r="1.1" fill="currentColor" />
        </svg>
      }
    >
      {children}
    </StateShell>
  );
}

export function OfflineState({
  title = "Vous êtes hors ligne",
  children = "Ce que vous avez déjà ouvert reste lisible. Les envois repartiront tout seuls dès que le réseau revient.",
  action,
}: {
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <StateShell
      role="status"
      tone="warn"
      title={title}
      action={action}
      icon={
        <svg {...ICON} aria-hidden="true">
          <path
            d="M2.5 8.5a13 13 0 0 1 19 0"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <path
            d="M6 12.2a8.5 8.5 0 0 1 12 0"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="12" cy="17.5" r="1.4" fill="currentColor" />
          <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      }
    >
      {children}
    </StateShell>
  );
}

/** Etat de chargement. `aria-busy` + libelle lisible par lecteur d'ecran. */
export function LoadingState({
  label = "Chargement…",
  lines = 3,
}: {
  label?: string;
  lines?: number;
}) {
  return (
    <div
      data-slot="state"
      aria-busy="true"
      role="status"
      className="flex flex-col gap-2 p-4 font-sans"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => `ligne-${i}`).map((cle, i) => (
        <Skeleton key={cle} className={cx("h-5", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
