import { formatXaf } from "@catalog/contracts/money";
import {
  type Chemin,
  cheminsDePaiement,
  montantAcceptable,
  type OperateurRampe,
  type Versement,
} from "@catalog/contracts/ussd";

/**
 * Ecran 2 — la rampe.
 *
 * **Catalog ne declenche aucun transfert.** Le bouton ouvre le composeur du
 * telephone, deja rempli. Tout ce qui suit se passe dans la session de
 * l'operateur, hors de portee de Catalog — y compris, et surtout, la saisie du
 * code secret.
 *
 * Deux regles de mise en page, et elles ne sont pas negociables :
 *
 * 1. **les etapes ecrites sont SOUS le bouton, toujours** — meme quand le
 *    raccourci fonctionne. Une acheteuse qui a lu ce qui va se passer ne
 *    s'arrete pas au premier menu inattendu ;
 * 2. **un raccourci non verifie ne remplace jamais le code d'entree.** Les deux
 *    chemins sont proposes, et le raccourci est marque pour ce qu'il est : une
 *    hypothese que personne n'a encore composee sur un telephone reel a Douala.
 *    L'ecran reste utilisable si elle echoue.
 */

export interface RampeProps {
  operateur: OperateurRampe;
  versement: Versement;
  onCompose: () => void;
}

export function Rampe({ operateur, versement, onCompose }: RampeProps) {
  const assezGrand = montantAcceptable(operateur, versement.montantXaf);
  const chemins: Chemin[] = assezGrand ? cheminsDePaiement(operateur, versement) : [];
  const aUnRaccourciNonVerifie = chemins.some((c) => c.type === "raccourci" && !c.verifie);

  if (!assezGrand) {
    return (
      <section class="flex flex-col gap-3">
        <h2 class="text-body font-semibold text-ink">{operateur.nom}</h2>
        <p class="rounded-field border border-warn bg-warn-soft p-3 text-caption text-warn">
          {operateur.nom} refuse les montants sous {formatXaf(operateur.montantMinXaf)}. Reglez
          directement avec le/la vendeur/se sur WhatsApp.
        </p>
      </section>
    );
  }

  return (
    <section class="flex flex-col gap-4">
      <h2 class="text-body font-semibold text-ink">{operateur.nom}</h2>

      {chemins.map((chemin, rang) => (
        <CarteChemin key={chemin.id} chemin={chemin} principal={rang === 0} onCompose={onCompose} />
      ))}

      {aUnRaccourciNonVerifie ? (
        <p
          data-testid="raccourci-a-confirmer"
          class="rounded-field border border-warn bg-warn-soft p-3 text-caption text-warn"
        >
          Le raccourci n'a pas encore ete essaye sur un telephone camerounais. S'il s'arrete en
          route, utilisez le menu de votre operateur juste au-dessous : il marche a coup sur.
        </p>
      ) : null}

      {/* Les etapes ecrites, SOUS le bouton, toujours. */}
      <section class="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <h3 class="text-body font-semibold text-ink">Comment ca se passe</h3>
        <ol class="flex list-decimal flex-col gap-1.5 pl-5 text-caption text-ink-2">
          {operateur.etapes.map((etape) => (
            <li key={etape}>{etape}</li>
          ))}
        </ol>
        {operateur.etapesAConfirmer ? (
          <p class="text-caption text-muted" data-testid="etapes-a-confirmer">
            Les intitules exacts des menus peuvent differer d'un telephone a l'autre : suivez
            l'option de transfert d'argent.
          </p>
        ) : null}
      </section>

      {/* Ce que Catalog ne voit jamais. Une acheteuse a qui on demande son code
          secret doit savoir, avant, que ce n'est jamais nous. */}
      <p class="rounded-field border border-line bg-brand-soft p-3 text-caption text-ink-2">
        Votre code secret ne se tape jamais sur Catalog. Il se saisit dans la session de votre
        operateur, apres l'appel. Nous n'avons aucun champ pour le recevoir, et personne d'ici ne
        vous le demandera.
      </p>

      <button
        type="button"
        data-testid="j-ai-paye"
        onClick={onCompose}
        class="min-h-[var(--size-touch)] rounded-field border border-control-line bg-surface px-4 text-body font-semibold text-ink"
      >
        J'ai fait le transfert
      </button>
    </section>
  );
}

function CarteChemin({
  chemin,
  principal,
  onCompose,
}: {
  chemin: Chemin;
  principal: boolean;
  onCompose: () => void;
}) {
  const manuel = chemin.type === "code_entree";
  return (
    <div
      class="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
      data-testid={`chemin-${chemin.type}`}
    >
      <p class="text-caption font-semibold text-ink-2">{chemin.libelle}</p>
      <p class="rounded-field bg-plane px-3 py-2 font-mono text-body font-bold tracking-wide text-ink break-all">
        {chemin.ussd}
      </p>
      <a
        href={chemin.tel}
        onClick={onCompose}
        data-testid={`composer-${chemin.type}`}
        class={
          principal
            ? "inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-field bg-brand-fill px-5 py-3 text-body font-semibold text-brand-on-fill"
            : "inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-field border border-control-line bg-surface px-5 py-3 text-body font-semibold text-brand-500"
        }
      >
        Composer
      </a>
      <p class="text-caption text-muted">
        {manuel
          ? "Le menu de votre operateur s'ouvre : vous saisissez le numero et le montant vous-meme. C'est le chemin qui ne peut pas echouer."
          : "Le clavier s'ouvre deja rempli : numero et montant sont dedans."}
      </p>
    </div>
  );
}

export default Rampe;
