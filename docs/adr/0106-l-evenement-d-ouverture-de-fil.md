# ADR 0106 — l'événement d'ouverture de fil

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0087, 0103 · Révise ce que le 0103 disait de la fenêtre

## Le fait mesuré qui rouvre la question

L'ADR 0103 posait : « le bot ne peut pas parler le premier — un message
initié hors fenêtre exige un gabarit, et nous n'en avons aucun ». C'était
incomplet, et la lecture élargie du numéro (`--accueil-etat`, 14/08, 16 h 56)
l'a montré :

```
enable_welcome_message : false
prompts : 4 · commands : 4
numéro : +32 451 05 51 44 · vérifié · qualité GREEN
```

`enable_welcome_message` est le troisième composant de
`conversational_automation`, à côté des amorces et des commandes. Posé à
`true`, Meta envoie un message de type **`request_welcome`** dès que quelqu'un
ouvre une conversation **neuve** — avant qu'il ait rien écrit. L'ouverture du
fil ouvre la fenêtre de service : le bot peut répondre librement, **sans
gabarit**. C'est le seul cas où il parle le premier, et c'est exactement la
demande d'origine (« le bot doit écrire un message d'accueil quand quelqu'un
ouvre la conversation »).

C'est aussi la sortie du piège des amorces : leur affichage est décidé par
Meta sur son historique serveur du fil — invisible pour qui a déjà écrit,
invérifiable pour nous. L'événement, lui, se constate dans nos journaux.

## Décision

1. **Le bot lit `request_welcome`** (`entrees.ts`, genre `ouverture_fil`).
   Lecture minimale — le type et l'expéditeur —, parce que la forme est
   documentaire, pas mesurée : le drapeau n'a jamais été posé sur notre
   numéro. Une variante inattendue retombe sur la forme non lue, qui répond
   poliment.
2. **La réaction est l'accueil qui existe déjà** : les trois portes de
   l'ADR 0103 sans boutique en contexte, l'accueil de la boutique sinon —
   panier gardé, une ouverture de fil n'est pas un « annuler ». Aucune copie
   nouvelle : le message conçu pour quelqu'un qui n'a rien dit est celui-là.
3. **`--accueil-poser` pose le drapeau** avec les amorces et les commandes.

## L'ordre est un invariant, pas un conseil

**Le lecteur se déploie AVANT que le drapeau parte.** Poser
`enable_welcome_message: true` sur une image qui ne lit pas `request_welcome`
ferait répondre « je ne sais pas lire ce type de message » à **chaque
ouverture de conversation** — l'exact contraire d'un accueil, servi au seul
moment où l'on n'a qu'une chance. Le commentaire du script porte
l'avertissement ; l'opération `accueil-poser` ne se lance qu'après un
déploiement embarquant ce lot.

## Ce que ce lot ne règle pas

- **L'affichage des amorces** reste la décision de Meta. Elles sont posées,
  correctes, sur le bon numéro ; un fil qui a déjà servi ne les montre plus,
  et l'effacement local n'y change rien. Le test qui tranche reste un numéro
  qui n'a jamais écrit — et avec l'événement d'ouverture, il devient
  secondaire : l'accueil n'attend plus d'être deviné.
- **La forme exacte de `request_welcome`** sera constatée au premier
  déclenchement réel ; la lecture tolérante est faite pour survivre à l'écart.
