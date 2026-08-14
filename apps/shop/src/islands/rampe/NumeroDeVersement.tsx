import { formatXaf } from "@catalog/contracts/money";
import { formatPhone } from "@catalog/contracts/phone";
import { useState } from "preact/hooks";

/**
 * Le numero de reversement de la vendeuse, EN GRAND et copiable d'un tap.
 *
 * C'est le seul element de tout le parcours qu'une acheteuse peut avoir a
 * recopier a la main — quand la rampe echoue, quand elle est sur iPhone, quand
 * elle prefere son menu habituel. Il est donc affiche en chiffres groupes
 * (`6 77 12 34 56`), a la taille d'un titre, avec un bouton de copie qui fait
 * 44 px de haut.
 *
 * Un chiffre faux envoie l'argent chez quelqu'un d'autre, definitivement.
 */

export interface NumeroDeVersementProps {
  numero: string;
  montantXaf: number;
  boutique?: string;
}

export function NumeroDeVersement({ numero, montantXaf, boutique }: NumeroDeVersementProps) {
  const [copie, setCopie] = useState<"non" | "oui" | "echec">("non");

  async function copier() {
    try {
      await navigator.clipboard.writeText(formatPhone(numero).replace(/\s/g, ""));
      setCopie("oui");
    } catch {
      // Un navigateur sans presse-papiers, ou un refus de permission. On le dit
      // plutot que de laisser croire que c'est copie : le numero reste lisible
      // a l'ecran, il se recopie a la main.
      setCopie("echec");
    }
  }

  return (
    <section class="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <p class="text-caption text-ink-2">
        {boutique ? `Vous payez ${boutique}` : "Vous payez le/la vendeur/se"}
      </p>
      <p class="text-hero font-extrabold leading-tight text-ink">{formatXaf(montantXaf)}</p>
      <p class="text-caption text-ink-2">sur le numero</p>
      <p class="text-title font-bold tabular-nums tracking-wide text-ink" data-testid="numero">
        {formatPhone(numero)}
      </p>
      <button
        type="button"
        onClick={copier}
        class="min-h-[var(--size-touch)] rounded-field border border-control-line bg-surface px-4 text-body font-semibold text-brand-500"
      >
        Copier le numero
      </button>
      <p role="status" aria-live="polite" class="text-caption text-ink-2">
        {copie === "oui"
          ? "Numero copie."
          : copie === "echec"
            ? "Copie impossible sur ce telephone — le numero est ecrit au-dessus."
            : ""}
      </p>
    </section>
  );
}

export default NumeroDeVersement;
