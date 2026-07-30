import { Button, LoadingState, OfflineState } from "@catalog/ui";
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import type { Vendeuse } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";
import { Ecran } from "./Ecran.tsx";

/**
 * Garde d'ecran authentifie.
 *
 * **Hors ligne n'est pas anonyme.** C'est la seule subtilite du composant, et
 * elle compte : rediriger vers la connexion parce que la requete de session a
 * echoue enverrait une vendeuse demander un SMS alors que sa session est valide
 * et que c'est son reseau qui a coupe. Elle paierait le SMS de son cote, et
 * l'operateur aussi.
 *
 * La garde cote client n'est PAS la securite : l'API refuse en 401 de toute
 * facon. Elle sert le confort, et rien d'autre ne doit reposer sur elle.
 */
export function Protege({ children }: { children: (v: Vendeuse) => ReactNode }) {
  const { session, rafraichir } = useSession();

  if (session.etat === "chargement") {
    return (
      <Ecran titre="Espace vendeuse">
        <LoadingState label="Ouverture de votre espace…" />
      </Ecran>
    );
  }

  if (session.etat === "horsLigne") {
    return (
      <Ecran titre="Espace vendeuse">
        <OfflineState
          action={
            <Button tone="outline" onClick={() => void rafraichir()}>
              Reessayer
            </Button>
          }
        >
          Vous restez connectee. Nous n'arrivons simplement pas a joindre le service pour l'instant.
        </OfflineState>
      </Ecran>
    );
  }

  if (session.etat === "anonyme") return <Navigate to="/connexion" replace />;

  return <>{children(session.vendeuse)}</>;
}
