# 0054 — Les gabarits utilitaires, et la porte qu'ils ouvrent

Date : 2026-08-08
Statut : accepté
WABA-1 — premier lot rendu possible par le déblocage du numéro (07/08/2026)

## Contexte

Notre bot n'initie jamais une conversation (ADR 0034). Hors de la fenêtre de
24 h ouverte par un message entrant, une notification **attend** en base
jusqu'à la prochaine interaction : elle n'est jamais perdue, mais elle n'arrive
pas.

L'audit a nommé ce que ça coûte : **une commande arrivée à 21 h un vendredi
n'est pas remise avant que la vendeuse ne réécrive — et elle ne peut pas
provoquer l'ouverture d'une fenêtre dont elle ignore l'existence.**

Le gabarit est la seule façon d'ouvrir cette porte. Meta le facture, et c'est
précisément ce qui fait du « Catalog prévient » un palier payant défendable
(§8 de l'audit) : la frontière du produit épouse sa seule ligne de coût
variable.

## Décision 1 — une liste FERMÉE de cinq sujets

Un gabarit ne se déclenche que sur un événement qui a **déjà** de la valeur :

| Sujet | Pour qui | Pourquoi il mérite d'ouvrir une fenêtre payée |
|---|---|---|
| `nouvelle_commande` | vendeuse | Elle a une vente à servir, et elle l'ignore |
| `paiement_prouve` | acheteuse | La valeur n° 1 du produit ne doit pas attendre |
| `commande_livree` | acheteuse | Contre-signature et avis vérifié en dépendent |
| `acompte_attendu` | acheteuse | Une commande qui expire faute d'un rappel |
| `reversement_absent` | vendeuse | Sans lui, personne ne peut la payer |

Une boutique qui génère du coût est, par construction, une boutique qui vend.

## Décision 2 — `decisionRemise` gagne une troisième issue

`"envoyer"` (fenêtre ouverte, gratuit) · `"gabarit"` (fermée, sujet éligible) ·
`"attendre"` (fermée, pas de sujet). **Sans sujet, le comportement est
exactement celui d'avant** : aucun appelant existant ne change de conduite par
accident.

## Décision 3 — le repli n'est jamais la perte

Trois raisons de retomber sur la file d'attente : le gabarit n'est pas
approuvé, une variable manque, ou Meta refuse l'envoi. **Dans les trois cas la
notification attend** — et on ne paie jamais un envoi qu'on sait incomplet,
d'où `variablesManquantes` vérifié avant l'appel.

Ce module ne sait pas si un gabarit est approuvé, et c'est assumé : personne ne
le sait sans demander à Meta, et une approbation peut être retirée. On tente,
on retombe.

## Décision 4 — les règles de Meta sont tenues par des tests, pas par la relecture

Catégorie `utility` uniquement ; variables numérotées à partir de 1, sans trou ;
jamais de variable en tête ni en fin de corps ; pas de double saut de ligne ni
d'espace en fin de ligne ; un paramètre ne porte jamais de saut de ligne — Meta
rejette l'envoi entier pour un seul.

Ces règles sont des tests, parce qu'un gabarit refusé n'est pas une erreur de
compilation : **c'est une note de qualité qui baisse sur le numéro**, et une
série de refus finit par restreindre l'envoi.

## Décision 5 — les textes déposés sont LUS du code

`apps/api/scripts/gabarits.mjs` lit `GABARITS` et rend les dix entrées (cinq
sujets × deux langues). Rien n'est recopié à la main : un gabarit approuvé dont
le texte différerait du code enverrait un message que personne n'a relu.

Trois modes : `--voir` (affiche), `--etat` (dit lesquels existent et leur
statut), `--deposer` (soumet). **`--deposer` ne part jamais tout seul** : c'est
un acte sortant et durable, examiné par Meta.

## Ce que ce lot ne fait PAS

- **Il ne dépose pas les gabarits.** Le dépôt touche le compte Meta du porteur
  et sa note de qualité ; il se décide, il ne se déduit pas d'une tâche de
  code.
- **Trois des cinq sujets ne sont pas encore branchés.** `commande_livree`,
  `acompte_attendu` et `reversement_absent` existent au catalogue et sont
  testés ; leurs appelants (`notifierLivree`, les deux relances pg-boss) les
  passeront quand les gabarits seront approuvés. Brancher un sujet dont le
  gabarit n'existe pas ne ferait que produire des refus.
- **Aucun plafond de facturation.** L'audit recommande un plafond **dit** et
  affiché sur le palier gratuit ; le nombre est une décision commerciale
  (§8.3), et `subscriptionStatus` n'est lu nulle part dans le dépôt.
- **Ni Flows, ni catalogue natif, ni carrousels** — WABA-2 et WABA-3.

## Conséquences

- 16 tests neufs, vus rouges d'abord. 948 tests API.
- `MessageGabarit` rejoint l'union `MessageSortant` : l'envoyeur existant le
  porte sans changement, c'est la même route.
- Deux appelants branchés, les deux plus utiles : la nouvelle commande côté
  vendeuse, le paiement prouvé côté acheteuse.
