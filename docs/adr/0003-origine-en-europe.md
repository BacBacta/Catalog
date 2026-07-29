# 0003 — Origine applicative en Europe, CDN devant

- Statut : accepté, **sous réserve de mesure**
- Date : 2026-07-28

## Contexte

Les câbles WACS et SAT-3 atterrissent à **Limbe et Douala** et repartent en
direct vers Sesimbra (Portugal) et Highbridge (Royaume-Uni) : le chemin vers
l'Europe est un seul saut sous-marin, sans transit tiers. Le Cameroun est en
revanche absent de 2Africa et d'Equiano, les deux câbles modernes à très haute
capacité.

Aucun hyperscaler n'a de région en Afrique de l'Ouest ou centrale : les seules
options africaines sont Le Cap et Johannesburg. Les mesures publiques
disponibles sont anciennes, partielles et parfois incohérentes.

## Décision

Origine applicative et base de données en **Europe (Paris)**, avec Cloudflare
devant pour tout le statique.

## Réserve — à lever avant de figer l'infrastructure

Deux mesures à faire depuis un vrai réseau MTN et Orange à Douala :

1. `curl -sI https://cloudflare.com/cdn-cgi/trace` et lire `colo=` — quel PoP
   sert réellement le Cameroun ;
2. latence comparée Douala → Paris contre Douala → Johannesburg.

Deux heures de travail remplacent tout le raisonnement ci-dessus. Si la mesure
contredit cette décision, elle est remplacée par un ADR 0006.
