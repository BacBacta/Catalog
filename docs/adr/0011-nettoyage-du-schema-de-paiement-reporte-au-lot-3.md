# 0011 — Le nettoyage du schéma de paiement appartient au lot 3

- Statut : **caduc — dette payée au lot 3 le 29/07/2026**. Voir la section
  finale ; le corps du texte est conservé tel quel.
- Date : 2026-07-29
- Amende la définition de terminé du **lot 0** de `PROMPTS.md`
- Ne modifie aucune décision d'architecture : l'ADR 0009 reste la référence

## Contexte

Le lot 0 a basculé le dépôt sur l'architecture v1 sans agrégateur (ADR 0009).
Sa définition de terminé exigeait que cette commande ne renvoie plus que des
occurrences situées dans l'adaptateur dormant et ses tests :

```
git grep -n "WAITING_FOR_CUSTOMER\|webhook" -- apps packages
```

Elle en renvoie davantage. Quatre d'entre elles sont dans `packages/db`, et
elles ne décrivent pas l'adaptateur : elles décrivent le **modèle de données**
hérité de l'architecture à agrégateur.

## Ce qui reste, et pourquoi c'est un bloc

| Élément | Ce qui le rattache à l'agrégateur |
|---|---|
| `model PaymentEvent` | table d'idempotence de webhook, `@@unique([providerTxId, status])` |
| `model Payment` | champs `provider`, `providerTxId`, `raw`, `confirmedAt` — un paiement que Catalog aurait opéré |
| `enum PaymentStatus` | contient `waiting_customer`, c'est-à-dire l'ancien `WAITING_FOR_CUSTOMER` |
| `packages/db/scripts/check-schema.mjs` | **asserte** que la contrainte webhook existe encore, et échoue si elle disparaît |
| `packages/db/sql/0001_constraints.sql` | porte un `CHECK` sur la table `Payment` |

Les cinq se tiennent. On ne peut pas retirer `PaymentEvent` seul : il resterait
un `model Payment` tout aussi périmé. On ne peut pas retirer les deux modèles
sans toucher aussi les deux gardes, sous peine de rendre `pnpm db:validate`
rouge.

## La contradiction à trancher

Elle est interne à `PROMPTS.md`, et il faut la nommer :

- la définition de terminé du **lot 0** exige le grep propre ;
- son préambule interdit d'anticiper les lots suivants, et le **lot 3** est
  propriétaire de ce schéma. Il le spécifie en entier — `payment_proof` avec
  `UNIQUE(operator, operator_tx_id)` — et dit explicitement qu'« il n'y a PAS
  de table `payment_event` ni de champ `provider_tx_id` ». Il **fige** en outre
  le vocabulaire de l'état de la preuve (`attendu`, `declare_non_trace`,
  `prouve`, `contresigne`, `conteste`) en demandant de ne pas le redéfinir
  ailleurs.

Les deux exigences ne peuvent pas être satisfaites en même temps.

## Décision

**Le lot 0 ne touche pas `packages/db`. Le lot 3 nettoie le bloc en même temps
qu'il pose `payment_proof`.**

La définition de terminé du lot 0 est amendée en conséquence : le grep ci-dessus
peut renvoyer les occurrences des fichiers énumérés dans
`MENTIONS_TOLEREES` (voir ci-dessous), et **elles seules**.

### Ce que le lot 3 doit faire, en plus de sa propre spécification

1. supprimer `model PaymentEvent` et `model Payment` de `schema.prisma` ;
2. retirer de `check-schema.mjs` l'assertion sur
   `@@unique([providerTxId, status])`, et la remplacer par l'assertion
   correspondante sur `UNIQUE(operator, operator_tx_id)` de `payment_proof` ;
3. retirer de `sql/0001_constraints.sql` le `CHECK payment_amount_positive`
   porté par la table `Payment` ;
4. retirer les deux fichiers de `packages/db` de la liste `MENTIONS_TOLEREES`,
   dans `apps/api/src/__tests__/aggregator-dormant.test.ts` ;
5. décider du sort de `enum PaymentStatus`. Il est utilisé par l'adaptateur
   dormant **via `packages/contracts`**, pas via Prisma — voir ci-dessous.

## L'exception est opposable, pas seulement écrite

Un ADR qui documente une tolérance sans la faire respecter se périme en
silence. La tolérance est donc gelée dans un test —
`ADR 0011 — les mentions de webhook restantes sont celles, et rien de plus` :

- toute mention **nouvelle** de `webhook` dans `apps/` ou `packages/` fait
  échouer la CI ;
- et la **disparition** d'un fichier de la liste la fait échouer aussi, avec le
  message « dette payée : retirer ces fichiers de `MENTIONS_TOLEREES` ». Le
  lot 3 ne peut donc pas payer la dette sans mettre à jour cet ADR au même
  moment.

Le second point est le plus important : c'est ce qui empêche la liste de
devenir un fourre-tout qui grossit.

## Ce qui n'est pas en jeu

`PaymentStatus` vit dans `packages/contracts/src/payment.ts` (schéma Zod), pas
dans Prisma. L'adaptateur CamPay dormant l'importe de là. **Aucune** des options
examinées ne mettait en cause sa compilabilité, exigée par l'AGENTS.md §5.

## Pourquoi pas l'inverse

Élaguer dès le lot 0 aurait rendu le grep propre, au prix de trois défauts :
le dépôt se retrouvait sans aucune table de paiement jusqu'au lot 3 ; une part
du travail du lot 3 était faite hors de son cadre, donc hors de sa
spécification et de ses tests ; et le schéma passait par un état intermédiaire
qu'aucun lot ne décrit — exactement le genre d'état où une migration
`expand / contract` se fait mal.

## À revoir si

Le lot 3 est livré. Cet ADR devient alors caduc : la liste `MENTIONS_TOLEREES`
ne doit plus contenir aucune ligne `packages/db`, et le test le vérifie.

---

## Dette payée — lot 3, 29/07/2026

Les cinq gestes énumérés plus haut ont été exécutés :

1. `model PaymentEvent` et `model Payment` ont disparu du schéma, remplacés par
   `payment_proof` ;
2. `check-schema.mjs` n'asserte plus `@@unique([providerTxId, status])` mais
   `@@unique([operator, operatorTxId])` — le contrôle n° 5 ;
3. le `CHECK payment_amount_positive` porté par `Payment` a été retiré de
   `sql/0001_constraints.sql`, remplacé par son équivalent sur `payment_proof` ;
4. les deux lignes `packages/db` ont quitté `MENTIONS_TOLEREES` ;
5. `enum PaymentStatus` reste dans `packages/contracts/src/payment.ts`, mais
   **hors du modèle de données** : c'est le vocabulaire de l'adaptateur dormant,
   et l'ADR 0009 exige qu'il reste compilable. Le vocabulaire de la v1 est
   ailleurs — `ProofState` dans `proof.ts`, `PayMode` et `OrderStep` dans
   `order.ts`.

Deux mentions de « webhook » subsistent dans `packages/db`, et elles restent
dans la liste tolérée pour une raison différente de l'ancienne : ce sont
désormais des **interdictions**. Le commentaire d'en-tête du schéma dit que
Catalog ne reçoit aucun webhook, et `check-schema.mjs` échoue si la table
d'idempotence réapparaît. Nommer une chose pour l'interdire est le contraire
d'une dérive — c'est la même catégorie que `app.test.ts`, qui vérifie qu'aucune
URL de notification n'existe.

Le test qui gèle la liste continue de tourner. Il a d'ailleurs fait exactement
ce qu'on lui demandait : il a échoué au moment du retrait des deux lignes, ce
qui a forcé la mise à jour de cet ADR dans le même commit que le nettoyage.
