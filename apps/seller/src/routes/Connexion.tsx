import { normalizePhone } from "@catalog/contracts";
import { Button, Card, CardNote, CardTitle, Field, Input, OfflineState } from "@catalog/ui";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { api, messageDErreur, PanneReseau } from "../lib/api.ts";

/**
 * Saisie du numero de connexion.
 *
 * **Il n'y a pas de mot de passe, et il n'y a pas d'e-mail.** Le numero est le
 * seul facteur. Il n'y a pas non plus d'ecran d'inscription separe : une vendeuse
 * entre son numero, recoit un code, et elle est dedans — l'API cree le compte a
 * la premiere verification reussie.
 *
 * La saisie est TOLERANTE. « 6 77 12 34 56 », « 677123456 », « 237677123456 » et
 * « +237 677 12 34 56 » sont la meme chose, et `normalizePhone` de
 * `packages/contracts` en fait foi — on ne reecrit pas la regle ici. Refuser une
 * mise en forme est un echec de produit : personne n'ecrit son numero en E.164.
 */
export function Connexion() {
  const naviguer = useNavigate();
  const [saisie, setSaisie] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const numero = normalizePhone(saisie);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    if (!numero) {
      setErreur("Ce numero ne ressemble pas a un numero camerounais.");
      return;
    }
    setEnvoiEnCours(true);
    try {
      const r = await api.envoyerCodeConnexion(numero);
      if (!r.ok) {
        setErreur(messageDErreur(r, "L'envoi du code n'a pas abouti. Reessayez."));
        return;
      }
      naviguer(`/connexion/code?numero=${encodeURIComponent(numero)}`);
    } catch (cause) {
      if (cause instanceof PanneReseau) setHorsLigne(true);
      else setErreur("L'envoi du code n'a pas abouti. Reessayez.");
    } finally {
      setEnvoiEnCours(false);
    }
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
          Le code arrive par SMS, mais la demande a besoin du reseau. Des qu'il revient, reprenez
          ici.
        </OfflineState>
      </Ecran>
    );
  }

  return (
    <Ecran titre="Connexion">
      <Card>
        <CardTitle>Votre numero</CardTitle>
        <CardNote>
          Nous vous envoyons un code a six chiffres par SMS. Pas de mot de passe a retenir.
        </CardNote>
        <form onSubmit={soumettre} noValidate className="flex flex-col gap-4">
          <Field
            label="Numero de telephone"
            htmlFor="numero"
            hint="Ecrivez-le comme vous voulez : 677 12 34 56, 237677123456, +237 677 12 34 56."
          >
            <Input
              id="numero"
              name="numero"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              aria-invalid={erreur ? true : undefined}
              aria-describedby="numero-hint numero-err"
              placeholder="677 12 34 56"
            />
          </Field>

          {/* Poli : la vendeuse est peut-etre encore en train de taper. */}
          <p id="numero-err" role="status" aria-live="polite" className="text-caption text-danger">
            {erreur}
          </p>

          <Button type="submit" size="lg" disabled={envoiEnCours}>
            {envoiEnCours ? "Envoi du code…" : "Recevoir le code"}
          </Button>
        </form>
      </Card>
    </Ecran>
  );
}
