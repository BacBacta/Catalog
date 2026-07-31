# syntax=docker/dockerfile:1
#
# L'image de l'API. Deux etages : on installe et on genere dans le premier, on
# n'emporte que ce qui sert dans le second.
#
# ── `-slim` et pas `-alpine`, deliberement ─────────────────────────────────
#
# `sharp` (chaine d'images, lot 5) embarque des binaires natifs compiles pour la
# glibc. Sur Alpine — musl — l'installation retombe sur une compilation depuis
# les sources quand elle ne casse pas franchement, et le probleme se manifeste
# au premier televersement de photo, pas a la construction. Les quelques
# dizaines de megaoctets d'ecart ne valent pas ce risque-la.
#
# ── Node execute le TypeScript directement ─────────────────────────────────
#
# Il n'y a pas d'etape de transpilation : `node src/server.ts` retire les types
# et execute. C'est ce que fait deja `pnpm start`, et c'est pourquoi les sources
# `.ts` sont dans l'image finale. Corollaire connu du lot 4 : une propriete de
# parametre, un `enum` ou un `namespace` feraient echouer le demarrage A
# L'IMPORT — `node-strip-only.test.ts` l'empeche, et il tourne en CI avant que
# cette image ne soit construite.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# ── `COREPACK_HOME` hors du home de root, et ce n'est pas cosmetique ───────
#
# Par defaut, corepack cache pnpm dans `/root/.cache`. L'etage de construction
# tourne en root, l'execution tourne en `node` : au demarrage, corepack ne
# trouve rien et **retelecharge pnpm**. Constate ici — le `release_command` de
# Fly sortait en `fetch failed` avant meme d'atteindre Prisma.
#
# Un deploiement qui depend d'un telechargement est un deploiement qui echoue le
# jour ou le registre a un hoquet, c'est-a-dire un jour qu'on ne choisit pas.
# Le cache est donc pose a un chemin partage, rempli a la construction, et
# emporte dans l'image finale.
ENV COREPACK_HOME=/opt/corepack
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# ── OpenSSL, que `node:24-slim` n'embarque pas ────────────────────────────
#
# Le moteur de requetes de Prisma est lie a libssl et choisit son binaire
# d'apres la version detectee. Sans elle, il avertit — « Prisma failed to detect
# the libssl/openssl version to use » — et retombe sur `openssl-1.1.x`, un
# defaut qui ne correspond a rien sur une base recente. Constate a la premiere
# execution des migrations dans cette image.
#
# Un avertissement au deploiement est deja une mauvaise nouvelle ; ici il
# annonce un moteur qui « may not work as expected » devant une base de
# paiements. On installe la bibliotheque plutot que d'esperer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# `packageManager` de package.json est la source de verite de la version de
# pnpm — ici comme en CI. On ne la redeclare pas.
RUN corepack enable

FROM base AS build
WORKDIR /app

# pnpm 11 demande confirmation avant de purger un `node_modules` desynchronise,
# et ABANDONNE quand il n'a pas de terminal — `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.
# Une construction d'image n'a jamais de terminal. `CI=true` est la reponse
# documentee : pnpm procede au lieu d'attendre une reponse qui ne viendra pas.
ENV CI=true

# Les manifestes d'abord : sans changement de dependance, cette couche est
# reutilisee et l'installation ne recommence pas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/seller/package.json ./apps/seller/
COPY apps/shop/package.json ./apps/shop/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/db/package.json ./packages/db/
COPY packages/ui/package.json ./packages/ui/

# Telecharge pnpm UNE FOIS, a la construction, dans `COREPACK_HOME`. Sans cette
# ligne, l'execution le refait — voir la note de l'etage `base`.
RUN corepack install

# `--frozen-lockfile` : la meme garantie qu'en CI. Un lockfile decale doit faire
# echouer la construction, pas produire une image qui contient autre chose que
# ce qui a ete teste.
RUN pnpm install --frozen-lockfile

COPY . .

# ── Le client Prisma, et la variable factice qu'il faut expliquer ──────────
#
# Prisma 7 sort l'URL du schema et la lit dans `prisma.config.ts` (ADR 0014).
# `prisma generate` echoue donc en `PrismaConfigEnvError` sans `DATABASE_URL`,
# alors qu'il **ne se connecte a rien** : il lit un fichier et ecrit du code.
#
# La valeur ci-dessous est donc un satisfaire-la-configuration, pas une base.
# Elle ne sort pas de cet etage, elle ne figure pas dans l'image finale, et
# aucune connexion n'est ouverte avec. La vraie URL arrive a l'execution, par
# les secrets de la plateforme.
#
# Ce n'est pas la meme situation que le canari de formats du lot 14, ou la
# variable factice aurait MASQUE un probleme : le canari n'avait pas besoin du
# client genere du tout. Ici, il en faut un.
RUN DATABASE_URL="postgresql://construction:construction@127.0.0.1:5432/construction?schema=public" \
    pnpm --filter @catalog/db exec prisma generate

# ── PAS de `pnpm prune --prod`, et c'est un choix mesure ──────────────────
#
# Il paraissait evident : retirer les dependances de developpement allege
# l'image. Il casse le deploiement.
#
# `fly.toml` lance `pnpm db:migrate` en `release_command`, avant que la nouvelle
# version ne prenne le trafic. Cette commande enchaine `prisma migrate deploy`
# puis `apply-constraints.mjs` — or **le CLI `prisma` est une devDependency** de
# `packages/db`. Elague, il disparait, et le `release_command` echoue au moment
# precis ou l'on deploie.
#
# L'image est plus grosse. Une image plus grosse coute des secondes de
# telechargement ; une migration qui ne part pas coute un deploiement bloque,
# et le decouvrir a ce moment-la est le pire moment possible.

FROM base AS runtime
WORKDIR /app

# UTC+1 sans heure d'ete. Sans ce reglage, les dates lues dans les SMS derivent
# d'une heure et la fenetre de 48 h du controle n° 4 se decale — le meme piege
# qu'en CI (AGENTS.md).
ENV TZ=Africa/Douala
ENV NODE_ENV=production
ENV PORT=8080

# ── Le repertoire LUI-MEME, pas seulement son contenu ─────────────────────
#
# `WORKDIR /app` cree le repertoire en root, et `COPY --chown` ne change que ce
# qui est copie DEDANS. Le noeud `/app` reste donc a root, et un processus qui
# tourne en `node` ne peut pas y creer de fichier.
#
# Ce n'est pas theorique : `pnpm db:migrate` sortait en
# `EACCES: permission denied, open '/app/_tmp_…'`. Le `release_command` de Fly
# echouait a l'etape des migrations, avant de servir la moindre requete.
RUN mkdir -p /app && chown node:node /app

# ── Le repertoire de l'interrupteur d'arret ───────────────────────────────
#
# `INTERRUPTEUR_FICHIER` de `fly.toml` vaut `/run/catalog/interrupteur`, et
# **rien ne creait ce repertoire**. `/run` appartient a root ; le processus
# tourne en `node`. C'est la meme regle que six lignes plus haut, non appliquee.
#
# Ce qui rend le defaut couteux, c'est qu'il est SILENCIEUX dans les deux sens :
# `positionCourante` avale l'echec de lecture a dessein — « un fichier absent
# n'est pas une erreur », sinon le garde-fou deviendrait une cause de panne — et
# rien ne distingue « pas de fichier » de « pas de repertoire ». Le service
# repond normalement, tous les tests passent, et le jour de l'incident
# `echo lecture_seule > /run/catalog/interrupteur` rend « No such file or
# directory ». C'est-a-dire que l'interrupteur d'arret ne marche que le jour ou
# l'on n'en a pas besoin.
#
# Le repertoire est cree ici plutot qu'au premier incident, et appartient a
# `node` : l'operateur ecrit en root par `fly ssh console`, mais un chemin
# inscriptible par le processus laisse la porte ouverte a un basculement
# automatique sans changer d'image.
RUN mkdir -p /run/catalog && chown node:node /run/catalog

# `--chown` : l'etage de construction tourne en root, l'execution en `node`.
# Sans cette option, tout le contenu appartient a root. Le corriger par un
# `chown` separe doublerait la taille de l'image : chaque couche garde sa copie
# des fichiers, et changer leur proprietaire les reecrit tous.
COPY --from=build --chown=node:node /app /app
# Le cache de corepack, pour que `pnpm db:migrate` du `release_command` ne
# retelecharge rien.
COPY --from=build /opt/corepack /opt/corepack

# Ni root, ni le shell. L'image `node` fournit deja l'utilisateur `node`.
USER node

EXPOSE 8080

# Pas d'orchestrateur de processus : Fly redemarre la machine si le processus
# meurt, et une couche de plus ne ferait qu'avaler le code de sortie.
CMD ["node", "apps/api/src/server.ts"]
