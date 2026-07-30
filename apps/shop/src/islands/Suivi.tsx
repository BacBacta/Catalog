import { formatXaf } from "@catalog/contracts/money";
import type { RecuJson, RefusRecu } from "@catalog/contracts/recu";
import { useEffect, useState } from "preact/hooks";
import { CarteRecu, CarteRefus } from "./recu/CarteRecu.tsx";

/**
 * Le suivi de l'acheteuse — `/suivi/<jeton>`.
 *
 * **Version MINIMALE, comme le lot le demande** : reference, montant, recu,
 * contre-signature. Les etapes de livraison appartiennent au lot 11 et ne
 * s'anticipent pas ici.
 *
 * ── Pourquoi un jeton et pas la reference ────────────────────────────────
 *
 * Cette page porte la contre-signature, c'est-a-dire la seconde voix qui donne
 * au recu sa valeur. La reference `CT-1043` se devine et le code de verification
 * est public des qu'un recu est montre : si l'un des deux ouvrait cette page, il
 * suffirait d'essayer des liens pour valider le paiement de quelqu'un d'autre.
 *
 * Le lien porte donc un secret. Corollaire assume : **partager ce lien, c'est
 * partager le pouvoir de contresigner.** C'est le prix de « pas de compte
 * requis », et l'ecran le dit.
 */

const API_BASE = (import.meta.env.PUBLIC_API_BASE ?? "").replace(/\/$/, "");

/** Le jeton, extrait du chemin. Fonction PURE. */
export function jetonDuChemin(chemin: string): string | null {
  const segments = chemin.split("/").filter(Boolean);
  if (segments[0] !== "suivi") return null;
  const jeton = segments[1];
  return jeton ? decodeURIComponent(jeton) : null;
}

interface Suivi {
  reference: string;
  boutique: string;
  totalXaf: number;
  dejaPayeXaf: number;
  resteXaf: number;
  etatPreuve: string;
  numeroDeVersement: string | null;
  recu?: RecuJson;
  portee?: string;
  refus?: RefusRecu;
  actions: { contresigner: boolean; contester: boolean };
}

type Etat =
  | { nom: "chargement" }
  | { nom: "inconnu" }
  | { nom: "erreur" }
  | { nom: "hors-ligne" }
  | { nom: "pret"; suivi: Suivi };

export default function SuiviAcheteuse() {
  const [etat, setEtat] = useState<Etat>({ nom: "chargement" });
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const jeton = typeof window === "undefined" ? null : jetonDuChemin(window.location.pathname);

  async function charger() {
    if (!jeton) return setEtat({ nom: "inconnu" });
    try {
      const r = await fetch(`${API_BASE}/api/suivi/${encodeURIComponent(jeton)}`, {
        headers: { accept: "application/json" },
      });
      if (r.status === 404) return setEtat({ nom: "inconnu" });
      if (!r.ok) return setEtat({ nom: "erreur" });
      setEtat({ nom: "pret", suivi: (await r.json()) as Suivi });
    } catch {
      setEtat({ nom: navigator.onLine === false ? "hors-ligne" : "erreur" });
    }
  }

  useEffect(() => {
    void charger();
    // Une seule lecture au montage : la page ne sonde pas le serveur en boucle,
    // le forfait de l'acheteuse n'est pas a nous.
  }, []);

  async function agir(chemin: "contresigner" | "contester", motif?: string) {
    if (!jeton || envoi) return;
    setEnvoi(true);
    setMessage(null);
    try {
      const r = await fetch(`${API_BASE}/api/suivi/${encodeURIComponent(jeton)}/${chemin}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(motif ? { motif } : {}),
      });
      const corps = (await r.json().catch(() => null)) as { refuse?: string } | null;
      if (!r.ok) {
        setMessage(
          corps?.refuse === "contresignature_sans_preuve"
            ? "Il n'y a pas encore de preuve à confirmer."
            : "Cette action n'a pas abouti.",
        );
      }
      await charger();
    } catch {
      setMessage("Le réseau n'a pas répondu. Rien n'a été enregistré.");
    } finally {
      setEnvoi(false);
    }
  }

  if (etat.nom === "chargement") {
    return (
      <p role="status" aria-live="polite" class="text-body text-ink-2">
        Lecture de votre commande…
      </p>
    );
  }

  if (etat.nom === "inconnu") {
    return (
      <section class="flex flex-col gap-2" data-testid="lien-inconnu">
        <h2 class="text-body font-semibold text-ink">Ce lien de suivi ne mène à rien</h2>
        <p class="text-caption text-ink-2">
          Reprenez le lien que la vendeuse vous a envoyé sur WhatsApp, en entier. Un lien tronqué à
          la recopie ne fonctionne pas.
        </p>
      </section>
    );
  }

  if (etat.nom === "hors-ligne" || etat.nom === "erreur") {
    return (
      <section class="flex flex-col gap-3" data-testid="indisponible">
        <h2 class="text-body font-semibold text-ink">
          {etat.nom === "hors-ligne" ? "Vous êtes hors ligne" : "Le suivi n'a pas pu être lu"}
        </h2>
        <p class="text-caption text-ink-2">Cela ne dit rien de votre commande ni du paiement.</p>
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

  const s = etat.suivi;
  return (
    <div class="flex flex-col gap-5">
      <section class="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
        <p class="text-caption text-ink-2">{s.boutique}</p>
        <h2 class="text-title font-bold text-ink">Commande {s.reference}</h2>
        <p class="text-body text-ink">
          Total : <strong>{formatXaf(s.totalXaf)}</strong>
        </p>
        {s.resteXaf > 0 ? (
          <p class="text-caption text-warn">Reste à payer : {formatXaf(s.resteXaf)}</p>
        ) : null}
      </section>

      {s.recu ? (
        <CarteRecu recu={s.recu} portee={s.portee ?? ""} />
      ) : s.refus ? (
        <CarteRefus refus={s.refus} />
      ) : null}

      <p role="status" aria-live="polite" class="text-caption text-danger">
        {message}
      </p>

      {/* UN TAP, pas un formulaire. Une acheteuse sur un telephone d'entree de
          gamme, dans une conversation WhatsApp, ne remplit pas un formulaire. */}
      {s.actions.contresigner ? (
        <button
          type="button"
          data-testid="contresigner"
          disabled={envoi}
          onClick={() => void agir("contresigner")}
          class="min-h-[var(--size-touch)] rounded-field bg-brand-fill px-5 py-3 text-body font-semibold text-brand-on-fill disabled:opacity-55"
        >
          {envoi ? "Envoi…" : "Oui, j'ai bien envoyé ce paiement"}
        </button>
      ) : null}

      {s.etatPreuve === "contresigne" ? (
        <p class="text-caption text-good" data-testid="deja-contresigne">
          Vous avez confirmé ce paiement. Deux parties indépendantes portent maintenant le même
          identifiant.
        </p>
      ) : null}

      {s.actions.contester ? (
        <button
          type="button"
          data-testid="contester"
          disabled={envoi}
          onClick={() => void agir("contester", "Contestation depuis le lien de suivi")}
          class="min-h-[var(--size-touch)] rounded-field border border-control-line bg-surface px-5 py-3 text-body font-semibold text-danger disabled:opacity-55"
        >
          Ce n'est pas moi qui ai payé
        </button>
      ) : null}

      {/* Le corollaire assume du « pas de compte requis ». On le dit plutot que
          de le laisser decouvrir. */}
      <p class="text-caption text-muted">
        Ce lien vous est personnel : il permet de confirmer le paiement. Ne le transmettez pas.
      </p>
    </div>
  );
}
