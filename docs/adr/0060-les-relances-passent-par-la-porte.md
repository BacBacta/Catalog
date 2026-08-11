# 0060 — Les relances passent par la porte

Date : 2026-08-11
Statut : accepté
Corrige : deux chemins d'envoi qui contournaient l'ADR 0035 et l'ADR 0054
Concerne : `jobs/relance-acompte.ts`

## Contexte

L'analyse du 10/08/2026, demandée après le banc d'essai : *« dans le flow
vendeur on utilise très peu de modèles de Meta »*. Le décompte a montré que
sur cinq sujets déposés et **tous approuvés**, deux seulement étaient
branchés — et un seul côté vendeuse.

La cause principale n'était pas une décision produit. C'était un défaut.

## Le défaut

Les deux travaux pg-boss appelaient `deps.envoyeur.envoyer(texte(...))`
**directement**, sans passer par `notifier()`. Trois conséquences en cascade :

1. **aucun contrôle de la fenêtre de service.** Hors des 24 h, Meta refuse en
   `131047` ;
2. **le message était perdu** — ni mise en file, ni remise à la prochaine
   interaction, alors que `notifier()` fait les deux depuis l'ADR 0035 ;
3. **le gabarit de repli n'était jamais tenté**, alors qu'il existait,
   qu'il était déposé, examiné et approuvé pour exactement ce cas.

## Pourquoi c'est cher, et pas cosmétique

La relance reversement part **~20 h après la création de la boutique**. La
fenêtre, elle, compte **24 h depuis le dernier message de la vendeuse**.

Une vendeuse qui s'inscrit, publie un article, puis se tait a donc une porte
**déjà fermée** quand la relance arrive. Autrement dit : le message qui
rapporte le plus — *« posez votre numéro Mobile Money, sinon vos clientes
commandent sans acompte »* — était précisément celui qui avait le plus de
chances de s'évaporer. Sans trace, puisque l'erreur était avalée.

Et c'est exactement ce que le banc a vécu : une boutique restée sans
reversement, toutes ses commandes parties `sans_prepaiement`, sans que la
vendeuse comprenne pourquoi.

## Décision

Les deux relances passent par `notifier()`, avec leur sujet :

| Relance | Destinataire | Gabarit |
|---|---|---|
| Acompte attendu (~1 h) | acheteuse | `catalog_acompte_attendu_v2` |
| Reversement absent (~20 h) | vendeuse | `catalog_reversement_absent_v2` |

`notifier()` décide : dans la fenêtre, le texte riche part tel quel ; hors
fenêtre, le gabarit ouvre la porte ; à tout échec, la notification **attend**
dans `bot_notification` et repart au prochain message entrant.

**Aucun gabarit nouveau n'est déposé.** Les deux existaient déjà et étaient
payés — c'est le point le plus rentable du lot.

## Ce qui ne change pas

- **La décision de relancer reste souveraine et pure.** `decisionRelance` et
  `decisionRelanceReversement` re-décident sur l'état réel : un reversement
  posé entre-temps vaut silence, une commande annulée aussi. Le passage par
  `notifier()` n'intervient qu'après.
- **Le coût variable reste borné.** Un gabarit ne part que hors fenêtre, et
  seulement pour un sujet de la liste fermée de l'ADR 0054.
- **Aucun texte n'est réécrit.** Ce que la vendeuse lit dans la fenêtre est
  mot pour mot ce qu'elle lisait avant.

## Conséquences

- `executerRelanceAcompte` et `executerRelanceReversement` sont **exportées** :
  elles étaient inatteignables sans monter une file pg-boss, donc intestables.
  `RelanceDeps` sépare ce dont une relance a besoin de ce dont la file a
  besoin.
- 5 tests contre une vraie base, **4 vus rouges** avant le correctif — le
  cinquième vérifie que le silence reste le silence.
- La relance reversement porte désormais le **nom de la boutique** dans son
  gabarit. C'est ce qu'une vendeuse reconnaît dans une notification.

## Ce qui reste ouvert

Trois sujets vendeuse n'existent toujours pas, et l'analyse les a nommés :
la **contestation d'un paiement** — le plus urgent du produit —, l'avis reçu,
et la commande expirée. Le premier mérite son gabarit ; les deux autres sont
des candidats du palier payant, pas du socle.
