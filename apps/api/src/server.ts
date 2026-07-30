import { createPrismaClient } from "@catalog/db";
import { serve } from "@hono/node-server";
import { PrismaOtpAttemptStore } from "./adapters/otp-attempt-store.ts";
import { PayoutOtpStore } from "./adapters/payout-otp-store.ts";
import { resolveChiffreurSms } from "./adapters/sms-chiffre.ts";
import { ConsoleSmsSender } from "./adapters/sms-console.ts";
import { MemoryStorage, resolveStorage } from "./adapters/storage-s3.ts";
import app from "./app.ts";
import { createAuth, smsSenderDepuisEnv } from "./auth.ts";
import { limitesDepuisEnv } from "./domain/rate-limit.ts";
import { authRoutes } from "./routes/auth.ts";
import { devOtpRoutes } from "./routes/dev-otp.ts";
import { mediaRoutes } from "./routes/media.ts";
import { payoutRoutes } from "./routes/payout.ts";
import { preuveRoutes } from "./routes/preuve.ts";
import { productRoutes } from "./routes/products.ts";
import { sellerRoutes } from "./routes/seller.ts";

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
app.route("/api/commandes", preuveRoutes({ prisma, session, chiffreur: resolveChiffreurSms() }));

// Uniquement quand le fournisseur factice est actif — donc jamais en production,
// ou `ConsoleSmsSender` refuse de se construire.
const dev = devOtpRoutes({ console: sms instanceof ConsoleSmsSender ? sms : null });
if (dev) app.route("/api/dev", dev);

// De meme pour le stockage en memoire : avec un vrai S3, l'URL signee pointe
// chez le fournisseur et cette route n'existe pas.
if (storage instanceof MemoryStorage) app.route("/api/media", mediaRoutes(storage));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`catalog-api ecoute sur http://localhost:${port}`);
