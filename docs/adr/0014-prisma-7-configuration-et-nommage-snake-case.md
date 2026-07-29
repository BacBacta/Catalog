# 0014 — Prisma 7 : configuration hors du schéma, adaptateur de pilote, et nommage snake_case

- Statut : accepté
- Date : 2026-07-29
- Concerne le lot 3 (`packages/db`)
- Ne change aucune version de la stack : Prisma reste en 7.9.1

## Contexte

Le squelette du lot 1 déclarait la connexion dans le schéma :

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Prisma 7 refuse cette forme :

> The datasource property `url` is no longer supported in schema files. Move
> connection URLs for Migrate to `prisma.config.ts` and pass either `adapter`
> for a direct database connection or `accelerateUrl` […]

Autrement dit `pnpm db:validate` — qui tourne dans le job `quality` de la CI —
**échouait déjà** avant ce lot. Le lot 3 est le premier à toucher la base, donc
le premier à s'en apercevoir.

## Trois autres choses cassées, découvertes en tirant le fil

Elles n'étaient pas visibles sans une base réelle. Elles le sont maintenant.

**1. Le script d'application des contraintes ne pouvait pas fonctionner.**
Il faisait `psql "$DATABASE_URL"`, or `DATABASE_URL` porte `?schema=public` — un
paramètre propre à Prisma que libpq rejette : *invalid URI query parameter*. Avec
l'URL de `.env.example`, la commande échouait systématiquement.

C'est plus grave qu'un script cassé : **un CHECK jamais appliqué est un
invariant qui n'existe pas**, et rien ne le signalait. La cohérence
`amount_paid_xaf + balance_xaf = total_xaf` était écrite, documentée, et absente
de la base.

**2. Le générateur `prisma-client` émet du TypeScript.** `src/index.ts` importait
`../generated/client/client.js`, un fichier qui n'existe pas — le générateur
produit `client.ts`. Rien ne le révélait tant que personne n'instanciait le
client.

**3. `packages/contracts` n'était pas chargeable par Node.** Son `index.ts`
réexportait en `./delivery.js`, convention TypeScript que le dépouillement de
types de Node ne remappe pas vers `.ts`. Le seed, qui doit réutiliser
`splitDeposit` plutôt que le réimplémenter, ne pouvait pas l'importer.

## Décisions

**La connexion vit dans `prisma.config.ts`**, et le client reçoit un adaptateur
de pilote `@prisma/adapter-pg`. Une fabrique `createPrismaClient(url)` remplace
l'export nu du client : elle rend l'URL injectable, ce dont les tests
d'intégration ont besoin.

**Les contraintes s'appliquent par un script Node**, pas par `psql` :
`scripts/apply-constraints.mjs` retire les paramètres propres à Prisma de l'URL
et exécute le fichier SQL **dans une transaction**. Deux gains — plus aucun
binaire externe requis (le client `pg` est déjà une dépendance, donc rien à
installer dans l'image de CI), et un jeu de contraintes soit entièrement
appliqué soit pas du tout. Un demi-jeu serait pire que rien : on croirait le
tout en place.

**`packages/contracts` passe aux imports en `.ts`**, comme `apps/api` le fait
déjà. Ça supprime une incohérence entre paquets du même dépôt et rend le paquet
chargeable directement par Node, sans étape de compilation.

**Les tables et colonnes sont en `snake_case`**, via `@@map` et `@map`, avec des
identifiants `camelCase` côté TypeScript. Ce n'est pas une préférence de style :
le lot 3 nomme les colonnes de `payment_proof` une par une — `operator_tx_id`,
`pattern_a_confirmer`, `counterparty_phone` — et prévient que toute divergence
casse la transposition du lot 8. AGENTS.md exige par ailleurs des montants
« suffixés `_xaf` ». Le seul moyen d'avoir exactement ces noms **en base** tout
en gardant du TypeScript idiomatique est le mappage explicite.

## Ce que la vérification a coûté, et ce qu'elle a rapporté

Rien de tout cela ne se voit sans base réelle. C'est l'argument pour les tests
d'intégration ajoutés au lot 3 : ils ont trouvé quatre défauts que ni
`typecheck`, ni `lint`, ni les tests unitaires ne pouvaient voir.

**Une limite à connaître** : la vérification a été faite sur **PostgreSQL 16**,
pas 18. Le démon Docker n'était pas disponible dans l'environnement, et 16 était
la version installée localement. Rien de ce que le schéma utilise n'est
spécifique à 17 ou 18 — `jsonb`, `CHECK`, triggers `plpgsql`, contraintes
`UNIQUE` composées, `uuid` v7 généré côté application — mais la CI doit tourner
sur 18 pour que ce soit établi, et c'est ce que la configuration ajoutée fait.

## À revoir si

Prisma change encore de forme de configuration — la 7 vient de le faire, et
cette section existe pour que le prochain ne cherche pas pourquoi l'URL n'est
pas dans le schéma. Ou si l'on ajoute un second adaptateur (pool externe,
serverless) : `createPrismaClient` est le seul endroit à toucher.
