import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, PanneReseau, type Vendeuse } from "./api.ts";

/**
 * La session vendeuse, cote client.
 *
 * Trois etats, et le troisieme est celui qu'on oublie :
 *
 * - `chargement` — on ne sait pas encore. Afficher l'ecran de connexion ici
 *   ferait clignoter la page a chaque ouverture de l'application.
 * - `connectee` / `anonyme` — l'API a repondu.
 * - `horsLigne` — l'API n'a pas repondu. Ce n'est **pas** « anonyme » : mettre
 *   une vendeuse dehors parce que son reseau a coupe lui ferait redemander un SMS
 *   qu'elle n'a pas besoin de recevoir. AGENTS.md exige cet etat sur chaque ecran.
 *
 * La session vit dans un cookie pose par l'API. On ne stocke aucun jeton en
 * `localStorage` : un jeton lisible par du script est un jeton exfiltrable.
 */

export type EtatSession =
  | { etat: "chargement" }
  | { etat: "connectee"; vendeuse: Vendeuse }
  | { etat: "anonyme" }
  | { etat: "horsLigne" };

interface Contexte {
  session: EtatSession;
  rafraichir: () => Promise<void>;
  deconnecter: () => Promise<void>;
}

const Ctx = createContext<Contexte | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<EtatSession>({ etat: "chargement" });

  const rafraichir = useCallback(async () => {
    try {
      const r = await api.moi();
      if (r.ok && r.donnees) setSession({ etat: "connectee", vendeuse: r.donnees });
      else setSession({ etat: "anonyme" });
    } catch (cause) {
      setSession(cause instanceof PanneReseau ? { etat: "horsLigne" } : { etat: "anonyme" });
    }
  }, []);

  const deconnecter = useCallback(async () => {
    try {
      await api.deconnexion();
    } finally {
      setSession({ etat: "anonyme" });
    }
  }, []);

  useEffect(() => {
    void rafraichir();
  }, [rafraichir]);

  return <Ctx.Provider value={{ session, rafraichir, deconnecter }}>{children}</Ctx.Provider>;
}

export function useSession(): Contexte {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession hors de SessionProvider");
  return c;
}
