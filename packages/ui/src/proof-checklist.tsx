import type { ReactNode } from "react";
import { cx } from "./cx.ts";

/**
 * La liste des controles de preuve, avec ses quatre etats visuels.
 *
 * Ce composant est la ou la vendeuse apprend POURQUOI un paiement est refuse.
 * S'il ne le lui dit pas en langue simple, elle expedie la marchandise quand
 * meme et le produit n'a servi a rien. C'est pour ca que chaque ligne porte une
 * explication obligatoire, et pas seulement un titre.
 *
 * Accessibilite, deux points qui comptent :
 *
 * - **La couleur ne porte jamais l'etat seule** (WCAG 1.4.1). Chaque ligne a un
 *   pictogramme de forme distincte — coche, croix, triangle, sablier — ET un
 *   libelle d'etat en texte, lu par les lecteurs d'ecran via `sr-only`.
 * - **C'est une vraie liste.** `<ol>` : la numerotation des sept controles est
 *   canonique (ADR 0009) et l'ordre est porteur de sens.
 *
 * Le composant ne connait pas les sept controles : il affiche ce qu'on lui
 * donne. Leur definition vit dans `apps/api/src/domain/proof` au lot 8.
 */

export type CheckState = "pass" | "fail" | "warn" | "pending";

export interface ProofCheckItem {
  id: string;
  /** Titre court : « Montant conforme ». */
  title: string;
  /** Explication en langue simple. Obligatoire — c'est tout l'interet. */
  explanation: ReactNode;
  state: CheckState;
}

const STATE: Record<CheckState, { label: string; text: string; bg: string; icon: ReactNode }> = {
  pass: {
    label: "Vérifié",
    text: "text-good",
    bg: "bg-good-soft",
    icon: (
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
        <path
          d="M4.5 10.5l3.4 3.4 7.1-7.9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  fail: {
    label: "Refusé",
    text: "text-danger",
    bg: "bg-danger-soft",
    icon: (
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
        <path
          d="M5.5 5.5l9 9M14.5 5.5l-9 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  warn: {
    label: "À vérifier",
    text: "text-warn",
    bg: "bg-warn-soft",
    icon: (
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
        <path
          d="M10 3.2l7 12.6H3z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M10 8v3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="10" cy="13.6" r="1" fill="currentColor" />
      </svg>
    ),
  },
  pending: {
    label: "En attente",
    text: "text-ink-2",
    bg: "bg-plane",
    icon: (
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M10 6v4.3l2.6 1.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
};

export interface ProofChecklistProps {
  items: ProofCheckItem[];
  /** Numerote les lignes. Les sept controles ont une numerotation canonique. */
  numbered?: boolean;
  className?: string;
}

export function ProofChecklist({ items, numbered = true, className }: ProofChecklistProps) {
  return (
    <ol data-slot="proof-checklist" className={cx("flex list-none flex-col gap-2 p-0", className)}>
      {items.map((item, i) => {
        const s = STATE[item.state];
        return (
          <li
            key={item.id}
            data-state={item.state}
            className="flex gap-3 rounded-card border border-line bg-surface p-3 font-sans"
          >
            <span
              className={cx(
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-pill",
                s.bg,
                s.text,
              )}
            >
              {s.icon}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="flex flex-wrap items-baseline gap-x-2 text-body font-semibold text-ink">
                {numbered ? <span className="text-muted tabular-nums">{i + 1}.</span> : null}
                {item.title}
                {/* L'etat en texte : la couleur seule ne suffit pas. */}
                <span className={cx("text-caption font-semibold", s.text)}>{s.label}</span>
              </p>
              <p className="text-caption text-ink-2">{item.explanation}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
