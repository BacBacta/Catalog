import { Badge, Button, Card, CardNote, CardTitle, Separator } from "@catalog/ui";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { IconeAppareil, IconeBoutique, IconeChevron, IconeRecu } from "../components/icones.tsx";
import { Protege } from "../components/Protege.tsx";
import type { Vendeuse } from "../lib/api.ts";
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
