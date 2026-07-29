# Catalog

Outil de vente WhatsApp-first pour les commerçantes camerounaises. On ne déplace
pas la transaction hors de WhatsApp : on ajoute par-dessus la conversation un
catalogue partageable, un lien de paiement mobile money, un suivi de commande et
une réputation vérifiée.

**La valeur numéro un n'est pas le catalogue, c'est la preuve de paiement
opposable** — un reçu à code vérifiable, dans un marché où la fausse capture
d'écran MoMo est l'arnaque la plus courante, dans les deux sens.

## Démarrer

```bash
corepack enable && corepack prepare pnpm@11.17.0 --activate
pnpm install
cp .env.example .env
docker compose up -d          # PostgreSQL 18 + MinIO
pnpm db:generate
pnpm dev                      # shop :4321 · seller :5173 · api :8787
```

Vérifier la chaîne complète, comme la CI :

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size
```

## Structure

```
apps/shop      Astro 7 — boutique publique, vérification de reçu, suivi
apps/seller    React Router 8 en SPA + service worker
apps/api       Hono 4
  src/domain     métier pur, testable sans base ni réseau
  src/adapters   agrégateurs de paiement, SMS, stockage — derrière interfaces
  src/routes     HTTP mince : valide, délègue, sérialise
packages/contracts  schémas Zod partagés = source de vérité des types
packages/db         schéma Prisma + contraintes SQL
packages/ui         jetons de design
docs/adr            une décision = un fichier numéroté, jamais réécrit
```

**Règle de dépendance** : `domain` ne dépend de rien. `routes` et `jobs`
dépendent de `domain`. Les `adapters` implémentent des interfaces définies dans
`domain`. Aucun import de Prisma dans `domain`.

## Les cinq règles qu'on ne négocie pas

1. **Les montants sont des entiers XAF.** Le franc CFA n'a pas de sous-unité.
   Jamais de flottant.
2. **Il n'y a pas d'adresse au Cameroun.** Quartier, point de repère, téléphone.
3. **Le contenu d'un webhook n'est jamais une preuve.** Signature, puis
   re-vérification du statut auprès de l'agrégateur.
4. **`waiting_customer` n'est pas un échec.** C'est l'acheteuse qui n'a pas
   encore saisi son code secret.
5. **30 Ko de JS sur la boutique.** La CI échoue au dépassement.

Le détail est dans `AGENTS.md`, lu au début de chaque session de travail.

## Versions

Relevées sur le registre npm le **28 juillet 2026**. Elles se périment :
revérifier avant toute montée de version majeure, et écrire un ADR.

| | |
|---|---|
| Astro | 7.1.5 |
| React Router | 8.3.0 · React 19.2.8 |
| Hono | 4.12.32 · Node 24 LTS |
| PostgreSQL | 18 · Prisma 7.9.1 |
| Tailwind | 4.3.3 (config CSS-first, pas de `tailwind.config.js`) |
| TypeScript | **6.0.3 — pas 7** : TS 7 ne supporte pas encore Astro |
| Outils | pnpm 11 · Biome 2.5.6 · Vitest 4.1.10 · Playwright 1.62 |

## Phase en cours

**Phase 1 — catalogue.** La phase 0 (conformité) reste ouverte : aucun code de
paiement ne doit être écrit avant qu'un agrégateur ait confirmé par écrit les
conditions de partenariat au regard du communiqué du MINFI du 5 mai 2025.
