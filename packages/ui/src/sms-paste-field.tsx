import { useId, useRef, useState } from "react";
import { cx } from "./cx.ts";
import { Button, Label } from "./primitives/basics.tsx";

/**
 * Le champ de collage du SMS operateur.
 *
 * C'est le point d'entree de la valeur numero un du produit : la preuve de
 * paiement. Trois regles le gouvernent, et aucune n'est negociable.
 *
 * **1. Le collage n'est JAMAIS bloque.** Pas de `onPaste` qui appelle
 * `preventDefault`, pas de `onCopy` neutralise, pas d'`onContextMenu` supprime.
 * AGENTS.md le classe parmi les interdits, et WCAG 2.2 §3.3.8 le formule ainsi :
 * empecher le collage est une regression, pas une securite. Ici c'est plus fort
 * qu'ailleurs — l'usage entier de ce champ est le collage. Un test le verifie.
 *
 * **2. Le bouton « coller » est explicite.** Beaucoup de vendeuses ne
 * connaissent pas l'appui long. Le bouton lit le presse-papiers a leur place.
 * Quand le navigateur refuse — permission absente, contexte non securise — on
 * le dit et on laisse le champ utilisable : le collage manuel marche toujours.
 *
 * **3. Le champ est haut et en monospace.** Un SMS operateur fait deux a quatre
 * lignes ; dans un champ d'une ligne la vendeuse ne voit pas ce qu'elle colle,
 * donc ne voit pas qu'elle a colle la mauvaise chose. Le monospace fait
 * ressortir l'identifiant de transaction, qui est ce qu'elle doit reconnaitre.
 *
 * Le SMS brut contient le SOLDE du compte de la vendeuse. Il ne doit jamais
 * partir dans un log, une trace ou un message d'erreur — c'est la
 * responsabilite de l'appelant, rappelee ici parce que c'est ici qu'il entre.
 */

export interface SmsPasteFieldProps {
  value: string;
  onValueChange: (next: string) => void;
  /** Bandeau au-dessus du champ. Le lot 8 y met l'avertissement « capture d'écran ». */
  notice?: React.ReactNode;
  label?: string;
  hint?: React.ReactNode;
  disabled?: boolean;
  rows?: number;
  className?: string;
}

export function SmsPasteField({
  value,
  onValueChange,
  notice,
  label = "Collez le SMS de votre opérateur",
  hint = "Le message entier, tel qu’il est arrivé. N’enlevez rien : l’identifiant de transaction en fait partie.",
  disabled,
  rows = 6,
  className,
}: SmsPasteFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const area = useRef<HTMLTextAreaElement>(null);
  const [clipboardNote, setClipboardNote] = useState<string | null>(null);

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard?.readText();
      if (!text) {
        setClipboardNote("Le presse-papiers est vide. Copiez d’abord le SMS.");
        return;
      }
      onValueChange(text);
      setClipboardNote(null);
      area.current?.focus();
    } catch {
      // Refus de permission, ou page non securisee. Ce n'est pas une panne :
      // le collage a la main reste disponible, et on le dit.
      setClipboardNote(
        "Votre téléphone n’autorise pas la lecture automatique. Appuyez longuement dans le cadre, puis « Coller ».",
      );
      area.current?.focus();
    }
  }

  return (
    <div className={cx("flex flex-col gap-2 font-sans", className)}>
      {notice}
      <div className="flex items-end justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <Button
          type="button"
          tone="outline"
          onClick={pasteFromClipboard}
          disabled={disabled}
          aria-describedby={statusId}
        >
          Coller
        </Button>
      </div>

      <textarea
        id={id}
        ref={area}
        value={value}
        rows={rows}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value)}
        aria-describedby={cx(hintId, clipboardNote ? statusId : undefined)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="Vous avez recu 26800 XAF de …"
        className={cx(
          "w-full resize-y rounded-field border border-control-line bg-surface p-3.5",
          "font-mono text-body text-ink leading-relaxed placeholder:text-muted",
          "min-h-[9rem] transition-colors duration-fast ease-out",
          "disabled:cursor-not-allowed disabled:opacity-55",
        )}
      />

      <p id={hintId} className="text-caption text-ink-2">
        {hint}
      </p>

      {/* Poli, pas assertif : la vendeuse est en train de taper. */}
      <p id={statusId} role="status" aria-live="polite" className="text-caption text-warn">
        {clipboardNote}
      </p>
    </div>
  );
}
