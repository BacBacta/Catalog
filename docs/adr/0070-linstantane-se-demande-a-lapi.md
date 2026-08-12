# 0070 — L'instantané du catalogue se demande à l'API, pas à la base

Date : 2026-08-11
Statut : accepté
Révise : 0068 (le transport de la reconstruction reste inchangé ; c'est la
source de l'instantané qui change)

## Contexte

La boutique publique est un site **statique**. Elle ne parle pas à la base : elle
lit un instantané JSON pris à la construction (lot 6). Cette inversion de la
règle de dépendance est délibérée — c'est elle qui tient les 30 Ko de JavaScript
et qui fait qu'une page de boutique survit à une API tombée.

Le job `boutique` de `.github/workflows/deploiement.yml` produisait donc cet
instantané en **interrogeant la base de production depuis l'intégration
continue** :

```yaml
- run: pnpm db:generate         # env: DATABASE_URL
- run: pnpm shop:snapshot       # env: DATABASE_URL
```

Ce job n'a **jamais abouti**. Ses deux seules exécutions, le 07/08 et le
11/08/2026, sont mortes sur la même ligne, et il a fallu trois échecs successifs
pour voir pourquoi : le secret `DATABASE_URL` n'existe pas dans ce dépôt. Il n'y
a jamais été posé.

La réponse évidente était de l'y poser. Elle est mauvaise, pour deux raisons
indépendantes — et la première suffirait.

**1. C'est la chaîne de connexion complète de la base de production.** Hôte,
identifiant, mot de passe, en un seul secret, déposé chez un fournisseur
d'intégration continue qui exécute du code écrit dans des branches. Il n'y a
aucune granularité possible : ce secret n'ouvre pas « la lecture du catalogue »,
il ouvre la base — les commandes, les preuves de paiement, les numéros de
reversement. La cle du coffre confiée au coursier.

**2. Le coursier n'en a pas besoin.** L'API a déjà cette chaîne, légitimement,
parce que parler à la base est son travail. Elle peut donc **servir**
l'instantané ; la construction n'a plus qu'à le demander.

## Décision

**L'API sert l'instantané du catalogue sur `GET /api/instantane`, et le
déploiement le lui demande. `DATABASE_URL` ne va pas chez GitHub.**

Trois conséquences dans le job `boutique` :

- `pnpm db:generate` disparaît — plus rien dans ce job n'importe le client
  Prisma ;
- `pnpm shop:snapshot` devient `pnpm shop:snapshot:distant` ;
- le job ne porte plus aucun secret de base de données.

`exporter-catalogue.mjs` reste : c'est le chemin de la chaîne de vérification et
du développement, où la base est locale et jetable. Les deux chemins partagent
le **choix des champs**, qui vit désormais dans
`apps/api/src/adapters/instantane-catalogue.ts`. Deux copies de cette requête
dériveraient, et le jour où l'écart porterait sur un champ sensible, personne ne
le verrait.

## La route n'est pas publique, alors que la donnée l'est

Chaque champ servi est déjà sur une page de boutique : le nom, la ville, les
articles, les prix, la note, et le numéro WhatsApp du bouton « écrire à la
vendeuse ». Rien de privé n'y entre — le numéro de **reversement**, en
particulier, n'y est pas, et n'y sera jamais.

Mais une page à la fois. Réunir en un appel le numéro de **toutes** les
vendeuses actives change la nature de la chose : ce n'est plus un catalogue,
c'est une liste de diffusion. La différence est réelle même si la donnée ne
l'est pas, et elle ne coûte rien à éviter. On ne construit pas la liste de
diffusion de ses propres vendeuses.

## Comment l'appelant s'identifie — et pourquoi pas par un secret partagé

La réponse habituelle serait un jeton commun, posé des deux côtés. Elle échoue
ici pour une raison de fond : ce secret devrait être **inventé**, puis
**transmis** à un humain pour qu'il le recopie dans deux tableaux de bord. Un
secret qui traverse une conversation est un secret publié — c'est exactement la
dette que le dépôt traîne déjà (tâche #49). On ne la creuse pas pour économiser
trente lignes.

GitHub signe, sur demande, un jeton court décrivant l'exécution en cours : quel
dépôt, quelle référence, quel workflow. Sa clé publique est publiée. Il n'y a
donc **aucun secret à poser nulle part** — ni chez GitHub, ni chez Fly.

```
workflow ──(permissions: id-token: write)──> jeton signé, audience « catalog-instantane »
   │
   └── GET /api/instantane, Authorization: Bearer <jeton>
                │
                └── l'API vérifie la signature (clé publique GitHub)
                    et lit `repository` : c'est le dépôt qu'elle réveille déjà.
```

Deux contrôles portent tout le poids, et chacun serait insuffisant seul :

1. **le dépôt.** N'importe qui peut demander à GitHub un jeton parfaitement
   signé depuis *son* dépôt. Sans ce contrôle, la route est publique avec une
   étape de plus ;
2. **l'audience.** Elle est choisie par nous. Sans ce contrôle, tout jeton du bon
   dépôt — celui d'un déploiement AWS, par exemple, où l'audience vaut
   `sts.amazonaws.com` — ouvrirait cette route.

La liste d'algorithmes est **fermée** à `RS256` : sans elle, un jeton déclare
l'algorithme avec lequel il veut être vérifié, ce qui est la première faille de
toute implémentation de JWT.

Les règles d'acceptation vivent dans `src/domain/deploiement/jeton-actions.ts`,
où elles se lisent et se testent **sans réseau ni clé** ; l'adaptateur ne fait
que récupérer les clés publiques et vérifier la signature.

## Aucune variable nouvelle

La route est montée **si et seulement si** `SHOP_REBUILD_GITHUB_REPO` est
renseignée — la même variable que le déclencheur de reconstruction, vue dans
l'autre sens : l'API réveille le workflow, il revient chercher la photo. Sans
elle, rien n'est monté, comme le reste de ce qui est dormant (AGENTS.md §5).

Côté GitHub, rien à poser non plus : `permissions: id-token: write` est une
déclaration dans le fichier, pas un réglage de tableau de bord.

## Ce qui n'est PAS vérifié, et pourquoi

La **référence** (`ref`) ne l'est pas. L'exiger sur `refs/heads/main`
paraîtrait plus sûr, mais interdirait de rejouer le déploiement depuis une
branche — ce qu'on fait justement pour éprouver la chaîne avant de la fusionner.
Or la frontière de confiance n'est pas la branche : quiconque peut pousser une
branche sur ce dépôt peut déjà en lire le contenu. Le dépôt est la bonne
granularité ; la branche donnerait l'illusion d'une barrière qui n'en est pas
une.

## Conséquences

- Le déploiement de la boutique ne dépend plus d'un secret **absent**, donc il
  peut aboutir. C'est le point de départ de cet ADR.
- Un secret de base de production de moins dans le monde. Il n'y en a plus
  qu'un exemplaire, chez Fly, là où c'est son travail.
- L'API devient un **prérequis** du déploiement de la boutique : API tombée,
  pas de nouvel instantané. C'est un couplage nouveau, et il est acceptable —
  une boutique qu'on redéploie alors que l'API est tombée servirait de toute
  façon des pages dont le reçu et le suivi ne répondent pas. L'ancienne version
  continue d'être servie par le CDN pendant ce temps.
- Le job échoue **franchement** quand l'API refuse le jeton, avec les trois
  causes possibles écrites dans le message. Le mode d'échec précédent — un
  `PrismaConfigEnvError` obscur — a coûté trois itérations.
- La route ne dit pas **pourquoi** elle refuse. Le motif fermé
  (`emetteur`, `audience`, `depot`, `expire`, …) sert le diagnostic depuis les
  journaux du serveur ; le dire à l'appelant lui apprendrait la moitié de ce
  qu'il cherche.

## Alternatives écartées

**Poser `DATABASE_URL` chez GitHub.** L'objet même de cet ADR. Voir plus haut.

**Un utilisateur PostgreSQL en lecture seule, restreint aux deux tables.** Réduit
la portée sans supprimer le problème : il reste une base de production joignable
depuis l'extérieur avec un identifiant déposé ailleurs, et il faut désormais
maintenir des droits SQL en plus. Le champ servi est déjà décidé par la requête ;
l'utilisateur restreint ne fait que le redire, moins bien.

**Un jeton partagé (`INSTANTANE_TOKEN`).** Trente lignes de moins, mais un secret
inventé, transmis à un humain, recopié dans deux tableaux de bord, et à faire
tourner un jour. Le jeton d'identité de GitHub n'a aucune de ces propriétés.

**Rendre la route publique.** Ce serait publier d'un bloc le numéro de toutes les
vendeuses actives. Voir plus haut.

**Faire voyager l'instantané dans le `client_payload` du dispatch.** Il
apparaîtrait dans l'événement de l'exécution, lisible par quiconque a accès au
dépôt — même exposition, en pire, et une limite de taille par-dessus.
