import {
  Badge,
  Button,
  Card,
  CardNote,
  CardTitle,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  MoneyDisplay,
  OfflineState,
  Separator,
  StatTile,
} from "@catalog/ui";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { Protege } from "../components/Protege.tsx";
import { api, type Commande, type EtapeCommande, messageDErreur } from "../lib/api.ts";

/**
 * Les commandes de la vendeuse, et leur avancement.
 *
 * **L'avancement d'etape est optimiste, le mouvement d'argent ne l'est jamais.**
 * C'est la regle du lot, et la distinction est concrete : cocher « preparee »
 * repeint la ligne tout de suite et revient en arriere VISIBLEMENT si le serveur
 * refuse ; declarer un paiement recu n'affiche rien tant que le serveur n'a pas
 * repondu. Une somme affichee puis retiree serait pire qu'une seconde d'attente.
 */

const LIBELLE: Record<EtapeCommande, string> = {
  recue: "Recue",
  preparee: "Preparee",
  /**
   * « Confiee au livreur », pas « expediee » : au Cameroun le livreur APPELLE en
   * arrivant dans le quartier, il ne depose pas a une adresse. Le libelle doit
   * refleter ce qui se passe vraiment, sinon l'acheteuse attend devant sa porte.
   */
  chez_le_livreur: "Confiee au livreur",
  livree: "Livree",
};

const ACTION: Record<EtapeCommande, string> = {
  recue: "Marquer recue",
  preparee: "C'est prepare",
  chez_le_livreur: "Confiee au livreur",
  livree: "Remise a votre client/e",
};

export function Commandes() {
  return <Protege>{() => <Liste />}</Protege>;
}

type Etat =
  | { nom: "chargement" }
  | { nom: "hors_ligne" }
  | { nom: "erreur"; message: string }
  | { nom: "prete"; commandes: Commande[]; soldesXaf: number };

function Liste() {
  const [etat, setEtat] = useState<Etat>({ nom: "chargement" });
  /** Message de retour arriere, quand le serveur refuse une etape deja peinte. */
  const [annulation, setAnnulation] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setEtat({ nom: "chargement" });
    try {
      const r = await api.commandes();
      if (!r.ok || !r.donnees) {
        setEtat({
          nom: "erreur",
          message: messageDErreur(r, "Les commandes n'ont pas pu etre lues."),
        });
        return;
      }
      setEtat({
        nom: "prete",
        commandes: r.donnees.commandes,
        soldesXaf: r.donnees.soldesAEncaisserXaf,
      });
    } catch {
      setEtat({ nom: "hors_ligne" });
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  /**
   * Avancement OPTIMISTE : on repeint, puis on confirme.
   *
   * Le retour arriere est VISIBLE — un `role="status"` annonce ce qui a ete
   * defait et pourquoi. Une interface qui remet silencieusement l'ancien etat
   * laisse la vendeuse croire qu'elle a mal clique.
   */
  async function avancer(commande: Commande, vers: EtapeCommande) {
    if (etat.nom !== "prete") return;
    const avant = etat.commandes;
    setAnnulation(null);
    setEtat({
      ...etat,
      commandes: avant.map((c) => (c.id === commande.id ? { ...c, etape: vers } : c)),
    });

    try {
      const r = await api.avancerEtape(commande.id, vers);
      if (!r.ok || !r.donnees) {
        setEtat({ ...etat, commandes: avant });
        setAnnulation(
          r.erreur === "solde_ouvert"
            ? `${commande.reference} : il reste un solde a encaisser avant la remise.`
            : messageDErreur(r, `${commande.reference} : l'etape n'a pas ete enregistree.`),
        );
        return;
      }
      const confirmee = r.donnees;
      setEtat((e) =>
        e.nom === "prete"
          ? {
              ...e,
              commandes: e.commandes.map((c) => (c.id === confirmee.id ? confirmee : c)),
              soldesXaf: e.commandes.reduce(
                (s, c) =>
                  s + (c.id === confirmee.id ? confirmee.soldeAEncaisserXaf : c.soldeAEncaisserXaf),
                0,
              ),
            }
          : e,
      );
    } catch {
      setEtat({ ...etat, commandes: avant });
      setAnnulation(`${commande.reference} : pas de reseau, l'etape n'a pas ete enregistree.`);
    }
  }

  function remplacer(maj: Commande) {
    setEtat((e) =>
      e.nom === "prete"
        ? {
            ...e,
            commandes: e.commandes.map((c) => (c.id === maj.id ? maj : c)),
            soldesXaf: e.commandes.reduce(
              (s, c) => s + (c.id === maj.id ? maj.soldeAEncaisserXaf : c.soldeAEncaisserXaf),
              0,
            ),
          }
        : e,
    );
  }

  if (etat.nom === "chargement") {
    return (
      <Ecran titre="Mes commandes" surtitre="Espace vendeur/se">
        <LoadingState label="Lecture de vos commandes…" />
      </Ecran>
    );
  }
  if (etat.nom === "hors_ligne") {
    return (
      <Ecran titre="Mes commandes" surtitre="Espace vendeur/se">
        <OfflineState action={<Button onClick={() => void charger()}>Reessayer</Button>} />
      </Ecran>
    );
  }
  if (etat.nom === "erreur") {
    return (
      <Ecran titre="Mes commandes" surtitre="Espace vendeur/se">
        <ErrorState action={<Button onClick={() => void charger()}>Reessayer</Button>}>
          {etat.message}
        </ErrorState>
      </Ecran>
    );
  }

  return (
    <Ecran titre="Mes commandes" surtitre="Espace vendeur/se">
      <StatTile
        label="Soldes a encaisser"
        value={<MoneyDisplay amountXaf={etat.soldesXaf} size="hero" />}
        note="Ce que vos client/es vous doivent encore, sur les commandes en cours."
        data-testid="soldes-a-encaisser"
      />

      <p role="status" aria-live="polite" className="text-caption text-danger">
        {annulation}
      </p>

      {etat.commandes.length === 0 ? (
        <EmptyState title="Aucune commande">
          Vos commandes apparaitront ici des qu'un/e client/e en passera une.
        </EmptyState>
      ) : (
        etat.commandes.map((c) => (
          <LigneCommande key={c.id} commande={c} onAvancer={avancer} onMaj={remplacer} />
        ))
      )}
    </Ecran>
  );
}

function LigneCommande({
  commande,
  onAvancer,
  onMaj,
}: {
  commande: Commande;
  onAvancer: (c: Commande, vers: EtapeCommande) => void;
  onMaj: (c: Commande) => void;
}) {
  const suivantes = commande.etapesPossibles.filter((e) => e !== commande.etape);

  return (
    <Card data-testid={`commande-${commande.reference}`}>
      <CardTitle>{commande.reference}</CardTitle>
      <CardNote>
        {commande.acheteuse.nom ?? "Client/e"} · {commande.acheteuse.telephone}
      </CardNote>

      <div className="flex flex-wrap items-center gap-2">
        {/* L'etape est ecrite EN TOUTES LETTRES, pas seulement portee par une
            couleur : c'est la regle d'accessibilite deja tenue par la liste des
            sept controles. */}
        <Badge tone={commande.etape === "livree" ? "good" : "neutral"}>
          <span data-testid="etape">{LIBELLE[commande.etape]}</span>
        </Badge>
        {commande.resteXaf > 0 ? <Badge tone="warn">Solde a encaisser</Badge> : null}
        {commande.etatPreuve === "declare_non_trace" ? (
          <Badge tone="warn">Paiement non trace</Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline gap-3">
        <MoneyDisplay amountXaf={commande.totalXaf} />
        <span className="text-caption text-ink-2">
          deja paye <MoneyDisplay amountXaf={commande.dejaPayeXaf} size="caption" /> · reste{" "}
          <MoneyDisplay amountXaf={commande.resteXaf} size="caption" />
        </span>
      </div>

      {suivantes.length > 0 ? (
        <>
          <Separator />
          <div className="flex flex-wrap gap-2">
            {suivantes.map((e) => (
              <Button
                key={e}
                tone={e === "livree" ? "primary" : "outline"}
                size="lg"
                onClick={() => onAvancer(commande, e)}
              >
                {ACTION[e]}
              </Button>
            ))}
          </div>
        </>
      ) : null}

      {commande.resteXaf > 0 ? <EncaisserSolde commande={commande} onMaj={onMaj} /> : null}
    </Card>
  );
}

/**
 * L'encaissement du solde a la remise.
 *
 * **Deux chemins, cote a cote, et c'est voulu.** Le depot direct non trace
 * existe et existera toujours : la vendeuse le ferait de toute facon hors du
 * systeme, et on perdrait aussi la donnee. On ne cherche pas a le bloquer, on
 * le distingue — et on met « j'ai le SMS » juste a cote, parce que c'est le seul
 * chemin qui produit un recu.
 *
 * Rien d'optimiste ici : aucun montant n'est affiche avant la reponse du
 * serveur. Une somme peinte puis retiree serait pire qu'une seconde d'attente.
 */
function EncaisserSolde({ commande, onMaj }: { commande: Commande; onMaj: (c: Commande) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [montant, setMontant] = useState(String(commande.resteXaf));
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function declarer(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    const valeur = Number(montant.replace(/\s/g, ""));
    // Entier strict cote ecran AUSSI : le franc CFA n'a pas de sous-unite, et
    // laisser passer 2500,5 pour se faire refuser par le serveur ferait perdre
    // un aller-retour a une vendeuse en 3G.
    if (!Number.isInteger(valeur) || valeur <= 0) {
      setErreur("Un montant en francs entiers, sans virgule.");
      return;
    }
    setEnCours(true);
    try {
      const r = await api.declarerPaiement(commande.id, valeur);
      if (!r.ok || !r.donnees) {
        setErreur(messageDErreur(r, "Le paiement n'a pas ete enregistre."));
        return;
      }
      onMaj(r.donnees);
      setOuvert(false);
    } catch {
      setErreur("Pas de reseau. Le paiement n'a pas ete enregistre.");
    } finally {
      setEnCours(false);
    }
  }

  if (!ouvert) {
    return (
      <>
        <Separator />
        <div className="flex flex-wrap gap-2">
          <Button tone="outline" size="lg" onClick={() => setOuvert(true)}>
            Declarer un paiement recu
          </Button>
          <Button
            render={<Link to={`/commandes/${commande.id}/preuve`} />}
            tone="primary"
            size="lg"
          >
            J'ai le SMS
          </Button>
        </div>
        <CardNote>
          Le SMS de votre operateur produit un recu verifiable. Une declaration a la main fait
          avancer la commande, mais reste marquee non tracee.
        </CardNote>
      </>
    );
  }

  return (
    <>
      <Separator />
      <form onSubmit={declarer} noValidate className="flex flex-col gap-3">
        <Field
          label="Montant recu"
          htmlFor={`montant-${commande.id}`}
          hint="En francs entiers. Sans virgule."
        >
          <Input
            id={`montant-${commande.id}`}
            name="montant"
            inputMode="numeric"
            value={montant}
            onChange={(e) => setMontant(e.target.value)}
          />
        </Field>
        <p role="status" aria-live="polite" className="text-caption text-danger">
          {erreur}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" loading={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer ce paiement"}
          </Button>
          <Button type="button" tone="ghost" size="lg" onClick={() => setOuvert(false)}>
            Annuler
          </Button>
        </div>
      </form>
    </>
  );
}
