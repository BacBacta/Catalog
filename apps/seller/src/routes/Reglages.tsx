import { Badge, Button, Card, CardNote, CardTitle, Separator } from "@catalog/ui";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { useConges } from "../components/conges.tsx";
import { Ecran } from "../components/Ecran.tsx";
import { IconeAppareil, IconeBoutique, IconeChevron, IconeRecu } from "../components/icones.tsx";
import { Protege } from "../components/Protege.tsx";
import { api, type Vendeuse } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";

/**
 * Reglages — nouvel ecran de la refonte (ADR 0030).
 *
 * Avant lui, la configuration vivait eparpillee sur le tableau de bord, et
 * `/appareils` n'etait relie a RIEN : l'ecran existait, aucun lien n'y menait.
 * Ici vivent : la connexion, le numero de reversement, les appareils scelles,
 * la boutique publique, et la deconnexion.
 *
 * Le tableau de bord garde sa carte de reversement : c'est le champ qu'un
 * attaquant chercherait a detourner, il merite d'etre VU, pas range.
 */
export function Reglages() {
  return <Protege>{(v) => <Contenu vendeuse={v} />}</Protege>;
}

function LigneLien({
  vers,
  icone,
  titre,
  note,
  badge,
}: {
  vers: string;
  icone: ReactNode;
  titre: string;
  note?: string;
  badge?: ReactNode;
}) {
  return (
    <Link
      to={vers}
      className="flex min-h-[var(--size-touch)] items-center gap-3.5 rounded-field px-2 py-2.5 transition-colors duration-fast hover:bg-plane"
    >
      <span aria-hidden="true" className="text-brand-500">
        {icone}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body font-semibold text-ink">{titre}</span>
        {note ? <span className="truncate text-caption text-muted">{note}</span> : null}
      </span>
      {badge}
      <span aria-hidden="true" className="text-muted">
        <IconeChevron taille={18} />
      </span>
    </Link>
  );
}

/**
 * Le mode conges — ADR 0039.
 *
 * L'ecran dit ce que la bascule fait ET ce qu'elle ne fait pas. Sans la
 * seconde moitie, une vendeuse peut croire qu'elle annule ses commandes en
 * cours ou qu'elle retire sa boutique — et ne l'utilisera jamais.
 *
 * Aucune date de retour n'est demandee : elle serait fausse le jour ou elle
 * passe, et personne ne la corrigerait. C'est la meme discipline que le stock
 * (ADR 0038) — on ne promet pas ce qu'on ne tient pas.
 */
function CarteConges({ depuis }: { depuis: string | null }) {
  /* La requete et l'etat vivent dans `components/conges.tsx` — ADR 0056.
     L'accueil porte le meme geste ; deux copies auraient derive. */
  const { ferme, enCours, erreur, basculer } = useConges(depuis);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle>Mode conges</CardTitle>
        {ferme ? (
          <Badge tone="warn">Fermee aux commandes</Badge>
        ) : (
          <Badge tone="good">Ouverte</Badge>
        )}
      </div>
      <CardNote>
        {ferme ? (
          <>
            Votre boutique reste en ligne — lien, articles, avis — mais n'accepte plus de{" "}
            <strong className="text-ink">nouvelle</strong> commande. Vos commandes en cours
            continuent normalement.
          </>
        ) : (
          <>
            Vous partez, vous etes malade, vous n'avez plus de marchandise ? Fermez aux commandes
            plutot que d'en accepter que vous ne pourrez pas honorer. Votre boutique reste visible
            et vos clientes peuvent toujours vous ecrire.
          </>
        )}
      </CardNote>
      <p role="status" aria-live="polite" className="text-caption text-danger">
        {erreur}
      </p>
      <Button
        tone={ferme ? "primary" : "outline"}
        size="lg"
        loading={enCours}
        onClick={() => void basculer()}
      >
        {ferme ? "Je reprends les commandes" : "Fermer aux commandes"}
      </Button>
    </Card>
  );
}

/**
 * Renommer la boutique — ADR 0092, constat C-002 de l'audit du 13/08/2026.
 *
 * Le harnais a montre qu'un nom pose au deuxieme message du fil etait
 * DEFINITIF : aucun chemin de renommage n'existait dans tout le produit. Or ce
 * nom est aussi l'adresse publique de la boutique.
 *
 * **L'adresse ne change pas, et l'ecran le dit en toutes lettres.** Elle a
 * peut-etre deja ete partagee — en Statut, dans une chaine, dans le QR d'une
 * carte imprimee — et la casser en silence produirait le defaut de l'ADR 0073 :
 * un lien qui mene a un 404 se voit chez l'acheteuse, une fois.
 */
function CarteNom({ seller }: { seller: NonNullable<Vendeuse["seller"]> }) {
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState(seller.businessName);
  const [ville, setVille] = useState(seller.city);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");
  const [fait, setFait] = useState(false);

  async function enregistrer() {
    setErreur("");
    setFait(false);
    if (nom.trim().length < 2 || ville.trim().length < 2) {
      setErreur("Le nom et la ville sont necessaires.");
      return;
    }
    setEnCours(true);
    try {
      await api.renommer(nom.trim(), ville.trim());
      setFait(true);
      setOuvert(false);
    } catch {
      setErreur("Le changement n'a pas pu etre enregistre. Reessayez.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Card>
      <CardTitle>Nom de la boutique</CardTitle>
      <CardNote>
        <strong className="text-ink">{seller.businessName}</strong> · {seller.city}
      </CardNote>
      {ouvert ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-caption">
            Nom de la boutique
            <input
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-body text-ink"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              autoComplete="organization"
            />
          </label>
          <label className="flex flex-col gap-1 text-caption">
            Ville
            <input
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-body text-ink"
              value={ville}
              onChange={(e) => setVille(e.target.value)}
              autoComplete="address-level2"
            />
          </label>
          <CardNote>
            Votre adresse en ligne ne change pas : elle reste{" "}
            <strong className="text-ink">/{seller.slug}</strong>. C'est voulu — vous l'avez
            peut-etre deja partagee en Statut ou sur une affiche, et un lien casse mene vos clientes
            sur une page vide.
          </CardNote>
          <p role="status" aria-live="polite" className="text-caption text-danger">
            {erreur}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" loading={enCours} onClick={() => void enregistrer()}>
              Enregistrer
            </Button>
            <Button tone="outline" size="lg" onClick={() => setOuvert(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p role="status" aria-live="polite" className="text-caption text-ink-3">
            {fait ? "C'est enregistre." : ""}
          </p>
          <Button tone="outline" size="lg" onClick={() => setOuvert(true)}>
            Corriger le nom
          </Button>
        </>
      )}
    </Card>
  );
}

function Contenu({ vendeuse }: { vendeuse: Vendeuse }) {
  const { deconnecter } = useSession();
  const seller = vendeuse.seller;

  return (
    <Ecran titre="Reglages" surtitre="Espace vendeuse">
      <Card>
        <CardTitle>Votre connexion</CardTitle>
        <CardNote>
          {vendeuse.loginPhone ? (
            <>
              Vous vous connectez avec le{" "}
              <strong className="text-ink">{vendeuse.loginPhone}</strong>.
            </>
          ) : (
            "Vous vous connectez avec votre compte Google."
          )}
        </CardNote>
      </Card>

      {seller ? (
        <Card className="gap-1 py-2">
          <LigneLien
            vers="/reversement"
            icone={<IconeRecu />}
            titre="Numero de reversement"
            note={seller.payoutPhone ?? "Pas encore regle"}
            badge={
              seller.payoutPhone ? (
                <Badge tone="good">Verifie</Badge>
              ) : (
                <Badge tone="warn">A regler</Badge>
              )
            }
          />
          <Separator />
          <LigneLien
            vers="/appareils"
            icone={<IconeAppareil />}
            titre="Appareils scelles"
            note="Les telephones qui ouvrent votre espace avec l'empreinte"
          />
          <Separator />
          <LigneLien
            vers="/verifier"
            icone={<IconeBoutique />}
            titre="Votre boutique"
            note={`${seller.city} · lien public /${seller.slug}`}
          />
        </Card>
      ) : null}

      {seller ? <CarteNom seller={seller} /> : null}

      {seller ? <CarteConges depuis={seller.congesDepuis} /> : null}

      <Card>
        <CardTitle>Session</CardTitle>
        <CardNote>Vous pourrez revenir avec votre numero, votre cle ou votre compte.</CardNote>
        <Button tone="outline" size="lg" onClick={() => void deconnecter()}>
          Me deconnecter
        </Button>
      </Card>
    </Ecran>
  );
}
