import { Button, Card, CardNote, CardTitle, OfflineState } from "@catalog/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { CadreConnexion } from "../components/CadreConnexion.tsx";
import { api, PanneReseau } from "../lib/api.ts";
import { destinationApresConnexion } from "../lib/cle.ts";
import { type DefiWhatsApp, enMinutesSecondes, secondesRestantes } from "../lib/defi-attente.ts";

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
 *
 * ── Deux lecons du banc du 13/08/2026 ────────────────────────────────────
 *
 * 1. **L'etat de navigation survit au rechargement** (`history.state`). Cet
 *    ecran repartait alors a `expireDansS` : 5:00 tout neuf sur un code mort.
 *    Le restant se RECALCULE desormais depuis l'instant de creation, et un
 *    defi deja echu s'affiche expire des le montage. Recharger ne redonne
 *    jamais de temps ; seul « Preparer un nouveau message » en donne.
 * 2. **Le premier sondage part immediatement**, pas trois secondes plus tard.
 *    Une page rouverte apres l'envoi se connecte aussitot, et un defi que le
 *    serveur ne connait plus se dit expire aussitot — c'est la reponse du
 *    serveur qui tranche, jamais une supposition d'ici.
 */

const INTERVALLE_SONDAGE_MS = 3000;

export function ConnexionWhatsApp() {
  const naviguer = useNavigate();
  const { state } = useLocation();

  /**
   * L'etat de navigation n'est qu'une GRAINE : « Preparer un nouveau message »
   * remplace le defi sur place, sans renvoyer la vendeuse a l'ecran precedent.
   */
  const [defi, setDefi] = useState<DefiWhatsApp | null>((state ?? null) as DefiWhatsApp | null);
  const [restantS, setRestantS] = useState(() => (defi ? secondesRestantes(defi, Date.now()) : 0));
  const [phase, setPhase] = useState<"attente" | "echange" | "expire" | "horsLigne">(() =>
    defi && secondesRestantes(defi, Date.now()) <= 0 ? "expire" : "attente",
  );
  const [relance, setRelance] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  /** Sans defi — arrivee directe sur l'URL — on repart au debut, sans erreur. */
  useEffect(() => {
    if (!defi) naviguer("/connexion", { replace: true });
  }, [defi, naviguer]);

  const echanger = useCallback(
    async (jeton: string) => {
      setPhase("echange");
      try {
        const r = await api.echangerDefiWhatsapp(jeton);
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
    },
    [naviguer],
  );

  /* Le sondage. Il s'arrete de lui-meme hors de la phase d'attente. */
  useEffect(() => {
    if (!defi || phase !== "attente") return;
    let vivant = true;
    const sonder = async () => {
      try {
        const r = await api.attenteDefiWhatsapp(defi.suivi);
        if (!vivant || phaseRef.current !== "attente") return;
        if (r.ok && r.donnees?.statut === "verifie") void echanger(defi.jeton);
        else if (r.ok && r.donnees?.statut === "inconnu") setPhase("expire");
      } catch (cause) {
        if (cause instanceof PanneReseau && phaseRef.current === "attente") setPhase("horsLigne");
      }
    };
    void sonder(); // des le montage — voir la lecon 2 en tete de fichier
    const minuterie = setInterval(() => void sonder(), INTERVALLE_SONDAGE_MS);
    return () => {
      vivant = false;
      clearInterval(minuterie);
    };
  }, [defi, phase, echanger]);

  /**
   * Le compte a rebours. Il se RECALCULE depuis l'echeance a chaque tour : un
   * onglet mis en arriere-plan voit ses minuteries bridees, et un compteur qui
   * se decremente aurait derive. Le serveur fait foi de toute facon.
   */
  useEffect(() => {
    if (!defi || phase !== "attente") return;
    const minuterie = setInterval(() => {
      const restant = secondesRestantes(defi, Date.now());
      setRestantS(restant);
      if (restant <= 0) setPhase("expire");
    }, 1000);
    return () => clearInterval(minuterie);
  }, [defi, phase]);

  /**
   * Un code neuf en un seul geste.
   *
   * C'est le vrai remede au piege du 13/08 : la vendeuse bloquee reappuyait
   * sur un ancien message du fil, qui ne vaut plus rien. Ici, le message
   * prepare est toujours celui du defi courant.
   */
  async function reprendre() {
    setRelance(true);
    try {
      const r = await api.creerDefiWhatsapp();
      if (r.ok && r.donnees) {
        const neuf: DefiWhatsApp = { ...r.donnees, creeA: Date.now() };
        naviguer("/connexion/whatsapp", { replace: true, state: neuf });
        setDefi(neuf);
        setRestantS(neuf.expireDansS);
        setPhase("attente");
        setRelance(false);
        return;
      }
    } catch {
      /* L'ecran de connexion sait tout redire — panne reseau comprise. */
    }
    naviguer("/connexion", { replace: true });
  }

  if (!defi) return null;

  if (phase === "horsLigne") {
    return (
      <CadreConnexion titre="Connexion">
        <OfflineState
          action={
            <Button tone="outline" onClick={() => setPhase("attente")}>
              Reessayer
            </Button>
          }
        />
      </CadreConnexion>
    );
  }

  if (phase === "expire") {
    return (
      <CadreConnexion titre="Connexion">
        <Card>
          <CardTitle>Ce lien a expire</CardTitle>
          <CardNote>
            Un lien de connexion ne vit que cinq minutes. Le message deja envoye ne compte plus, et
            le renvoyer ne changerait rien : demandez un nouveau message, il portera un nouveau
            code.
          </CardNote>
          <Button size="lg" onClick={() => void reprendre()} loading={relance}>
            {relance ? "Preparation…" : "Preparer un nouveau message"}
          </Button>
          <Button tone="outline" onClick={() => naviguer("/connexion", { replace: true })}>
            Revenir
          </Button>
        </Card>
      </CadreConnexion>
    );
  }

  return (
    <CadreConnexion titre="Connexion">
      <Card>
        <CardTitle>Envoyez le message WhatsApp</CardTitle>
        <CardNote>
          WhatsApp s'ouvre avec un message deja ecrit. Envoyez-le tel quel : des qu'il arrive, vous
          etes connectee — en general moins de deux secondes. Rien a recopier, et un ancien message
          du fil ne vaut plus rien : le code change a chaque fois.
        </CardNote>

        {/* Une ancre, pas un bouton : ouvrir WhatsApp est une navigation. */}
        <Button size="lg" render={<a href={defi.lien} target="_blank" rel="noreferrer" />}>
          Ouvrir WhatsApp
        </Button>

        <p role="status" aria-live="polite" className="text-caption text-ink-2">
          {phase === "echange"
            ? "Message recu — connexion en cours…"
            : `En attente de votre message… Ce lien expire dans ${enMinutesSecondes(restantS)}.`}
        </p>

        <Button tone="outline" onClick={() => naviguer("/connexion", { replace: true })}>
          Annuler
        </Button>
      </Card>
    </CadreConnexion>
  );
}
