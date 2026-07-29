import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "../cx.ts";

/**
 * Primitives sans portail. Base UI fournit le comportement et l'accessibilite ;
 * le style vient de nos jetons, jamais du preset shadcn — voir ADR 0012.
 *
 * Aucune de ces classes n'utilise une couleur en dur : tout passe par
 * `tokens.css`, dont les contrastes sont verifies dans les deux themes.
 */

/* ────────────────────────── Button ────────────────────────── */

export type ButtonTone = "primary" | "outline" | "ghost" | "danger";
export type ButtonSize = "md" | "lg" | "icon";

/**
 * Les hauteurs partent de 44px, pas de 32px comme le preset shadcn : c'est la
 * cible tactile d'AGENTS.md, et elle n'est pas negociable. `min-h-[var(--size-touch)]` vient
 * du jeton --size-touch, et la regle de base de tokens.css la garantit meme si
 * un appelant surcharge la classe.
 */
const TONE: Record<ButtonTone, string> = {
  primary: "bg-brand-fill text-brand-on-fill hover:opacity-90",
  outline: "border border-control-line bg-surface text-ink hover:bg-plane",
  ghost: "bg-transparent text-brand-500 hover:bg-brand-soft",
  danger: "border border-danger bg-danger-soft text-danger hover:opacity-90",
};

const SIZE: Record<ButtonSize, string> = {
  md: "min-h-[var(--size-touch)] px-4 text-body",
  lg: "min-h-[var(--size-touch)] w-full px-5 py-3 text-body",
  icon: "min-h-[var(--size-touch)] min-w-[var(--size-touch)]",
};

export interface ButtonProps extends ButtonPrimitive.Props {
  tone?: ButtonTone;
  size?: ButtonSize;
}

export function Button({ className, tone = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-field font-sans font-semibold",
        "transition-[opacity,background-color] duration-fast ease-out",
        "disabled:pointer-events-none disabled:opacity-55",
        TONE[tone],
        SIZE[size],
        className as string,
      )}
      {...props}
    />
  );
}

/* ────────────────────────── Input ────────────────────────── */

/**
 * Le bord utilise --color-control-line, pas --color-line : un champ doit se
 * distinguer du fond a 3:1 (WCAG 1.4.11), la ou un separateur decoratif n'y
 * est pas tenu.
 */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cx(
        "min-h-[var(--size-touch)] w-full rounded-field border border-control-line bg-surface px-3.5",
        "font-sans text-body text-ink placeholder:text-muted",
        "transition-colors duration-fast ease-out",
        "disabled:cursor-not-allowed disabled:opacity-55",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Etiquette de champ. `htmlFor` est OBLIGATOIRE dans le type : une etiquette
 * non reliee ne sert a rien, et un placeholder n'est pas une etiquette.
 */
export function Label({ className, ...props }: ComponentProps<"label"> & { htmlFor: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor est requis par le type ci-dessus et arrive par le spread — la regle ne voit pas a travers.
    <label
      data-slot="label"
      className={cx("block font-sans text-caption font-semibold text-ink-2", className)}
      {...props}
    />
  );
}

/* ────────────────────────── Card ────────────────────────── */

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cx(
        "flex flex-col gap-3 rounded-card border border-line bg-surface p-4 font-sans text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cx("text-title font-bold text-ink", className)}
      {...props}
    />
  );
}

export function CardNote({ className, ...props }: ComponentProps<"p">) {
  return (
    <p data-slot="card-note" className={cx("text-caption text-muted", className)} {...props} />
  );
}

/* ────────────────────────── Badge ────────────────────────── */

export type BadgeTone = "neutral" | "brand" | "good" | "warn" | "danger";

const BADGE: Record<BadgeTone, string> = {
  neutral: "bg-plane text-ink-2",
  brand: "bg-brand-soft text-brand-500",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export interface BadgeProps extends ComponentProps<"span"> {
  tone?: BadgeTone;
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      data-tone={tone}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1",
        "font-sans text-caption font-semibold",
        BADGE[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ────────────────────────── Skeleton ────────────────────────── */

/**
 * L'animation de pulsation est neutralisee par la regle
 * `prefers-reduced-motion` de tokens.css. Le squelette reste visible et lisible
 * sans elle : l'animation n'est pas ce qui porte l'information.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cx("animate-pulse rounded-field bg-line", className)}
      {...props}
    />
  );
}

/* ────────────────────────── Separator ────────────────────────── */

export function Separator({ className, ...props }: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      className={cx("h-px w-full bg-line", className as string)}
      {...props}
    />
  );
}

/* ────────────────────────── Field ────────────────────────── */

/** Groupe etiquette + champ + aide, avec l'aide reliee par aria-describedby. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  const hintId = `${htmlFor}-hint`;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? (
        <p id={hintId} className="text-caption text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
