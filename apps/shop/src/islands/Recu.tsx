import type { RecuJson, RefusRecu } from "@catalog/contracts/recu";
import { useEffect, useState } from "preact/hooks";
import { CarteRecu, CarteRefus } from "./recu/CarteRecu.tsx";

/**
 * La page publique de verification d'un recu — `/v/<code>`.
 *
 * **Consultable par n'importe qui, sans compte.** C'est le point entier du
 * produit : Catalog n'atteste rien, il rend la verification possible. Une
 * acheteuse a qui l'on montre un recu doit pouvoir le controler elle-meme, sur
 * son telephone, sans rien installer.
 *
 * Le code est lu dans l'URL et la page interroge l'API a l'execution. Elle ne
 * peut pas etre prerendue : le recu n'existe pas au moment de la construction du
 * site, et il change quand l'acheteuse contresigne. Voir l'ADR 0021.
 */

const API_BASE = (import.meta.env.PUBLIC_API_BASE ?? "").replace(/\/$/, "");

/**
 * Le code, extrait de l'URL. Fonction PURE : elle prend chemin et requete, elle
 * ne lit pas `location`.
 *
 * **Deux formes, et la seconde est celle qui marche partout.** `/v/ACDE-4679`
 * est la jolie, celle qu'on partage ; elle exige une reecriture cote
 * hebergement, parce qu'une sortie statique ne connait que les chemins enumeres
 * a la construction. `/v/?c=ACDE-4679` ne demande AUCUNE configuration : elle
 * fonctionne en developpement, en previsualisation et derriere n'importe quel
 * CDN. Le produit ne depend donc pas d'un reglage d'hebergement — la jolie URL
 * est un confort par-dessus. Voir l'ADR 0021.
 */
export function codeDuChemin(chemin: string, requete = ""): string | null {
  const segments = chemin.split("/").filter(Boolean);
  if (segments[0] !== "v") return null;
  const segment = segments[1];
  if (segment) return decodeURIComponent(segment);
  const c = new URLSearchParams(requete).get("c");
  return c ? c.trim() || null : null;
}

type Etat =
  | { nom: "chargement" }
  | { nom: "vide" }
  | { nom: "erreur" }
  | { nom: "hors-ligne" }
  | { nom: "refus"; refus: RefusRecu }
  | { nom: "recu"; recu: RecuJson; portee: string };

export default function Recu() {
  const [etat, setEtat] = useState<Etat>({ nom: "chargement" });

  useEffect(() => {
    const code = codeDuChemin(window.location.pathname, window.location.search);
    if (!code) {
      setEtat({ nom: "vide" });
      return;
    }
    let vivant = true;
    fetch(`${API_BASE}/api/recu/${encodeURIComponent(code)}`, {
      headers: { accept: "application/json" },
    })
      .then(async (r) => ({ statut: r.status, corps: await r.json() }))
      .then(({ corps }) => {
        if (!vivant) return;
        if (corps?.recu) setEtat({ nom: "recu", recu: corps.recu, portee: corps.portee ?? "" });
        else if (corps?.refus) setEtat({ nom: "refus", refus: corps.refus });
        else setEtat({ nom: "erreur" });
      })
      .catch(() => {
        if (!vivant) return;
        setEtat({ nom: navigator.onLine === false ? "hors-ligne" : "erreur" });
      });
    return () => {
      vivant = false;
    };
  }, []);

  if (etat.nom === "chargement") {
    return (
      <p role="status" aria-live="polite" class="text-body text-ink-2">
        Lecture du reçu…
      </p>
    );
  }

  if (etat.nom === "vide") {
    return (
      <section class="flex flex-col gap-2" data-testid="sans-code">
        <h2 class="text-body font-semibold text-ink">Aucun code dans ce lien</h2>
        <p class="text-caption text-ink-2">
          Un lien de vérification se termine par le code du reçu. Demandez-le à la personne qui vous
          montre le paiement.
        </p>
      </section>
    );
  }

  if (etat.nom === "hors-ligne" || etat.nom === "erreur") {
    return (
      <section class="flex flex-col gap-3" data-testid="indisponible">
        <h2 class="text-body font-semibold text-ink">
          {etat.nom === "hors-ligne" ? "Vous êtes hors ligne" : "Le reçu n'a pas pu être lu"}
        </h2>
        {/* On ne dit RIEN du paiement : ne pas pouvoir lire un recu n'est ni une
            preuve ni une infirmation, et laisser croire l'un ou l'autre serait
            plus grave que la panne. */}
        <p class="text-caption text-ink-2">
          Cela ne dit rien du paiement lui-même. Réessayez, ou contrôlez l'identifiant directement
          auprès de l'opérateur.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          class="min-h-[var(--size-touch)] rounded-field border border-control-line bg-surface px-4 text-body font-semibold text-brand-500"
        >
          Réessayer
        </button>
      </section>
    );
  }

  if (etat.nom === "refus") return <CarteRefus refus={etat.refus} />;
  return <CarteRecu recu={etat.recu} portee={etat.portee} />;
}
