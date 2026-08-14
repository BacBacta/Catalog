import { formatXaf } from "@catalog/contracts/money";
import {
  Button,
  Card,
  CardNote,
  CardTitle,
  type CheckState,
  ErrorState,
  LoadingState,
  OfflineState,
  type ProofCheckItem,
  ProofChecklist,
  SmsPasteField,
} from "@catalog/ui";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { Protege } from "../components/Protege.tsx";
import { appeler, messageDErreur, PanneReseau } from "../lib/api.ts";

/**
 * L'ecran « coller le SMS » — le point d'entree de la valeur numero un du
 * produit.
 *
 * Quatre regles gouvernent cet ecran, et aucune n'est negociable :
 *
 * 1. **Le bandeau d'avertissement est PERMANENT**, au-dessus du champ. Une
 *    capture d'ecran ne porte aucun identifiant controlable : c'est l'arnaque la
 *    plus courante du marche, et l'interface doit le dire avant qu'on la subisse,
 *    pas apres.
 * 2. **Chaque controle affiche une explication en langue simple.** La vendeuse
 *    doit comprendre POURQUOI un paiement est refuse — sinon elle expedie quand
 *    meme, et le produit n'aura servi a rien.
 * 3. **Le collage n'est jamais bloque.** `SmsPasteField` porte deja cette
 *    discipline (WCAG 2.2 §3.3.8) ; cet ecran ne fait que l'entourer.
 * 4. **Le SMS colle ne repart jamais du serveur.** Il porte le solde du compte
 *    de la vendeuse. Il monte, il est chiffre, et il ne redescend pas.
 */

interface Commande {
  id: string;
  ref: string;
  totalXaf: number;
  balanceXaf: number;
  amountPaidXaf: number;
  proofState: string;
}

interface Controle {
  n: number;
  id: string;
  state: CheckState;
  explanation: string;
}

interface Reponse {
  verdict: "accepte" | "accepte_sous_reserve" | "refuse";
  checks: Controle[];
  resume?: { operateur: string; operatorTxId: string; montantXaf: number; aConfirmer: boolean };
}

/**
 * Les sept controles, dans l'ordre canonique. Ils sont affiches DES L'OUVERTURE,
 * en attente : la vendeuse voit ce qui va etre verifie avant de coller, ce qui
 * rend un refus comprehensible au lieu d'arbitraire.
 */
const CONTROLES: Array<{ n: number; id: string; title: string; attente: string }> = [
  {
    n: 1,
    id: "format",
    title: "Message d'opérateur reconnu",
    attente: "Nous vérifierons que ce message vient bien de MTN ou d'Orange.",
  },
  {
    n: 2,
    id: "montant",
    title: "Montant conforme",
    attente: "Nous comparerons le montant du SMS à ce qui reste à payer.",
  },
  {
    n: 3,
    id: "contrepartie",
    title: "Bon numéro",
    attente: "Nous regarderons de quel numéro l'argent est parti ou arrivé.",
  },
  {
    n: 4,
    id: "horodatage",
    title: "Date cohérente",
    attente: "Nous vérifierons que le paiement suit la commande, sous 48 heures.",
  },
  {
    n: 5,
    id: "unicite",
    title: "Paiement jamais utilisé ailleurs",
    attente: "Nous vérifierons qu'aucune autre commande n'a déjà utilisé ce paiement.",
  },
  {
    n: 6,
    id: "auto_coherence",
    title: "Identifiant cohérent",
    attente: "Chez Orange, l'identifiant porte sa propre date : nous la vérifierons.",
  },
  {
    n: 7,
    id: "contresignature",
    title: "Confirmation de l'acheteur/se",
    attente: "L'acheteur/se confirmera depuis son lien de suivi.",
  },
];

export function CollerSms() {
  return <Protege>{() => <Ecrans />}</Protege>;
}

function Ecrans() {
  const { orderId } = useParams();
  const [commande, setCommande] = useState<Commande | null>(null);
  const [chargement, setChargement] = useState(true);
  const [horsLigne, setHorsLigne] = useState(false);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);

  const [sms, setSms] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [reponse, setReponse] = useState<Reponse | null>(null);

  useEffect(() => {
    let vivant = true;
    (async () => {
      const r = await appeler<Commande>(`/api/commandes/${orderId}`);
      if (!vivant) return;
      if (r.ok && r.donnees) setCommande(r.donnees);
      else setErreurChargement(messageDErreur(r, "Cette commande est introuvable."));
      setChargement(false);
    })().catch((cause) => {
      if (!vivant) return;
      if (cause instanceof PanneReseau) setHorsLigne(true);
      else setErreurChargement("Cette commande n'a pas pu être lue.");
      setChargement(false);
    });
    return () => {
      vivant = false;
    };
  }, [orderId]);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    if (!sms.trim()) {
      setErreur("Collez d'abord le SMS que votre opérateur vous a envoyé.");
      return;
    }
    setEnvoi(true);
    try {
      const r = await appeler<Reponse>(`/api/commandes/${orderId}/preuve`, { corps: { sms } });
      if (r.donnees?.checks) {
        setReponse(r.donnees);
        // On EFFACE le champ des qu'une réponse arrive : le texte contient le
        // solde du compte, il n'a aucune raison de rester à l'écran.
        if (r.ok) setSms("");
      } else {
        setErreur(messageDErreur(r, "L'envoi n'a pas abouti. Réessayez."));
      }
    } catch (cause) {
      if (cause instanceof PanneReseau) setHorsLigne(true);
      else setErreur("L'envoi n'a pas abouti. Réessayez.");
    } finally {
      setEnvoi(false);
    }
  }

  const titre = "Prouver le paiement";

  if (horsLigne) {
    return (
      <Ecran titre={titre} surtitre="Preuve">
        <OfflineState
          action={
            <Button tone="outline" onClick={() => setHorsLigne(false)}>
              Réessayer
            </Button>
          }
        >
          Votre SMS reste dans vos messages. Vous pourrez le coller dès que le réseau revient — rien
          n'est perdu.
        </OfflineState>
      </Ecran>
    );
  }

  if (chargement) {
    return (
      <Ecran titre={titre} surtitre="Preuve">
        <LoadingState label="Lecture de la commande…" />
      </Ecran>
    );
  }

  if (erreurChargement || !commande) {
    return (
      <Ecran titre={titre} surtitre="Preuve">
        <ErrorState action={<Button render={<Link to="/" />}>Retour</Button>}>
          {erreurChargement ?? "Cette commande est introuvable."}
        </ErrorState>
      </Ecran>
    );
  }

  /**
   * Les sept controles, fusionnes avec ce que le serveur a repondu.
   *
   * Le controle 6 n'existe pas chez MTN. Apres une reponse, son absence signifie
   * « sans objet » — on le dit en toutes lettres, plutot que de le laisser en
   * attente indefinie, ce qui ressemblerait a une verification bloquee.
   */
  const controles: ProofCheckItem[] = CONTROLES.map((def) => {
    const recu = reponse?.checks.find((x) => x.n === def.n);
    if (recu) {
      return { id: def.id, title: def.title, state: recu.state, explanation: recu.explanation };
    }
    if (reponse && def.n === 6) {
      return {
        id: def.id,
        title: def.title,
        state: "pending" as CheckState,
        explanation: "Sans objet : cet opérateur n'inscrit pas de date dans son identifiant.",
      };
    }
    return {
      id: def.id,
      title: def.title,
      state: "pending" as CheckState,
      explanation: def.attente,
    };
  });

  return (
    <Ecran
      titre={titre}
      surtitre={`Commande ${commande.ref}`}
      retour={{ vers: "/commandes", libelle: "Mes commandes" }}
    >
      <Card>
        <CardTitle>Ce qui est attendu</CardTitle>
        <p className="text-hero font-extrabold text-ink">{formatXaf(commande.balanceXaf)}</p>
        <CardNote>
          {commande.amountPaidXaf > 0
            ? `Déjà réglé : ${formatXaf(commande.amountPaidXaf)} sur ${formatXaf(commande.totalXaf)}.`
            : `Total de la commande : ${formatXaf(commande.totalXaf)}.`}
        </CardNote>
      </Card>

      <Card>
        <form onSubmit={soumettre} noValidate className="flex flex-col gap-4">
          <SmsPasteField
            value={sms}
            onValueChange={setSms}
            disabled={envoi}
            notice={
              /* LE BANDEAU PERMANENT. Il n'est pas conditionnel, il ne se ferme
                 pas, et il est au-dessus du champ — pas en dessous. */
              <div
                role="note"
                data-testid="bandeau-capture"
                className="rounded-field border border-warn bg-warn-soft p-3 text-caption text-warn"
              >
                <strong className="font-bold">Ne vous fiez jamais à une capture d'écran.</strong>{" "}
                Seul votre propre SMS compte. Une capture ne porte aucun identifiant que nous
                puissions vérifier — c'est exactement ce qu'un faux acheteur envoie.
              </div>
            }
          />

          <p role="status" aria-live="polite" className="text-caption text-danger">
            {erreur}
          </p>

          <Button type="submit" size="lg" loading={envoi}>
            {envoi ? "Vérification…" : "Vérifier ce paiement"}
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Les sept contrôles</CardTitle>
        {reponse ? (
          <CardNote data-testid="verdict">
            {reponse.verdict === "accepte"
              ? "Paiement prouvé. Le reçu peut être émis."
              : reponse.verdict === "accepte_sous_reserve"
                ? "Accepté sous réserve : il manque une confirmation pour que le reçu soit émis."
                : "Ce paiement n'est pas prouvé. Voyez ci-dessous ce qui bloque."}
          </CardNote>
        ) : (
          <CardNote>
            Collez le SMS, puis appuyez sur « Vérifier ». Chaque contrôle vous dira ce qu'il a vu.
          </CardNote>
        )}
        <ProofChecklist items={controles} />
      </Card>
    </Ecran>
  );
}
