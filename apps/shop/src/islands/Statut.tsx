import { useEffect, useState } from "preact/hooks";

/**
 * La page de statut publique — `/statut`.
 *
 * ── Ce qu'elle affiche, et ce qu'elle refuse d'afficher ────────────────────
 *
 * Trois faits que le service connait reellement : est-il en marche, les recus
 * sont-ils consultables, les operations sont-elles possibles. Plus le message
 * d'incident qu'un exploitant a ecrit a la main.
 *
 * **Aucun pourcentage de disponibilite, aucun voyant « formats SMS ».** Le
 * premier se mesure depuis l'exterieur — un service qui calcule sa propre
 * disponibilite affiche 100 % exactement quand il est incapable de repondre ;
 * le second est verifie par le canari du lot 14, qui tourne en integration
 * continue et dont l'API ne sait rien. Les afficher serait inventer un chiffre
 * (AGENTS.md §7.7). La page dit a la place ou l'information existe vraiment.
 *
 * ── Les quatre etats, et un cinquieme qui compte ───────────────────────────
 *
 * Chargement, vide, erreur, hors ligne sont exiges par AGENTS.md. Ici, l'etat
 * « erreur » a un sens particulier et il est ecrit comme tel : **une page de
 * statut qui n'obtient pas de reponse REPOND QUAND MEME**, et ce silence est
 * lui-meme une information — c'est probablement que le service est tombé.
 * Afficher « erreur de chargement » et s'arreter la serait la seule facon de
 * rater le seul moment ou cette page sert a quelque chose.
 */

const API_BASE = (import.meta.env.PUBLIC_API_BASE ?? "").replace(/\/$/, "");

export type Niveau = "ok" | "degrade" | "interrompu";

export interface StatutJson {
  niveau: Niveau;
  recusConsultables: boolean;
  operationsPossibles: boolean;
  message: string | null;
}

type Etat =
  | { nom: "chargement" }
  | { nom: "injoignable" }
  | { nom: "hors-ligne" }
  | { nom: "statut"; statut: StatutJson };

/** Le libelle et la couleur d'un niveau. Fonction PURE, donc testable. */
export function libelleDe(niveau: Niveau): { titre: string; ton: "ok" | "attention" | "arret" } {
  if (niveau === "ok") return { titre: "Tout fonctionne normalement", ton: "ok" };
  if (niveau === "degrade") {
    return { titre: "Service partiel : les reçus restent consultables", ton: "attention" };
  }
  return { titre: "Service interrompu", ton: "arret" };
}

const TONS: Record<"ok" | "attention" | "arret", string> = {
  ok: "border-line bg-surface text-ink",
  attention: "border-warn bg-warn-soft text-ink",
  arret: "border-danger bg-danger-soft text-ink",
};

function Ligne({ vrai, texte }: { vrai: boolean; texte: string }) {
  return (
    <li class="flex items-start gap-2 text-body text-ink">
      {/* Le mot fait foi, jamais la seule couleur : critere 1.4.1. */}
      <span class="font-bold">{vrai ? "Oui —" : "Non —"}</span>
      <span>{texte}</span>
    </li>
  );
}

export default function Statut() {
  const [etat, setEtat] = useState<Etat>({ nom: "chargement" });

  useEffect(() => {
    let vivant = true;
    const charger = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setEtat({ nom: "hors-ligne" });
        return;
      }
      fetch(`${API_BASE}/api/statut`, { headers: { accept: "application/json" } })
        .then((r) => r.json())
        .then((corps: StatutJson) => {
          if (vivant) setEtat({ nom: "statut", statut: corps });
        })
        .catch(() => {
          if (vivant) setEtat({ nom: "injoignable" });
        });
    };
    charger();
    // Une page de statut se laisse ouverte pendant un incident. Trente secondes
    // suffisent a voir la reprise sans marteler un service deja en peine.
    const minuterie = setInterval(charger, 30_000);
    return () => {
      vivant = false;
      clearInterval(minuterie);
    };
  }, []);

  if (etat.nom === "chargement") {
    return (
      <p class="rounded-card border border-line bg-surface p-4 text-body text-ink-2">
        Vérification en cours…
      </p>
    );
  }

  if (etat.nom === "hors-ligne") {
    return (
      <p class="rounded-card border border-line bg-surface p-4 text-body text-ink">
        Votre téléphone n'a pas de connexion. Impossible de savoir si Catalog fonctionne :
        rebranchez-vous et rechargez cette page.
      </p>
    );
  }

  if (etat.nom === "injoignable") {
    /**
     * **Le silence EST l'information.** Ne pas obtenir de reponse de l'API,
     * depuis une page servie par le CDN, veut presque toujours dire que l'API
     * est tombee — et c'est precisement ce que la personne devant cet ecran
     * cherche a savoir.
     */
    return (
      <div class={`rounded-card border p-4 ${TONS.arret}`}>
        <p class="text-body font-bold">Catalog ne répond pas</p>
        <p class="mt-2 text-caption text-ink-2">
          Cette page est servie par le réseau de distribution, elle s'affiche même quand le service
          est arrêté. Ne pas obtenir de réponse signifie très probablement que le service est
          interrompu. Vos reçus déjà émis ne sont pas perdus : ils redeviendront consultables.
        </p>
      </div>
    );
  }

  const { statut } = etat;
  const { titre, ton } = libelleDe(statut.niveau);

  return (
    <div class="flex flex-col gap-4">
      <div class={`rounded-card border p-4 ${TONS[ton]}`}>
        <p class="text-body font-bold">{titre}</p>
        {statut.message ? <p class="mt-2 text-caption text-ink-2">{statut.message}</p> : null}
      </div>

      <ul class="flex flex-col gap-2">
        <Ligne
          vrai={statut.recusConsultables}
          texte="Les reçus déjà émis sont consultables et vérifiables."
        />
        <Ligne
          vrai={statut.operationsPossibles}
          texte="Les nouvelles opérations — coller un SMS, confirmer un paiement — sont enregistrées."
        />
      </ul>
    </div>
  );
}
