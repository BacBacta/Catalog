# 0077 — Le sel d'exécution se pose, il ne se tire pas

- **Statut** : accepté
- **Date** : 12/08/2026
- **Révise** : le schéma d'identifiants de test posé les 10 et 11/08
  (`apps/api/src/__tests__/_identifiants.ts`), sur un point et un seul.

## Le défaut

La suite API échouait par intermittence, sur `recu-route.test.ts` et
`traces-sans-sms.test.ts`. Verte au réessai, à chaque fois.

Deux correctifs avaient déjà été posés :

1. **le 10/08** — un bloc par fichier, parce que Vitest joue les fichiers en
   parallèle contre une seule base ;
2. **le 11/08** — le compteur reçoit ses propres chiffres, parce que les
   décalages par test (`RUN + 1` … `RUN + 16`) et les pas arithmétiques
   (`RUN * 7`) débordaient sur la tranche de l'exécution précédente.

Les deux étaient justes. Aucun ne pouvait fermer le défaut, et il faut voir
pourquoi : **ils retirent l'amplification du recouvrement, ils ne retirent pas
le recouvrement.**

## Ce qui manquait

Le bloc sépare les **fichiers**. Rien ne séparait les **exécutions**, sinon le
sel — et le sel était tiré de l'horloge, `Date.now() % 1000`. Deux exécutions
partageant la même milliseconde modulo mille étaient entièrement confondues.

Une chance sur mille se raconte comme négligeable. Elle ne l'est pas ici, pour
une raison qui n'est pas dans le code des tests mais dans celui de la CI :

> `ci.yml` enchaîne `pnpm test` **puis** `pnpm test:coverage` sur **le même
> conteneur postgres** (lignes 70 et 76 avant ce lot).

La CI ne tire donc pas un sel, elle en tire **une paire, à chaque passage**. Et
la base ne purge jamais les contraintes qui comptent — `seller.phone`,
`seller.slug`, `user.email`, `order.ref`, et surtout `(operator,
operator_tx_id)`, dont le caractère **réseau-large** est le contrôle n° 5
lui-même, pas un détail d'implémentation.

Une fois sur mille par passage, c'est exactement le pire régime : assez rare
pour qu'un rouge passe pour un défaut métier et se referme au réessai, assez
fréquent pour empoisonner la CI en continu.

## La propriété qu'on cherche, dite une fois

> Deux exécutions **contre la même base** ne doivent jamais partager un sel.

Tout le reste en découle.

## La décision

**Le sel d'exécution est posé par l'environnement.** `selExecution()` lit
`CATALOG_SEL_EXECUTION` ; `ci.yml` y met une valeur **dérivée du passage** —
`${{ github.run_id }}` suffixé par l'étape, `0` pour les tests et `1` pour la
couverture. La valeur est longue ; elle est ramenée modulo mille, où les trois
chiffres du sel vivent.

Absente, la variable rend le tirage à l'horloge : en développement local la base
est jetable et il n'y a qu'une exécution à la fois.

### Pourquoi pas simplement `1` et `2`

C'est ce qu'on avait écrit d'abord, et **c'était faux**. Deux constantes séparent
bien les deux étapes d'un passage. Mais si la base survit au passage — un poste
de développement, une préproduction —, le passage suivant repose `1` et recouvre
le précédent **en entier**.

Ce n'est pas une hypothèse : en rejouant trois fois la paire de la CI contre une
base persistante, le second passage a produit **quatorze fichiers rouges d'un
coup, tous sur `email`**. On aurait échangé un recouvrement rare contre un
recouvrement certain.

Le conteneur postgres de la CI est neuf à chaque job, donc le cas ne se présente
pas là. Mais faire dépendre la justesse du schéma d'un détail d'infrastructure,
c'est la perdre le jour où ce détail change — et sans rien qui le dise. Le
suffixe sépare les deux étapes, `run_id` sépare les passages.

## Trois points qui ne sont pas des détails

### La valeur vide est un refus, pas un repli

`Number("")` vaut **zéro**, pas NaN. C'est la même arête qu'au lot 8, où un
montant fait uniquement de séparateurs produisait un paiement de zéro franc
parfaitement formé (ADR 0019). Ici, une variable posée mais vide donnerait le
sel 0 en silence — donc deux exécutions identiques, c'est-à-dire précisément le
défaut qu'on ferme.

Le contrôle porte donc sur la **chaîne**, avant toute conversion, et une valeur
mal formée **lève**. Un repli silencieux serait pire que le défaut : la CI
redeviendrait intermittente sans que rien ne le dise.

### On n'a pas migré les quatorze fichiers

Ils gardent leur bloc à trois chiffres et leurs fixtures ; ils cessent seulement
de tirer leur sel. C'est une ligne par fichier. Une migration complète vers
`identifiants()` n'aurait rien fermé de plus, et chaque réécriture de fixture
est une occasion de casser un test qui passait.

### Un garde, et pas une liste d'exceptions

Un test lit les sources de `__tests__` et **échoue si un fichier refabrique son
sel à partir de l'horloge**. `_identifiants.ts` est le seul endroit où l'horloge
a le droit d'entrer.

Ce test s'est d'abord dénoncé lui-même, parce que son propre commentaire citait
le motif cherché. On a reformulé le commentaire plutôt que d'ouvrir une
exception : une liste d'exceptions est la porte par laquelle ce défaut revient.

## Une erreur de diagnostic, corrigée ici

En cherchant la cause, on a d'abord attribué à `recu-route.test.ts` un taux de
recouvrement de 0,44 %, en lisant `codeDeTest(RUN * 7 + i * 101)` comme une
amplification par un pas de 7.

**C'est faux.** Le site d'appel cherche un code libre et réessaie cinquante fois
avant d'abandonner : il absorbe déjà ses collisions. Le taux réel de ce fichier
est le plancher commun, ~0,1 % — le même que `traces-sans-sms`.

L'erreur ne change ni la cause ni le correctif, mais elle change l'ampleur, et
un chiffre faux dans un ADR vaut moins que pas de chiffre du tout.

## Ce que ce lot corrige aussi, au passage

`traces-sans-sms.test.ts` fabriquait ses identifiants d'opérateur en
`RUN_TX * 10 + suffixe`, avec des suffixes allant jusqu'à 24. Un pas de 10 fait
retomber le suffixe `20 + i` d'une exécution sur le `10 + i` de la suivante :
le pas doit dépasser l'étendue des suffixes, il vaut donc 100.

Et le résultat est **rempli à six chiffres**. Ce n'est pas de la mise en forme :
un identifiant MTN a une longueur fixe, et le raccourcir d'un chiffre ne produit
pas un identifiant différent — il produit un SMS que l'analyseur ne reconnaît
plus, donc un test qui échoue pour une raison qui n'est pas la sienne.

## Ce qu'on n'a pas fait

**Purger la base entre deux exécutions.** `payment_proof`, `ledger_entry`,
`order_event` et `seller_audit_event` sont en ajout seul, tenus par des
déclencheurs SQL (lot 3). Les vider demanderait de désarmer ces déclencheurs
dans un chemin de test — c'est-à-dire d'écrire, une fois, le code qui sait
effacer une preuve de paiement. On ne l'écrit pas.

**Monter un second conteneur postgres.** Il coûterait plus que ce qu'il
rapporte, maintenant que les deux exécutions sont disjointes.

## Conséquence

La borne du schéma est désormais : deux exécutions ne se recouvrent que si on
leur pose **la même valeur**. Ce n'est plus un tirage, c'est une faute de
configuration — et elle ne se cache pas : elle ne produit pas un rouge sur mille
qui ressemble à un défaut métier, elle produit quatorze fichiers rouges d'un
coup, tous sur la même contrainte. Un échec certain et lisible vaut mieux qu'un
échec rare et trompeur.
