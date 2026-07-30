import { formatXaf } from "@catalog/contracts/money";
import { MESSAGE_REFUS, type RecuJson, type RefusRecu } from "@catalog/contracts/recu";
import { Button, Card, CardNote, CardTitle, ErrorState, OfflineState } from "@catalog/ui";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { Protege } from "../components/Protege.tsx";
import { appeler, PanneReseau } from "../lib/api.ts";

/**
 * « Verifier un recu » — l'ecran de la vendeuse.
 *
 * Une acheteuse lui montre un recu, ou lui dicte un code au telephone. Elle doit
 * pouvoir trancher AVANT d'expedier : c'est le moment ou la fraude se joue.
 *
 * Deux regles gouvernent cet ecran :
 *
 * 1. **un refus dit quoi FAIRE**, pas seulement qu'il refuse. « Aucune preuve ne
 *    correspond » sans consigne laisse une vendeuse expedier quand meme — et le
 *    produit n'aura servi a rien ;
 * 2. **jamais « garanti » ni « certifie ».** Ce qui est montre est un identifiant
 *    que l'operateur peut confirmer, pas une signature informatique. La phrase
 *    qui le dit vient du serveur, ecrite une seule fois dans le depot.
 *
 * Le collage n'est jamais bloque : c'est un champ dont l'usage entier est le
 * collage (WCAG 2.2 §3.3.8).
 */

interface Reponse {
  recu?: RecuJson;
  portee?: string;
  refus?: RefusRecu;
}

/**
 * Un code de verification ou un identifiant d'operateur ?
 *
 * Le code fait huit caracteres sur un alphabet sans B, I, L, O, S ni Z. Tout le
 * reste part vers la recherche par identifiant. On ne demande pas a la vendeuse
 * de choisir : elle colle ce qu'elle a.
 */
export function routeDeRecherche(saisie: string): string | null {
  const net = saisie.trim();
  if (!net) return null;
  const compact = net.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[ACDEFGHJKMNPQRTUVWXY34679]{8}$/.test(compact)) return `/api/recu/${compact}`;
  if (compact.length < 6 || compact.length > 64) return null;
  return `/api/recu/identifiant/${encodeURIComponent(compact)}`;
}

export function VerifierRecu() {
  return <Protege>{() => <Ecrans />}</Protege>;
}

function Ecrans() {
  const [saisie, setSaisie] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [horsLigne, setHorsLigne] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [reponse, setReponse] = useState<Reponse | null>(null);

  async function chercher(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setReponse(null);
    const route = routeDeRecherche(saisie);
    if (!route) {
      setErreur("Collez le code du reçu ou l'identifiant de transaction de l'opérateur.");
      return;
    }
    setEnvoi(true);
    try {
      const r = await appeler<Reponse>(route);
      if (r.donnees?.recu || r.donnees?.refus) setReponse(r.donnees);
      // Une recherche sans resultat n'est PAS une erreur technique : c'est une
      // reponse, et elle porte une consigne.
      else setReponse({ refus: "code_inconnu" });
    } catch (cause) {
      if (cause instanceof PanneReseau) setHorsLigne(true);
      else setErreur("La recherche n'a pas abouti. Réessayez.");
    } finally {
      setEnvoi(false);
    }
  }

  const titre = "Vérifier un reçu";

  if (horsLigne) {
    return (
      <Ecran titre={titre} surtitre="Preuve">
        <OfflineState
          action={
            <Button tone="outline" onClick={() => setHorsLigne(false)}>
              Réessayer
            </Button>
          }
        >
          {/* Ne pas pouvoir verifier n'est ni une preuve ni une infirmation. */}
          Sans réseau, nous ne pouvons rien vérifier — et cela ne dit rien du paiement. Dans le
          doute, n'expédiez pas.
        </OfflineState>
      </Ecran>
    );
  }

  return (
    <Ecran
      titre={titre}
      surtitre="Preuve"
      actions={
        <Button tone="ghost" render={<Link to="/" />}>
          Retour
        </Button>
      }
    >
      <Card>
        <CardTitle>Le code ou l'identifiant</CardTitle>
        <CardNote>
          Collez le code du reçu qu'on vous montre (huit caractères), ou l'identifiant de
          transaction inscrit dessus.
        </CardNote>
        <form onSubmit={chercher} noValidate className="flex flex-col gap-4">
          <label htmlFor="recherche-recu" className="text-caption font-semibold text-ink-2">
            Code du reçu ou identifiant de transaction
          </label>
          {/* Le collage n'est JAMAIS bloque : c'est l'usage entier de ce champ. */}
          <input
            id="recherche-recu"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            disabled={envoi}
            autoComplete="off"
            spellCheck={false}
            className="min-h-[var(--size-touch)] w-full rounded-field border border-control-line bg-surface px-3 font-mono text-body text-ink"
          />
          <p role="status" aria-live="polite" className="text-caption text-danger">
            {erreur}
          </p>
          <Button type="submit" size="lg" disabled={envoi}>
            {envoi ? "Recherche…" : "Vérifier"}
          </Button>
        </form>
      </Card>

      {reponse?.recu ? <Authentique recu={reponse.recu} portee={reponse.portee ?? ""} /> : null}
      {reponse?.refus ? <Aucune refus={reponse.refus} /> : null}
    </Ecran>
  );
}

function Authentique({ recu, portee }: { recu: RecuJson; portee: string }) {
  return (
    <Card>
      <CardTitle data-testid="verdict-recu">Preuve authentique</CardTitle>
      <p className="font-mono text-title font-bold text-ink" data-testid="identifiant">
        {recu.operatorTxId}
      </p>
      <dl className="flex flex-col gap-1 text-caption text-ink-2">
        <div className="flex justify-between gap-3">
          <dt>Opérateur</dt>
          <dd className="text-ink">{recu.operateur.nom}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Montant</dt>
          <dd className="font-bold text-ink">{formatXaf(recu.montantXaf)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Commande</dt>
          <dd className="text-ink">{recu.reference}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Confirmé par l'acheteuse</dt>
          <dd className="text-ink">{recu.contresigneA ? "oui" : "pas encore"}</dd>
        </div>
        {recu.resteXaf > 0 ? (
          <div className="flex justify-between gap-3">
            <dt>Reste à payer</dt>
            <dd className="font-semibold text-warn">{formatXaf(recu.resteXaf)}</dd>
          </div>
        ) : null}
      </dl>
      {recu.aConfirmer ? (
        <p
          data-testid="motif-a-confirmer"
          className="rounded-field border border-warn bg-warn-soft p-3 text-caption text-warn"
        >
          Le format de ce SMS d'opérateur est reconstitué. Contrôlez l'identifiant auprès de
          l'opérateur avant d'expédier.
        </p>
      ) : null}
      <CardNote>{portee}</CardNote>
    </Card>
  );
}

/**
 * Aucune preuve ne correspond — et la consigne va avec.
 *
 * C'est le seul ecran du produit ou une vendeuse decide d'expedier ou non. Un
 * refus muet la laisserait expedier quand meme.
 */
function Aucune({ refus }: { refus: RefusRecu }) {
  const m = MESSAGE_REFUS[refus] ?? MESSAGE_REFUS.code_inconnu;
  return (
    <ErrorState action={null}>
      <span data-testid="verdict-recu">Aucune preuve ne correspond — {m.titre}</span>
      <br />
      {m.detail}
      <br />
      <strong>N'expédiez pas tant que le paiement n'est pas prouvé.</strong>
    </ErrorState>
  );
}

export default VerifierRecu;
