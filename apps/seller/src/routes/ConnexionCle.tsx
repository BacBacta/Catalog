import { Button, Card, CardNote, CardTitle } from "@catalog/ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import {
  marquerProposition,
  scellerAppareil,
  serveurCleActif,
  webAuthnDisponible,
} from "../lib/cle.ts";

/**
 * La proposition de scellement — ADR 0028. Elle arrive UNE fois, juste apres
 * une connexion reussie, et jamais plus : un « Plus tard » vaut reponse.
 *
 * L'ecran s'eclipse tout seul quand il n'a rien a proposer : navigateur sans
 * WebAuthn, ou plugin ferme cote serveur (pas de PASSKEY_RP_ID tant que le
 * domaine definitif n'existe pas). La vendeuse ne voit alors jamais cette
 * etape — elle atterrit sur son tableau de bord comme avant.
 */
export function ConnexionCle() {
  const naviguer = useNavigate();
  const [phase, setPhase] = useState<"verif" | "proposition" | "scellement" | "fait">("verif");

  useEffect(() => {
    if (phase !== "verif") return;
    let vivant = true;
    (async () => {
      const possible = webAuthnDisponible() && (await serveurCleActif());
      if (!vivant) return;
      if (possible) {
        setPhase("proposition");
      } else {
        marquerProposition();
        naviguer("/", { replace: true });
      }
    })();
    return () => {
      vivant = false;
    };
  }, [phase, naviguer]);

  async function activer() {
    setPhase("scellement");
    const r = await scellerAppareil();
    marquerProposition();
    if (r === "ok") setPhase("fait");
    else naviguer("/", { replace: true }); // geste annule : pas une erreur
  }

  function plusTard() {
    marquerProposition();
    naviguer("/", { replace: true });
  }

  if (phase === "verif") return null;

  if (phase === "fait") {
    return (
      <Ecran titre="C'est active">
        <Card>
          <CardTitle>Double ancrage</CardTitle>
          <CardNote>
            Votre numero est verifie, et ce telephone est scelle par votre empreinte. La prochaine
            connexion tiendra en une seconde — meme sans credit, meme sans reseau. Vos appareils se
            gerent dans Reglages.
          </CardNote>
          <Button size="lg" onClick={() => naviguer("/", { replace: true })}>
            Continuer
          </Button>
        </Card>
      </Ecran>
    );
  }

  return (
    <Ecran titre="Connexion">
      <Card>
        <CardTitle>Se reconnecter sans code ?</CardTitle>
        <CardNote>
          La prochaine fois, votre empreinte ou votre schema suffira. Plus besoin d'attendre un
          message — meme sans credit, meme sans reseau operateur.
        </CardNote>
        <Button size="lg" onClick={activer} disabled={phase === "scellement"}>
          {phase === "scellement" ? "Suivez l'ecran du telephone…" : "Activer — deux secondes"}
        </Button>
        <Button tone="ghost" onClick={plusTard}>
          Plus tard
        </Button>
      </Card>
    </Ecran>
  );
}
