# ADR 0101 — une commande payée n'expire pas, et la vendeuse seule l'apprend

Date : 14/08/2026
Statut : accepté — **deux arbitrages produit**, tranchés par le porteur
Prolonge : le constat C-003 de `docs/audit-pipeline-2026-08.md`

## Ce que cet ADR est, et ce qu'il n'est pas

Le constat C-003 dit que l'expiration des commandes **n'existe qu'en théorie** :
`apps/api/src/domain/order/expiration.ts` est complet et testé, et **personne
ne l'appelle**. `Order.expiresAt` est écrite à chaque commande et jamais relue.

Le brancher demandait deux décisions produit. Elles sont prises ici. **Le
branchement lui-même n'est pas fait** — c'est le lot suivant.

Un point de fait, relevé en instruisant : le dépôt a **déjà** une relance
d'acompte qui part (`decisionRelance`, file `bot-relance-acompte`). Elle est
distincte du module d'expiration, ne partage aucune constante avec lui, et ne
dit rien de l'expiration. L'audit ne le distinguait pas assez.

## Arbitrage A — une commande dont l'acompte est payé n'expire jamais

**Seules les commandes à zéro franc encaissé expirent.**

Le prédicat du domaine s'appelait `soldeRegle` — « le total attendu est
couvert ». Il faisait donc expirer une commande dont l'acheteuse avait
réellement payé la moitié.

Trois raisons, et la première suffit :

1. **Catalog ne détient aucun fonds** (AGENTS.md §2). Faire « expirer » une
   commande déjà payée suggérerait un retour d'argent qu'il ne peut pas faire.
   Une promesse que l'architecture interdit de tenir.
2. **Un acompte prouvé porte un reçu** — la valeur numéro un du produit
   (lot 10). L'expirer orphelinerait le reçu.
3. Une commande à acompte payé est une **relation vivante** : la vendeuse a
   l'argent, l'acheteuse attend sa marchandise. Ce n'est pas un panier
   abandonné, et l'expiration sert à ramasser les paniers abandonnés.

Conséquence dans le code, appliquée immédiatement : `soldeRegle` devient
`argentEncaisse`, et `raison: "solde_regle"` devient `"argent_encaisse"`.

Ce changement est fait **maintenant** et non au lot suivant, à dessein : laisser
un ADR affirmer une règle que le code contredit serait exactement le défaut que
C-003 dénonce — une documentation qui décrit un comportement absent.

## Arbitrage B — la vendeuse seule est prévenue

**Le fait qui commande cette décision** : l'échéance est à 48 h, et la fenêtre
de service WhatsApp dure 24 h. Une notification d'expiration est donc **hors
fenêtre par construction**. Elle exige un gabarit utilitaire approuvé, et sur
les six gabarits approuvés du dépôt, **aucun ne concerne l'expiration**.

- **La vendeuse est prévenue**, par la porte de l'ADR 0060 : `notifier` tente le
  gabarit, échoue faute d'en avoir un, et **met en attente**. Le message part
  quand elle réécrit au bot — ce qu'elle fait souvent, c'est sa console. Elle
  est la seule des deux qui puisse agir : relancer, libérer l'article, ou
  simplement savoir.
- **L'acheteuse n'est pas prévenue.** Ce n'est pas une économie, c'est un
  principe déjà écrit dans `expiration.ts` : *« aucun rappel après l'expiration
  — rappeler une commande morte ne sert qu'à faire honte à l'acheteuse »*. Lui
  annoncer l'expiration au moment précis où elle revient payer serait le
  contraire du service.

## Ce que ça n'autorise pas

L'état « expirée » **n'existe pas encore**. `OrderStep` vaut `recue`,
`preparee`, `chez_le_livreur`, `livree` — quatre étapes, pas cinq (le schéma le
dit en toutes lettres). L'ajouter est une migration expand/contract, et c'est le
lot suivant.

Cet ADR ne pose donc **aucune** file, **aucun** job, **aucun** gabarit. Il tranche
deux questions, corrige le prédicat qui les portait, et laisse le reste écrit.

## Ce qui reste à faire, dans l'ordre

1. **Lot 1 — mesurer sans rien changer** : combien de commandes seraient
   expirées aujourd'hui, et combien ont un acompte payé. Un balayage en lecture
   seule, avant toute transition d'état.
2. **Lot 2 — la transition**, en expand/contract, plus le job qui l'applique et
   la notification vendeuse par la porte.
3. **La file morte** sur les deux files pg-boss existantes : aujourd'hui un
   échec répété ne se voit nulle part.
4. **Corriger `CLAUDE.md` et `AGENTS.md` §3**, qui affirment que pg-boss sert
   aux « relances d'expiration de commande ». C'est faux depuis le début, et
   c'est ce décalage qui a rendu le défaut durable.

Le gabarit d'expiration, lui, rejoint la liste de ce qui **attend le WABA**
(CLAUDE.md) : sans lui, la notification vendeuse ne part qu'en différé, à son
retour. C'est acceptable et c'est dit — ce n'est pas la même chose que de le
découvrir en production.
