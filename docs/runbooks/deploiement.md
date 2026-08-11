# Déploiement — Fly (API) et Vercel (boutique)

Ce fichier se lit **avant** le premier déploiement, une fois. Ensuite, tout tient
dans `.github/workflows/deploiement.yml`, qui se déclenche à la main.

> **Le parcours vendeuse ne fonctionne pas encore, et ce n'est pas un réglage.**
> `PendingSmsProvider` lève, délibérément, parce que trois choses ne sont pas
> tranchées — le fournisseur, l'identifiant d'expéditeur (qui se déclare auprès
> du régulateur au Cameroun), et le comportement en cas d'échec partiel. Le
> téléphone est le seul facteur d'authentification : pas de SMS, pas de vendeuse.
> Voir §5.

---

## 1. Ce qui marche, mesuré

Vérifié le 31/07/2026 en `NODE_ENV=production` contre une vraie base :

| Route | Résultat |
|---|---|
| `GET /health` | 200 |
| `GET /api/statut` | 200 `{"niveau":"ok","base":"joignable"}` |
| `GET /api/rampe` | 200 |
| `GET /api/recu/<code valide>` | 200 |
| `GET /api/recu/<code inconnu>` | 404 |
| `POST /api/auth/phone-number/send-otp` | **500** — voir §5 |

Le parcours **acheteuse** est donc entièrement déployable. C'est aussi ce qu'il
faut en ligne pour lever deux réserves que six lots de code ne peuvent pas
lever : les budgets depuis un vrai réseau camerounais
([checklist §6.2](checklist-lancement.md)) et la latence Douala → Paris de
l'ADR 0003, qui est **accepté sous réserve de mesure**.

---

## 2. Deux gardes qui empêchent la machine de DÉMARRER

Pas de fonctionner : de démarrer. Le processus sort en erreur à l'import, avant
d'écouter. Les deux sont voulus, et il faut les connaître avant de chercher
pourquoi une machine boucle en redémarrage.

| Variable absente | Message |
|---|---|
| `SMS_PROVIDER` | `ConsoleSmsSender est un fournisseur de developpement : en production, aucun OTP ne partirait et les vendeuses resteraient dehors.` |
| **une des quatre** `S3_ENDPOINT` · `S3_BUCKET` · `S3_ACCESS_KEY` · `S3_SECRET_KEY` | `MemoryStorage est un stockage de developpement […] Variables de stockage absentes : <les noms>.` |
| `BETTER_AUTH_SECRET` | `BETTER_AUTH_SECRET est absent. Il signe les sessions vendeuses […]` |
| `PAYOUT_OTP_SECRET` (ou `BETTER_AUTH_SECRET`) | `PAYOUT_OTP_SECRET (ou BETTER_AUTH_SECRET) est requis […]` |
| les `ORANGE_*` / `WHATSAPP_*`, **si `SMS_PROVIDER` les désigne** | `Configuration … incomplete. Variables absentes : <les noms>.` |

`SMS_PROVIDER=provider` est déjà posé dans `fly.toml`. Le stockage, non : il
demande de vrais identifiants, donc il passe par `fly secrets`.

> **Le tableau n'en listait que deux, et le message S3 ne nommait que
> `S3_ENDPOINT`** — quelle que soit la variable réellement absente. Un
> `S3_SECRET_KEY` mal orthographié dans la longue ligne à contre-obliques de §3
> produisait donc un journal disant de configurer `S3_ENDPOINT`, que
> `fly secrets list` montrait pourtant présent. Les messages nomment désormais
> la variable manquante.

> **`BETTER_AUTH_SECRET` était le piège le plus coûteux.** Sa validation vivait
> à l'intérieur de Better Auth, dans une promesse sans `.catch` : elle rejetait
> **après** le `serve()`. Le journal affichait `catalog-api ecoute sur …` puis le
> processus mourait. Sur Fly, une boucle de redémarrage dont chaque itération
> montre une ligne d'écoute *réussie* — on cherche du côté du port, du health
> check ou de la mémoire. La vérification est maintenant synchrone, avant
> l'écoute : plus aucune ligne d'écoute ne précède l'erreur.

> **La bascule du canal SMS mérite un ordre.** Poser les identifiants
> `ORANGE_*` ou `WHATSAPP_*` **avant** de changer `SMS_PROVIDER` : les
> adaptateurs se construisent à l'import, donc une variable oubliée met hors
> ligne le parcours **acheteuse** — reçu, suivi, rampe —, celui qui
> fonctionnait. `SMS_PROVIDER=provider` ne lève, lui, qu'à l'envoi : c'est
> pourquoi le premier déploiement passe.

---

## 3. Les secrets

**Aucun ne va dans le dépôt, ni dans `fly.toml`, ni dans un workflow.** Un
secret qui traverse un journal d'intégration continue est un secret publié.

> **L'application doit exister avant.** `fly secrets set --app …` échoue sur une
> application inconnue : lancer le `fly launch --no-deploy` de §4 d'abord, puis
> revenir ici. L'ordre §3 → §4 est celui de la lecture, pas celui des gestes.

```bash
fly secrets set --app catalog-api-preprod \
  DATABASE_URL="postgresql://…" \
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  BETTER_AUTH_URL="https://api-preprod.catalog.cm" \
  SMS_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  PAYOUT_OTP_SECRET="$(openssl rand -hex 32)" \
  S3_ENDPOINT="https://…" S3_BUCKET="catalog-media" \
  S3_ACCESS_KEY="…" S3_SECRET_KEY="…" S3_REGION="…" \
  TRUSTED_ORIGINS="https://app-preprod.catalog.cm"
```

> **`TRUSTED_ORIGINS` prend les origines de l'APP VENDEUSE, pas de la
> boutique.** Elle n'alimente que deux choses : les origines de confiance de
> Better Auth, et la branche `session` du CORS. Les quatre routes que la
> boutique appelle — `/api/recu`, `/api/suivi`, `/api/rampe`, `/api/statut` —
> sont publiques et sans cookie : y mettre l'origine de la boutique n'ouvre
> rien, et **omettre celle de l'app vendeuse l'empêche de se connecter**.

> **`SMS_ENCRYPTION_KEY` ne se perd pas et ne se change pas à la légère.** Elle
> chiffre le SMS d'opérateur au repos (lot 8). La perdre rend illisibles toutes
> les preuves déjà enregistrées — et le SMS brut est ce qui porte l'identifiant
> de transaction, donc la matière du reçu. À sauvegarder ailleurs que sur Fly,
> le jour où elle est créée.

### Le stockage : Tigris pose les mauvais noms

`fly storage create` provisionne un bucket Tigris **et pose lui-même cinq
secrets** — sous des noms qui ne sont pas ceux que l'application lit :

| Ce que Tigris pose | Ce que l'application lit |
|---|---|
| `AWS_ENDPOINT_URL_S3` | `S3_ENDPOINT` |
| `BUCKET_NAME` | `S3_BUCKET` |
| `AWS_ACCESS_KEY_ID` | `S3_ACCESS_KEY` |
| `AWS_SECRET_ACCESS_KEY` | `S3_SECRET_KEY` |
| `AWS_REGION` | `S3_REGION` |

**Sans ce mappage, la machine ne démarre pas** — le garde de §2 lève, alors que
`fly secrets list` montre cinq secrets de stockage bien présents. C'est
exactement la fausse piste que le message d'erreur évite désormais : il nomme
les quatre variables *attendues*, pas celles qui existent.

```bash
fly storage create --name catalog-media-preprod --app catalog-api-preprod --yes
# puis, en recopiant les valeurs affichées :
fly secrets set --app catalog-api-preprod \
  S3_ENDPOINT="https://fly.storage.tigris.dev" S3_BUCKET="catalog-media-preprod" \
  S3_ACCESS_KEY="tid_…" S3_SECRET_KEY="tsec_…" S3_REGION="auto"
```

> `--yes` vaut **acceptation des conditions de service de Tigris Data**. Ce
> n'est pas un drapeau de confort : c'est un engagement contractuel, et il n'y a
> pas d'autre moyen de créer le bucket sans terminal interactif.
>
> `flyctl` **affiche les clés en clair** à la création. Elles passent donc par le
> terminal, l'historique du shell et, en session assistée, le transcript. Les
> régénérer depuis la console Tigris une fois le déploiement stabilisé.

Côté dépôt GitHub, pour le workflow :

| Secret | Sert à |
|---|---|
| `FLY_API_TOKEN` | `flyctl deploy` |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | `vercel deploy` |
| `DATABASE_URL` | l'instantané du catalogue, **uniquement** |

Et deux variables, pas des secrets — ce sont des URL publiques :

| Variable | Sert à |
|---|---|
| `API_BASE_URL` | `connect-src` de la CSP, et la vérification post-déploiement de l'API. **Le workflow refuse de construire si elle est vide** : sans elle la boutique se déploie au vert sans jamais pouvoir joindre l'API |
| `SHOP_BASE_URL` | vérifier après coup que Vercel sert bien `vercel.json`. Facultative : absente, le pas se saute en le disant |

Les deux se posent **par environnement** GitHub, comme `VERCEL_PROJECT_ID` :
c'est ce qui fait que préproduction et production ne se marchent pas dessus.

---

## 4. Premier déploiement, à la main

### L'API

```bash
fly launch --no-deploy --copy-config --name catalog-api-preprod --region cdg
fly postgres create --name catalog-pg-preprod --region cdg   # PostgreSQL 18
fly postgres attach catalog-pg-preprod --app catalog-api-preprod
fly deploy
```

`fly deploy` lance d'abord le `release_command`, qui enchaîne
`prisma migrate deploy` **puis** `apply-constraints.mjs`. L'ordre n'est pas
négociable — les contraintes SQL du lot 3 ne sont pas dans les migrations
Prisma, et une base migrée sans elles accepterait un montant négatif ou un
identifiant d'opérateur en double.

> **Il appelle les binaires directement, et pas `pnpm db:migrate`.** Le
> raccourci par le lanceur de scripts est celui qu'on tape en local, mais il
> échoue dans l'image : pnpm 11 vérifie que `node_modules` correspond au
> lockfile avant d'exécuter un script, déclenche un `pnpm install`, et sort en
> `EACCES` dans un conteneur où le processus n'a aucune raison d'écrire. Mesuré
> dans le conteneur, pas déduit. La commande exacte est dans `fly.toml` — **ne
> pas la « simplifier » en la ramenant au script pnpm.**

Le répertoire de l'interrupteur d'arrêt (`/run/catalog`) est créé **par
l'image**, pas à la main : voir le `mkdir` de l'étage d'exécution du
`Dockerfile`. Une version antérieure de ce runbook le posait ici, au milieu de
commandes `fly` — il se serait exécuté sur le poste de l'opérateur, jamais sur
la machine.

### Si le `release_command` échoue

C'est le seul point de cette procédure d'où l'on ne revient pas tout seul, et il
faut le savoir avant d'y être. Fly n'envoie pas la nouvelle version — c'est le
comportement voulu — mais une migration interrompue **en cours d'application**
laisse Prisma dans un état qu'aucun redéploiement ne débloque : la migration est
marquée en échec, et toute exécution suivante s'arrête sur `P3009` sans rien
tenter.

```bash
fly ssh console -C "sh -c 'cd /app/packages/db && ./node_modules/.bin/prisma migrate status'"
```

Puis, selon ce que dit le diagnostic — et **seulement après avoir regardé la
base**, pas par réflexe :

| Constat | Geste |
|---|---|
| La migration n'a rien appliqué | `prisma migrate resolve --rolled-back <nom>` |
| Elle a tout appliqué mais a échoué après | `prisma migrate resolve --applied <nom>` |
| Elle a appliqué une partie | Défaire à la main, puis `--rolled-back` |

Le troisième cas est le seul vraiment coûteux, et c'est celui qu'évite le
`lock_timeout` de `apply-constraints.mjs` : les contraintes sont appliquées dans
**une** transaction, donc tout ou rien.

Pour remettre le service en ligne sans attendre le diagnostic, redéployer
l'image précédente — elle tourne sur l'ancien schéma, et c'est précisément ce
que garantit l'expand/contract d'AGENTS.md §6 :

```bash
fly releases --app catalog-api-preprod          # relever la version qui marchait
fly deploy --image <image de cette version> --strategy immediate
```

### Si le bâtisseur distant refuse un jeton de déploiement

Constaté le 01/08/2026 avec un jeton `fly tokens create deploy` (scopé à l'app,
24 h) : le **registre** l'accepte (`docker login registry.fly.io`, utilisateur
`x`, jeton en mot de passe), les **machines** aussi — y compris celles de
l'app bâtisseur —, mais le canal de construction de `fly deploy` sort en
`unauthorized`, bâtisseur hérité comme Depot, builder démarré ou pas.

Le contournement qui marche : construire localement, pousser au registre,
déployer par image — le bâtisseur n'est plus dans la boucle.

```bash
docker build -f apps/api/Dockerfile -t registry.fly.io/catalog-api-preprod:<etiquette> .
cat <jeton> | docker login registry.fly.io -u x --password-stdin
docker push registry.fly.io/catalog-api-preprod:<etiquette>
fly deploy --app catalog-api-preprod --image registry.fly.io/catalog-api-preprod:<etiquette>
```

Le `release_command` (migrations puis contraintes) s'exécute normalement : il
tourne sur une machine Fly, pas chez le bâtisseur. Les secrets mis en attente
(`--stage`) partent avec ce déploiement comme avec un autre.

### `fly deploy` réussit sur un service mort — vérifier, toujours

**Ce n'est pas une précaution, c'est une observation.** Au premier déploiement
réel, `fly deploy` a rendu **0** et affiché `Visit your newly deployed app`
pendant que la machine bouclait en redémarrage sur un garde de boot. Ni le code
de sortie, ni le message, ni le `[[http_service.checks]]` de `fly.toml` n'ont
arrêté quoi que ce soit : la sonde existe, mais rien dans la commande ne bloque
sur son résultat.

Le job `api` du workflow attrape ce cas — son pas « Le service répond »
interroge `/api/statut` en boucle. Le `fly deploy` lancé à la main, non. D'où
ces trois lignes, à exécuter systématiquement après un déploiement manuel :

```bash
fly status -a catalog-api-preprod        # STATE doit dire "started", pas "stopped"
curl -sS https://api-preprod.catalog.cm/api/statut | jq
fly logs -a catalog-api-preprod --no-tail | tail -30   # si le statut ne répond pas
```

`/api/statut` doit rendre `{"niveau":"ok","base":"joignable",…}`. Un service qui
répond mais dont la base ne l'est pas rend `niveau: "degrade"` — c'est une
information différente d'un silence, et c'est pour cela que la page existe.

### La boutique

Le projet Vercel se crée avec **aucune commande de construction** : le workflow
construit, Vercel ne fait que servir. Faire construire Vercel demanderait de lui
donner `DATABASE_URL` pour l'instantané, ce qui n'a aucune raison d'être.

> **Le répertoire de sortie du projet reste VIDE — surtout pas
> `apps/shop/dist`.** `vercel deploy apps/shop/dist` fait déjà de ce répertoire
> la racine du déploiement ; le réglage du projet s'appliquerait *par-dessus*, et
> Vercel chercherait `apps/shop/dist/apps/shop/dist`. Le chemin ne se donne
> qu'une fois, et c'est sur la ligne de commande.

```bash
pnpm db:generate                      # le client Prisma, que l'instantané importe
pnpm shop:snapshot                    # a besoin de DATABASE_URL
PUBLIC_API_BASE=https://api-preprod.catalog.cm pnpm --filter @catalog/shop build
cd apps/shop/dist && VERCEL_PROJECT_ID=… VERCEL_ORG_ID=… npx vercel deploy --yes --prod
```

> **Cibler le projet par son identifiant, pas par le répertoire.** Un
> `vercel deploy apps/shop/dist` écrit un `.vercel/project.json` **dans `dist/`**
> et lie le déploiement à un projet nommé d'après le répertoire — `dist`. Le
> déploiement suivant part alors dans ce projet parasite, et le vrai continue de
> servir l'ancienne version, **au vert**. Constaté : deux projets créés, dont un
> nommé `dist`. Les variables `VERCEL_PROJECT_ID` / `VERCEL_ORG_ID` lèvent
> l'ambiguïté — c'est déjà ce que fait le workflow.

> **`--prod`, même en préproduction.** Sans lui, Vercel crée une
> *prévisualisation* : une URL jetable. `preprod.catalog.cm` continue de servir
> la version d'avant et la commande rend un succès — on croit avoir déployé.
> Chaque environnement a **son propre projet Vercel** (le `VERCEL_PROJECT_ID` du
> workflow est porté par l'environnement GitHub), donc « la production de ce
> projet-là » est bien ce qu'on veut dans les deux cas.

> **`PUBLIC_API_BASE` entre dans la politique de sécurité de contenu.** Fausse ou
> absente, `connect-src` ne contient pas l'API et le navigateur bloque les îlots
> du reçu, du suivi et de la rampe — sans erreur visible côté serveur.

Vérifier les trois choses que Vercel ne fait pas tout seul :

```bash
curl -sI https://preprod.catalog.cm/ | grep -i "content-security-policy\|referrer"
curl -sI https://preprod.catalog.cm/v/ACDE-4679 | head -1   # 200, pas 404
curl -sI https://preprod.catalog.cm/suivi/xxxx | head -1    # 200, pas 404
```

> **Les deux dernières lignes ont déjà attrapé un vrai défaut**, sur le premier
> déploiement réel du 31/07/2026. Les en-têtes passaient — donc `vercel.json`
> était bien lu — mais `/v/ACDE-4679` rendait **404**. Cause : `cleanUrls: true`
> fait de `/v/index.html` une URL non canonique, à laquelle Vercel répond 308
> vers `/v`. Une réécriture qui pointe dessus ne sert rien. La destination est
> désormais `/v`, et `public/_redirects` garde `/v/index.html` parce que Netlify
> et Cloudflare, eux, servent ce chemin tel quel.
>
> Vérifié après correction : `/v/ACDE-4679` → 200, et le corps servi porte bien
> `<title>Vérifier un reçu — Catalog</title>`. **Ne pas se contenter du code de
> statut** : une page d'accueil rendue à la place du reçu répondrait 200 aussi.

### L'app vendeuse

Déployée le 01/08/2026 : projet Vercel `catalog-vendeuse-preprod`, servi sur
`https://catalog-vendeuse-preprod.vercel.app`. Même modèle que la boutique —
aucune commande de construction côté Vercel, on déploie `dist/` :

```bash
pnpm --filter @catalog/seller build
cd apps/seller/dist && npx vercel deploy --yes --prod
```

Trois différences avec la boutique, toutes trois voulues :

1. **Son `vercel.json` est un fichier SOURCE, versionné** :
   `apps/seller/vercel.json`. L'inverse de la boutique, et pour la raison
   inverse : rien dans son contenu ne dépend du build — pas d'empreintes de
   scripts en ligne (le HTML construit n'en contient aucun), pas d'origine
   d'API injectée par l'environnement.

   > **Il arrive à DEUX endroits, et il le faut** — corrigé le 11/08/2026,
   > voir l'ADR 0067. Il a longtemps vécu dans `apps/seller/public/`, d'où Vite
   > le recopiait dans `dist/`. Correct pour la commande ci-dessus, **invisible**
   > pour une construction déclenchée depuis git : celle-là lit la configuration
   > à la racine de `apps/seller`, pas dans la sortie. Le jour où le projet
   > Vercel a été relié au dépôt, l'app s'est déployée sans son renvoi `/api/*`,
   > sans repli SPA et sans en-têtes — **sans aucune erreur de construction**.
   > Le fichier vit maintenant à la racine de l'app, et `vite.config.ts` le
   > recopie dans `dist/`. `src/__tests__/vercel-json.test.ts` tient les deux.

2. **La réécriture `/api/*` vers l'API Fly est le « serveur de tête » annoncé
   par `apps/seller/vite.config.ts`.** Le cookie de session posé par Better
   Auth doit être de MÊME ORIGINE : un appel direct du navigateur vers
   `fly.dev` en ferait un cookie tiers, jeté par défaut sur les navigateurs
   mobiles — la vendeuse serait déconnectée à chaque ouverture, sans erreur.
   Le renvoi Vercel fait voyager requêtes ET `Set-Cookie` sous l'origine de
   l'app. **L'ordre des règles compte** : `/api/*` d'abord, le repli SPA
   (`/* → /index.html`) ensuite ; les fichiers réels (`/assets`, `/sw.js`)
   gagnent de toute façon, Vercel servant le système de fichiers avant les
   réécritures.

3. **Le cache est réparti selon ce que porte le nom du fichier** : `/assets/*`
   (noms hachés) en `immutable` un an ; `sw.js` et `registerSW.js` en
   `no-cache`, sinon l'`autoUpdate` du service worker mettrait un cache CDN
   de retard à chaque livraison.

Vérifié au premier déploiement — la liste à rejouer à chaque livraison :

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://catalog-vendeuse-preprod.vercel.app/connexion   # 200 via repli SPA
curl -s https://catalog-vendeuse-preprod.vercel.app/api/statut                                   # JSON de l'API Fly
curl -sI https://catalog-vendeuse-preprod.vercel.app/ | grep -i content-security-policy
curl -sI https://catalog-vendeuse-preprod.vercel.app/sw.js | grep -i cache-control               # no-cache
```

Deux choses à savoir pour la suite :

- **`TRUSTED_ORIGINS` sur l'API doit contenir l'origine de l'app** dès qu'un
  parcours d'authentification pose un cookie depuis elle :
  `fly secrets set --app catalog-api-preprod TRUSTED_ORIGINS="https://catalog-vendeuse-preprod.vercel.app"`.
- **Le jour où la cérémonie Google s'active** (ADR 0029), l'URL de base de
  Better Auth doit être l'origine de l'APP, pas celle de l'API : c'est elle
  qui entre dans le `redirect_uri` OAuth, et le retour de Google doit passer
  par le renvoi `/api/*` pour que le cookie atterrisse sur la bonne origine.

---

## 5. Pourquoi Vercel a besoin de `vercel.json`

**Vercel ne lit ni `_redirects` ni `_headers`** — ce sont des formats Netlify et
Cloudflare Pages. Sans `vercel.json`, deux choses tombent **sans aucune
erreur** :

1. tous les en-têtes de sécurité, dont `Referrer-Policy: no-referrer`, celui qui
   empêche le jeton de suivi de partir dans un `Referer` — et ce jeton autorise
   la contre-signature (ADR 0021) ;
2. les réécritures `/v/*` et `/suivi/*`. `/v/ACDE-4679` rendrait 404 et seule
   `/v/?c=ACDE-4679` marcherait — c'est-à-dire la forme dont l'ADR 0021 dit que
   le produit ne doit **pas** dépendre.

Le fichier est **généré** par `apps/shop/scripts/entetes.mjs`, à côté de
`_headers`, à partir de la même source.

### Il est écrit dans `dist/`, et la première version se trompait

Deux défauts, tous deux constatés, tous deux silencieux :

1. **Il était écrit à la racine du paquet** (`apps/shop/vercel.json`), alors que
   le déploiement envoie `apps/shop/dist`. Vercel lit sa configuration à la
   racine du répertoire **déployé** : le fichier n'aurait jamais été lu, et rien
   n'aurait échoué — exactement la panne que ce fichier existe pour empêcher.
2. **Il était versionné et comparé par `git diff`** en intégration continue. Or
   son contenu n'est pas reproductible hors du build : `connect-src` dépend de
   `PUBLIC_API_BASE`, et les empreintes dépendent du HTML produit, donc de
   l'instantané du catalogue que la CI regénère depuis une base semée. Cette
   garde ne pouvait pas passer, et ne passait pas.

### ⚠️ Ce qui ferait disparaître ces en-têtes du jour au lendemain

**Connecter l'un de ces deux projets à Git.** Le mécanisme entier ci-dessus
repose sur `cd dist && vercel deploy` : c'est ce `cd` qui fait de `dist/` la
racine lue par Vercel, et donc de `dist/vercel.json` sa configuration.

Un projet relié à GitHub ne passe plus par là. Il construit depuis le dépôt et
lit `vercel.json` **à son `Root Directory`** — où il n'y a rien. En-têtes et
réécritures disparaissent, **sans une erreur, sans un avertissement**, et le
site continue de s'afficher parfaitement.

Ce n'est pas une hypothèse : c'est arrivé au site de la société le 05/08/2026.
Il a servi plusieurs heures sans une seule ligne de CSP pendant que son ADR
affirmait le contraire. Voir l'ADR 0045.

Si un jour l'un de ces projets doit passer par Git, la contrepartie est de
régler son `Root Directory` sur le paquet (`apps/shop`, `apps/seller`) et d'y
placer le `vercel.json` — puis de **vérifier la réponse**, pas le fichier :

```bash
curl -sSI https://<url>/ | grep -i "content-security\|x-frame\|referrer"
```

Contrôle passé le 05/08/2026 sur les deux projets : les cinq en-têtes sortent,
`/v/ACDE-4679` et `/suivi/<jeton>` rendent 200, et la reprise SPA de l'app
vendeuse fonctionne. Rien à corriger — mais rien qui tienne tout seul.

C'est donc un **artefact de construction**, comme `_headers` : produit dans
`dist/`, non versionné, regénéré à chaque build avec les valeurs de
l'environnement qui déploie. Ce que la CI vérifie n'est plus une égalité à un
fichier commité, mais une **cohérence** — les empreintes déclarées sont celles
des scripts réellement émis. Ces assertions se déclarent ignorées sans `dist/`,
d'où le second passage des tests de la boutique **après** le build : sans lui,
elles ne tournaient jamais.

---

## 6. Ce qui reste bloqué, et par quoi

| Bloqué | Cause | Ce qu'il faut décider |
|---|---|---|
| Connexion vendeuse | `PendingSmsProvider.send()` lève | Le fournisseur SMS, l'identifiant d'expéditeur déclaré au régulateur, le comportement en cas d'échec partiel |
| Écritures vendeuse | `COHORTE_POURCENT=0` | La taille de la première vague |
| Photos d'articles | dépend de S3 | Le fournisseur de stockage objet |

Le premier est le seul vrai blocage. Les deux autres sont des réglages.

**Ne pas contourner en posant `SMS_PROVIDER=console`.** L'adaptateur refuse de se
construire en production, et c'est le comportement correct : il ferait croire à
des OTP envoyés que personne ne reçoit, et une vendeuse resterait devant un champ
qu'elle ne pourra jamais remplir.

---

## 7. Arrêt et retour arrière

Ils ont leur propre runbook :
[interrupteur-et-retour-arriere.md](interrupteur-et-retour-arriere.md).

Deux points qui touchent spécifiquement Fly :

- **l'interrupteur est un fichier local à la machine**
  (`/run/catalog/interrupteur`). Avec plusieurs machines, il faut le poser sur
  chacune — `fly ssh console -s` —, ou passer par `fly secrets set INTERRUPTEUR=…`
  et accepter le redémarrage ;
- **`min_machines_running = 1` n'est pas du confort.** Un reçu est une preuve
  opposable montrée pendant une négociation ; un démarrage à froid de plusieurs
  secondes tombe exactement au moment où quelqu'un doute.

Et un point qui vaut avant toute montée en charge : **la limitation de débit
compte en mémoire du processus.** Avec N machines, la limite effective est N fois
celle qui est écrite. Passer à deux machines n'est pas un réglage neutre — soit
on divise les plafonds, soit on sort le compteur du processus.
