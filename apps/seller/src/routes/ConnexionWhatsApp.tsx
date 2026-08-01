import { Button, Card, CardNote, CardTitle, OfflineState } from "@catalog/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { api, PanneReseau } from "../lib/api.ts";
import { destinationApresConnexion } from "../lib/cle.ts";

/**
 * L'attente de la connexion par WhatsApp — ADR 0027.
 *
 * L'ecran precedent a cree le defi ; celui-ci porte le bouton qui ouvre
 * WhatsApp avec le message pre-rempli, puis SONDE le statut. La vendeuse ne
 * recopie rien : elle envoie le message, et cet ecran se connecte tout seul.
 *
 * Le sondage interroge `attente` (GET, par `suivi`) et n'echange le `jeton`
 * — la seule cle qui vaille une session — que lorsque le defi est verifie.
 * L'intervalle de 3 s tient le sondage sous la famille `lecture` du limiteur
 * de debit ; plus court, il se ferait jeter.
 */

interface EtatDefi {
  jeton: string;
  suivi: string;
  code: string;
  lien: string;
  expireDansS: number;
}

const INTERVALLE_SONDAGE_MS = 3000;

export function ConnexionWhatsApp() {
  const naviguer = useNavigate();
  const { state } = useLocation();
  const defi = (state ?? null) as EtatDefi | null;

  const [restantS, setRestantS] = useState(defi?.expireDansS ?? 0);
  const [phase, setPhase] = useState<"attente" | "echange" | "expire" | "horsLigne">("attente");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  /** Sans defi — arrivee directe sur l'URL — on repart au debut, sans erreur. */
  useEffect(() => {
    if (!defi) naviguer("/connexion", { replace: true });
  }, [defi, naviguer]);

  const echanger = useCallback(async () => {
    if (!defi) return;
    setPhase("echange");
    try {
      const r = await api.echangerDefiWhatsapp(defi.jeton);
      if (r.ok && r.donnees?.statut === "connecte") {
        naviguer(destinationApresConnexion(), { replace: true });
        return;
      }
      // Un concurrent a consomme, ou le defi a expire entre deux sondages.
      setPhase(r.donnees?.statut === "en_attente" ? "attente" : "expire");
    } catch (cause) {
      if (cause instanceof PanneReseau) setPhase("horsLigne");
      else setPhase("expire");
    }
  }, [defi, naviguer]);

  /* Le sondage. Il s'arrete de lui-meme hors de la phase d'attente. */
  useEffect(() => {
    if (!defi || phase !== "attente") return;
    const minuterie = setInterval(async () => {
      try {
        const r = await api.attenteDefiWhatsapp(defi.suivi);
        if (phaseRef.current !== "attente") return;
        if (r.ok && r.donnees?.statut === "verifie") void echanger();
        else if (r.ok && r.donnees?.statut === "inconnu") setPhase("expire");
      } catch (cause) {
        if (cause instanceof PanneReseau && phaseRef.current === "attente") setPhase("horsLigne");
      }
    }, INTERVALLE_SONDAGE_MS);
    return () => clearInterval(minuterie);
  }, [defi, phase, echanger]);

  /* Le compte a rebours, purement informatif : le serveur fait foi. */
  useEffect(() => {
    if (phase !== "attente") return;
    const minuterie = setInterval(() => {
      setRestantS((s) => {
        if (s <= 1) {
          setPhase("expire");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(minuterie);
  }, [phase]);

  if (!defi) return null;

  if (phase === "horsLigne") {
    return (
      <Ecran titre="Connexion">
        <OfflineState
          action={
            <Button tone="outline" onClick={() => setPhase("attente")}>
              Reessayer
            </Button>
          }
        />
      </Ecran>
    );
  }

  if (phase === "expire") {
    return (
      <Ecran titre="Connexion">
        <Card>
          <CardTitle>Ce lien a expire</CardTitle>
          <CardNote>
            Un lien de connexion ne vit que cinq minutes. Rien de grave : reprenez, un nouveau
            message sera prepare.
          </CardNote>
          <Button size="lg" onClick={() => naviguer("/connexion", { replace: true })}>
            Reprendre
          </Button>
        </Card>
      </Ecran>
    );
  }

  const minutes = Math.floor(restantS / 60);
  const secondes = String(restantS % 60).padStart(2, "0");

  return (
    <Ecran titre="Connexion">
      <Card>
        <CardTitle>Envoyez le message WhatsApp</CardTitle>
        <CardNote>
          WhatsApp s'ouvre avec un message deja ecrit. Envoyez-le tel quel : des qu'il arrive, vous
          etes connectee — en general moins de deux secondes. Rien a recopier.
        </CardNote>

        {/* Une ancre, pas un bouton : ouvrir WhatsApp est une navigation. */}
        <Button size="lg" render={<a href={defi.lien} target="_blank" rel="noreferrer" />}>
          Ouvrir WhatsApp
        </Button>

        <p role="status" aria-live="polite" className="text-caption text-ink-2">
          En attente de votre message… Ce lien expire dans {minutes}:{secondes}.
        </p>

        <Button tone="outline" onClick={() => naviguer("/connexion", { replace: true })}>
          Annuler
        </Button>
      </Card>
    </Ecran>
  );
}
