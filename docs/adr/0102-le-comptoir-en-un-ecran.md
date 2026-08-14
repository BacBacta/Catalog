# ADR 0102 — le comptoir en un écran

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0061, 0069, 0087, 0090, 0096

## Contexte — le dernier parcours vendeuse entièrement conversationnel

Le comptoir vendeuse (ADR 0061, rang 1) enregistre la vente négociée de vive
voix — le cas le plus fréquent du canal. Il coûtait **cinq allers-retours** :
article, prix convenu, cliente, remise, récapitulatif. Inscription et article,
eux, ont leur formulaire depuis les ADR 0055 et 0087.

C'est le geste que la vendeuse fait **le plus souvent**, et le seul encore
question par question. Les composants nécessaires sont tous mesurés sur notre
WABA (ADR 0096) : le témoin 7.3, et — par les formulaires déjà déposés —
`input-type: phone` (livraison) et `number` (article).

## Décision

`catalog_comptoir` : **un** écran, quatre champs, `complete` sans endpoint.

```
article   TextInput text      « Qu'avez-vous vendu ? »
prix      TextInput number    « Prix convenu, en francs »
cliente   TextInput phone     « Numéro WhatsApp de votre cliente »
remise    TextInput text      « Où se fait la remise ? »
Footer    « Relire la vente » → complete
```

Le pied dit « **Relire** la vente », pas « créer » : le formulaire ne crée
jamais. Cinq tours deviennent deux — un formulaire, une confirmation.

## Les quatre règles qui portent la conception

**1. Le récapitulatif reste dans le fil.** Ma première esquisse mettait le
récap dans un second écran (`RichText`) — elle reposait sur une liaison
dynamique `${data.…}` inter-écrans **jamais mesurée**. Le dépôt avait déjà la
bonne forme : l'ADR 0090 (la boutique se relit avant de s'ouvrir). Le
formulaire débouche sur le récapitulatif **du fil**, boutons Confirmer /
Corriger / Annuler — celui qui existait déjà. Rien ne se crée sans un oui
explicite (leçon de l'ADR 0032).

**2. Un seul valideur.** `venteDepuisFlux` ne connaît aucune règle : il
**rejoue `avancerComptoir` pas à pas**, comme si la vendeuse avait répondu aux
quatre questions. « Un formulaire ne doit pas faire entrer ce que la question
refuse » — et la manière la plus sûre de le garantir n'est pas un test de
parité entre deux validations : c'est de n'en avoir qu'une.

**3. Le crédit partiel.** Un champ fautif arrête la marche **là** où elle
échoue : l'état est positionné au pas fautif, champs précédents acquis. Un
numéro illisible dans le formulaire → la phrase de refus + la question de la
cliente, article et prix déjà en poche. La vendeuse corrige un champ dans le
fil, pas quatre — c'est le même état derrière le formulaire et les questions,
comme pour l'ouverture (ADR 0087).

**4. Une valeur n'est pas un geste.** Dans le fil, le mot exact « annuler »
ferme le comptoir. Dans un formulaire, c'est le contenu d'un champ.
`venteDepuisFlux` rattrape la lecture en geste d'`avancerComptoir` et refuse le
champ au motif de son pas — jamais « C'est annulé » en réponse à un formulaire
rempli.

## Ce que le câblage a corrigé au passage

L'aiguillage ne routait vers la machine vendeuse que le formulaire d'article,
par un drapeau nommé `formulaireArticle`. Le comptoir a montré que le drapeau
nommait **un** formulaire au lieu du **camp** entier : sans correction, la
réponse du comptoir tombait dans le fil acheteuse et recevait « je ne sais pas
lire ce type de message ». Il s'appelle désormais `formulaireVendeuse`
(article, comptoir), et le test d'intégration qui l'a attrapé reste.

## Dormant par défaut, comme tous les autres

- sans `WABOT_FLUX_COMPTOIR_ID`, « vendu » est **exactement le fil d'hier** —
  un test le tient au mot ;
- posé, le formulaire **s'ajoute** à la question, il ne la remplace pas
  (ADR 0055, 0063) : la question part en dernier, c'est elle qui reste visible
  si le Flow ne s'affiche pas ;
- la parité de version (`flux-version.test.ts`) passe de cinq à six
  définitions ; la garde d'environnement (`env-declaree.test.ts`) exige la
  sixième variable, lue **et** déclarée.

## Déposé le 14/08/2026, et vu sur un téléphone

`depots-meta → flux --deposer` a créé `catalog_comptoir` — **2024756688241442**,
définition téléversée, publiée, **aucune `validation_error`**. Les quatre types
de champs passent donc pour de vrai, `input-type: phone` compris.

Un mode d'aperçu est né avec lui, et pour une raison qui vaut d'être dite : le
formulaire était déposable et **invisible**. `composants.mjs --apercu-comptoir
<numéro> [fluxId]` envoie le message qui le propose — construit par
`messageComptoirFlux`, la fonction que le bot appelle en production, jamais une
copie recopiée (ADR 0089, 0098).

L'identifiant s'y prend **en argument avant l'environnement**. Ce n'est pas une
commodité : entre le dépôt chez Meta et la pose de `WABOT_FLUX_COMPTOIR_ID`
dans la machine, il existe une fenêtre où l'identifiant est connu et la
variable absente — et c'est exactement la fenêtre où l'on veut voir le
formulaire. Sans cet argument, voir coûterait un secret posé et un
redéploiement, c'est-à-dire qu'on ne verrait qu'après avoir décidé.

La garde « tout mode est joignable depuis le workflow » (`flux-version.test.ts`)
ne lisait que `flux.mjs` ; elle lit désormais les deux scripts. Ils vivent dans
la même image, derrière la même console, et rien ne les distinguait sauf que le
test n'en ouvrait qu'un.

**Ce qui reste** : `fly secrets set WABOT_FLUX_COMPTOIR_ID=2024756688241442
--app catalog-api-preprod` puis un redéploiement. Tant que le secret n'est pas
posé, « vendu » ouvre exactement le fil d'hier — quatre questions —, et un test
le tient au mot.
