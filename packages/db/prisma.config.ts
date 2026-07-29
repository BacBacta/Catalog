import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 sort l'URL de connexion du schema : `datasource.url` y est refuse.
 * Elle vit ici pour les commandes de migration, et le client la recoit via un
 * adaptateur de pilote (`@prisma/adapter-pg`). Voir ADR 0014.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: env("DATABASE_URL") },
  migrations: {
    path: "prisma/migrations",
    seed: "node --experimental-strip-types prisma/seed.ts",
  },
});
