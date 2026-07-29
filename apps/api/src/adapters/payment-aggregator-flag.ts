/**
 * Drapeau de reveil de l'agregateur de paiement — voir ADR 0009.
 *
 * La v1 de Catalog se passe d'agregateur : le paiement est un depot direct de
 * portefeuille a portefeuille, et la preuve vient du SMS de l'operateur. Ce
 * drapeau n'existe que pour permettre de rallumer l'adaptateur CamPay en
 * developpement, le jour ou l'on rouvrira la decision.
 *
 * Deux proprietes voulues :
 *
 * 1. Il est ABSENT par defaut. Une variable non definie vaut « desactive » —
 *    il n'y a pas de valeur par defaut « activee » a oublier de retirer.
 * 2. Sa simple LECTURE echoue en production. Ce n'est pas une garde qu'on
 *    contourne en posant la variable a « true » sur le serveur : en
 *    production, il n'existe aucune valeur qui l'active.
 */

export const PAYMENT_AGGREGATOR_FLAG = "PAYMENT_AGGREGATOR_ENABLED" as const;

export interface FlagEnv {
  NODE_ENV?: string | undefined;
  PAYMENT_AGGREGATOR_ENABLED?: string | undefined;
}

/**
 * Repond « l'agregateur est-il reveille ? ».
 *
 * @throws en production, systematiquement — quelle que soit la valeur du
 * drapeau. La v1 n'a pas d'agregateur : lire ce drapeau sur un serveur de
 * production signale un chemin de code qui n'aurait jamais du exister.
 */
export function isPaymentAggregatorEnabled(env: FlagEnv = process.env): boolean {
  if (env.NODE_ENV === "production") {
    throw new Error(
      `${PAYMENT_AGGREGATOR_FLAG} est illisible en production : la v1 de Catalog ` +
        "se passe d'agregateur (ADR 0009). Si ce code s'execute, c'est qu'un " +
        "chemin v1 appelle l'adaptateur dormant — corriger l'appelant, pas ce drapeau.",
    );
  }
  return env[PAYMENT_AGGREGATOR_FLAG] === "true";
}
