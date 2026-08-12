# 0062 — La position s'ajoute au repère, elle ne le remplace pas

Date : 2026-08-11
Statut : accepté
Prolonge : 0005 (pas de champ adresse), 0049 (les formes qu'on ne sait pas lire)
Sprint : « le bot devient une application », chantier b
Concerne : `domain/bot/entrees.ts`, `messages.ts`, `conversation.ts`, `textes.ts`,
`aiguillage.ts`, `bot.ts`

## Le défaut

Deux manques symétriques, tous deux vérifiés dans le code avant d'écrire une
ligne :

1. **On ne savait pas lire une position.** `location` était dans la table des
   formes non traitées : une acheteuse qui partageait son point recevait
   « je ne sais pas lire ça ». Or `deliverySchema` porte un champ `geo?`
   **optionnel depuis le lot 7, prévu et jamais alimenté** — le chemin
   d'écriture n'existait nulle part.
2. **On ne savait pas en demander une.** Meta expose
   `location_request_message` ; le dépôt ne le connaissait pas.

## La décision, et ce qu'elle refuse

**Le point est un confort pour le livreur. Il ne remplace aucun champ.**

L'ADR 0005 n'est pas négociable : il n'existe pas d'adresse au Cameroun, et
c'est le **repère** qui fait le travail. Un point GPS ne dit ni l'étage, ni
« en face de la pharmacie du Rond-Point », ni **qui appeler en arrivant**. Le
quartier, le repère et le téléphone restent donc exigés, exactement comme
avant.

Trois conséquences tenues par des tests :

- un point reçu pendant la saisie **ne fait pas avancer l'étape** : il patiente
  dans l'état et la question se re-pose ;
- le texte de la demande **dit qu'elle est facultative** — une acheteuse qui
  croirait son point suffisant s'arrêterait là ;
- sans point, la livraison **n'a pas de champ `geo`** : une absence reste une
  absence, elle ne devient pas un zéro.

## Pourquoi deux messages et non un

`location_request_message` n'accepte **qu'une seule action**. En faire la
question de livraison ferait disparaître « parler à la vendeuse » et
« annuler » de l'écran — au moment précis où l'acheteuse tape le plus long
message de son parcours, donc là où une sortie de secours compte le plus.

La question garde ses boutons ; la demande de position vient **en plus**.
C'est le même arbitrage que le Flow (ADR 0055) : ce qui est riche s'ajoute, ce
qui est universel ne bouge pas.

**Le retrait n'en reçoit pas.** Le point de rendez-vous est celui de la
vendeuse : la position de l'acheteuse n'y veut rien dire.

## Zéro degré est un point réel

Une position sans coordonnées exploitables **retombe sur la forme non lue**
plutôt que de devenir un faux point. `Number("")` vaut zéro — la même famille
de piège que le montant de zéro franc du lot 8 (ADR 0019) —, et zéro degré de
latitude est un lieu **réel** : le golfe de Guinée, à 300 km de Douala. Un
livreur envoyé là n'aurait aucun moyen de savoir que la donnée était vide.

## Ce qui n'est PAS retenu du message

Meta joint parfois un `name` et une `address` saisis par l'expéditrice. **Ils
ne sont pas lus**, et c'est l'ADR 0005 qui l'exige : un champ d'adresse qui
entre par la fenêtre reste un champ d'adresse. Un test compare le contenu de
l'entrée à ces deux valeurs.

## Le routage

Une position n'a de sens que dans le fil **acheteuse**, à l'étape livraison.
Ailleurs — inscription, fil vendeuse — elle devient une forme non lue, donc
une phrase plutôt qu'un silence (ADR 0049). Même traitement que la réponse de
Flow, et pour la même raison.

Un test verrouille le cas qui aurait cassé : une **vendeuse en train
d'acheter** qui envoie sa position reste dans son achat, elle n'est pas
renvoyée dans son fil vendeuse au milieu d'une saisie (ADR 0052).

## Conséquences

- 12 tests neufs, les trois comportements nouveaux vus **rouges** d'abord.
- Un test de `formes-entrantes` a été **mis à jour, pas supprimé** : il
  affirmait que `location` produisait une forme non lue — c'était vrai, ça ne
  l'est plus pour une position complète. Il garde le cas sans coordonnées.
- FR et EN complets ; le pidgin reste reporté (ADR 0033).
- Aucun coût : ce message ne part que dans la fenêtre de service, jamais en
  gabarit.
