import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { garantiesSqlPosees } from "../adapters/garanties-sql.ts";
import { statutRoutes } from "../routes/statut.ts";

/**
 * La sonde des garanties SQL — residu A3 de l'audit 2026-08. Les CHECK et
 * triggers du lot 3 vivent hors des migrations (ADR 0014) : tous les chemins
 * de deploiement les appliquent, mais rien ne verifiait en PRODUCTION qu'ils
 * y sont. `/api/statut` le dit desormais.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
beforeAll(() => {
  if (URL) prisma = createPrismaClient(URL);
});
afterAll(async () => {
  await prisma?.$disconnect();
});

const lireStatut = async (garantiesSql?: () => Promise<boolean>) => {
  const app = statutRoutes({
    baseJoignable: async () => true,
    position: () => "ouvert",
    ...(garantiesSql ? { garantiesSql } : {}),
  });
  const r = await app.fetch(new Request("http://x/"));
  return (await r.json()) as { garantiesSql: string | null; niveau: string };
};

describe("la sonde des garanties dans /api/statut", () => {
  it("dit « posees » quand la sonde repond vrai, « manquantes » quand elle repond faux", async () => {
    expect((await lireStatut(async () => true)).garantiesSql).toBe("posees");
    expect((await lireStatut(async () => false)).garantiesSql).toBe("manquantes");
  });

  it("une sonde qui LEVE vaut « on ne sait pas », jamais « manquantes »", async () => {
    /* « La base ne repond pas » n'est pas « les triggers manquent » : le
       confondre ferait crier la mauvaise alerte le jour d'une panne. */
    const corps = await lireStatut(async () => {
      throw new Error("base injoignable");
    });
    expect(corps.garantiesSql).toBeNull();
  });

  it("sans sonde cablee, le champ est nul — rien n'est invente", async () => {
    expect((await lireStatut()).garantiesSql).toBeNull();
  });
});

describeDb("la requete signature, contre la vraie base", () => {
  it("trouve les quatre triggers d'ajout seul et les deux CHECK du lot 3", async () => {
    /* Le non-retour qui compte : si un renommage dans
       `sql/0001_constraints.sql` desynchronise la sonde, ce test tombe —
       avant que la production n'affiche « manquantes » a tort. */
    expect(await garantiesSqlPosees(prisma)).toBe(true);
  });
});
