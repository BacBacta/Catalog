import { formatXaf } from "@catalog/contracts";
import type { ComponentProps } from "react";
import { cx } from "./cx.ts";

/**
 * Affichage d'un montant. Le composant le plus surveille du design system :
 * c'est celui qui peut faire perdre de l'argent a une vendeuse.
 *
 * Trois garanties :
 *
 * 1. **Le formatage vient de `formatXaf`**, dans `packages/contracts`. Il n'est
 *    pas reimplemente ici — l'espace de groupement est une espace fine
 *    INSECABLE, et un « 15 000 » coupe en fin de ligne se lit « 15 » puis
 *    « 000 ». On ne redeclare jamais une regle metier de part et d'autre d'une
 *    frontiere (AGENTS.md §6).
 * 2. **Un montant non entier leve.** `formatXaf` appelle `assertXaf`, qui refuse
 *    les flottants et les negatifs. Un `NaN` n'atteindra jamais l'ecran sous
 *    forme de « NaN FCFA » : le rendu echoue avant, bruyamment.
 * 3. **Les chiffres changent de style selon l'usage.** En grand, des chiffres
 *    proportionnels se lisent mieux. En colonne, il faut des chiffres
 *    tabulaires, sinon les milliers ne s'alignent pas d'une ligne a l'autre et
 *    l'oeil ne peut plus comparer deux montants.
 */

export type MoneySize = "hero" | "body" | "caption";

const SIZE: Record<MoneySize, string> = {
  hero: "text-hero font-extrabold tracking-[-0.01em]",
  body: "text-body font-semibold",
  caption: "text-caption font-semibold",
};

export interface MoneyDisplayProps extends Omit<ComponentProps<"span">, "children"> {
  amountXaf: number;
  size?: MoneySize;
  /** Vrai des que le montant est dans une colonne comparee ligne a ligne. */
  tabular?: boolean;
  /** `false` retire « FCFA » — utile quand l'unite est deja dans l'en-tete. */
  suffix?: boolean;
}

export function MoneyDisplay({
  amountXaf,
  size = "body",
  tabular = false,
  suffix = true,
  className,
  ...props
}: MoneyDisplayProps) {
  const text = formatXaf(amountXaf, { suffix });
  return (
    <span
      data-slot="money"
      data-amount-xaf={amountXaf}
      className={cx(
        "font-sans text-ink",
        SIZE[size],
        tabular
          ? "[font-variant-numeric:tabular-nums]"
          : "[font-variant-numeric:proportional-nums]",
        className,
      )}
      {...props}
    >
      {text}
    </span>
  );
}
