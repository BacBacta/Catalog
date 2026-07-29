import type { SmsMessage, SmsSender } from "../domain/sms-sender.ts";

/**
 * Fournisseur SMS factice, pour le developpement et les tests.
 *
 * Il n'envoie rien : il ecrit dans la sortie standard. C'est ce qui permet de
 * parcourir tout le chemin d'authentification sans compte chez un operateur et
 * sans depenser un franc.
 *
 * **Il refuse de se charger en production.** Un fournisseur factice actif en
 * production, ce sont des OTP que personne ne recoit et une vendeuse enfermee
 * dehors — panne silencieuse, et la pire de ce module.
 */
export class ConsoleSmsSender implements SmsSender {
  readonly name = "console";
  /** Les messages envoyes, pour que les tests puissent les relire. */
  readonly envoyes: SmsMessage[] = [];

  constructor(env: { NODE_ENV?: string | undefined } = process.env) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "ConsoleSmsSender est un fournisseur de developpement : en production, " +
          "aucun OTP ne partirait et les vendeuses resteraient dehors. " +
          "Configurez SMS_PROVIDER sur un vrai fournisseur.",
      );
    }
  }

  async send(message: SmsMessage): Promise<void> {
    this.envoyes.push(message);
    // Le texte contient le code : c'est acceptable ICI, et seulement ici,
    // parce que ce fournisseur ne tourne jamais en production.
    console.log(`[SMS:${message.kind}] → ${message.to}\n  ${message.text}`);
  }

  /** Dernier code a six chiffres envoye a ce numero. Reserve aux tests. */
  dernierCode(to: string): string | null {
    for (let i = this.envoyes.length - 1; i >= 0; i--) {
      const m = this.envoyes[i];
      if (m?.to !== to) continue;
      const code = /\b(\d{4,8})\b/.exec(m.text)?.[1];
      if (code) return code;
    }
    return null;
  }
}
