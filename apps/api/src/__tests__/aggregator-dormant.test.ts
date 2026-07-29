import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isPaymentAggregatorEnabled,
  PAYMENT_AGGREGATOR_FLAG,
} from "../adapters/payment-aggregator-flag.ts";

/**
 * Le garde-fou du lot 0 (ADR 0009).
 *
 * L'adaptateur CamPay reste dans le depot et reste compilable, mais il doit
 * etre INATTEIGNABLE depuis un chemin de code v1. Ce test echoue si quelqu'un
 * le rebranche depuis une route ou un job. Si un jour il saute, ce n'est pas
 * un detail de proprete : c'est l'architecture qui derive.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");

/** Repertoires d'ou l'adaptateur ne doit JAMAIS etre atteignable. */
const V1_CODE_PATHS = ["routes", "jobs"];

/** Ce qui trahit un import de l'adaptateur, quelle que soit la forme. */
const FORBIDDEN = /(from|import|require)\s*\(?\s*["'][^"']*adapters\/campay(\.ts)?["']/;

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // le repertoire n'existe pas encore (src/jobs viendra plus tard)
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

describe("l'adaptateur agregateur est en dormance", () => {
  it("aucune route et aucun job n'importe adapters/campay", () => {
    const coupables: string[] = [];
    for (const d of V1_CODE_PATHS) {
      for (const file of walk(join(SRC, d))) {
        if (FORBIDDEN.test(readFileSync(file, "utf8"))) {
          coupables.push(relative(SRC, file));
        }
      }
    }
    expect(
      coupables,
      `chemin v1 rebranche sur l'adaptateur dormant : ${coupables.join(", ")}`,
    ).toEqual([]);
  });

  it("le motif du garde-fou reconnait bien un import, sinon il ne garde rien", () => {
    // Sans ce test, une faute de frappe dans FORBIDDEN rendrait le garde-fou
    // muet : il passerait au vert en ne regardant rien.
    expect(FORBIDDEN.test('import { CampayProvider } from "../adapters/campay.ts";')).toBe(true);
    expect(FORBIDDEN.test('import type { X } from "./adapters/campay";')).toBe(true);
    expect(FORBIDDEN.test('const c = require("../../adapters/campay.ts");')).toBe(true);
    expect(FORBIDDEN.test('import { health } from "./routes/health.ts";')).toBe(false);
  });
});

describe(PAYMENT_AGGREGATOR_FLAG, () => {
  it("est absent par defaut — pas de valeur activee a oublier de retirer", () => {
    expect(isPaymentAggregatorEnabled({})).toBe(false);
    expect(isPaymentAggregatorEnabled({ NODE_ENV: "development" })).toBe(false);
  });

  it("s'active explicitement hors production", () => {
    expect(
      isPaymentAggregatorEnabled({ NODE_ENV: "development", PAYMENT_AGGREGATOR_ENABLED: "true" }),
    ).toBe(true);
  });

  it("ne s'active pas sur une valeur approximative", () => {
    for (const v of ["1", "yes", "TRUE", "oui", ""]) {
      expect(isPaymentAggregatorEnabled({ PAYMENT_AGGREGATOR_ENABLED: v })).toBe(false);
    }
  });

  it("sa LECTURE echoue en production, meme quand il n'est pas pose", () => {
    expect(() => isPaymentAggregatorEnabled({ NODE_ENV: "production" })).toThrow(/production/);
  });

  it("aucune valeur ne l'active en production — la garde ne se contourne pas", () => {
    expect(() =>
      isPaymentAggregatorEnabled({ NODE_ENV: "production", PAYMENT_AGGREGATOR_ENABLED: "true" }),
    ).toThrow(/ADR 0009/);
  });
});
