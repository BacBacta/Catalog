import { Button } from "@catalog/ui";
import { useState } from "react";
import { api, messageDErreur } from "../lib/api.ts";

/**
 * Le mode conges, rendu VISIBLE — ADR 0039, revise par l'ADR 0056.
 *
 * ── Le defaut que ce module corrige ────────────────────────────────────────
 *
 * La bascule existait, elle marchait, et elle vivait dans `Reglages` — un
 * ecran qu'on ouvre quand on cherche quelque chose. Or une boutique fermee
 * n'est pas quelque chose qu'on cherche : c'est quelque chose qu'on OUBLIE.
 *
 * Et l'oubli est cher, dans un seul sens. Une vendeuse qui ferme pour trois
 * jours et rouvre le quatrieme ne perd rien. Une vendeuse qui oublie de
 * rouvrir perd **toutes** ses ventes, sans un signe : le lien fonctionne, le
 * catalogue s'affiche, les acheteuses ecrivent — et se voient refuser au
 * dernier verrou, celui de la creation de commande. Cote vendeuse, ca ne
 * ressemble a rien du tout. Ca ressemble a « personne n'achete ».
 *
 * D'ou la regle de ce module : **l'etat ferme se dit sur l'ecran d'accueil**,
 * en haut, avec le geste de retour a portee de pouce. L'etat ouvert, lui, ne
 * dit rien — un bandeau permanent qui annonce que tout va bien devient un
 * meuble, et on cesse de le voir le jour ou il compte.
 *
 * ── Pourquoi un module commun ──────────────────────────────────────────────
 *
 * Deux surfaces portent maintenant la bascule : l'accueil et les reglages. La
 * requete, l'etat local et le message d'erreur vivent ici une seule fois —
 * sinon les deux derivent, et c'est toujours celle qu'on ne teste pas qui se
 * met a mentir.
 */
export function useConges(depuis: string | null) {
  const [ferme, setFerme] = useState(depuis !== null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function basculer() {
    setErreur(null);
    setEnCours(true);
    const r = await api.basculerConges(!ferme);
    setEnCours(false);
    if (!r.ok) {
      setErreur(messageDErreur(r, "La bascule n'a pas abouti."));
      return;
    }
    setFerme(r.donnees?.congesDepuis != null);
  }

  return { ferme, enCours, erreur, basculer };
}

/** « depuis mardi » — la duree se lit d'un coup d'oeil, la date se compte. */
function depuisQuand(iso: string, maintenant = new Date()): string {
  const debut = new Date(iso);
  if (Number.isNaN(debut.getTime())) return "";
  const jours = Math.floor((maintenant.getTime() - debut.getTime()) / 86_400_000);
  if (jours <= 0) return "depuis aujourd'hui";
  if (jours === 1) return "depuis hier";
  return `depuis ${jours} jours`;
}

/**
 * Le bandeau d'accueil. Il ne s'affiche QUE fermee, et il porte le geste de
 * retour — pas un lien vers un ecran ou le geste se trouve. Un rappel qui
 * demande deux taps pour etre suivi est un rappel qu'on remet a plus tard.
 *
 * Le ton est `warn` et non `danger` : rien n'est casse, rien n'est perdu.
 * C'est un etat choisi, qui dure peut-etre trop.
 */
export function BanniereConges({ depuis }: { depuis: string | null }) {
  const { ferme, enCours, erreur, basculer } = useConges(depuis);
  if (!ferme) return null;

  return (
    <section
      aria-label="Boutique fermee aux commandes"
      data-testid="banniere-conges"
      className="flex flex-col gap-2.5 rounded-card border border-warn/40 bg-warn-soft p-4"
    >
      <p className="text-body font-semibold text-ink">
        🌴 Votre boutique ne prend pas de commande
        {depuis ? <span className="font-normal text-muted"> — {depuisQuand(depuis)}</span> : null}
      </p>
      <p className="text-caption text-muted">
        Elle reste en ligne et vos client/es peuvent vous ecrire, mais aucune nouvelle commande ne
        peut etre creee. Vos commandes en cours continuent normalement.
      </p>
      <p role="status" aria-live="polite" className="text-caption text-danger">
        {erreur}
      </p>
      <Button tone="primary" size="lg" loading={enCours} onClick={() => void basculer()}>
        Je reprends les commandes
      </Button>
    </section>
  );
}
