import { normalizePhone } from "@catalog/contracts";
import {
  Button,
  Card,
  CardNote,
  CardTitle,
  Field,
  Input,
  OfflineState,
  OtpField,
} from "@catalog/ui";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { Protege } from "../components/Protege.tsx";
import { api, messageDErreur, PanneReseau, type Vendeuse } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";

/**
 * Reglage du numero de reversement.
 *
 * **C'est l'ecran le plus sensible du produit.** C'est la que l'argent arrive, et
 * c'est donc le champ qu'un attaquant chercherait a detourner. Deux consequences
 * visibles ici :
 *
 * 1. **Le code part au NOUVEAU numero**, pas a l'ancien. L'ecran le dit
 *    explicitement, parce que la vendeuse doit avoir la puce en main : c'est
 *    exactement ce que la verification prouve.
 * 2. **Le changement se fait en deux temps**, et l'ecran ne les cache pas. Une
 *    interface qui enchainerait tout seule laisserait croire que le numero a
 *    bouge alors que le code n'est pas encore saisi.
 *
 * La double SIM est la norme : ce numero n'a aucune raison d'etre celui de la
 * connexion, et l'ecran ne le suggere pas.
 */
export function Reversement() {
  return <Protege>{(v) => <Formulaire vendeuse={v} />}</Protege>;
}

type Etape = { nom: "numero" } | { nom: "code"; numero: string };

function Formulaire({ vendeuse }: { vendeuse: Vendeuse }) {
  const naviguer = useNavigate();
  const { rafraichir } = useSession();
  const actuel = vendeuse.seller?.payoutPhone ?? null;

  const [etape, setEtape] = useState<Etape>({ nom: "numero" });
  const [saisie, setSaisie] = useState("");
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [enCours, setEnCours] = useState(false);

  async function demanderCode(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    const numero = normalizePhone(saisie);
    if (!numero) {
      setErreur("Ce numero ne ressemble pas a un numero camerounais.");
      return;
    }
    setEnCours(true);
    try {
      const r = await api.envoyerCodeReversement(numero);
      if (!r.ok) {
        setErreur(messageDErreur(r, "L'envoi du code n'a pas abouti. Reessayez."));
        return;
      }
      setCode("");
      setEtape({ nom: "code", numero });
    } catch (cause) {
      if (cause instanceof PanneReseau) setHorsLigne(true);
      else setErreur("L'envoi du code n'a pas abouti. Reessayez.");
    } finally {
      setEnCours(false);
    }
  }

  async function confirmer(e: React.FormEvent) {
    e.preventDefault();
    if (etape.nom !== "code") return;
    setErreur(null);
    if (code.length !== 6) {
      setErreur("Le code fait six chiffres.");
      return;
    }
    setEnCours(true);
    try {
      const r = await api.changerReversement(etape.numero, code);
      if (!r.ok) {
        setErreur(messageDErreur(r, "Ce code ne correspond pas. Verifiez le SMS."));
        return;
      }
      await rafraichir();
      naviguer("/", { replace: true });
    } catch (cause) {
      if (cause instanceof PanneReseau) setHorsLigne(true);
      else setErreur("La confirmation n'a pas abouti. Reessayez.");
    } finally {
      setEnCours(false);
    }
  }

  if (horsLigne) {
    return (
      <Ecran titre="Numero de reversement">
        <OfflineState
          action={
            <Button tone="outline" onClick={() => setHorsLigne(false)}>
              Reessayer
            </Button>
          }
        >
          Rien n'a change. Votre numero de reversement actuel reste celui qui est enregistre.
        </OfflineState>
      </Ecran>
    );
  }

  return (
    <Ecran
      titre="Numero de reversement"
      surtitre="Reglages"
      actions={
        <Button tone="ghost" render={<Link to="/" />}>
          Retour
        </Button>
      }
    >
      <Card>
        <CardTitle>C'est la que l'argent arrive</CardTitle>
        <CardNote>
          Ce numero n'a pas besoin d'etre celui de votre connexion. Beaucoup de vendeuses se
          connectent avec une puce et se font payer sur l'autre — c'est prevu.
        </CardNote>
        <CardNote>
          Numero actuel :{" "}
          <span data-testid="reversement-actuel" className="font-mono text-ink">
            {actuel ?? "aucun"}
          </span>
        </CardNote>
      </Card>

      {etape.nom === "numero" ? (
        <Card>
          <form onSubmit={demanderCode} noValidate className="flex flex-col gap-4">
            <Field
              label="Nouveau numero de reversement"
              htmlFor="reversement"
              hint="Nous envoyons un code A CE NUMERO : vous devez avoir la puce sous la main."
            >
              <Input
                id="reversement"
                name="reversement"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                aria-invalid={erreur ? true : undefined}
                aria-describedby="reversement-hint reversement-err"
                placeholder="699 12 34 56"
              />
            </Field>
            <p
              id="reversement-err"
              role="status"
              aria-live="polite"
              className="text-caption text-danger"
            >
              {erreur}
            </p>
            <Button type="submit" size="lg" disabled={enCours}>
              {enCours ? "Envoi du code…" : "Recevoir le code"}
            </Button>
          </form>
        </Card>
      ) : (
        <Card>
          <CardNote>
            Un SMS est parti au <strong className="text-ink">{etape.numero}</strong>. Tant que le
            code n'est pas saisi, rien n'a change.
          </CardNote>
          <form onSubmit={confirmer} noValidate className="flex flex-col gap-4">
            <OtpField
              value={code}
              onValueChange={setCode}
              erreur={erreur}
              label="Code reçu sur le nouveau numéro"
              autoFocus
            />
            <Button type="submit" size="lg" disabled={enCours}>
              {enCours ? "Confirmation…" : "Confirmer ce numero"}
            </Button>
          </form>
          <Button
            tone="ghost"
            onClick={() => {
              setErreur(null);
              setEtape({ nom: "numero" });
            }}
          >
            Corriger le numero
          </Button>
        </Card>
      )}
    </Ecran>
  );
}
