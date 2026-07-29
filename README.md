# Catalog

Outil de vente WhatsApp-first pour les commerçantes camerounaises. On ne déplace
pas la transaction hors de WhatsApp : on ajoute par-dessus la conversation un
catalogue partageable, une rampe de paiement mobile money, un suivi de commande
et une réputation vérifiée.

**La valeur numéro un n'est pas le catalogue, c'est la preuve de paiement
opposable** — un reçu portant l'identifiant de transaction de l'opérateur, dans
un marché où la fausse capture d'écran MoMo est l'arnaque la plus courante.

Les fonds ne transitent jamais par un compte contrôlé par Catalog : ils vont du
portefeuille de l'acheteuse à celui de la vendeuse, en dépôt direct. Voir
l'ADR 0009.

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
  src/adapters   stockage, SMS sortants — derrière interfaces
                 (l'adaptateur agrégateur y dort, voir ADR 0009)
  src/routes     HTTP mince : valide, délègue, sérialise
packages/contracts  schémas Zod partagés = source de vérité des types
packages/db         schéma Prisma + contraintes SQL
packages/ui         jetons de design + primitives sur Base UI
docs/adr            une décision = un fichier numéroté, jamais réécrit
```

**Règle de dépendance** : `domain` ne dépend de rien. `routes` et `jobs`
dépendent de `domain`. Les `adapters` implémentent des interfaces définies dans
`domain`. Aucun import de Prisma dans `domain`.

## Les cinq règles qu'on ne négocie pas

1. **Les montants sont des entiers XAF.** Le franc CFA n'a pas de sous-unité.
   Jamais de flottant.
2. **Il n'y a pas d'adresse au Cameroun.** Quartier, point de repère, téléphone.
3. **Seul le SMS reçu par la vendeuse prouve un paiement.** Une capture d'écran
   n'est jamais une entrée de contrôle, et un identifiant d'opérateur ne vaut
   qu'une fois sur tout le réseau.
4. **Catalog n'encaisse rien et ne prélève aucune commission.** Le revenu vient
   de l'abonnement — on ne peut pas prélever sur un flux qu'on ne détient pas.
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
| Base UI | 1.6.0 — paquet `@base-ui/react` (l'ancien `@base-ui-components/react` s'est arrêté en 1.0.0-rc) |
| Outils | pnpm 11 · Biome 2.5.6 · Vitest 4.1.10 · Playwright 1.62 · axe-core 4.12 |

## Design system

`packages/ui` — jetons en CSS-first (`@theme`, pas de `tailwind.config.js`),
primitives sur **Base UI** (`@base-ui/react`), et deux composants propres au
produit : `SmsPasteField` et `ProofChecklist`.

Page de démonstration : `pnpm --filter @catalog/seller dev`, puis `/demo`. Elle
montre chaque composant dans les quatre états obligatoires — chargement, vide,
erreur, **hors ligne** — et permet de basculer le thème à la main.

Ce qui est vérifié par la CI, et non par l'œil :

| Contrôle | Où |
|---|---|
| Contrastes WCAG 2.2 AA sur **les deux thèmes** | `packages/ui/src/__tests__/tokens.test.ts` |
| Le collage n'est jamais bloqué | `components.test.ts` + un vrai `Ctrl+V` en e2e |
| Cibles tactiles ≥ 44 px **une fois rendues** | `apps/seller/e2e/ui-demo.spec.ts` |
| Zéro violation axe-core bloquante | idem, sur les deux thèmes |
| Aucune police téléchargée, aucune dépendance de style | `tokens.test.ts`, `components.test.ts` |

```bash
pnpm --filter @catalog/seller build      # le serveur de préviz sert le build
pnpm --filter @catalog/seller e2e        # axe-core + captures clair/sombre
```

Si votre environnement embarque déjà un Chromium d'une autre version que celle
attendue par Playwright, pointez-le au lieu d'en télécharger un second :

```bash
CHROMIUM_PATH=/chemin/vers/chrome pnpm --filter @catalog/seller e2e
```

### Poids mesuré

Relevé le 29/07/2026, build de production, compressé gzip :

| | JS | CSS |
|---|---|---|
| App vendeuse **avant** le design system (lot 0) | 108,4 Ko | 1,9 Ko |
| App vendeuse **avec** le design system et `/demo` | **165,3 Ko** | 4,4 Ko |
| Boutique publique (`apps/shop`) | **0,0 Ko** / 30 Ko | — |

Le socle coûte donc environ **57 Ko compressés**, dont l'essentiel est Base UI.
C'est acceptable dans l'app vendeuse — SPA mise en cache par le service worker,
ouverte plusieurs fois par jour par la même personne — et ce serait inacceptable
sur la boutique publique, qui reste à **zéro octet de JS** : elle importe
`tokens.css` et aucun composant React. Le budget de 30 Ko n'est pas entamé, et
`pnpm size` le vérifie à chaque build.

## Phase en cours

**Phase 2 — boutique et articles.** Le lot 0 (bascule v1 sans agrégateur et
renommage) et le lot 2 (design system) sont livrés. La séquence complète est
dans `PROMPTS.md` : un lot par session.

Il n'y a plus de porte de phase 0 : sans agrégateur, aucune confirmation écrite
d'un tiers n'est attendue avant d'écrire le code de paiement (ADR 0009).
