import { createPrismaClient } from "@catalog/db";
import { demarrerObservabilite } from "./observabilite/demarrage.ts";
import { serve } from "@hono/node-server";
import { PrismaOtpAttemptStore } from "./adapters/otp-attempt-store.ts";
import { PayoutOtpStore } from "./adapters/payout-otp-store.ts";
import { resolveChiffreurSms } from "./adapters/sms-chiffre.ts";
import { ConsoleSmsSender } from "./adapters/sms-console.ts";
import { MemoryStorage, resolveStorage } from "./adapters/storage-s3.ts";
import app from "./app.ts";
import { createAuth, smsSenderDepuisEnv } from "./auth.ts";
import { rampeDepuisEnv } from "./domain/ramp/config.ts";
import { limitesDepuisEnv } from "./domain/rate-limit.ts";
import { authRoutes } from "./routes/auth.ts";
import { commandeRoutes } from "./routes/commandes.ts";
import { devOtpRoutes } from "./routes/dev-otp.ts";
import { mediaRoutes } from "./routes/media.ts";
import { payoutRoutes } from "./routes/payout.ts";
import { preuveRoutes } from "./routes/preuve.ts";
import { productRoutes } from "./routes/products.ts";
import { rampeRoutes } from "./routes/rampe.ts";
import { recuRoutes, suiviRoutes } from "./routes/recu.ts";
import { sellerRoutes } from "./routes/seller.ts";
import { statsRoutes } from "./routes/stats.ts";

/**
 * Point d'entree. C'est ici que les dependances concretes sont branchees :
 * `app.ts` reste constructible sans base, ce qui permet de le tester nu.
 */
const prisma = createPrismaClient();
const sms = smsSenderDepuisEnv();
const otpStore = new PrismaOtpAttemptStore(prisma);
const storage = resolveStorage();
const limits = limitesDepuisEnv(process.env);
const auth = createAuth({ prisma, sms });
const session = {
  prisma,
  session: (req: Request) => auth.api.getSession({ headers: req.headers }),
};

app.route("/api/auth", authRoutes({ handler: auth.handler, otpStore, limits }));
app.route("/api/vendeuse", sellerRoutes(session));
app.route(
  "/api/reversement",
  payoutRoutes({
    prisma,
    session,
    otp: new PayoutOtpStore({ prisma }),
    sms,
    otpStore,
    limits,
  }),
);

app.route("/api/articles", productRoutes({ prisma, session, storage }));
// Les statistiques : sous session, et filtrees par la vendeuse de la session.
// Aucun identifiant de boutique ne circule dans l'URL — ce serait un numero a
// essayer, et les chiffres d'une vendeuse ne regardent qu'elle.
app.route("/api/statistiques", statsRoutes({ prisma, session }));
app.route("/api/commandes", preuveRoutes({ prisma, session, chiffreur: resolveChiffreurSms() }));
// Le cycle de vie, sur le MEME prefixe. Les deux routeurs se partagent
// `/api/commandes` sans se recouvrir : `preuveRoutes` tient `GET /:id` et
// `POST /:id/preuve`, celui-ci tient la liste, l'avancement d'etape et la
// declaration de paiement.
app.route("/api/commandes", commandeRoutes({ prisma, session }));

// La rampe : publique, sans session. C'est une acheteuse qui la lit, depuis la
// boutique statique, et c'est ce qui permet de changer un code d'operateur sans
// reconstruire le site.
const rampe = rampeDepuisEnv(process.env);
app.route("/api/rampe", rampeRoutes(rampe));

// Le recu et le suivi : publics, sans session. C'est une ACHETEUSE qui les lit,
// et c'est le principe meme du recu — n'importe qui doit pouvoir controler.
app.route("/api/recu", recuRoutes({ prisma, rampe, session }));
app.route("/api/suivi", suiviRoutes({ prisma, rampe }));

// Uniquement quand le fournisseur factice est actif — donc jamais en production,
// ou `ConsoleSmsSender` refuse de se construire.
const dev = devOtpRoutes({ console: sms instanceof ConsoleSmsSender ? sms : null });
if (dev) app.route("/api/dev", dev);

// De meme pour le stockage en memoire : avec un vrai S3, l'URL signee pointe
// chez le fournisseur et cette route n'existe pas.
if (storage instanceof MemoryStorage) app.route("/api/media", mediaRoutes(storage));

/**
 * L'observabilite se branche AVANT d'ecouter, et elle ne demarre que si un
 * collecteur est configure. Sans `OTEL_EXPORTER_OTLP_ENDPOINT`, le code
 * instrumente tourne a l'identique — l'API d'OpenTelemetry rend alors un tracer
 * sans effet. On le DIT au demarrage plutot que de laisser croire a une
 * observabilite qui n'existe pas (lot 14, ADR 0023).
 */
const otel = demarrerObservabilite();
console.log(otel.actif ? "observabilite : active" : `observabilite : inactive — ${otel.raison}`);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`catalog-api ecoute sur http://localhost:${port}`);
