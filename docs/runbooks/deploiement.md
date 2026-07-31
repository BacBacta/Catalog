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
| `S3_ENDPOINT` | `MemoryStorage est un stockage de developpement : en production, les photos disparaitraient au premier redemarrage.` |

`SMS_PROVIDER=provider` est déjà posé dans `fly.toml`. Le stockage, non : il
demande de vrais identifiants, donc il passe par `fly secrets`.

---

## 3. Les secrets

**Aucun ne va dans le dépôt, ni dans `fly.toml`, ni dans un workflow.** Un
secret qui traverse un journal d'intégration continue est un secret publié.

```bash
fly secrets set --app catalog-api-preprod \
  DATABASE_URL="postgresql://…" \
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  BETTER_AUTH_URL="https://api-preprod.catalog.cm" \
  SMS_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  PAYOUT_OTP_SECRET="$(openssl rand -hex 32)" \
  S3_ENDPOINT="https://…" S3_BUCKET="catalog-media" \
  S3_ACCESS_KEY="…" S3_SECRET_KEY="…" S3_REGION="…" \
  TRUSTED_ORIGINS="https://preprod.catalog.cm"
```

> **`SMS_ENCRYPTION_KEY` ne se perd pas et ne se change pas à la légère.** Elle
> chiffre le SMS d'opérateur au repos (lot 8). La perdre rend illisibles toutes
> les preuves déjà enregistrées — et le SMS brut est ce qui porte l'identifiant
> de transaction, donc la matière du reçu. À sauvegarder ailleurs que sur Fly,
> le jour où elle est créée.

Côté dépôt GitHub, pour le workflow :

| Secret | Sert à |
|---|---|
| `FLY_API_TOKEN` | `flyctl deploy` |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | `vercel deploy` |
| `DATABASE_URL` | l'instantané du catalogue, **uniquement** |

Et une variable, pas un secret : `API_BASE_URL` — c'est une URL publique.

---

## 4. Premier déploiement, à la main

### L'API

```bash
fly launch --no-deploy --copy-config --name catalog-api-preprod --region cdg
fly postgres create --name catalog-pg-preprod --region cdg   # PostgreSQL 18
fly postgres attach catalog-pg-preprod --app catalog-api-preprod
mkdir -p /run/catalog   # l'interrupteur ; voir interrupteur-et-retour-arriere.md
fly deploy
```

`fly deploy` lance d'abord le `release_command` : `pnpm db:migrate`, qui
enchaîne `prisma migrate deploy` **puis** `apply-constraints.mjs`. L'ordre n'est
pas négociable — les contraintes SQL du lot 3 ne sont pas dans les migrations
Prisma, et une base migrée sans elles accepterait un montant négatif ou un
identifiant d'opérateur en double.

Vérifier :

```bash
curl -sS https://api-preprod.catalog.cm/api/statut | jq
```

### La boutique

Le projet Vercel se crée avec **`apps/shop/dist` comme répertoire de sortie** et
**aucune commande de construction** : le workflow construit, Vercel ne fait que
servir. Faire construire Vercel demanderait de lui donner `DATABASE_URL` pour
l'instantané, ce qui n'a aucune raison d'être.

```bash
pnpm shop:snapshot                    # a besoin de DATABASE_URL
PUBLIC_API_BASE=https://api-preprod.catalog.cm pnpm --filter @catalog/shop build
npx vercel deploy apps/shop/dist --yes
```

> **`PUBLIC_API_BASE` entre dans la politique de sécurité de contenu.** Fausse ou
> absente, `connect-src` ne contient pas l'API et le navigateur bloque les îlots
> du reçu, du suivi et de la rampe — sans erreur visible côté serveur.

Vérifier les trois choses que Vercel ne fait pas tout seul :

```bash
curl -sI https://preprod.catalog.cm/ | grep -i "content-security-policy\|referrer"
curl -sI https://preprod.catalog.cm/v/ACDE-4679 | head -1   # 200, pas 404
curl -sI https://preprod.catalog.cm/suivi/xxxx | head -1    # 200, pas 404
```

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
