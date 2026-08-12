import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { observerFuitesEvitees } from "./mesures.ts";
import { ProcesseurDeRedaction } from "./redaction.ts";
import { NOM_SERVICE } from "./traces.ts";

/**
 * Le branchement du SDK. **Importe par `server.ts` et par personne d'autre.**
 *
 * ── L'observabilite ne s'allume pas toute seule ────────────────────────────
 *
 * Sans `OTEL_EXPORTER_OTLP_ENDPOINT`, ce module ne demarre RIEN et le dit. Le
 * code instrumente continue de tourner : quand aucun SDK n'est enregistre,
 * l'API d'OpenTelemetry rend un tracer et un metre sans effet, dont les appels
 * ne coutent presque rien. C'est ce qui permet aux tests, au developpement et
 * aux tests de bout en bout de ne pas attendre un collecteur qui n'existe pas.
 *
 * Le contraire — un SDK qui demarre par defaut et tente d'exporter vers
 * `localhost:4318` — ajoute une erreur reseau toutes les cinq secondes dans un
 * journal de developpement, et on apprend a l'ignorer. Un journal qu'on apprend
 * a ignorer est un journal perdu.
 *
 * ── L'ordre des processeurs n'est pas negociable ───────────────────────────
 *
 * `ProcesseurDeRedaction` enveloppe `BatchSpanProcessor`, il ne le suit pas. Un
 * span passe par la redaction PUIS par le lot d'export. Inverse, le lot
 * exporterait le span tel quel et la redaction nettoierait un objet deja parti.
 */

let sdk: NodeSDK | null = null;

export interface OptionsObservabilite {
  /** L'URL du collecteur. Absente, rien ne demarre. */
  endpoint?: string | undefined;
  version?: string | undefined;
  /** Intervalle d'export des metriques, en millisecondes. */
  intervalleMetriquesMs?: number;
  /** L'environnement, injectable pour que le message se teste sans le muter. */
  env?: NodeJS.ProcessEnv | undefined;
}

export function demarrerObservabilite(options: OptionsObservabilite = {}): {
  actif: boolean;
  raison?: string;
} {
  if (sdk) return { actif: true };

  const endpoint = options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    /**
     * Le message affirmait « c'est le comportement voulu hors production » — y
     * compris sur une machine `NODE_ENV=production`, ou il est faux. Une ligne
     * de journal qui rassure a tort est pire que pas de ligne du tout : c'est
     * exactement celle qu'on relit en cherchant pourquoi aucune alerte n'est
     * partie pendant un incident.
     */
    const enProduction = (options.env ?? process.env).NODE_ENV === "production";
    return {
      actif: false,
      raison:
        "OTEL_EXPORTER_OTLP_ENDPOINT absent : traces et metriques sont inertes. " +
        (enProduction
          ? "EN PRODUCTION : aucune alerte ne partira, et le canari de formats " +
            "est aveugle. Poser l'endpoint."
          : "C'est le comportement voulu hors production."),
    };
  }

  const redaction = new ProcesseurDeRedaction(
    new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })),
  );
  observerFuitesEvitees(redaction);

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: NOM_SERVICE,
      [ATTR_SERVICE_VERSION]: options.version ?? process.env.CATALOG_VERSION ?? "0.0.0",
    }),
    spanProcessors: [redaction],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: options.intervalleMetriquesMs ?? 60_000,
    }),
    /**
     * **Aucune auto-instrumentation.**
     *
     * `@opentelemetry/auto-instrumentations-node` capture les requetes HTTP
     * sortantes, les requetes SQL et leurs parametres. Les parametres SQL de ce
     * produit contiennent `rawSms` — chiffre, mais aussi `counterpartyPhone`,
     * `buyerPhone` et `buyerToken` en clair. Le jeton de suivi est le SECRET qui
     * autorise la contre-signature (ADR 0021) : le voir passer dans une trace
     * reviendrait a le publier.
     *
     * Le filet de redaction l'attraperait probablement. « Probablement » n'est
     * pas un mot acceptable ici : on n'allume pas la capture.
     */
    instrumentations: [],
  });

  sdk.start();
  return { actif: true };
}

/** Vide les lots en attente. A appeler avant un arret propre. */
export async function arreterObservabilite(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}
