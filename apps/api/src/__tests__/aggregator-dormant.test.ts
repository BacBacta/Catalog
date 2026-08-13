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

function walk(dir: string, keep = /\.(ts|tsx|mts|js|mjs)$/): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // le repertoire n'existe pas encore (src/jobs viendra plus tard)
  }
  for (const e of entries) {
    if (e === "node_modules" || e === "dist" || e === "generated" || e === ".astro") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(walk(p, keep));
    else if (keep.test(p)) out.push(p);
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

/**
 * La tolerance de l'ADR 0011, rendue opposable.
 *
 * DETTE PAYEE AU LOT 3. Les deux lignes `packages/db` ont disparu de la liste
 * ci-dessous : `Payment` et `PaymentEvent` ont ete remplaces par
 * `payment_proof`, et `check-schema.mjs` asserte desormais la contrainte
 * UNIQUE(operator, operator_tx_id) — le controle n° 5 — au lieu de
 * l'idempotence d'un webhook qui n'existe plus.
 *
 * Ce qui reste est la surface agregateur DORMANTE, qui doit rester compilable
 * (AGENTS.md §5), plus les deux gardes qui nomment « webhook » pour l'interdire.
 *
 * Un ADR qui documente une tolerance sans la faire respecter se perime en
 * silence : la liste fige donc l'etat connu. Toute occurrence NOUVELLE fait
 * echouer la CI, et le retrait d'un fichier la fait echouer aussi — ce qui
 * force a la mettre a jour au moment exact ou une dette est payee.
 */
const REPO = join(HERE, "..", "..", "..", "..");
const WEBHOOK_MENTION = /WAITING_FOR_CUSTOMER|webhook/i;

/**
 * Etat connu au 29/07/2026, apres paiement de la dette au lot 3.
 * Voir ADR 0011 pour la raison de chaque ligne.
 */
const MENTIONS_TOLEREES = [
  // Surface agregateur dormante — reste compilable, inatteignable en v1 (ADR 0009).
  "apps/api/src/adapters/campay.ts",
  "apps/api/src/domain/payment-provider.ts",
  "apps/api/src/__tests__/campay.test.ts",
  // Outillage du bac a sable, dormant lui aussi.
  "apps/api/scripts/README.md",
  "apps/api/scripts/campay-probe.mjs",
  "apps/api/scripts/webhook-capture.mjs",
  // Simulateur d'entrant sandbox (ADR 0035) : il NOMME la variable
  // `WABOT_WEBHOOK_AUTH` — celle du canal de MESSAGERIE de l'ADR 0027,
  // pas un webhook de paiement. Meme famille que webhook-capture.mjs.
  "apps/api/scripts/sandbox-entrant.mjs",
  // Meme raison pour l'outil qui RE-POSE ce webhook de messagerie apres une
  // rotation de cle du bac a sable (04/08/2026). Il ne connait ni commande, ni
  // paiement, ni etat : il ecrit une URL et un en-tete chez 360dialog.
  "apps/api/scripts/sandbox-webhook.mjs",
  // Gardes : ces fichiers nomment « webhook » pour l'INTERDIRE. C'est le
  // contraire d'une derive, et c'est aussi ce qui reste dans packages/db une
  // fois la dette du lot 3 payee — le modele de donnees n'en porte plus trace,
  // seules les interdictions le nomment.
  "apps/api/src/__tests__/app.test.ts",
  "apps/api/src/__tests__/aggregator-dormant.test.ts",
  "packages/db/prisma/schema.prisma",
  "packages/db/scripts/check-schema.mjs",
  /**
   * Le webhook de connexion WhatsApp entrant — ADR 0027, ajout du 01/08/2026.
   *
   * Ce n'est PAS un webhook de paiement, et c'est toute la difference que
   * l'ADR 0011 protege : aucun tiers n'y pilote l'etat d'une commande. Il
   * recoit le message de CONNEXION de la vendeuse, atteste par Meta, et ne
   * touche qu'a la table de verification de Better Auth. L'interdit du
   * webhook de paiement reste entier.
   */
  "apps/api/src/routes/whatsapp-entrant.ts",
  "apps/api/src/__tests__/connexion-whatsapp-flux.test.ts",
  "apps/api/src/server.ts",
  "apps/api/src/auth-connexion-whatsapp.ts",
  "apps/api/src/domain/connexion-whatsapp.ts",
  "apps/api/src/middleware/debit.ts",
  /* Le lecteur d'enveloppe partage par les deux parseurs de ce meme webhook
     de messagerie — ADR 0081. Meme raison que ci-dessus : il lit des formes
     de livraison, il ne connait ni commande ni paiement. */
  "apps/api/src/domain/enveloppe-entrante.ts",
  "apps/api/src/__tests__/connexion-whatsapp-domaine.test.ts",
].sort();

describe("ADR 0011 — les mentions de webhook restantes sont celles, et rien de plus", () => {
  it("aucune mention nouvelle dans apps/ ni packages/", () => {
    const trouves = ["apps", "packages"]
      .flatMap((d) => walk(join(REPO, d), /\.(ts|tsx|mts|js|mjs|md|prisma|sql|astro|json|css)$/))
      .filter((f) => WEBHOOK_MENTION.test(readFileSync(f, "utf8")))
      .map((f) => relative(REPO, f).split("\\").join("/"))
      .sort();

    const nouvelles = trouves.filter((f) => !MENTIONS_TOLEREES.includes(f));
    expect(
      nouvelles,
      "mention de webhook hors du perimetre tolere par l'ADR 0011 — la v1 n'a pas de webhook de paiement",
    ).toEqual([]);

    const disparues = MENTIONS_TOLEREES.filter((f) => !trouves.includes(f));
    expect(
      disparues,
      "dette payee : retirer ces fichiers de MENTIONS_TOLEREES et mettre a jour l'ADR 0011",
    ).toEqual([]);
  });
});
