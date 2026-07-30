import { formatXaf } from "@catalog/contracts/money";
import { MESSAGE_REFUS, type RecuJson, type RefusRecu } from "@catalog/contracts/recu";

/**
 * Le recu, tel qu'il s'affiche.
 *
 * **Catalog n'atteste rien de lui-meme. Il rend la verification POSSIBLE.** Cet
 * ecran ne doit donc jamais ressembler a un certificat : pas de sceau, pas de
 * coche verte triomphante, pas de « garanti ». Ce qu'il montre est un
 * identifiant de transaction, et il dit d'ou vient l'autorite — l'operateur.
 *
 * Le composant est PARTAGE par la page publique `/v/` et la page de suivi de
 * l'acheteuse : deux rendus du meme recu seraient deux occasions d'en affaiblir
 * un.
 */

export interface CarteRecuProps {
  recu: RecuJson;
  /** La phrase qui dit ce que le recu vaut. Elle vient du serveur, une seule fois. */
  portee: string;
}

/** Date lisible en heure de Douala. Une date absente s'affiche comme absente. */
function quand(iso: string | null): string {
  if (!iso) return "non datée";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "non datée";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Douala",
  }).format(d);
}

export function CarteRecu({ recu, portee }: CarteRecuProps) {
  return (
    <article class="flex flex-col gap-4" data-testid="recu">
      <header class="flex flex-col gap-1">
        <p class="text-caption text-ink-2">Reçu de paiement · {recu.boutique}</p>
        <h2 class="text-title font-bold text-ink">Commande {recu.reference}</h2>
      </header>

      {/* L'identifiant AVANT le montant : c'est lui qui se contrôle. */}
      <section class="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <p class="text-caption font-semibold text-ink-2">
          Identifiant de transaction {recu.operateur.nom}
        </p>
        <p
          class="rounded-field bg-plane px-3 py-2 font-mono text-body font-bold tracking-wide text-ink break-all"
          data-testid="identifiant"
        >
          {recu.operatorTxId}
        </p>
        <dl class="flex flex-col gap-1 text-caption text-ink-2">
          <div class="flex justify-between gap-3">
            <dt>Montant</dt>
            <dd class="font-bold text-ink">{formatXaf(recu.montantXaf)}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt>Date du transfert</dt>
            <dd data-testid="survenu">{quand(recu.survenuA)}</dd>
          </div>
          <div class="flex justify-between gap-3">
            {/* Jamais confondue avec la precedente : Catalog CONSTATE, il ne voit
                pas passer le transfert. */}
            <dt>Constaté par Catalog</dt>
            <dd>{quand(recu.constateA)}</dd>
          </div>
          {recu.resteXaf > 0 ? (
            <div class="flex justify-between gap-3">
              <dt>Reste à payer</dt>
              <dd class="font-semibold text-warn">{formatXaf(recu.resteXaf)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section class="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
        <p class="text-caption font-semibold text-ink-2">Confirmation de l'acheteuse</p>
        <p class="text-body text-ink" data-testid="contresignature">
          {recu.contresigneA
            ? `Confirmée le ${quand(recu.contresigneA)}.`
            : "Pas encore confirmée par l'acheteuse."}
        </p>
      </section>

      {recu.aConfirmer ? (
        <p
          data-testid="motif-a-confirmer"
          class="rounded-field border border-warn bg-warn-soft p-3 text-caption text-warn"
        >
          Le format de ce SMS d'opérateur est reconstitué : il n'a pas encore été confronté à un
          message réel. Contrôlez l'identifiant auprès de l'opérateur avant de vous engager.
        </p>
      ) : null}

      {/* La marche a suivre vient de la CONFIGURATION, jamais d'un gabarit. */}
      <section class="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
        <h3 class="text-body font-semibold text-ink">Contrôler auprès de l'opérateur</h3>
        {recu.marcheAsuivre.codeOperateur ? (
          <p
            class="rounded-field bg-plane px-3 py-2 font-mono text-body font-bold text-ink"
            data-testid="code-operateur"
          >
            {recu.marcheAsuivre.codeOperateur}
          </p>
        ) : null}
        <ol class="flex list-decimal flex-col gap-1.5 pl-5 text-caption text-ink-2">
          {recu.marcheAsuivre.etapes.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ol>
        {recu.marcheAsuivre.etapesAConfirmer ? (
          <p class="text-caption text-muted">
            Les intitulés exacts des menus peuvent différer d'un téléphone à l'autre.
          </p>
        ) : null}
        {!recu.marcheAsuivre.codeVerifie && recu.marcheAsuivre.codeOperateur ? (
          <p class="text-caption text-warn">
            Ce code n'a pas été vérifié récemment. En cas de doute, passez en agence.
          </p>
        ) : null}
      </section>

      {/* Ce que le recu vaut. La phrase vient du serveur : elle est ecrite une
          seule fois dans le depot, et trois ecrans l'affichent. */}
      <p class="text-caption text-ink-2" data-testid="portee">
        {portee}
      </p>

      <p class="text-caption text-muted">
        Code de ce reçu : <span class="font-mono font-semibold">{recu.code}</span>
      </p>
    </article>
  );
}

/**
 * L'absence de recu — et elle est EXPLICITE.
 *
 * Une page vide laisserait croire a une panne. Les quatre refus n'appellent pas
 * la meme decision : un code faux, un paiement non prouve et un paiement
 * conteste sont trois situations differentes, et celui qui verifie doit savoir
 * laquelle il a devant lui.
 */
export function CarteRefus({ refus }: { refus: RefusRecu }) {
  const m = MESSAGE_REFUS[refus] ?? MESSAGE_REFUS.code_inconnu;
  return (
    <section
      class="flex flex-col gap-2 rounded-card border border-warn bg-warn-soft p-4"
      data-testid={`refus-${refus}`}
      role="status"
    >
      <h2 class="text-body font-bold text-warn">{m.titre}</h2>
      <p class="text-caption text-ink-2">{m.detail}</p>
    </section>
  );
}

export default CarteRecu;
