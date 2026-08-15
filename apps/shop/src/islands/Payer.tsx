import { normalizePhone } from "@catalog/contracts/phone";
import type { OperateurRampe, RampeConfig } from "@catalog/contracts/ussd";
import { operateurParId } from "@catalog/contracts/ussd";
import { useEffect, useState } from "preact/hooks";
import { Attente } from "./rampe/Attente.tsx";
import { ChoixOperateur } from "./rampe/ChoixOperateur.tsx";
import { NumeroDeVersement } from "./rampe/NumeroDeVersement.tsx";
import { Rampe } from "./rampe/Rampe.tsx";

/**
 * La rampe de paiement, cote acheteuse.
 *
 * ── Pourquoi cet ecran a besoin de JavaScript ─────────────────────────────
 *
 * Le reste de la boutique est du HTML statique : c'est ce qui tient le LCP sous
 * 2,5 s depuis Douala. Cette page-ci ne peut pas l'etre, et pour une raison de
 * fond : **la configuration des codes USSD ne doit PAS etre figee a la
 * construction du site.** Les operateurs changent leurs codes ; un code fige se
 * remplace par un redeploiement, c'est-a-dire des heures pendant lesquelles la
 * chaine composee ouvre un menu inattendu. La page lit donc `GET /api/rampe` a
 * l'execution.
 *
 * L'acheteuse sans JavaScript n'est pas pour autant laissee sans rien : le
 * numero de reversement et le montant sont ecrits EN TEXTE BRUT dans le message
 * WhatsApp qu'elle a echange avec la vendeuse, et elle compose alors par le menu
 * de son operateur — celui qu'elle utilise deja toutes les semaines. Le
 * `<noscript>` de la page le lui dit.
 *
 * ── Les parametres ────────────────────────────────────────────────────────
 *
 * Ils viennent de l'URL. **Ce n'est pas une source de verite** : la rampe ne
 * fait que pre-remplir un clavier, elle n'engage rien et ne cree rien. Le
 * montant et le numero sont affiches en grand precisement pour que l'acheteuse
 * les compare a ce que la vendeuse lui a ecrit avant de composer.
 */

const API_BASE = (import.meta.env.PUBLIC_API_BASE ?? "").replace(/\/$/, "");

export interface Parametres {
  numero: string;
  montantXaf: number;
  boutique?: string;
  whatsapp?: string;
  reference?: string;
}

/**
 * Lecture des parametres. Fonction PURE : elle prend la chaine de requete, elle
 * ne lit pas `location`. Un montant qui n'est pas un entier de francs est
 * refuse — le franc CFA n'a pas de sous-unite, et une chaine USSD portant une
 * virgule ne compose rien.
 */
export function lireParametres(recherche: string): Parametres | null {
  const p = new URLSearchParams(recherche);
  const numero = p.get("numero")?.trim();
  const brut = p.get("montant")?.trim();
  if (!numero || !brut || !/^\d+$/.test(brut)) return null;
  /* Un numero que `numeroLocal` ne saurait pas normaliser FERAIT LEVER la
     construction des chemins USSD au premier rendu — l'ilot mourait sans un
     mot (constat D5 de l'audit 2026-08 : URL editee a la main, ou commande
     d'un vendeur du banc d'essai dont le reversement est etranger, ADR 0080).
     On le refuse ICI, ou l'ecran « lien incomplet » sait deja le dire. */
  if (!normalizePhone(numero)) return null;
  const montantXaf = Number(brut);
  if (!Number.isSafeInteger(montantXaf) || montantXaf <= 0) return null;
  return {
    numero,
    montantXaf,
    boutique: p.get("boutique")?.trim() || undefined,
    whatsapp: p.get("whatsapp")?.trim() || undefined,
    reference: p.get("ref")?.trim() || undefined,
  };
}

/**
 * L'ecran vide — « ce lien de paiement est incomplet » — n'est PAS un etat de
 * chargement : il depend des parametres de l'URL, pas de la configuration. Le
 * melanger ici obligerait a distinguer deux vides differents.
 */
type Etat =
  | { nom: "chargement" }
  | { nom: "erreur" }
  | { nom: "hors-ligne" }
  | { nom: "pret"; config: RampeConfig };

export default function Payer() {
  const [parametres, setParametres] = useState<Parametres | null>(null);
  const [etat, setEtat] = useState<Etat>({ nom: "chargement" });
  const [operateurId, setOperateurId] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);

  useEffect(() => {
    setParametres(lireParametres(window.location.search));
  }, []);

  useEffect(() => {
    let vivant = true;
    fetch(`${API_BASE}/api/rampe`, { headers: { accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as RampeConfig;
      })
      .then((config) => {
        if (!vivant) return;
        setEtat(
          config?.version === 1 && Array.isArray(config.operateurs)
            ? { nom: "pret", config }
            : { nom: "erreur" },
        );
      })
      .catch(() => {
        if (!vivant) return;
        // Une panne de reseau et une API en erreur ne se disent pas pareil :
        // l'une se reessaie, l'autre pas.
        setEtat({ nom: navigator.onLine === false ? "hors-ligne" : "erreur" });
      });
    return () => {
      vivant = false;
    };
  }, []);

  if (etat.nom === "chargement") {
    return (
      <p role="status" aria-live="polite" class="text-body text-ink-2">
        Preparation du paiement…
      </p>
    );
  }

  if (etat.nom === "hors-ligne" || etat.nom === "erreur") {
    return <SansRampe horsLigne={etat.nom === "hors-ligne"} />;
  }

  if (!parametres) {
    return (
      <section class="flex flex-col gap-3">
        <h2 class="text-body font-semibold text-ink">Rien a payer ici</h2>
        <p class="text-caption text-ink-2">
          Ce lien de paiement est incomplet. Reprenez le lien que la vendeuse vous a envoye sur
          WhatsApp, ou demandez-lui son numero et le montant.
        </p>
      </section>
    );
  }

  const operateur: OperateurRampe | null = operateurId
    ? operateurParId(etat.config, operateurId)
    : null;
  const versement = { numero: parametres.numero, montantXaf: parametres.montantXaf };

  if (compose) {
    return (
      <Attente
        numero={parametres.numero}
        montantXaf={parametres.montantXaf}
        whatsapp={parametres.whatsapp}
        reference={parametres.reference}
      />
    );
  }

  return (
    <div class="flex flex-col gap-5">
      <NumeroDeVersement
        numero={parametres.numero}
        montantXaf={parametres.montantXaf}
        boutique={parametres.boutique}
      />

      {operateur ? (
        <>
          <Rampe operateur={operateur} versement={versement} onCompose={() => setCompose(true)} />
          <button
            type="button"
            onClick={() => setOperateurId(null)}
            class="min-h-[var(--size-touch)] rounded-field px-4 text-caption font-semibold text-brand-500"
          >
            ← Changer d'operateur
          </button>
        </>
      ) : (
        <ChoixOperateur operateurs={etat.config.operateurs} onChoisir={setOperateurId} />
      )}
    </div>
  );
}

/**
 * Les etats hors ligne et en erreur.
 *
 * **On n'affiche aucun code de repli**, et c'est volontaire : le seul endroit du
 * depot ou un code USSD est ecrit est la configuration du serveur. Un repli code
 * en dur ici serait exactement la constante que le lot interdit, et il finirait
 * par etre le seul code affiche le jour ou l'API tombe — donc un code perime.
 *
 * Ce qu'on peut dire sans rien inventer : le menu de son operateur, l'acheteuse
 * le connait, et le numero et le montant sont dans son fil WhatsApp.
 */
function SansRampe({ horsLigne }: { horsLigne: boolean }) {
  return (
    <section class="flex flex-col gap-3" data-testid="sans-rampe">
      <h2 class="text-body font-semibold text-ink">
        {horsLigne ? "Vous etes hors ligne" : "La rampe n'est pas disponible"}
      </h2>
      <p class="text-caption text-ink-2">
        Vous pouvez payer quand meme : ouvrez le menu mobile money de votre operateur comme
        d'habitude. Le numero de la vendeuse et le montant sont ecrits dans votre conversation
        WhatsApp.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        class="min-h-[var(--size-touch)] rounded-field border border-control-line bg-surface px-4 text-body font-semibold text-brand-500"
      >
        Reessayer
      </button>
    </section>
  );
}
