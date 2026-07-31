# ADR 0023 — Observabilité : la rédaction comme invariant, et le canari comme repère

- **Statut** : accepté
- **Date** : 31/07/2026
- **Lot** : 14 — observabilité et runbooks
- **Concerne** : `apps/api/src/observabilite/`, `apps/api/src/__tests__/traces-sans-sms.test.ts`,
  `apps/api/src/__tests__/canari-formats.test.ts`, `.github/workflows/canari.yml`,
  `packages/db/scripts/`, `docs/runbooks/`

## Contexte

Le lot 14 instrumente l'application pour la production : traces sur les parcours
critiques, métriques et alertes, un canari sur les formats de SMS, des runbooks,
et des sauvegardes restaurables.

Sa contrainte centrale tient en une phrase du blueprint : **« Le SMS brut ne
figure dans AUCUNE trace. »**

## Décisions

### 1. La rédaction est un invariant testé, pas une convention

Un SMS d'opérateur porte le **solde du compte** de la vendeuse. Pas le montant
de la vente : le solde. Le lot 8 le chiffre avant qu'il entre en base ; une
trace, elle, part chez un fournisseur tiers, s'y garde des semaines et s'y lit
par quiconque a un accès en lecture. Une seule fuite annulerait ce chiffrement
en entier.

**Deux couches, parce qu'une seule se contourne.**

1. **Par construction** — `ATTRIBUTS_AUTORISES` est une liste **fermée**. Un
   attribut dont la clé n'y figure pas est retiré, quel que soit son contenu.
   Une liste de refus se contourne par inadvertance : il suffit d'un attribut au
   nom neuf. Une liste d'autorisation refuse par défaut, et son pire cas est un
   attribut manquant dans un tableau de bord.
2. **Par filet** — `ProcesseurDeRedaction` inspecte chaque span avant l'export :
   attributs, **événements**, message de statut, **nom du span**.

La seconde couche existe pour le chemin auquel personne ne pense.
`span.recordException(e)` recopie le message **et la pile d'appel** d'une erreur.
Il suffit qu'une bibliothèque tierce mette le corps de la requête dans un
message d'erreur pour qu'un SMS parte. Personne n'écrit
`setAttribute("sms", texte)` ; c'est par là que la fuite arrive.

**Le détecteur suit la spécification.** Après trois épreuves bon marché —
longueur au-delà de 120 caractères, marqueurs relevés dans
`docs/formats-sms-operateurs.md` §2 — il appelle `analyserSms`, l'analyseur du
domaine. Le jour où un motif est ajouté pour un nouvel opérateur, le détecteur le
reconnaît sans qu'on ait pensé à le mettre à jour.

**Le filet compte ce qu'il attrape.** `catalog.trace.fuites_evitees` doit rester
à zéro. Une valeur non nulle veut dire qu'un chemin de code a failli envoyer un
solde chez un tiers : c'est un défaut à corriger, même si rien n'a fui. Une
rédaction silencieuse masquerait exactement ce qu'elle corrige.

`traces-sans-sms.test.ts` fait passer de **vrais SMS par la vraie route** et
fouille chaque span exporté — y compris les fragments, parce que « 12020 » suffit
à publier un solde.

### 2. Aucune auto-instrumentation

`@opentelemetry/auto-instrumentations-node` capture les requêtes SQL **et leurs
paramètres**. Ceux de ce produit contiennent `buyerPhone`, `counterpartyPhone`,
et surtout `buyerToken` — le secret qui autorise la contre-signature (ADR 0021).
Le voir passer dans une trace reviendrait à le publier : il suffirait de lire un
tableau de bord pour valider le paiement d'autrui.

Le filet l'attraperait probablement. « Probablement » n'est pas un mot acceptable
ici : la capture n'est pas allumée.

### 3. L'observabilité ne démarre pas toute seule

Sans `OTEL_EXPORTER_OTLP_ENDPOINT`, aucun SDK n'est enregistré et le code
instrumenté tourne à l'identique — l'API d'OpenTelemetry rend alors un tracer et
un mètre sans effet.

L'alternative — un SDK qui démarre par défaut vers `localhost:4318` — ajoute une
erreur réseau toutes les cinq secondes dans un journal de développement. Un
journal qu'on apprend à ignorer est un journal perdu.

### 4. Quatre mesures, et le contrôle n° 1 en tête

**`catalog.preuve.controle{controle, etat, operateur}`** est ventilé **par
opérateur**, et c'est le point qui compte. Un changement de format touche MTN ou
Orange, jamais les deux le même jour : un taux global mélangerait les deux et
diviserait le signal par deux au moment précis où il faut le voir.

Un point par **contrôle**, pas un par preuve. « Les refus augmentent » ne dit pas
où, et c'est ce qu'il faut savoir : le n° 2 est un sous-paiement, le n° 4 une
horloge, le n° 1 un changement de format. Trois pannes sans rapport.

Les trois autres : part de `declare_non_trace` (le contournement, vu de
l'exploitant), délai commande → preuve en **histogramme** (une moyenne de délai
est toujours mentie par la queue), et tentatives de réutilisation d'identifiant.

**Aucune étiquette ne porte un montant, un solde, un numéro ni un identifiant de
transaction.** Une métrique se garde plus longtemps qu'une trace et se lit par
plus de monde ; et un identifiant en étiquette produit une cardinalité infinie.
Pour enquêter sur un identifiant précis, on ouvre le journal d'audit, qui est en
ajout seul et fait pour ça.

### 5. Le canari rejoue la **spécification**, pas les fixtures

`sms-motifs.test.ts` vérifie que les analyseurs font ce qu'on attend. Le canari
vérifie autre chose : que **le code et la spécification disent encore la même
chose**. Il lit `docs/formats-sms-operateurs.md`, en extrait les messages, et les
fait passer par les analyseurs réels. Il vérifie aussi que tout motif du code est
documenté et réciproquement, et que `om.entrant` porte toujours `aConfirmer`.

Le scénario qu'il prévient est banal : quelqu'un « nettoie » une expression
régulière, adapte les fixtures pour que la suite repasse au vert, et ne touche
pas à la spécification. Tout est vert, et la source — AGENTS.md §7.4 — décrit
désormais un produit qui n'existe plus.

**Le programme quotidien sert à autre chose que la CI de branche.** Le jour où un
opérateur changera son format, ce test ne cassera pas : c'est la production qui
cassera, et `catalog.preuve.controle{controle=1}` basculera. Le canari est le
repère fixe à côté duquel on lit cette bascule — tant qu'il est vert, les motifs
du dépôt n'ont pas bougé, donc le changement vient de l'extérieur. Sans lui, la
première question du jour d'un incident serait « est-ce nous ou eux ? » et
personne ne saurait y répondre.

### 6. Restaurer ailleurs, vérifier, puis basculer

`restauration.sh` **refuse** d'écrire dans la base pointée par `DATABASE_URL`, et
refuse une cible non vide sans `FORCE_ECRASER=oui`. Une restauration lancée par
erreur sur la production écraserait les commandes arrivées depuis la
sauvegarde — celles que personne n'a encore vues.

Le script réapplique les **contraintes SQL hors schéma Prisma** (lot 3) puis
lance trois contrôles d'intégrité : l'invariant `amount_paid + balance = total`,
l'unicité `(operator, operator_tx_id)` du contrôle n° 5, et l'absence de commande
orpheline. C'est la différence entre « les données sont là » et « la base est
correcte ».

Format `custom`, restauration parallèle : c'est là que se gagne le délai de
remise en service. Un dump SQL en clair ne se restaure qu'en entier et en
séquentiel.

**La clé de chiffrement des SMS n'est pas dans la sauvegarde.** Une archive volée
ne livre donc pas les soldes. Corollaire à connaître avant d'en avoir besoin :
perdre la clé rend les SMS irrécupérables. Elle se sauvegarde ailleurs, dans un
coffre.

### 7. Deux runbooks annoncés ont disparu, et c'est l'architecture qui les efface

`docs/runbooks/README.md` annonçait `panne-operateur.md` et
`ecart-reconciliation.md`. Les deux datent d'avant l'ADR 0009 :

- il n'y a plus d'agrégateur, donc plus de relevé, donc **aucun écart de
  réconciliation possible** — Catalog ne détient aucun fonds ;
- Catalog **n'initie pas** les paiements et ne peut donc pas les suspendre. Si
  MTN est indisponible, l'acheteuse le constate sur son propre téléphone, et
  Catalog n'a ni levier ni information de plus qu'elle.

Ce qui reste vrai est couvert : le litige entre deux personnes
(`paiement-conteste.md`) et le code USSD qui change (`code-ussd-modifie.md`).

### 8. `protobufjs` ne s'installe pas

OpenTelemetry amène `protobufjs` en dépendance transitive, avec un script
d'installation. Les exportateurs utilisés sont les `*-otlp-http`, qui parlent
JSON : ce script ne produit rien dont ce dépôt se serve. Il est refusé
explicitement dans `pnpm-workspace.yaml` — dans un dépôt qui touche à des
paiements, un script d'installation arbitraire ne s'exécute pas « au cas où ».

## Conséquences

- Ajouter un attribut de trace demande de l'inscrire dans `ATTRIBUTS_AUTORISES` ;
  un oubli se voit dans le tableau de bord, jamais chez un tiers.
- Modifier un motif de SMS sans toucher à la spécification fait échouer le
  canari, avec le message fautif dans le rapport.
- Retirer `aConfirmer` d'`om.entrant` fait échouer le canari avec la marche à
  suivre : confirmer d'abord sur le terrain, mettre à jour la spécification et
  AGENTS.md §10 dans le même commit.
- Une restauration sur la production est refusée par le script.
- `pnpm test` couvre le canari ; `.github/workflows/canari.yml` le rejoue chaque
  jour à 06:00 UTC, sans base et sans réseau.

## Ce qui reste ouvert, et qui ne peut pas se fermer en session

Le blueprint du lot 14 le dit lui-même : l'agent livre le premier bloc, liste le
second, et s'arrête.

1. **Une restauration jouée pour de vrai** sur un volume réel, avec la durée
   notée dans le runbook. Le script a été exercé sur une base de développement —
   329 vendeuses, 269 commandes, 100 preuves, contraintes réappliquées, trois
   contrôles passés — mais **le délai de remise en service n'est pas connu**.
2. **Chaque alerte déclenchée volontairement au moins une fois.** Une alerte
   jamais vue se découvre le jour où elle compte.
3. **Les objectifs de perte de données maximale et de délai de remise en
   service**, écrits. Décisions de produit, pas de code.
4. **La programmation de la sauvegarde quotidienne**, qui dépend de l'hébergeur.
   Le script et la ligne de `cron` sont dans le runbook ; les brancher, non.
5. **Le parcours « création de commande » n'est pas instrumenté parce qu'il
   n'existe pas.** Aucune route de création de commande n'a été demandée par un
   lot : la boutique compose un message WhatsApp et la commande naît ailleurs.
   `PARCOURS.commandeCreee` existe, nommé et prêt, sans appelant — dit ici plutôt
   que laissé à constater dans un tableau de bord vide (AGENTS.md §7.7).
