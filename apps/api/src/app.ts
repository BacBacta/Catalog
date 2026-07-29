import { Hono } from "hono";
import { health } from "./routes/health.ts";

export const app = new Hono();

app.route("/health", health);

/**
 * L'URL de notification de paiement vivra ici (phase 2). Elle ne fait QUE
 * recevoir : pas de redirection, pas de HTML, et elle repond au GET pour les
 * tests de disponibilite des agregateurs. Elle est volontairement servie par
 * un point d'entree minimal, capable de survivre a une panne du reste de
 * l'application.
 */
app.get("/webhooks/payment", (c) => c.text("ok"));

export default app;
