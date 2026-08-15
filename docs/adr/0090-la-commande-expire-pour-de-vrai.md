# ADR 0090 — La commande expire pour de vrai

Date : 2026-08-15
Statut : accepté
Issu de : l'audit de pipeline v2 (`docs/audit-pipeline-2026-08.md`), constat
A2 (sévérité 64) — le plus grave des constats restants, parce que c'est un
**mensonge aux acheteuses** : la relance d'acompte leur écrit « Sans acompte,
la commande expirera d'elle-même » (FR et EN), et rien, nulle part, ne fait
expirer une commande.

## Contexte — tout était écrit, rien n'était branché

Le lot 7 a écrit `domain/order/expiration.ts` : fenêtre de 48 h, idempotence,
rattrapage, testé. La création de commande écrit `expiresAt` (`bot.ts`,
`echeance(maintenant)`), la colonne est indexée — et **jamais relue**. Aucun
job, aucun appelant hors tests. Il n'existe pas non plus d'état « expirée »
dans le schéma, et c'est le premier choix à faire.

## Décision 1 — l'expiration est une ANNULATION DATÉE, pas un état

Pas de nouvelle valeur d'enum. Le modèle existe déjà et il est **déjà
consommé partout** : `cancelledAt` (`annuleeA`) fait refuser toute avancée
d'étape (`cycle.ts`), met le solde à encaisser à zéro, sort la commande des
`commandesOuvertes` du fil, et le suivi sait l'afficher. L'expiration pose
`cancelledAt` et journalise **sa cause** en ajout seul :
`order_event` `kind: "commande_expiree"`, `actor: "systeme"`. La cause vit
dans le journal — c'est exactement ce qu'il est.

Fait notable, découvert par l'audit : **rien n'écrivait `cancelledAt` avant
cet ADR.** L'expiration en est le premier écrivain ; une annulation manuelle,
le jour où elle existera, écrira le même champ avec sa propre cause.

## Décision 2 — le périmètre : l'acompte attendu, et rien d'autre

N'expire que la commande **en mode `acompte` dont aucun franc n'est arrivé**
(`amountPaidXaf === 0`). Deux exclusions délibérées :

- une commande **sans prépaiement** vit légitimement impayée jusqu'à la
  remise — l'expirer à 48 h tuerait le mode de vente le plus courant ;
- une commande dont **l'acompte est arrivé** mais le solde reste ouvert ne
  meurt jamais d'elle-même : le solde se règle à la remise. Un franc versé
  sauve la commande — c'est la lecture donnée au champ `soldeRegle` du
  module (`amountPaidXaf > 0`), et elle est volontairement plus généreuse
  que « total couvert ».

## Décision 3 — le job, sur le patron des relances

File pg-boss `bot-expiration-commande`, planifiée à la création
(`sendAfter` à l'échéance) quand un acompte est attendu — même condition,
même site que la relance d'acompte. À l'exécution, la décision est
**reprise sur l'état réel** (`etatExpiration`), jamais figée à la
planification ; l'écriture est **gardée** (`updateMany` sur
`cancelledAt: null, amountPaidXaf: 0` — le patron de l'ADR 0089) : un SMS
collé pendant que le job court gagne, silencieusement et correctement.
Une commande disparue vaut silence, pas une levée qui ferait rejouer.

## Décision 4 — ce que ce lot NE fait pas, et le dit

- **Les rappels 2 h / 24 h de `expiration.ts` restent non branchés.** Ils
  sont supersédés par la relance unique ~1 h (ADR 0033) ; le module reste la
  spécification du rattrapage si un jour on les veut. Les rebrancher sans
  décision serait rouvrir l'ADR 0033 en silence.
- **Aucune notification d'expiration ne part.** La liste des gabarits est
  fermée (ADR 0054) et « commande expirée » y est déjà nommée candidate du
  palier payant (ADR 0060). L'acheteuse qui revient au fil voit sa commande
  annulée au suivi ; le pousser hors fenêtre est une décision de gamme, pas
  d'implémentation.
- **Le stock ne se ré-incrémente pas** : il ne se décompte pas (ADR 0038).

## Preuves

- `apps/api/src/__tests__/expiration-commande.test.ts` — l'impayée de 49 h
  expire (cancelledAt + événement) ; un franc versé la sauve ; sans
  prépaiement n'expire jamais ; l'exécution est idempotente ; la garde
  optimiste laisse gagner un versement concurrent.
- La copie de la relance (« expirera d'elle-même ») devient vraie sans
  changer d'une lettre.
