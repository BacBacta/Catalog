# 0002 — Prisma 7 plutôt que Drizzle

- Statut : accepté
- Date : 2026-07-28

## Contexte

Le consensus de l'écosystème pousse vers Drizzle, généralement au motif que
Prisma embarquait un moteur Rust lourd et mal adapté au serverless.

Deux faits vérifiés sur le registre npm le 28 juillet 2026 renversent ce
raisonnement. D'une part, **Drizzle n'a pas de 1.0 stable** : son tag `latest`
est figé sur `0.45.2` depuis mars 2026, et la RC 1.0 traîne depuis mai. D'autre
part, **Prisma 7 a supprimé son moteur Rust** en novembre 2025 : le client est
100 % TypeScript, le code généré va dans les sources du projet.

## Décision

**Prisma 7.9.x.** Sur un produit qui manipule de l'argent avec une petite
équipe, une dépendance figée en pré-1.0 sur le chemin critique est un risque
supérieur au confort SQL-first.

## Conséquences

- Les contraintes que Prisma ne sait pas exprimer — CHECK, triggers — vivent
  dans `packages/db/sql/0001_constraints.sql`, appliqué après chaque migration.
- À revoir si Drizzle 1.0 sort en GA et se stabilise sur plusieurs mois.
