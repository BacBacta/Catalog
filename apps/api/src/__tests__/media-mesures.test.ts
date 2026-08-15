import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LecteurMediaWhatsapp } from "../adapters/whatsapp-media.ts";
import { mesurerMediaBot } from "../observabilite/mesures.ts";

/**
 * La chaine media SE VOIT — ADR 0092, non-retour du constat D4 de l'audit
 * 2026-08 : « zero compteur sur toute la couche media — une panne du CDN Meta
 * produit des articles sans photo en serie, indistinguable en agregat de
 * vendeuses qui n'envoient pas de photos ».
 *
 * Ces tests branchent un VRAI lecteur de metriques en memoire et verifient
 * que chaque etape (lecture, lecture_cdn, dechiffrement) emet son point avec
 * ses etiquettes fermees — pas seulement que la fonction existe.
 */

const exporteur = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
let lecteurMetriques: PeriodicExportingMetricReader;

/** Tous les points du compteur `catalog.bot.media` collectes jusqu'ici. */
async function pointsMedia(): Promise<Array<Record<string, unknown>>> {
  await lecteurMetriques.forceFlush();
  const points: Array<Record<string, unknown>> = [];
  for (const ressource of exporteur.getMetrics()) {
    for (const portee of ressource.scopeMetrics) {
      for (const metrique of portee.metrics) {
        if (metrique.descriptor.name !== "catalog.bot.media") continue;
        for (const point of metrique.dataPoints) {
          points.push(point.attributes as Record<string, unknown>);
        }
      }
    }
  }
  return points;
}

beforeAll(() => {
  /* Un intervalle d'une heure : seul `forceFlush` exporte, jamais un minuteur. */
  lecteurMetriques = new PeriodicExportingMetricReader({
    exporter: exporteur,
    exportIntervalMillis: 3600_000,
  });
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [lecteurMetriques] }));
});

afterAll(async () => {
  await lecteurMetriques.shutdown();
  metrics.disable();
});

const CFG = { apiKey: "cle", baseUrl: "https://waba.test/v1", transport: "360dialog" as const };

describe("la chaine media du bot emet ses compteurs (ADR 0092)", () => {
  it("une lecture qui echoue compte `lecture / echec` — la panne CDN devient visible", async () => {
    const lecteur = new LecteurMediaWhatsapp({
      ...CFG,
      fetchImpl: (async () => new Response("panne", { status: 500 })) as never,
    });
    expect(await lecteur.lire("MEDIA-KO")).toBeNull();
    expect(await pointsMedia()).toContainEqual({ etape: "lecture", issue: "echec" });
  });

  it("une lecture qui aboutit compte `lecture / ok`", async () => {
    const octets = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const lecteur = new LecteurMediaWhatsapp({
      ...CFG,
      /* Forme v1 : les octets tout de suite, sans detour JSON. */
      fetchImpl: (async () =>
        new Response(octets, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        })) as never,
    });
    expect(await lecteur.lire("MEDIA-OK")).not.toBeNull();
    expect(await pointsMedia()).toContainEqual({ etape: "lecture", issue: "ok" });
  });

  it("le CDN separe TELECHARGEMENT et DECHIFFREMENT — deux pannes, deux enquetes", async () => {
    const lecteur = new LecteurMediaWhatsapp({
      ...CFG,
      fetchImpl: (async () => new Response(new Uint8Array(64), { status: 200 })) as never,
    });
    /* Telechargement reussi, cles fausses : le dechiffrement verifie refuse. */
    const media = await lecteur.lireCdn({
      url: "https://cdn.test/fichier",
      encryptionKey: Buffer.alloc(32).toString("base64"),
      hmacKey: Buffer.alloc(32).toString("base64"),
      iv: Buffer.alloc(16).toString("base64"),
      plaintextHash: Buffer.alloc(32).toString("base64"),
      encryptedHash: Buffer.alloc(32).toString("base64"),
    });
    expect(media).toBeNull();
    const points = await pointsMedia();
    expect(points).toContainEqual({ etape: "lecture_cdn", issue: "ok" });
    expect(points).toContainEqual({ etape: "dechiffrement", issue: "echec" });
  });

  it("le re-encodage compte sa raison de refus, jamais un texte libre", async () => {
    /* Le site d'appel (`creerArticleDepuisFil`) passe la raison du verdict —
       quatre valeurs de `RefusImage` plus `illisible` : cardinalite fermee. */
    mesurerMediaBot("reencodage", "fichier_trop_gros");
    expect(await pointsMedia()).toContainEqual({
      etape: "reencodage",
      issue: "fichier_trop_gros",
    });
  });
});
