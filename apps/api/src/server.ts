import { IMAGE_TAILLE_MAX_OCTETS } from "@catalog/contracts";
import { createPrismaClient } from "@catalog/db";
import { serve } from "@hono/node-server";
import { garantiesSqlPosees } from "./adapters/garanties-sql.ts";
import { construireInstantane } from "./adapters/instantane-catalogue.ts";
import { verificateurDepuisEnv } from "./adapters/jeton-actions-github.ts";
import { PrismaOtpAttemptStore } from "./adapters/otp-attempt-store.ts";
import { PayoutOtpStore } from "./adapters/payout-otp-store.ts";
import { declencheurDepuisEnv } from "./adapters/reconstruction-boutique.ts";
import { resolveChiffreurSms } from "./adapters/sms-chiffre.ts";
import { ConsoleSmsSender } from "./adapters/sms-console.ts";
import { MemoryStorage, resolveStorage } from "./adapters/storage-s3.ts";
import { EnvoyeurWhatsappBot } from "./adapters/whatsapp-bot.ts";
import { LecteurMediaWhatsapp } from "./adapters/whatsapp-media.ts";
import { resoudreTransport } from "./adapters/whatsapp-transport.ts";
import app from "./app.ts";
import { createAuth, origines, smsSenderDepuisEnv } from "./auth.ts";
import { appliquerMessageEntrant, type MagasinDefis } from "./auth-connexion-whatsapp.ts";
import { resumerErreur, traiterLivraisonBot } from "./bot.ts";
import { notifierConteste, notifierLivree, notifierPaiementProuve } from "./bot-notifications.ts";
import { accuserConnexionDansLeFil } from "./connexion-fil.ts";
import { cohorteDepuisEnv, hstsActif, positionCourante } from "./deploiement.ts";
import { rampeDepuisEnv } from "./domain/ramp/config.ts";
import { limitesDepuisEnv } from "./domain/rate-limit.ts";
import { reglesDepuisEnv } from "./domain/securite/debit.ts";
import {
  type ChargeExpiration,
  type ChargeRelance,
  type ChargeRelanceReversement,
  demarrerJobsBot,
} from "./jobs/relance-acompte.ts";
import { gardeDeCohorte } from "./middleware/cohorte.ts";
import { limiterDebit, MemoireDeDebit } from "./middleware/debit.ts";
import { monterAvecGardes, TAILLE_JSON_MAX } from "./middleware/securite.ts";
import { arreterObservabilite, demarrerObservabilite } from "./observabilite/demarrage.ts";
import { accuseLivraisonRoutes } from "./routes/accuse-livraison.ts";
import { authRoutes } from "./routes/auth.ts";
import { commandeRoutes } from "./routes/commandes.ts";
import { devOtpRoutes } from "./routes/dev-otp.ts";
import { instantaneRoutes } from "./routes/instantane.ts";
import { mediaRoutes } from "./routes/media.ts";
import { payoutRoutes } from "./routes/payout.ts";
import { preuveRoutes } from "./routes/preuve.ts";
import { productRoutes } from "./routes/products.ts";
import { rampeRoutes } from "./routes/rampe.ts";
import { recuRoutes, suiviRoutes } from "./routes/recu.ts";
import { sellerRoutes } from "./routes/seller.ts";
import { statsRoutes } from "./routes/stats.ts";
import { statutRoutes } from "./routes/statut.ts";
import { whatsappEntrantRoutes } from "./routes/whatsapp-entrant.ts";

/**
 * Point d'entree. C'est ici que les dependances concretes sont branchees :
 * `app.ts` reste constructible sans base, ce qui permet de le tester nu.
 */
const prisma = createPrismaClient();

/** Ce que l'arret propre doit fermer — rempli au fil des demarrages. */
const arreterProprement: Array<() => Promise<unknown>> = [];

const sms = smsSenderDepuisEnv();
const otpStore = new PrismaOtpAttemptStore(prisma);
const storage = resolveStorage();
const limits = limitesDepuisEnv(process.env);
const auth = createAuth({
  prisma,
  sms,
  wabaNumero: process.env.WHATSAPP_WABA_NUMERO?.trim(),
  passkeyRpId: process.env.PASSKEY_RP_ID?.trim(),
  passkeyOrigin: process.env.PASSKEY_ORIGIN?.trim(),
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim(),
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim(),
});
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
    /* Ou l'ancien numero envoie STOP (ADR 0061, rang 2b). Absent, l'alerte
       part quand meme et renvoie vers le support. */
    ...(process.env.WHATSAPP_WABA_NUMERO?.trim()
      ? { numeroBot: process.env.WHATSAPP_WABA_NUMERO.trim() }
      : {}),
  }),
);

// La rampe : publique, sans session. C'est une acheteuse qui la lit, depuis la
// boutique statique, et c'est ce qui permet de changer un code d'operateur sans
// reconstruire le site. Le bot en lit aussi le code d'entree (ADR 0035).
const rampe = rampeDepuisEnv(process.env);

/**
 * Le bot (ADR 0031), construit AVANT les routes de commandes : la preuve et
 * l'avancement d'etape le previennent (ADR 0035). Il reste EN DORMANCE sans
 * sa cle — et sans lui, les routes vivent sans notification, comme avant.
 */
const cleBot = process.env.WABOT_API_KEY?.trim();
const baseBot = process.env.WABOT_BASE_URL?.trim();
/**
 * Le transport (ADR 0046) se DEDUIT de l'hote quand celui-ci suffit — les
 * deploiements existants n'ont donc aucune variable a ajouter. `WABOT_TRANSPORT`
 * ne sert qu'a trancher un hote inconnu, et a faire echouer au demarrage une
 * configuration qui se contredit.
 */
const transportBot = baseBot
  ? resoudreTransport(process.env.WABOT_TRANSPORT, baseBot)
  : "360dialog";
const idNumeroBot = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
const bot =
  cleBot && baseBot
    ? {
        envoyeur: new EnvoyeurWhatsappBot({
          apiKey: cleBot,
          baseUrl: baseBot,
          transport: transportBot,
          phoneNumberId: idNumeroBot,
        }),
        baseBoutique: process.env.BASE_BOUTIQUE_PUBLIQUE?.trim() ?? "",
        baseApp: process.env.BASE_APP_VENDEUSE?.trim() ?? "",
        storage,
        /* Les photos entrantes de l'inscription (ADR 0034) — meme cle, meme
           base que l'envoi : c'est le meme canal. */
        media: new LecteurMediaWhatsapp({
          apiKey: cleBot,
          baseUrl: baseBot,
          transport: transportBot,
        }),
        /* Le numero du bot, pour composer les liens de boutique et de
           parrainage. Absent : les liens ne se fabriquent pas, et la
           machine le dit plutot que d'ecrire une URL fausse. */
        numeroCatalog: process.env.WHATSAPP_WABA_NUMERO?.trim() ?? "",
        rampe,
        /* Le Flow de livraison (ADR 0055). ABSENT PAR DEFAUT : sans lui, le
           fil est celui d'avant, question par question. Il se pose quand un
           Flow est publie chez Meta — l'API de notre cle ne sait pas le
           creer, donc l'identifiant vient de la console, a la main. */
        ...(process.env.WABOT_FLUX_LIVRAISON_ID?.trim()
          ? { fluxLivraisonId: process.env.WABOT_FLUX_LIVRAISON_ID.trim() }
          : {}),
        /* Le Flow d'AVIS, meme regime et meme raison. */
        ...(process.env.WABOT_FLUX_AVIS_ID?.trim()
          ? { fluxAvisId: process.env.WABOT_FLUX_AVIS_ID.trim() }
          : {}),
        /* Le formulaire d'inscription vendeuse (tache #60). Absent : le fil
           pose ses questions une par une, exactement comme avant. */
        ...(process.env.WABOT_FLUX_INSCRIPTION_ID?.trim()
          ? { fluxInscriptionId: process.env.WABOT_FLUX_INSCRIPTION_ID.trim() }
          : {}),
        /* L'ouverture en DEUX ecrans (ADR 0087). Posee, elle remplace le
           formulaire d'inscription : boutique, ville, puis premier article. */
        ...(process.env.WABOT_FLUX_OUVERTURE_ID?.trim()
          ? { fluxOuvertureId: process.env.WABOT_FLUX_OUVERTURE_ID.trim() }
          : {}),
        ...(process.env.WABOT_FLUX_ARTICLE_ID?.trim()
          ? { fluxArticleId: process.env.WABOT_FLUX_ARTICLE_ID.trim() }
          : {}),
        /* La reconstruction de la boutique publique — ADR 0065. `null` sans
           SHOP_REBUILD_HOOK_URL, et le fil n'annonce alors aucun delai. */
        reconstruction: declencheurDepuisEnv(),
      }
    : null;

app.route(
  "/api/articles",
  productRoutes({ prisma, session, storage, reconstruction: declencheurDepuisEnv() }),
);
// Les statistiques : sous session, et filtrees par la vendeuse de la session.
// Aucun identifiant de boutique ne circule dans l'URL — ce serait un numero a
// essayer, et les chiffres d'une vendeuse ne regardent qu'elle.
app.route("/api/statistiques", statsRoutes({ prisma, session }));
/* Un seul chiffreur pour les DEUX portes de preuve — la route et le fil
   (ADR 0083) : meme secret, meme format au repos. */
const chiffreurSms = resolveChiffreurSms();
app.route(
  "/api/commandes",
  preuveRoutes({
    prisma,
    session,
    chiffreur: chiffreurSms,
    /* Paiement prouve → l'acheteuse le sait dans son fil (ADR 0035). */
    ...(bot
      ? {
          apresPreuve: (orderId: string) =>
            notifierPaiementProuve({ prisma, envoyeur: bot.envoyeur }, orderId),
        }
      : {}),
  }),
);
// Le cycle de vie, sur le MEME prefixe. Les deux routeurs se partagent
// `/api/commandes` sans se recouvrir : `preuveRoutes` tient `GET /:id` et
// `POST /:id/preuve`, celui-ci tient la liste, l'avancement d'etape et la
// declaration de paiement.
app.route(
  "/api/commandes",
  commandeRoutes({
    prisma,
    session,
    /* Livree (depuis l'app comme depuis le fil) → l'invitation a noter. */
    ...(bot
      ? {
          apresEtape: async ({ orderId, etape }: { orderId: string; etape: string }) => {
            if (etape === "livree") {
              await notifierLivree({ prisma, envoyeur: bot.envoyeur }, orderId);
            }
          },
        }
      : {}),
  }),
);

/**
 * L'instantane du catalogue, servi a la CONSTRUCTION de la boutique — ADR 0070.
 *
 * Il evite de deposer `DATABASE_URL` chez GitHub : le seul endroit qui a besoin
 * du secret de la base est celui dont c'est le travail. L'appelant s'identifie
 * par le jeton signe de son execution — aucun secret partage, donc aucun secret
 * a inventer, a transmettre, ni a faire tourner.
 *
 * **Dormant sans `SHOP_REBUILD_GITHUB_REPO`** : la meme variable que le
 * declencheur, vue dans l'autre sens. L'API reveille le workflow, il revient
 * chercher la photo.
 */
const verificateurActions = verificateurDepuisEnv();
if (verificateurActions) {
  app.route(
    "/api/instantane",
    instantaneRoutes({
      verificateur: verificateurActions,
      construire: () => construireInstantane(prisma),
    }),
  );
}

app.route("/api/rampe", rampeRoutes(rampe));

// Le recu et le suivi : publics, sans session. C'est une ACHETEUSE qui les lit,
// et c'est le principe meme du recu — n'importe qui doit pouvoir controler.
app.route(
  "/api/recu",
  recuRoutes({ prisma, rampe, session, reconstruction: declencheurDepuisEnv() }),
);
app.route(
  "/api/suivi",
  suiviRoutes({
    prisma,
    rampe,
    /* Contestation depuis le lien de suivi → la vendeuse l'apprend dans son
       fil, comme pour celle qui vient du bouton du bot. */
    ...(bot
      ? {
          apresContestation: (orderId: string) =>
            notifierConteste({ prisma, envoyeur: bot.envoyeur }, orderId),
        }
      : {}),
  }),
);

/**
 * La page de statut publique. Elle passe l'interrupteur en toutes positions —
 * un service muet ne se supervise pas — et sa sonde de base est partagee entre
 * tous les appelants : une page de statut est consultee au moment ou tout le
 * monde a un probleme, elle ne doit pas ajouter sa charge a la panne.
 */
app.route(
  "/api/statut",
  statutRoutes({
    baseJoignable: async () => {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    },
    /* Les garanties SQL du lot 3, constatees dans la base REELLE — residu A3
       de l'audit 2026-08. Voir `adapters/garanties-sql.ts`. */
    garantiesSql: () => garantiesSqlPosees(prisma),
    position: () => positionCourante(),
    message: () => process.env.STATUT_MESSAGE?.trim() || null,
    ...(process.env.CATALOG_VERSION ? { version: process.env.CATALOG_VERSION } : {}),
  }),
);

/**
 * L'accuse de livraison d'Orange (« Delivery Receipt »). Monte UNIQUEMENT si un
 * secret est configure : sans lui, la route n'existe pas du tout.
 *
 * C'est un refus par defaut, et c'est le bon sens ici — une route de rappel
 * ouverte sans secret laisserait n'importe qui fausser la mesure de couverture,
 * qui est justement le seul controle automatique du fait que les vendeuses MTN
 * recoivent leur code.
 */
const secretAccuse = process.env.SMS_ACCUSE_SECRET?.trim();
if (secretAccuse) app.route("/api/sms", accuseLivraisonRoutes({ secret: secretAccuse }));

/**
 * Le webhook WhatsApp entrant (ADR 0027) — meme refus par defaut que l'accuse :
 * il faut LES DEUX secrets, celui du chemin et celui de la signature Meta.
 * L'un sans l'autre serait une porte a moitie fermee, donc pas de route.
 */
const secretEntrant = process.env.WHATSAPP_ENTRANT_SECRET?.trim();
const secretAppMeta = process.env.WHATSAPP_APP_SECRET?.trim();
if (secretEntrant && secretAppMeta) {
  /**
   * La relance d'acompte (ADR 0033) et la relance reversement (ADR 0035) —
   * pg-boss. Elles ne demarrent QU'AVEC le bot : sans lui, personne ne cree
   * de commande par WhatsApp, donc rien a relancer. Et si la file ne demarre
   * pas, le bot vit sans relance plutot que de ne pas vivre du tout.
   */
  if (bot && process.env.DATABASE_URL) {
    demarrerJobsBot({
      connexion: process.env.DATABASE_URL,
      prisma,
      envoyeur: bot.envoyeur,
      ...(bot.baseApp ? { baseApp: bot.baseApp } : {}),
    })
      .then((jobs) => {
        const cible = bot as {
          planifierRelance?: (c: ChargeRelance) => Promise<void>;
          planifierRelanceReversement?: (c: ChargeRelanceReversement) => Promise<void>;
          planifierExpiration?: (c: ChargeExpiration) => Promise<void>;
        };
        cible.planifierRelance = jobs.planifierRelance;
        cible.planifierRelanceReversement = jobs.planifierRelanceReversement;
        cible.planifierExpiration = jobs.planifierExpiration;
        arreterProprement.push(() => jobs.arreter());
      })
      .catch(() => console.warn("jobs bot : demarrage refuse — le bot continue sans relance"));
  }

  app.route(
    "/api/whatsapp",
    whatsappEntrantRoutes({
      secret: secretEntrant,
      appSecret: secretAppMeta,
      authEnTete: process.env.WABOT_WEBHOOK_AUTH?.trim() || undefined,
      surMessage: async (message) => {
        const contexte = await auth.$context;
        const magasin = contexte.internalAdapter as unknown as MagasinDefis;
        const verdict = await appliquerMessageEntrant(magasin, {
          ...message,
          maintenant: new Date(),
        });
        /* Le fil accuse la connexion — sans cela, envoyer son code ne produit
           RIEN cote WhatsApp, et rien ne distingue « ça a marché » de « le
           service est mort ». Banc du 13/08/2026. De confort : un envoi qui
           echoue ne defait aucune session, donc il n'interrompt pas le flux. */
        if (bot) {
          await accuserConnexionDansLeFil(
            { magasin, envoyeur: bot.envoyeur, prisma },
            message,
            verdict,
          ).catch((e: unknown) => {
            console.warn(`bot : accuse de connexion non envoye (${resumerErreur(e)})`);
          });
        }
      },
      ...(bot
        ? {
            surLivraison: (corps: unknown) =>
              traiterLivraisonBot(
                {
                  prisma,
                  ...bot,
                  /* Le verdict DANS le fil — ADR 0083 : meme service, meme
                     chiffreur que la route, et la meme notification
                     acheteuse apres commit. */
                  preuve: {
                    chiffreur: chiffreurSms,
                    apresPreuve: (orderId: string) =>
                      notifierPaiementProuve({ prisma, envoyeur: bot.envoyeur }, orderId),
                  },
                },
                corps,
              ),
          }
        : {}),
    }),
  );
}

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

/**
 * Les gardes de bordure du lot 15 (ADR 0024).
 *
 * **Ils enveloppent l'application, ils ne s'ajoutent pas dedans**, et le
 * montage vient donc APRES toutes les routes. Hono execute les gestionnaires
 * dans l'ordre d'enregistrement : un `app.use("*", …)` place ici ne
 * s'appliquerait pas a `/health`, declare dans `app.ts` donc enregistre a
 * l'import. C'est exactement ce qui s'est produit a la premiere ecriture de ce
 * lot — `/health` ressortait sans un seul en-tete de securite —, et le montage
 * en racine rend la question impossible a reposer.
 *
 * Le plafond des corps : 16 Ko partout, sauf le televersement de photo. Le
 * facteur 1,2 couvre l'enveloppe `multipart` — bornes, en-tetes de partie et
 * sauts de ligne — qui s'ajoute au fichier lui-meme.
 */
const reglesDeDebit = reglesDepuisEnv(process.env);
const racine = monterAvecGardes(app, {
  hsts: hstsActif(),
  origines: origines(),
  position: () => positionCourante(),
  debit: limiterDebit({ regles: reglesDeDebit, memoire: new MemoireDeDebit(reglesDeDebit) }),
  cohorte: gardeDeCohorte({ session, config: () => cohorteDepuisEnv() }),
  plafond: (chemin) =>
    /^\/api\/articles\/[^/]+\/image$/.test(chemin)
      ? Math.ceil(IMAGE_TAILLE_MAX_OCTETS * 1.2)
      : TAILLE_JSON_MAX,
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: racine.fetch, port });
console.log(`catalog-api ecoute sur http://localhost:${port}`);

/**
 * L'arret PROPRE — constat B2 de l'audit 2026-08.
 *
 * `arreterObservabilite()` (vidage des derniers lots de spans) et
 * `jobs.arreter()` (pg-boss) etaient ecrits, commentes « a appeler avant un
 * arret propre »… et appeles par personne : chaque redeploiement perdait les
 * spans en lot et coupait la file a la hache. Un seul passage — un second
 * signal pendant l'arret n'attend pas : il sort, l'hebergeur a le dernier
 * mot de toute facon (fly kill_timeout).
 */
let arretEnCours = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (arretEnCours) process.exit(1);
    arretEnCours = true;
    void Promise.allSettled(arreterProprement.map((f) => f()))
      .then(() => arreterObservabilite())
      .finally(() => process.exit(0));
  });
}
