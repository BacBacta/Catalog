import { formatXaf } from "@catalog/contracts/money";
import { formatPhone } from "@catalog/contracts/phone";
import { lienVersement } from "@catalog/contracts/whatsapp";

/**
 * Ecran 3 — l'attente, et elle est HONNETE.
 *
 * **Catalog ne sait pas si le paiement a abouti.** Aucun retour ne lui parvient :
 * ni notification d'operateur, ni API d'agregateur, ni resultat de session USSD.
 * La rampe ouvre un composeur et s'arrete la. Cet ecran ne peut donc annoncer ni
 * succes ni echec, et il ne doit surtout pas essayer.
 *
 * Ce qu'il dit est vrai et verifiable : la vendeuse recevra le SMS de son
 * operateur, et c'est en le collant dans Catalog qu'elle fera exister le recu.
 * C'est elle qui a l'argent, donc c'est son message qui fait autorite — et c'est
 * ce qui fait disparaitre la fraude a la fausse capture d'ecran.
 *
 * Un test verifie qu'aucune formule de confirmation n'apparait ici. Ce n'est pas
 * une precaution de style : « paiement confirme » affiche par un systeme qui ne
 * sait rien serait exactement le mensonge que le produit existe pour remplacer.
 */

export interface AttenteProps {
  numero: string;
  montantXaf: number;
  /** Numero WhatsApp de la vendeuse, quand il est connu. */
  whatsapp?: string;
  reference?: string;
}

export function Attente({ numero, montantXaf, whatsapp, reference }: AttenteProps) {
  let lien: string | null = null;
  if (whatsapp) {
    try {
      lien = lienVersement(whatsapp, { numeroReversement: numero, montantXaf }, reference);
    } catch {
      // Numero de vendeuse invalide : pas de lien mort.
      lien = null;
    }
  }

  return (
    <section class="flex flex-col gap-4" data-testid="attente">
      <h2 class="text-title font-bold text-ink">Le/la vendeur/se confirmera la reception</h2>

      <p class="text-body text-ink-2">
        Vous avez compose un transfert de <strong class="text-ink">{formatXaf(montantXaf)}</strong>{" "}
        vers le <strong class="text-ink">{formatPhone(numero)}</strong>.
      </p>

      <p class="rounded-card border border-line bg-surface p-4 text-caption text-ink-2">
        Catalog n'a pas de fenetre sur votre operateur : nous ne voyons pas passer les transferts.
        La boutique, elle, recoit un SMS de son operateur. Une fois ce SMS colle dans Catalog, le
        recu apparait, avec l'identifiant de transaction — et c'est ce recu qui vaut preuve, pas une
        capture d'ecran.
      </p>

      <p class="text-caption text-ink-2">
        Si la session s'est arretee en route, rien n'est perdu et rien n'a ete debite : revenez en
        arriere et reprenez par le menu de votre operateur.
      </p>

      {lien ? (
        <a
          href={lien}
          rel="noopener"
          data-testid="prevenir-vendeuse"
          class="inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-field bg-brand-fill px-5 py-3 text-body font-semibold text-brand-on-fill"
        >
          Prevenir le/la vendeur/se sur WhatsApp
        </a>
      ) : (
        <p class="text-caption text-muted">
          Prevenez le/la vendeur/se sur WhatsApp : le numero et le montant sont ecrits ci-dessus.
        </p>
      )}
    </section>
  );
}

export default Attente;
