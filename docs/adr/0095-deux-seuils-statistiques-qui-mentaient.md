# ADR 0095 — deux seuils statistiques qui mentaient

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0013

## Contexte — une porte au rouge, et le générateur n'y était pour rien

Le déploiement du 14/08 (run 31788410462) a échoué sur `porte-tests` :

```
FAIL src/__tests__/verification-code.test.ts
  > 10 000 codes : aucun motif degenere
  > les deux moities ne sont jamais systematiquement egales
AssertionError: expected 2 to be less than or equal to 1
```

Le test tire 10 000 codes de vérification avec `crypto.getRandomValues` — un
vrai générateur cryptographique, non graine — et exigeait **au plus une** paire
`ABCD-ABCD`. Il en a trouvé deux.

## Ce qui a été vérifié avant de toucher au seuil

Un seuil qu'on relâche parce qu'il gêne est une régression déguisée. La
question à trancher était donc : *le générateur est-il biaisé, ou la borne
est-elle fausse ?*

**Quatre millions de tirages réels, avec le générateur de production :**

| | mesuré | attendu (1/25⁴) | écart |
|---|---|---|---|
| moitiés jumelles | 7 | 10,24 | −1,0 σ |

Un écart-type. Le générateur n'est pas biaisé. C'est la borne qui mentait.

## Le calcul, parce qu'un seuil se calcule

Deux assertions du même fichier portaient des bornes **fausses pour un
générateur parfait**, et à des taux comparables :

| Assertion | λ | ancienne borne | fausse alerte | nouvelle borne | fausse alerte |
|---|---|---|---|---|---|
| aucun doublon | 3,28 × 10⁻⁴ | `= 0` | 1 sur **3 053** | `≤ 1` | 1 sur 18 600 000 |
| moitiés jumelles | 2,56 × 10⁻² | `≤ 1` | 1 sur **3 104** | `≤ 3` | 1 sur 364 556 |

— pour le doublon, λ = C(10 000, 2) / 25⁸ avec 25⁸ = 152 587 890 625 ;
— pour les jumelles, λ = 10 000 / 25⁴.

Les deux ensemble donnaient une fausse alerte **une exécution sur ~1 500**. Et
la suite tourne plus d'une fois par poussée — `pnpm test` puis
`pnpm test:coverage`, dans `ci.yml` **et** dans `deploiement.yml`. À ce
rythme-là, ce n'est pas un cas d'école : c'est un déploiement bloqué de temps
en temps, sans cause, et personne ne pense à recalculer une probabilité quand
la CI est rouge.

## Décision

Les deux bornes sont recalculées pour une fausse alerte négligeable, et le
calcul est **écrit dans le fichier de test**, pas seulement ici.

**Le pouvoir de détection ne bouge pas.** Ce que ces tests cherchent est nommé
depuis le lot 3 : un générateur congruentiel dont le pas partage un facteur
avec les 25 symboles de l'alphabet (25 = 5², donc tout pas multiple de 5
dégénère). Un tel générateur ne produit pas deux ou trois jumelles, il en
produit des milliers. Entre « 1 » et « 3 » il n'y a que du bruit ; entre « 3 »
et ce que rend un générateur périodique, il y a trois ordres de grandeur.

## Ce qui protège réellement le produit

`verification_code` est `@unique` en base. Une collision, si elle survenait
malgré 25⁸ possibilités, se heurterait à la contrainte avant d'exister deux
fois. Ces tests décrivent la **qualité du tirage**, ils ne sont pas le
garde-fou d'unicité — le confondre reviendrait à croire qu'un test statistique
protège une commande.

C'est la même répartition des rôles que le contrôle n° 5 : l'unicité d'un
identifiant d'opérateur est une contrainte `UNIQUE`, pas un `if` (AGENTS.md).

## Ce que ça dit de la méthode

Un seuil statistique posé « au jugé » est une dette qui se paie à un moment
qu'on ne choisit pas. Les deux autres assertions du même fichier — aucune
position figée, alphabet parcouru sans favori — ont été revérifiées à cette
occasion : leurs bornes sont à plus de vingt écarts-types du bruit, elles ne
peuvent pas mentir. Elles restent inchangées.
