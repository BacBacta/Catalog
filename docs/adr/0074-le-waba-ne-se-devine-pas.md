# 0074 — L'identifiant du compte WhatsApp Business se pose, il ne se devine pas

Date : 2026-08-12
Statut : accepté
Prolonge : 0071, 0063

## Contexte

L'opération `poser-flux-inscription` (workflow « Maintenance », tâche #60) fait
le pont entre deux moitiés d'un geste qu'aucune ne sait faire seule : la machine
Fly détient `WABOT_API_KEY` et sait donc demander à Meta l'identifiant du Flow ;
l'exécuteur d'intégration continue détient `FLY_API_TOKEN` et sait donc écrire le
secret. Aucun identifiant ne transite par un humain.

Première exécution réelle, le 12/08/2026 : elle s'arrête avant d'avoir rien
demandé.

```
WHATSAPP_WABA_ID est absente, et le jeton designe 0 compte(s)
```

Deux choses se sont apprises là, et elles ne sont ni l'une ni l'autre un défaut
de l'opération.

**L'application n'a jamais porté `WHATSAPP_WABA_ID`.** Les trois dépôts de
formulaires avaient toujours été faits depuis un poste, où la variable vivait
dans un `.env` local. Personne ne l'avait posée sur la machine parce que,
jusqu'ici, personne n'en avait eu besoin là-bas.

**Le repli par le jeton ne pouvait pas aboutir ici.** `flux.mjs` demande à
`debug_token` les `target_ids` de ses portées — c'est une bonne idée, et elle
reste. Mais Meta ne rend un `target_ids` que pour une portée **restreinte à un
actif**. Un jeton dont la portée WhatsApp est accordée sans restriction est
parfaitement valide et ne désigne rien. « 0 compte(s) » ne distinguait pas ce
cas des deux autres — jeton d'une autre application, portée jamais accordée —
qui se corrigent tous les trois ailleurs.

## Décision

**L'identifiant du WABA se pose explicitement, par le même canal que les autres
secrets de la machine.** Le workflow « Maintenance » gagne une opération
`poser-waba` : on saisit les chiffres lus dans la console Meta, l'exécuteur
écrit `WHATSAPP_WABA_ID` sur l'application. Une fois, puis plus jamais —
`poser-flux-inscription` se suffit ensuite.

La valeur passe par l'environnement du pas, jamais par une interpolation dans le
corps du script : une saisie libre ne devient pas du shell. Elle est refusée si
elle n'est pas une suite de chiffres.

Deux corrections accompagnent la décision, dans `flux.mjs` :

- **Les deux portées WhatsApp sont lues**, `whatsapp_business_management` et
  `whatsapp_business_messaging` — toutes deux ciblent des WABA. N'en regarder
  qu'une faisait échouer un jeton utilisable dont seule l'autre porte la
  restriction. La règle « exactement un compte, sinon on s'arrête » vaut
  toujours après l'union : elle est ce qui protège du mauvais compte.
- **L'échec dit ce que le jeton dit de lui-même** : validité, type, application,
  portées, et pour chacune ses actifs. Une exécution suffit désormais à savoir
  lequel des trois cas on tient. Le jeton, lui, n'est jamais réaffiché.

## Ce qu'on ne fait pas

**On ne déduit pas le WABA du numéro émetteur.** `WHATSAPP_PHONE_NUMBER_ID` est
posé sur l'application, et il serait tentant de remonter du numéro à son compte.
Meta ne documente pas ce chemin. Un identifiant reconstitué qui se trouve juste
la plupart du temps déposerait un jour nos trois formulaires chez quelqu'un
d'autre — c'est exactement la panne que le garde-fou existant cherche à éviter
(AGENTS.md §7.7).

**On ne devine pas davantage qu'avant.** Plusieurs comptes, ou aucun : arrêt
franc, avec le remède écrit dans le message.

## Conséquence

Le formulaire d'inscription n'est toujours pas actif dans le fil, et ce n'est
plus une question de code : il manque une valeur que seule la console Meta
détient. La séquence qui l'active tient maintenant en deux lancements du même
workflow — `poser-waba`, puis `poser-flux-inscription` — et le second dira, si
le Flow `catalog_inscription` n'est pas `PUBLISHED`, qu'il reste à le publier
chez Meta. Un brouillon s'envoie sans erreur et ne s'ouvre jamais.
