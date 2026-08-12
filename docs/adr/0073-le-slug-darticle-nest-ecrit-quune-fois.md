# 0073 — Le slug d'article n'est écrit qu'une fois

Date : 2026-08-11
Statut : accepté
Découvert en implémentant : 0061, rang 3a

## Contexte

Le rang 3a (pack statut) a besoin du slug d'un article pour composer un lien
marqué : `boutique chez-bea statut robe-wax-a1b2c3`. Ce slug existait déjà —
`apps/shop/src/lib/catalogue.ts` le calcule pour ses URL depuis le lot 6.

Les deux paquets ne peuvent pas s'importer l'un l'autre. La règle de dépendance
l'interdit dans les deux sens : la boutique ne connaît pas l'API, l'API ne
connaît pas la boutique. Et ce n'est pas qu'une règle de style — la première
tentative l'a prouvé sur-le-champ : importer le module de la boutique depuis un
test de l'API a fait entrer `import.meta.glob`, une API d'Astro, dans le
`tsc` de l'API. **Le build a échoué.**

## La solution tentée, et pourquoi elle était mauvaise

Écrire la règle deux fois, et poser un test de parité qui compare les deux
implémentations sur des entrées difficiles.

Elle est séduisante et elle est fausse : **un test de parité surveille une
divergence, il ne l'empêche pas.** Il rougit après coup, sur la branche de
celui qui a touché l'une des deux copies — en espérant qu'il comprenne
pourquoi. Et le coût d'une divergence n'est pas symétrique : un lien de Statut
qui mène à une page 404 ne se voit ni en CI, ni chez la vendeuse. Il se voit
chez l'acheteuse, une fois, et elle ne revient pas.

## Décision

**La règle vit dans `packages/contracts/src/slug.ts`**, sous-chemin
`@catalog/contracts/slug`. C'est le seul endroit que les deux paquets ont déjà
le droit de lire. Les deux appelants l'importent ; `apps/shop` la ré-exporte
pour que ses appelants existants ne changent pas.

## Pourquoi c'est sûr pour le navigateur

Le module est une **fonction de chaîne** : aucun schéma Zod, aucun effet de
bord au niveau du module. Il s'importe par son sous-chemin et **jamais par le
baril** — la règle du lot 6, mesurée : l'îlot pesait 20,6 Ko compressés au lieu
de 1,8 parce que les déclarations Zod du baril ont des effets de bord que
l'élagage ne retire pas.

## Ce que le test vérifie désormais

Plus une parité entre deux copies — il n'y en a qu'une — mais le comportement
sur les entrées qui font mal : accents, ponctuation seule, chaîne vide, nom de
120 caractères, et deux articles de même nom chez la même vendeuse. Le suffixe
de six caractères est ce qui les sépare, et c'est fréquent : deux lots de la
même robe, deux arrivages du même tissu.

## Conséquences

- Un sous-chemin de plus dans `@catalog/contracts`. Le budget de la boutique
  est inchangé, mesuré : JS 14,9 / 30 Ko.
- La leçon se généralise, et vaut d'être écrite : **quand deux paquets qui ne
  peuvent pas se parler ont besoin de la même règle, elle remonte dans
  `contracts` — elle ne se recopie pas.** La duplication surveillée par un test
  est un compromis qu'on croit tenir et qu'on ne tient pas.
