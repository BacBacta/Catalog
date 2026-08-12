import {
  Badge,
  Button,
  Card,
  CardNote,
  CardTitle,
  Field,
  Input,
  MoneyDisplay,
  StatTile,
} from "@catalog/ui";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { BanniereConges } from "../components/conges.tsx";
import { Ecran } from "../components/Ecran.tsx";
import { IconeChiffres, IconeCommandes, IconePlus, IconeRecu } from "../components/icones.tsx";
import { Protege } from "../components/Protege.tsx";
import { api, messageDErreur, type Vendeuse } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";

/**
 * L'ecran d'accueil de la vendeuse.
 *
 * Refonte (ADR 0030) : avant, cet ecran etait un ANNUAIRE — six cartes-menu
 * vers les autres ecrans, faute de navigation. La barre inferieure a pris ce
 * role ; l'accueil redevient un tableau de bord : le chiffre qu'elle vient
 * chercher (les soldes), les gestes du jour (ajouter, verifier), et l'etat du
 * numero de reversement — le champ qu'un attaquant chercherait a detourner,
 * il reste donc SOUS LES YEUX plutot que range dans Reglages.
 *
 * Il porte aussi la creation du profil, parce qu'elle n'a pas d'ecran a elle.
 * Le nom de la boutique et la ville sont **demandes**, jamais devines.
 */
export function Dashboard() {
  return (
    <Protege>
      {(v) => (v.seller ? <Accueil vendeuse={v} /> : <CreationProfil vendeuse={v} />)}
    </Protege>
  );
}

/** Un geste du jour : une tuile carree, une icone, un mot. */
function ActionRapide({
  vers,
  icone,
  libelle,
}: {
  vers: string;
  icone: ReactNode;
  libelle: string;
}) {
  return (
    <Link
      to={vers}
      className="flex min-h-[var(--size-touch)] flex-col items-start gap-2 rounded-card border border-line bg-surface p-4 font-sans shadow-card transition-[transform,box-shadow] duration-fast ease-out hover:shadow-raised active:scale-[0.98]"
    >
      <span aria-hidden="true" className="text-brand-500">
        {icone}
      </span>
      <span className="text-caption font-semibold text-ink">{libelle}</span>
    </Link>
  );
}

function Accueil({ vendeuse }: { vendeuse: Vendeuse }) {
  const { deconnecter } = useSession();
  const seller = vendeuse.seller as NonNullable<Vendeuse["seller"]>;
  const soldes = useSoldesAEncaisser();

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
      {/*
        Fermee aux commandes ? Ca se dit ICI, avant tout le reste — ADR 0056.
        L'oubli de rouvrir ne coute rien de visible : le lien marche, le
        catalogue s'affiche, et les ventes s'arretent en silence. Le bandeau
        ne parait que fermee, et il porte le geste de retour lui-meme.
      */}
      <BanniereConges depuis={seller.congesDepuis} />

      {/*
        La tuile des soldes ouvre le tableau de bord : c'est le chiffre qu'une
        vendeuse vient chercher en premier. Elle reste MUETTE tant que le total
        n'est pas connu — afficher zero pendant le chargement ferait croire
        qu'il n'y a rien a encaisser. Le lavis de marque la distingue de tout
        le reste : il n'y a qu'UN chiffre-roi par ecran.
      */}
      {soldes === null ? null : (
        <StatTile
          label="Soldes a encaisser"
          value={<MoneyDisplay amountXaf={soldes} size="hero" />}
          note="Ce que vos clientes vous doivent encore, sur les commandes en cours."
          data-testid="tuile-soldes"
          className="border-brand-100 bg-linear-to-br from-brand-soft to-surface dark:border-line"
        />
      )}

      <section aria-label="Gestes rapides" className="grid grid-cols-2 gap-3">
        <ActionRapide vers="/articles/nouveau" icone={<IconePlus />} libelle="Ajouter un article" />
        <ActionRapide vers="/verifier" icone={<IconeRecu />} libelle="Verifier un recu" />
        <ActionRapide vers="/commandes" icone={<IconeCommandes />} libelle="Mes commandes" />
        <ActionRapide vers="/statistiques" icone={<IconeChiffres />} libelle="Mes chiffres" />
      </section>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Numero de reversement</CardTitle>
          {seller.payoutPhone ? (
            <Badge tone="good">Verifie</Badge>
          ) : (
            <Badge tone="warn">A regler</Badge>
          )}
        </div>
        <p data-testid="reversement-actuel" className="font-mono text-title font-bold text-ink">
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
      </Card>

      <Card>
        <CardTitle>Votre connexion</CardTitle>
        <CardNote>
          {vendeuse.loginPhone ? (
            <>
              Vous vous connectez avec le{" "}
              <strong className="text-ink">{vendeuse.loginPhone}</strong>. Le reste — appareils,
              boutique publique — vit dans Reglages.
            </>
          ) : (
            "Vous vous connectez avec votre compte Google. Le reste — appareils, boutique publique — vit dans Reglages."
          )}
        </CardNote>
      </Card>
    </Ecran>
  );
}

/**
 * Le total des soldes a encaisser, ou `null` tant qu'il n'est pas connu.
 *
 * Un echec ne casse pas le tableau de bord : la tuile disparait, le reste de
 * l'ecran vit. C'est un chiffre de confort, pas la raison d'etre de la page —
 * et une vendeuse hors ligne doit quand meme pouvoir regler son reversement.
 */
function useSoldesAEncaisser(): number | null {
  const [soldes, setSoldes] = useState<number | null>(null);
  useEffect(() => {
    let vivant = true;
    void (async () => {
      try {
        const r = await api.commandes();
        if (vivant && r.ok && r.donnees) setSoldes(r.donnees.soldesAEncaisserXaf);
      } catch {
        /* hors ligne : la tuile ne s'affiche pas, le reste de l'ecran tient. */
      }
    })();
    return () => {
      vivant = false;
    };
  }, []);
  return soldes;
}

/** Deux questions, une fois. Rien d'autre n'est obligatoire pour commencer. */
function CreationProfil({ vendeuse }: { vendeuse: Vendeuse }) {
  /**
   * Compte ne de Google (ADR 0029) : pas de numero de connexion — le numero de
   * contact de la boutique se DECLARE ici. C'est celui du wa.me public : une
   * erreur prive la vendeuse de ses propres clientes, elle se corrige seule.
   */
  const demanderContact = !vendeuse.loginPhone;
  const { rafraichir } = useSession();
  const [nom, setNom] = useState("");
  const [ville, setVille] = useState("");
  const [contact, setContact] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const r = await api.creerProfil(
        nom.trim(),
        ville.trim(),
        demanderContact ? contact.trim() : undefined,
      );
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
          {demanderContact
            ? "Trois questions, une seule fois. Le nom est celui que vos clientes verront."
            : "Deux questions, une seule fois. Le nom est celui que vos clientes verront."}
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
          {demanderContact ? (
            <Field
              label="Numero WhatsApp de la boutique"
              htmlFor="contact"
              hint="Celui que vos clientes toucheront. Il se corrige dans Reglages."
            >
              <Input
                id="contact"
                name="contact"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </Field>
          ) : null}
          <p role="status" aria-live="polite" className="text-caption text-danger">
            {erreur}
          </p>
          <Button type="submit" size="lg" loading={enCours}>
            {enCours ? "Creation…" : "Ouvrir ma boutique"}
          </Button>
        </form>
      </Card>
    </Ecran>
  );
}
