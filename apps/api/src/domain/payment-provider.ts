import type { PaymentStatus } from "@catalog/contracts";

/**
 * INTERFACE EN DORMANCE — voir ADR 0009.
 *
 * C'est le contrat que l'adaptateur CamPay implemente. La v1 se passe
 * d'agregateur : aucune route, aucun job et aucun ecran ne depend de ce
 * fichier, et il n'a pas d'autre implementation. Il reste la, avec
 * l'adaptateur, pour que l'ensemble soit encore compilable le jour ou l'on
 * rouvrira la decision. Les mots « webhook » et « notification » qu'il
 * contient decrivent ce monde-la, pas la v1.
 *
 * Le domaine ne connait aucun agregateur. On doit pouvoir changer de
 * prestataire sans toucher au metier — c'est aussi ce qui rend le domaine
 * testable sans reseau.
 */

export type Operator = "mtn" | "orange";

export interface InitiateInput {
  /** Entier XAF. Le FCFA n'a pas de sous-unite. */
  amountXaf: number;
  /** Notre reference de commande — voyage jusqu'au releve du prestataire. */
  orderRef: string;
  /** Numero du payeur, E.164 : +237XXXXXXXXX */
  payerPhone: string;
  description: string;
}

export interface InitiateResult {
  /** Identifiant du prestataire. Cle d'idempotence de nos webhooks. */
  providerTxId: string;
  /**
   * Code USSD que le payeur peut composer si la notification push n'arrive
   * pas. Tous les prestataires ne le fournissent pas.
   */
  ussdCode?: string;
  operator?: Operator;
  redirectUrl?: string;
}

export interface StatusResult {
  status: PaymentStatus;
  amountXaf?: number;
  /**
   * Reference de transaction de l'OPERATEUR (celle qui figure dans le SMS
   * recu par la vendeuse), quand le prestataire l'expose. Beaucoup ne
   * l'exposent pas : dans ce cas le rapprochement avec le SMS passe par
   * le triplet montant + numero + horodatage.
   */
  operatorRef?: string;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly name: string;

  /** Declenche la demande de paiement chez le payeur. */
  initiate(input: InitiateInput): Promise<InitiateResult>;

  /**
   * Verifie la signature d'une notification, en comparaison a temps constant.
   * Le resultat n'autorise PAS a croire le contenu.
   */
  verifySignature(rawBody: string, headers: Record<string, string>): boolean;

  /**
   * Seule source d'autorite sur le statut. Le contenu du webhook n'est jamais
   * une preuve : on rappelle toujours le prestataire.
   */
  checkStatus(providerTxId: string): Promise<StatusResult>;
}
