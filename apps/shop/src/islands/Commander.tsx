/**
 * Les imports passent par les SOUS-CHEMINS, jamais par le baril
 * `@catalog/contracts`. Le baril reexporte les schemas Zod, dont les
 * declarations ont des effets de bord au niveau du module : l'elagage ne les
 * retire pas. Mesure, cet ilot pesait 20,6 Ko compresses au lieu de 1,5.
 */
import { formatXaf } from "@catalog/contracts/money";
import { lienCommande } from "@catalog/contracts/whatsapp";
import { useMemo, useState } from "preact/hooks";

/**
 * Le seul JavaScript de la boutique publique.
 *
 * **Preact, pas React.** React fait environ 45 Ko compresses ; Preact en fait
 * moins de cinq. Le budget du chemin critique est de 30 Ko pour TOUT, et il n'y a
 * ici qu'un compteur de quantite et un selecteur de variante. Voir ADR 0017.
 *
 * L'ilot est monte en `client:visible` : le JavaScript ne se telecharge que quand
 * le bouton entre dans le champ de vision. Une acheteuse qui parcourt la grille
 * d'une boutique sans ouvrir de fiche ne paie rien.
 *
 * **Le composant est utilisable AVANT son hydratation.** C'est le point le plus
 * important du fichier : le HTML rendu par Astro contient deja un lien WhatsApp
 * complet pour une quantite de un. Si le JavaScript n'arrive jamais — reseau
 * coupe, forfait epuise, navigateur ancien — l'acheteuse peut quand meme
 * commander. Le compteur est un confort par-dessus, jamais le porteur de la
 * fonction.
 */

export interface CommanderProps {
  boutique: string;
  whatsapp: string;
  nom: string;
  prixXaf: number;
  /** `null` quand la vendeuse ne suit pas son stock : on ne borne alors rien. */
  stock: number | null;
  variantes: string[];
}

/** Une acheteuse ne commande pas trente pieces par ce chemin. */
const QUANTITE_MAX = 20;

export default function Commander({
  boutique,
  whatsapp,
  nom,
  prixXaf,
  stock,
  variantes,
}: CommanderProps) {
  const [quantite, setQuantite] = useState(1);
  const [variante, setVariante] = useState(variantes[0] ?? "");

  const plafond = Math.min(QUANTITE_MAX, stock ?? QUANTITE_MAX);

  const lien = useMemo(() => {
    // La variante fait partie du NOM de l'article dans le message : c'est ce qui
    // la rend opposable. Un champ separe se perdrait a la recopie.
    const intitule = variante ? `${nom} (${variante})` : nom;
    try {
      return lienCommande(whatsapp, {
        boutique,
        lignes: [{ nom: intitule, quantite, prixUnitaireXaf: prixXaf }],
      });
    } catch {
      // Numero de vendeuse invalide : on n'affiche pas de lien mort.
      return null;
    }
  }, [boutique, whatsapp, nom, prixXaf, quantite, variante]);

  const total = prixXaf * quantite;

  return (
    <div class="flex flex-col gap-4">
      {variantes.length > 0 ? (
        <div class="flex flex-col gap-1.5">
          <label for="variante" class="text-caption font-semibold text-ink-2">
            Choix
          </label>
          <select
            id="variante"
            value={variante}
            onChange={(e) => setVariante((e.target as HTMLSelectElement).value)}
            class="min-h-[var(--size-touch)] w-full rounded-field border border-control-line bg-surface px-3 text-body text-ink"
          >
            {variantes.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* `<fieldset>` et `<legend>` plutot qu'un `role="group"` pose a la main :
          l'element natif porte deja la semantique, et il la porte meme si le CSS
          ne charge pas. */}
      <fieldset class="flex flex-col gap-1.5 border-0 p-0">
        <legend class="text-caption font-semibold text-ink-2">Quantite</legend>
        {/* Trois elements et non un `<input type=number>` : les fleches d'un champ
            numerique font moins de 44 px et ne sont pas atteignables au doigt. */}
        <div class="flex items-center gap-3">
          <button
            type="button"
            aria-label="Retirer un"
            disabled={quantite <= 1}
            onClick={() => setQuantite((q) => Math.max(1, q - 1))}
            class="min-h-[var(--size-touch)] min-w-[var(--size-touch)] rounded-field border border-control-line bg-surface text-title font-semibold text-ink disabled:opacity-55"
          >
            −
          </button>
          <output
            aria-live="polite"
            class="min-w-12 text-center text-title font-bold tabular-nums text-ink"
          >
            {quantite}
          </output>
          <button
            type="button"
            aria-label="Ajouter un"
            disabled={quantite >= plafond}
            onClick={() => setQuantite((q) => Math.min(plafond, q + 1))}
            class="min-h-[var(--size-touch)] min-w-[var(--size-touch)] rounded-field border border-control-line bg-surface text-title font-semibold text-ink disabled:opacity-55"
          >
            +
          </button>
        </div>
        {stock !== null && stock <= 5 ? (
          <p class="text-caption text-warn">Il n'en reste que {stock}.</p>
        ) : null}
      </fieldset>

      <p class="text-body text-ink">
        Total : <strong class="text-title font-bold">{formatXaf(total)}</strong>
      </p>

      {lien ? (
        <a
          href={lien}
          rel="noopener"
          data-testid="commander"
          class="inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-field bg-brand-fill px-5 py-3 text-body font-semibold text-brand-on-fill"
        >
          Commander sur WhatsApp
        </a>
      ) : (
        <p class="text-caption text-danger">
          Cette boutique n'a pas encore de numero WhatsApp valide.
        </p>
      )}
    </div>
  );
}
