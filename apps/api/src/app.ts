import { Hono } from "hono";
import { health } from "./routes/health.ts";

export const app = new Hono();

app.route("/health", health);

/**
 * Il n'y a PAS d'URL de notification de paiement, et il ne doit pas y en
 * avoir : la v1 se passe d'agregateur (ADR 0009). Catalog n'observe aucun
 * paiement en direct — il le constate ensuite, par le SMS que la vendeuse
 * colle. Un point d'entree qui reapparaitrait ici serait le premier signe
 * que l'architecture derive.
 */

export default app;
