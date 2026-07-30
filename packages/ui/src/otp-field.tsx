import { useId } from "react";
import { cx } from "./cx.ts";
import { Label } from "./primitives/basics.tsx";

/**
 * Le champ de saisie du code a six chiffres.
 *
 * **Un seul champ, pas six cases.** Le motif « une case par chiffre » est
 * repandu et il est mauvais ici : il casse l'auto-remplissage SMS, il casse le
 * collage, et il transforme une correction de frappe en six coups de touche
 * arriere. Une vendeuse sur un telephone d'entree de gamme perd la partie.
 *
 * Trois attributs font tout le travail, et aucun n'est decoratif :
 *
 * - `autoComplete="one-time-code"` — c'est ce qui declenche la proposition
 *   automatique du code par le clavier des que le SMS arrive. Sans lui, la
 *   vendeuse doit basculer vers ses messages, lire, revenir, taper.
 * - `inputMode="numeric"` — le pave numerique s'ouvre directement.
 * - `type="text"`, pas `number` — `number` fait apparaitre des fleches, accepte
 *   `e` et `-`, et supprime les zeros de tete. Un code commencant par 0 y
 *   disparait.
 *
 * **Le collage n'est JAMAIS bloque.** Pas de `onPaste` qui appelle
 * `preventDefault`. AGENTS.md le range parmi les interdits et WCAG 2.2 §3.3.8 le
 * formule ainsi : empecher le collage est une regression, pas une securite. Un
 * test lit cette source pour le verifier, parce qu'une interception d'evenement
 * est invisible dans le balisage.
 *
 * Le nettoyage se borne a retirer ce qui n'est pas un chiffre : c'est ce qui
 * permet de coller « Catalog : votre code de connexion est 481902. » sans que la
 * vendeuse ait a decouper la phrase.
 */

export interface OtpFieldProps {
  value: string;
  onValueChange: (next: string) => void;
  label?: string;
  hint?: React.ReactNode;
  /** Message d'erreur. Sa presence marque le champ `aria-invalid`. */
  erreur?: string | null;
  longueur?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  id?: string;
}

export function OtpField({
  value,
  onValueChange,
  label = "Code reçu par SMS",
  hint = "Six chiffres. Vous pouvez coller le message entier.",
  erreur,
  longueur = 6,
  disabled,
  autoFocus,
  className,
  id: idFourni,
}: OtpFieldProps) {
  const auto = useId();
  const id = idFourni ?? auto;
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;

  return (
    <div className={cx("flex flex-col gap-1.5 font-sans", className)}>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="text"
        value={value}
        disabled={disabled}
        // biome-ignore lint/a11y/noAutofocus: l'ecran n'existe que pour ce champ — la vendeuse vient d'y etre envoyee, et un focus manuel de plus est une frappe de plus sur un petit ecran.
        autoFocus={autoFocus}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={longueur * 4}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={cx(hintId, erreur ? errId : undefined)}
        placeholder={"0".repeat(longueur)}
        onChange={(e) => onValueChange(e.target.value.replace(/\D/g, "").slice(0, longueur))}
        className={cx(
          "min-h-[var(--size-touch)] w-full rounded-field border border-control-line bg-surface px-3.5 py-2",
          "text-center font-mono text-hero tracking-[0.35em] text-ink placeholder:text-muted",
          "transition-colors duration-fast ease-out",
          "disabled:cursor-not-allowed disabled:opacity-55",
          "aria-invalid:border-danger",
        )}
      />
      <p id={hintId} className="text-caption text-ink-2">
        {hint}
      </p>
      {/* Poli, pas assertif : la vendeuse est en train de taper. */}
      <p id={errId} role="status" aria-live="polite" className="text-caption text-danger">
        {erreur}
      </p>
    </div>
  );
}
