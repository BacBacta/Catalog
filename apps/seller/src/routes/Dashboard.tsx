import { Badge, Button, Card, CardNote, CardTitle, Field, Input, Separator } from "@catalog/ui";
import { useState } from "react";
import { Link } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { Protege } from "../components/Protege.tsx";
import { api, messageDErreur, type Vendeuse } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";

/**
 * L'ecran d'accueil de la vendeuse : sa session, et l'etat de son reversement.
 *
 * Il porte aussi la creation du profil, parce qu'elle n'a pas d'ecran a elle. Le
 * nom de la boutique et la ville sont **demandes**, jamais devines : ce nom
 * s'affichera sur la page publique que ses clientes voient, et « Ma boutique » y
 * serait une invention a son nom.
 *
 * Le reste du tableau de bord — commandes, articles, soldes — arrive aux lots
 * suivants. Ce qui est ici est ce que le lot 4 doit tenir : la session existe, et
 * le numero de reversement se regle.
 */
export function Dashboard() {
  return <Protege>{(v) => (v.seller ? <Accueil vendeuse={v} /> : <CreationProfil />)}</Protege>;
}

function Accueil({ vendeuse }: { vendeuse: Vendeuse }) {
  const { deconnecter } = useSession();
  const seller = vendeuse.seller as NonNullable<Vendeuse["seller"]>;

  return (
    <Ecran
      titre={seller.businessName}
      surtitre="Espace vendeuse"
      actions={
        <Button tone="ghost" onClick={() => void deconnecter()}>
          Me deconnecter
        </Button>
      }
    >
      <Card>
        <CardTitle>Votre connexion</CardTitle>
        <CardNote>
          Vous vous connectez avec le <strong className="text-ink">{vendeuse.loginPhone}</strong>.
        </CardNote>
        <Separator />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-caption font-semibold text-ink-2">Numero de reversement</span>
            {seller.payoutPhone ? (
              <Badge tone="good">Verifie</Badge>
            ) : (
              <Badge tone="warn">A regler</Badge>
            )}
          </div>
          <p data-testid="reversement-actuel" className="font-mono text-body text-ink">
            {seller.payoutPhone ?? "aucun"}
          </p>
          <CardNote>
            {seller.payoutPhone
              ? "C'est sur ce numero que vos clientes vous paient. Il peut etre sur une autre puce que celle de votre connexion."
              : "C'est le numero sur lequel vos clientes vous paieront. Tant qu'il n'est pas pose, aucune rampe de paiement ne peut etre generee."}
          </CardNote>
          <Button
            render={<Link to="/reversement" />}
            tone={seller.payoutPhone ? "outline" : "primary"}
            size="lg"
          >
            {seller.payoutPhone ? "Changer ce numero" : "Regler mon numero de reversement"}
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Votre catalogue</CardTitle>
        <CardNote>
          Une photo, un nom, un prix. C'est ce que vos clientes verront et partageront.
        </CardNote>
        <Button render={<Link to="/articles" />} tone="outline" size="lg">
          Gerer mes articles
        </Button>
      </Card>

      <Card>
        <CardTitle>Verifier un recu</CardTitle>
        <CardNote>
          Une cliente vous montre un recu ? Controlez-le avant d'expedier : c'est la que la fraude
          se joue.
        </CardNote>
        <Button render={<Link to="/verifier" />} tone="outline" size="lg">
          Verifier un recu
        </Button>
      </Card>

      <Card>
        <CardTitle>Votre boutique</CardTitle>
        <CardNote>
          {seller.city} · lien public <span className="font-mono text-ink">/{seller.slug}</span>
        </CardNote>
      </Card>
    </Ecran>
  );
}

/** Deux questions, une fois. Rien d'autre n'est obligatoire pour commencer. */
function CreationProfil() {
  const { rafraichir } = useSession();
  const [nom, setNom] = useState("");
  const [ville, setVille] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const r = await api.creerProfil(nom.trim(), ville.trim());
      if (!r.ok) {
        setErreur(messageDErreur(r, "La creation n'a pas abouti. Reessayez."));
        return;
      }
      await rafraichir();
    } catch {
      setErreur("La creation n'a pas abouti. Reessayez.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Ecran titre="Votre boutique" surtitre="Premiere ouverture">
      <Card>
        <CardNote>
          Deux questions, une seule fois. Le nom est celui que vos clientes verront.
        </CardNote>
        <form onSubmit={soumettre} noValidate className="flex flex-col gap-4">
          <Field
            label="Nom de la boutique"
            htmlFor="nom"
            hint="Celui que vous utilisez deja sur WhatsApp, si vous en avez un."
          >
            <Input
              id="nom"
              name="nom"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              autoComplete="organization"
            />
          </Field>
          <Field label="Ville" htmlFor="ville" hint="Douala, Yaounde, Bafoussam…">
            <Input
              id="ville"
              name="ville"
              value={ville}
              onChange={(e) => setVille(e.target.value)}
              autoComplete="address-level2"
            />
          </Field>
          <p role="status" aria-live="polite" className="text-caption text-danger">
            {erreur}
          </p>
          <Button type="submit" size="lg" disabled={enCours}>
            {enCours ? "Creation…" : "Ouvrir ma boutique"}
          </Button>
        </form>
      </Card>
    </Ecran>
  );
}
