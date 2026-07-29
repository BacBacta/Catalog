import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client/client.ts";

export type * from "../generated/client/client.ts";
export { PrismaClient };

/**
 * Prisma 7 ne lit plus l'URL depuis le schema : le client recoit un adaptateur
 * de pilote. Voir ADR 0014.
 *
 * `TZ=Africa/Douala` n'est PAS pose ici : c'est un reglage de processus, pas de
 * connexion. Il vit dans la configuration Vitest, le Dockerfile et la CI —
 * sans lui, la fenetre de 48 h du controle d'horodatage derive d'une heure.
 */
export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error("DATABASE_URL manquant");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
