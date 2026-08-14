import type { OperateurRampe } from "@catalog/contracts/ussd";

/**
 * Ecran 1 — le choix de l'operateur.
 *
 * **C'est l'operateur de l'ACHETEUSE qui compte**, pas celui de la vendeuse :
 * la chaine USSD se compose sur son telephone a elle, dans le menu de son propre
 * portefeuille. Le numero de la vendeuse n'est que la destination.
 *
 * Les operateurs viennent de la configuration, jamais d'une liste ecrite ici :
 * le jour ou un troisieme portefeuille compte au Cameroun, il s'ajoute par
 * l'environnement, sans toucher a la boutique.
 */

export interface ChoixOperateurProps {
  operateurs: OperateurRampe[];
  onChoisir: (id: string) => void;
}

export function ChoixOperateur({ operateurs, onChoisir }: ChoixOperateurProps) {
  return (
    <section class="flex flex-col gap-3">
      <h2 class="text-body font-semibold text-ink">Avec quel portefeuille payez-vous ?</h2>
      <p class="text-caption text-ink-2">
        Choisissez le votre — celui d'ou l'argent part. Nous preparons alors la chaine a composer.
      </p>
      <div class="flex flex-col gap-2">
        {operateurs.map((op) => (
          <button
            key={op.id}
            type="button"
            data-testid={`operateur-${op.id}`}
            onClick={() => onChoisir(op.id)}
            class="min-h-[var(--size-touch)] rounded-field border border-control-line bg-surface px-4 py-3 text-left text-body font-semibold text-ink"
          >
            {op.nom}
          </button>
        ))}
      </div>
      {operateurs.length === 0 ? (
        <p class="text-caption text-danger">
          Aucun operateur n'est configure pour l'instant. Reglez directement avec le/la vendeur/se
          sur WhatsApp.
        </p>
      ) : null}
    </section>
  );
}

export default ChoixOperateur;
