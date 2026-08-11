# 0071 — La maintenance de la base passe par la machine, pas par un poste

Date : 2026-08-11
Statut : accepté
Prolonge : 0070

## Contexte

L'ADR 0070 a retiré `DATABASE_URL` de l'intégration continue : le secret de la
base ne vit plus qu'à un endroit, les secrets de l'application Fly. C'est le
résultat voulu.

Il a un corollaire qu'on découvre au premier besoin réel — remettre à zéro des
boutiques de test en préproduction : **plus personne ne peut regarder ni
corriger la base depuis un poste.** Ni un poste de développement, ni un
conteneur d'assistance, ni un exécuteur d'intégration continue.

Trois réponses étaient possibles. Deux sont mauvaises.

**Remettre `DATABASE_URL` quelque part** annulerait l'ADR 0070 le jour même, et
pour un usage bien plus dangereux que la lecture d'un catalogue.

**Ouvrir une route d'administration sur l'API** aurait réutilisé le jeton signé
de GitHub, déjà éprouvé. Mais cela laisserait dans le produit un point d'entrée
HTTP capable de vider la base. Une porte qui n'existe pas ne s'ouvre pas par
erreur, et les invariants du produit — preuves indélébiles, journal d'audit en
ajout seul — méritent qu'aucune requête ne puisse les contourner.

## Décision

**Les opérations de maintenance s'exécutent DANS la machine Fly, déclenchées
par un workflow manuel.** `.github/workflows/maintenance.yml` ouvre une
console sur l'application et y lance un script du dépôt ; le secret ne bouge
pas, aucun nouveau secret n'est distribué, et le `FLY_API_TOKEN` employé est
celui que le déploiement utilise déjà.

Deux opérations pour l'instant :

- **`inventaire`** — lecture seule. Volumes par table, détail par boutique,
  et le nombre de lignes indélébiles.
- **`remise-a-zero`** — destructeur, borné à la préproduction.

## Ce que la contrainte apporte, en fait

Elle paraît gênante ; elle est meilleure que ce qu'elle remplace. Chaque
intervention sur la base laisse désormais une **exécution datée, nominative et
relisible**, là où un terminal ne laisse rien. Le jour où quelqu'un demandera
« qui a touché à la préproduction, et quand », la réponse existera.

## Pourquoi pas `prisma migrate reset`

Son comportement **dépend des droits du rôle** : selon qu'il peut ou non
recréer la base, il supprime la base ou seulement les objets du schéma — et il
tente un *seed*. Sur une base gérée, on ne veut pas d'un geste dont le sens
change avec les permissions.

`remise-a-zero.mjs` fait donc explicitement ce qui est écrit : il découvre les
schémas présents parmi `public` et `pgboss`, les supprime et les recrée, **en
une seule transaction**. Un demi-effacement — `public` vide, `pgboss` intact —
laisserait des travaux en attente pointant vers des commandes disparues.

## Trois verrous sur l'opération destructrice

1. **`FLY_APP_NAME` doit contenir `preprod`.** Cette variable est posée par Fly
   *dans* la machine : le script refuse de s'exécuter ailleurs, y compris
   depuis un poste. Il n'existe aucun drapeau pour passer outre.
2. **`CONFIRMATION` doit valoir exactement `REMISE-A-ZERO-PREPRODUCTION`.** Le
   workflow exige la même phrase dans un champ libre : un menu à deux entrées
   se choisit de travers, une phrase de vingt-six caractères ne s'écrit pas par
   accident. Le verrou du script est **en plus** de celui du workflow, pas à sa
   place — il protège aussi les invocations qui ne passent pas par là.
3. **Il annonce ce qu'il détruit avant de le détruire**, et refait l'inventaire
   après. Un effacement silencieux n'apprend rien.

## L'ordre des quatre pas n'est pas négociable

```
remise-a-zero.mjs → prisma migrate deploy → apply-constraints.mjs → inventaire.mjs
```

Le troisième est celui qu'on oublie. Sans lui, la base repart avec ses tables
mais **sans les CHECK ni les déclencheurs d'ajout seul du lot 3** : montants qui
ne s'additionnent plus, preuves modifiables, journal d'audit réinscriptible.
Une base sans ses invariants est pire qu'une base vide, parce qu'elle a l'air
de marcher. `set -e` fait échouer la suite au premier faux pas.

## Ce que la remise à zéro coûte, écrit une fois pour toutes

- **Les reçus déjà montrés deviennent invérifiables.** `verification_code` est
  public dès qu'un reçu circule ; `/v/?c=…` répondra 404.
- **Le contrôle n° 5 se rouvre.** L'unicité `(operator, operator_tx_id)` est
  réseau-large et perpétuelle : sa mémoire est exactement ce qu'on efface, donc
  des identifiants d'opérateur déjà réclamés redeviennent réclamables.
- **Les liens déjà partagés meurent** — y compris ceux collés en Statut
  WhatsApp, dès la reconstruction suivante de la boutique.
- **Les vendeuses refont leurs OTP**, de connexion et de reversement.
- **Les objets d'images restent dans le seau.** Supprimer une ligne ne supprime
  pas l'objet stocké ; l'existence d'un ramassage n'est **pas vérifiée** et se
  signale ici plutôt que de se supposer (AGENTS.md §7.7).

Aucun de ces coûts n'est acceptable en production. C'est pourquoi le premier
verrou porte sur le nom de l'application, et non sur une intention.

## Conséquences

- La boutique publiée reste **périmée** après une remise à zéro : elle est
  statique, le CDN sert l'ancien instantané jusqu'au déploiement suivant. Le
  workflow le dit en clair à la fin plutôt que de laisser le constater.
- Ces scripts ne sont **pas** dans la chaîne de vérification, pour la même
  raison que `db:sauvegarde` et `db:restauration` : ils demandent une vraie
  base, et une remise à zéro ne se lance pas par mégarde.
- Le canal `flyctl ssh console` avec un jeton de déploiement **n'a pas encore
  été éprouvé** dans ce dépôt. L'inventaire, en lecture seule, est le premier à
  l'exercer : c'est le bon ordre pour découvrir un refus de permission.
