import { createPrismaClient } from "@catalog/db";
import { serve } from "@hono/node-server";
import app from "./app.ts";
import { payoutRoutes } from "./routes/payout.ts";

/**
 * Point d'entree. C'est ici que les dependances concretes sont branchees :
 * `app.ts` reste constructible sans base, ce qui permet de le tester nu.
 */
const prisma = createPrismaClient();

app.route("/api/reversement", payoutRoutes({ prisma }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`catalog-api ecoute sur http://localhost:${port}`);
