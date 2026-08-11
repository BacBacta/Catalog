# 0068 — La boutique se reconstruit par la porte

Date : 11/08/2026
Statut : accepté
Révise : l'ADR 0065 sur le **transport** seulement — la décision de reconstruire
et son regroupement de 10 minutes ne changent pas
S'appuie sur : 0067 (où Vercel lit sa configuration)
Concerne : `adapters/reconstruction-boutique.ts`,
`.github/workflows/deploiement.yml`

## Le crochet ne pouvait pas atteindre la boutique

L'ADR 0065 envoyait une requête à un **crochet de déploiement** de l'hébergeur.
Mesure du 11/08/2026, par l'API Vercel :

```
catalog-boutique-preprod   git = NON   crochets = 0
catalog-vendeuse-preprod   git = oui   crochets = 1   [catalog-api -> main]
```

Un crochet de déploiement Vercel **suppose un projet relié à un dépôt**. La
boutique ne l'est pas, donc elle ne peut en porter aucun. Le seul crochet de
l'équipe est sur le projet de l'app **vendeuse**.

Deux issues, aucune bonne :

- si `SHOP_REBUILD_HOOK_URL` visait ce crochet, il répondait **200** — le bot
  annonçait « votre page web se met à jour d'ici 15 minutes », l'app vendeuse
  se reconstruisait, et la boutique restait en 404 ;
- sinon, l'adaptateur avalait l'échec — honnête, mais la fonction ne faisait
  rien.

Dans les deux cas, **l'ADR 0065 n'était pas fonctionnel**. Le code était bon et
testé ; le câblage n'existait pas.

## Pourquoi on ne relie PAS la boutique à un dépôt

C'est la solution évidente, et elle est piégée. L'ADR 0067 vient de le mesurer :
**Vercel lit `vercel.json` à la racine du répertoire qu'on lui déploie.** Une
construction depuis git lirait `apps/shop/vercel.json`.

Ce fichier **n'existe pas et ne peut pas exister** : il est produit dans `dist/`
par `entetes.mjs`, parce que sa politique de sécurité porte les **empreintes des
scripts réellement émis** et que `connect-src` dépend de `PUBLIC_API_BASE`. On
ne peut pas le versionner à la racine : son contenu n'existe pas avant la
construction.

Relier la boutique la déploierait donc sans :

- **`Referrer-Policy: no-referrer`** — celui qui empêche le jeton de suivi de
  l'acheteuse de partir dans un `Referer`. C'est la clé qui autorise la
  contre-signature (ADR 0021) ;
- **les réécritures `/v/*` et `/suivi/*`** — `/v/ACDE-4679` rendrait 404, et
  seule `/v/?c=…` fonctionnerait, la forme dont l'ADR 0021 dit que le produit
  ne doit pas dépendre ;
- **toute la CSP.**

Sans erreur de déploiement, avec une page d'accueil qui s'ouvre. C'est
exactement la panne dont l'app vendeuse sort le même jour, transposée là où
elle coûte le plus cher.

## La décision

L'API émet un **`repository_dispatch`** vers GitHub. Le workflow de déploiement
l'écoute, refait l'instantané depuis la base, reconstruit et déploie
`apps/shop/dist` — donc `dist/` reste la racine déployée, et tout le mécanisme
d'en-têtes continue de fonctionner tel quel.

`cible` vaut **`boutique`** par défaut sur cet événement : le job `api` ne part
pas. `environnement` vient du `client_payload`, avec `preproduction` par défaut
— une reconstruction ne touche pas la production sans qu'on l'ait demandé.

Le transport crochet **reste dans le code**, en repli, pour le jour où la
boutique serait reliée. Il n'est pas retiré : c'est une investigation
aboutie, comme l'adaptateur agrégateur (AGENTS.md §5).

## La porte reste franchie, et c'est le point qui se discute

`deploiement.yml` est manuel **exprès** : son en-tête dit que l'automatisme
attend que le retour arrière ait été joué pour de vrai. On aurait pu faire
sauter la chaîne de vérification pour un simple rafraîchissement d'instantané.

On ne l'a pas fait, pour une raison mesurable : **un dispatch déploie `main` à
l'instant où il arrive**, sans qu'un humain ait regardé. Si `main` porte du
code non vérifié, une vendeuse qui publie un article le met en ligne. C'est
précisément le cas pour lequel la porte existe. Elle coûte ~5 minutes ; le
délai annoncé à la vendeuse est de 15.

Ce qui a changé, en revanche, c'est que le déploiement de la **boutique**
devient automatique. Le garde-fou d'origine visait le risque de l'API —
migrations, `release_command`, retour arrière non joué. La boutique est un site
statique : pas de migration, pas de commande de version, et son retour arrière
est « redéployer le déploiement Vercel précédent », immuable et instantané. Le
job `api` reste, lui, strictement manuel.

## Le prix, dit franchement

Un **jeton GitHub dans les secrets Fly de l'API** — portée `contents: write` sur
ce dépôt, le minimum que `repository_dispatch` exige. C'est un secret de plus à
faire tourner, et il donne le droit de déclencher un déploiement.

Deux choses le bornent : il ne peut lancer que ce que le workflow contient, et
la porte tourne avant.

## Un piège d'expression trouvé en câblant

`if:` est **déjà** un contexte d'expression. Écrire
`if: ${{ inputs.cible || 'boutique' }} == 'api'` produit une **chaîne** non
vide, donc toujours vraie : le job `api` serait parti à chaque publication
d'article. La forme correcte n'enveloppe rien :
`if: (inputs.cible || 'boutique') == 'api'`.

## `PUBLIC_BOT_WHATSAPP` se pose ici, pas chez Vercel

Corollaire du même constat, et il corrige une consigne répétée toute la
journée : **la boutique est construite dans GitHub Actions**, Vercel ne reçoit
que `dist/`. Une variable posée dans le tableau de bord Vercel n'entre dans
aucun build.

`PUBLIC_BOT_WHATSAPP` est donc une **variable GitHub** (`vars.BOT_WHATSAPP`),
par environnement. Absente, la fiche produit reprend le chemin d'avant : le
comptoir est dormant par défaut (ADR 0066), donc elle n'est pas gardée comme
`API_BASE_URL` — son absence est un état légitime.

## Ce qu'il reste à poser, et qui n'est pas dans le dépôt

| où | quoi |
|---|---|
| secrets Fly de l'API | `SHOP_REBUILD_GITHUB_REPO`, `SHOP_REBUILD_GITHUB_TOKEN` |
| variables GitHub, par environnement | `BOT_WHATSAPP` |
| — | retirer `SHOP_REBUILD_HOOK_URL`, qui vise le mauvais projet |

**Le dispatch ne fonctionne que depuis la branche par défaut** : GitHub ne lit
ce fichier de workflow que là. Rien de tout ceci n'agit avant la fusion.

## Conséquences

- 17 tests sur le déclencheur, dont un qui lit le workflow réel pour vérifier
  que le nom de l'événement n'a pas divergé — la divergence produirait un 204
  suivi de rien.
- Le regroupement de 10 minutes vaut pour les deux transports.
- Ni le jeton, ni l'URL, ni le corps des réponses n'entrent dans une trace
  (ADR 0023).
