# 0065 — La boutique se reconstruit, et le fil le dit

Date : 2026-08-11
Statut : accepté
Répond à : le rang 0 de l'ADR 0061, mesuré au banc du 11/08/2026
Concerne : `domain/deploiement/reconstruction-boutique.ts`,
`adapters/reconstruction-boutique.ts`, `bot.ts`, `routes/products.ts`,
`domain/bot/inscription.ts`

## Ce qui a été mesuré

```
chez-bea-test    HTTP 404
chez-oumar       HTTP 404
accueil          HTTP 200
```

Deux boutiques nées dans le fil WhatsApp, avec des articles, une
carte-vitrine et des commandes — et **aucune page web**. Le reproche du
porteur, mot pour mot : *« impossible d'accéder au catalogue ou boutique web
pour finaliser la commande »*.

Ce n'était pas un défaut de code. C'était le prix, jamais payé, d'un choix
d'architecture juste.

## Le choix qu'on ne remet PAS en cause

`apps/shop` lit un instantané JSON pris à la **construction** et ne parle
jamais à la base (lot 6). C'est ce qui tient les 30 Ko de JavaScript, le LCP
sous 2,5 s en Slow 4G, et ce qui fait qu'une page de boutique survit à une API
tombée. La règle de dépendance est inversée **exprès**.

On ne renonce donc pas à l'instantané. On le **rafraîchit** quand ce que
l'acheteuse voit a changé.

## La décision

Un **crochet de déploiement** : l'API demande à l'hébergeur de reconstruire.
La construction reprend l'instantané contre la base réelle, et les nouvelles
boutiques apparaissent.

### La liste des motifs est FERMÉE

Même raison que celle des gabarits (ADR 0054) : une reconstruction coûte un
déploiement entier. Quatre motifs, et eux seuls :

| Motif | Pourquoi |
|---|---|
| `boutique_creee` | Elle n'a encore aucune page ; l'accueil la liste |
| `article_publie` | Publié, retiré, renommé, reprixé |
| `boutique_modifiee` | Nom, ville, description |
| `conges_bascules` | La page doit dire qu'elle est fermée (ADR 0039) |

Ce qui n'y est **pas**, et pourquoi : une commande — la boutique n'affiche pas
les commandes ; le numéro de reversement — il n'a rien à faire sur une page en
cache CDN ; **un avis déposé** — il compte dans la réputation affichée, mais
il arrive trop souvent pour justifier un déploiement à lui seul. Il voyagera
avec la reconstruction suivante.

### Le regroupement

Une vendeuse qui publie sa collection d'un coup — le geste le plus naturel du
premier jour — déclencherait un déploiement **par photo**. Une demande qui
arrive dans les 10 minutes suivant la précédente est donc absorbée : elle sera
dans le même instantané de toute façon, puisqu'il est pris au démarrage de la
construction et non à la demande.

**Le regroupement vit en mémoire, et c'est assumé.** Le mettre en base
ajouterait une table et une migration pour économiser une construction
occasionnelle. Conséquence à connaître : avec plusieurs instances d'API,
chacune a son compteur — le regroupement est un **plancher, pas une
garantie**. Dit ici plutôt que découvert un jour de facture.

## Le fil cesse de mentir

Le bot annonçait `✅ Robe wax — 15 000 FCFA est **en ligne**`. C'était vrai
pour le catalogue du fil et **faux pour le web** — et c'est le web que la
vendeuse va montrer.

Il dit maintenant *« est dans votre catalogue »*, puis, **seulement si une
reconstruction est réellement partie** :

> Votre page web se met à jour — elle portera cet article d'ici 15 minutes.

Le délai annoncé couvre le regroupement **plus** la construction. Une promesse
fausse sur la seule chose qu'elle attend vaudrait moins que le silence — c'est
pourquoi, sans crochet configuré ou quand le regroupement absorbe la demande,
**rien n'est annoncé**.

## Les deux chemins, pas un seul

Un article créé depuis **l'app vendeuse** périme la page autant qu'un article
créé depuis le fil. Brancher un seul des deux laisserait la moitié des
publications en retard, sans que rien ne le dise. Les deux appellent.

## Jamais fatal

Une reconstruction ratée ne doit **jamais** empêcher la publication. La
vendeuse a fait son geste, il est enregistré ; la page suivra à la prochaine
occasion. Même leçon que le Flow refusé du banc du 10/08 : ce qui est en plus
ne casse pas ce qui est essentiel.

## Le secret

L'URL du crochet **vaut un droit de déployer**. Elle ne figure dans aucune
trace : les corps d'erreur de l'hébergeur ne sont pas recopiés, seul le code
HTTP l'est (ADR 0023). Un test le vérifie en glissant un jeton dans le corps
d'erreur et en s'assurant qu'il ne ressort pas.

## Ce que cet ADR ne fait pas

- **Il ne change pas l'instantané en lecture directe.** La boutique reste
  statique, et c'est tout l'intérêt.
- **Il ne garantit pas la mise en ligne.** Le crochet répond en
  millisecondes, la construction dure des minutes : l'accusé de réception
  n'est pas une garantie, et aucun texte ne le présente comme telle.
- **Il ne pose pas la variable en production.** `SHOP_REBUILD_HOOK_URL` est
  absente par défaut ; sans elle, rien n'est monté, rien ne part, rien n'est
  annoncé.

## Conséquences

- 13 tests neufs : la décision pure, le regroupement, la non-fuite de l'URL,
  et les trois cas du message du fil.
- Le mot « en ligne » quitte le message de publication. Il reviendra le jour
  où il sera vrai des deux côtés.
