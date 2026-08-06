import { Badge, Button, Card, CardNote, CardTitle, Separator } from "@catalog/ui";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { IconeAppareil, IconeBoutique, IconeChevron, IconeRecu } from "../components/icones.tsx";
import { Protege } from "../components/Protege.tsx";
import { api, messageDErreur, type Vendeuse } from "../lib/api.ts";
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
