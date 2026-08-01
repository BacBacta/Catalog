import { Button, Card, CardNote, CardTitle, OfflineState, OtpField } from "@catalog/ui";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { api, messageDErreur, PanneReseau } from "../lib/api.ts";
import { destinationApresConnexion } from "../lib/cle.ts";
import { useSession } from "../lib/session.tsx";

/**
 * Saisie du code recu par SMS.
 *
 * Le champ vient de `OtpField` du design system, et c'est la que vit la regle
 * non negociable : `autocomplete="one-time-code"`, et le collage jamais bloque
 * (WCAG 2.2 §3.3.8). Cet ecran ne fait que l'entourer.
 *
 * Le numero circule dans l'URL, pas dans un etat de navigation : une vendeuse qui
 * recharge la page pendant qu'elle cherche le SMS dans ses messages ne doit pas
 * retomber au debut. Le numero n'est pas un secret — le code l'est, et il n'y est
 * pas.
 */
export function CodeConnexion() {
  const naviguer = useNavigate();
  const { rafraichir } = useSession();
  const [params] = useSearchParams();
  const numero = params.get("numero") ?? "";

  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [renvoye, setRenvoye] = useState<string | null>(null);

  async function verifier(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    if (code.length !== 6) {
      setErreur("Le code fait six chiffres.");
      return;
    }
    setEnCours(true);
    try {
      const r = await api.verifierCodeConnexion(numero, code);
      if (!r.ok) {
        setErreur(messageDErreur(r, "Ce code ne correspond pas. Verifiez le SMS."));
        return;
      }
      // La session est relue AVANT de naviguer. Sans cela, l'ecran d'accueil se
      // fierait a l'etat charge a l'ouverture de l'application — « anonyme » —
      // et renverrait la vendeuse sur la connexion qu'elle vient de reussir.
      await rafraichir();
      naviguer(destinationApresConnexion(), { replace: true });
    } catch (cause) {
      if (cause instanceof PanneReseau) setHorsLigne(true);
      else setErreur("La verification n'a pas abouti. Reessayez.");
    } finally {
      setEnCours(false);
    }
  }

  async function renvoyer() {
    setErreur(null);
    setRenvoye(null);
    try {
      const r = await api.envoyerCodeConnexion(numero);
      if (!r.ok) {
        setErreur(messageDErreur(r, "Le renvoi n'a pas abouti."));
        return;
      }
      setRenvoye("Un nouveau code est parti.");
    } catch (cause) {
      if (cause instanceof PanneReseau) setHorsLigne(true);
    }
  }

  if (!numero) {
    return (
      <Ecran titre="Connexion">
        <Card>
          <CardTitle>Reprenons au debut</CardTitle>
          <CardNote>Nous ne savons plus a quel numero le code a ete envoye.</CardNote>
          <Button render={<Link to="/connexion" />} size="lg">
            Saisir mon numero
          </Button>
        </Card>
      </Ecran>
    );
  }

  if (horsLigne) {
    return (
      <Ecran titre="Connexion">
        <OfflineState
          action={
            <Button tone="outline" onClick={() => setHorsLigne(false)}>
              Reessayer
            </Button>
          }
        >
          Votre code reste valable cinq minutes. Des que le reseau revient, saisissez-le ici.
        </OfflineState>
      </Ecran>
    );
  }

  return (
    <Ecran titre="Votre code" surtitre="Connexion">
      <Card>
        <CardNote>
          Un SMS est parti au <strong className="text-ink">{numero}</strong>. Il arrive en general
          en quelques secondes.
        </CardNote>
        <form onSubmit={verifier} noValidate className="flex flex-col gap-4">
          <OtpField value={code} onValueChange={setCode} erreur={erreur} autoFocus />
          <Button type="submit" size="lg" disabled={enCours}>
            {enCours ? "Verification…" : "Me connecter"}
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button tone="ghost" onClick={renvoyer}>
            Je n'ai rien recu
          </Button>
          <Button tone="ghost" render={<Link to="/connexion" />}>
            Changer de numero
          </Button>
        </div>
        <p role="status" aria-live="polite" className="text-caption text-good">
          {renvoye}
        </p>
      </Card>
    </Ecran>
  );
}
