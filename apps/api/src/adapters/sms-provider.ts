import type { SmsMessage, SmsSender } from "../domain/sms-sender.ts";

/**
 * Adaptateur pour un fournisseur SMS camerounais — **volontairement vide**.
 *
 * Aucun fournisseur n'est code en dur dans ce depot, et celui-ci n'en nomme
 * aucun. Il tient la place, avec la forme exacte que devra prendre
 * l'implementation : une methode `send`, une configuration injectee, et un echec
 * qui remonte.
 *
 * Ce qu'il faudra decider AVANT de le remplir, et qui n'est pas encore tranche :
 *
 * - **le fournisseur** — les passerelles locales facturent au message et leurs
 *   taux de delivrance varient selon l'operateur du destinataire ;
 * - **l'identifiant d'expediteur** (`SMS_SENDER_ID`) — au Cameroun il se
 *   declare aupres du regulateur, ce n'est pas un champ libre ;
 * - **le comportement en cas d'echec partiel** — une passerelle qui accepte le
 *   message puis ne le delivre pas est le cas courant, et il ne se voit pas
 *   depuis un code HTTP 200.
 *
 * Tant que ces trois points ne sont pas tranches, cet adaptateur leve. Lever est
 * le bon comportement : un envoi qu'on croit parti et qui ne part pas laisse la
 * vendeuse devant un champ qu'elle ne pourra jamais remplir.
 */
export interface SmsProviderConfig {
  apiKey: string;
  senderId: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class PendingSmsProvider implements SmsSender {
  readonly name = "provider-a-configurer";

  constructor(private readonly cfg: Partial<SmsProviderConfig> = {}) {}

  async send(message: SmsMessage): Promise<void> {
    const manquants = (["apiKey", "senderId", "baseUrl"] as const).filter((k) => !this.cfg[k]);
    throw new Error(
      "Aucun fournisseur SMS n'est configure. " +
        `Message non envoye : ${message.kind} vers ${message.to}. ` +
        (manquants.length
          ? `Configuration manquante : ${manquants.join(", ")}. `
          : "L'adaptateur attend son implementation. ") +
        "Voir apps/api/src/adapters/sms-provider.ts.",
    );
  }
}

/**
 * Choisit le fournisseur d'apres la configuration. C'est le SEUL endroit du
 * depot ou un nom de fournisseur apparait, et il n'en contient encore aucun.
 */
export function resolveSmsSender(
  env: { SMS_PROVIDER?: string | undefined; NODE_ENV?: string | undefined },
  fabriques: Record<string, () => SmsSender>,
): SmsSender {
  const nom = env.SMS_PROVIDER ?? "console";
  const fabrique = fabriques[nom];
  if (!fabrique) {
    throw new Error(
      `SMS_PROVIDER="${nom}" inconnu. Valeurs disponibles : ${Object.keys(fabriques).join(", ")}.`,
    );
  }
  return fabrique();
}
