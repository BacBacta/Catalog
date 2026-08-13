# ADR 0088 — l'ouverture tient en une bulle, et le menu est natif

Date : 13/08/2026
Statut : accepté
Révise : ADR 0086 (la réduction des messages), sur le seul cas de l'ouverture

## Contexte — ce que le banc a montré

L'ADR 0086 avait ramené l'ouverture de cinq messages à deux. Le banc du
13/08, à 19:23, en a compté **quatre**, plus un cinquième au geste suivant.
Le porteur du produit, dans ses mots : « une multiplication de messages et de
liens rendant touffu le chat, c'est confondant ».

Les quatre, dans l'ordre :

1. « Shop est ouverte » + le lien + deux boutons ;
2. « Ou tout d'un coup, dans un formulaire » + « Remplir le formulaire » ;
3. « Chaussures — 1 000 FCFA est dans votre catalogue » + deux boutons ;
4. « Votre boutique, mode d'emploi » — cinq points numérotés, trois liens.

**Cinq liens bruts** au total, dans un fil où le pouce cherche un seul geste.

Le message 2 est un **défaut**, pas un choix : il proposait le formulaire
d'article à une vendeuse qui venait de remplir ce formulaire même, à l'écran 2
du Flow d'ouverture. L'offre était empilée dans la suite avant qu'on regarde
si l'article était déjà arrivé.

Les messages 3 et 4 sont la conséquence d'un choix qui ne tient plus : le
formulaire d'ouverture rend la boutique ET l'article du même geste, mais les
deux confirmations partaient séparément, et le mode d'emploi s'ajoutait par
la règle « au premier article ».

## Ce que WhatsApp offre, vérifié le 13/08

**Le message Liste** — `interactive.type = "list"` — porte jusqu'à **dix
lignes**, chacune avec un titre (24 caractères) et une description (72), plus
un en-tête (60) et un **pied** (60). Un menu natif, fermé par défaut.

C'est l'outil qui manquait, et il était **déjà implémenté** dans
`messages.ts` : le fil acheteuse s'en sert pour le catalogue et les quantités.
L'ouverture, elle, n'avait que des boutons — trois au maximum.

C'est la racine du mur : trois boutons ne tiennent pas tout ce qu'une vendeuse
neuve peut vouloir faire, donc le reste retombait en texte, et le texte n'a
pas de fin.

## Décision 1 — une seule bulle, et c'est une liste

`messageBoutiqueCreee` rend **un** message de type liste :

- le **corps** dit que la boutique est ouverte, que l'article est en ligne
  quand l'écran 2 l'a rendu, et porte le lien à partager ;
- le **pied** porte la seule leçon qu'aucune ligne de menu ne peut porter :
  « Commandes ici. Remise faite ? « livrée » + la référence. » ;
- le **menu** porte les trois gestes suivants, chacun avec sa description.

Quatre messages deviennent un. Cinq liens deviennent un.

## Décision 2 — le lien de boutique reste du TEXTE

`cta_url` est accepté depuis la mesure du 13/08 (ADR 0087). On **pourrait**
en faire un bouton. On ne le fait pas ici, et la raison mérite d'être écrite
parce qu'elle vaut pour tous les liens à venir :

> `cta_url` sert « **va voir** cette page ». Il ne sert jamais « **prends
> ceci et colle-le ailleurs** ».

Le lien de boutique, la vendeuse doit le **copier** pour le mettre dans son
Statut WhatsApp. Un bouton l'ouvrirait — il ne le donnerait pas. Le reçu
vérifiable, le suivi de commande et l'espace vendeuse sont l'autre famille :
eux gagneront à devenir des boutons.

## Décision 3 — trois lignes, et pas une de plus

Chaque ligne promet un geste dont le **routage est vérifié** : `article`,
`carte`, `ma_boutique`. C'est la règle de l'ADR 0034 appliquée au menu — une
ligne qui ouvre sur rien est pire que pas de menu.

Le **reversement** n'y est pas, et c'est délibéré : il vit dans « ma
boutique », il a sa relance à ~20 h, et il reparaît à la première commande —
là où il coûte. Servir une information hors de son moment reste du bruit.

## Le piège qui aurait rendu le menu muet

`aiguillage.ts` ne routait `article` et `ma_boutique` que pour
`genre === "bouton"`. Une réponse de liste arrive en `genre === "liste"` :
sans le changement, **chaque ligne du menu n'aurait rien fait** — pas
d'erreur, pas de trace, un menu mort.

C'est le même genre de silence que le défaut de l'ADR 0085, et il est tenu
par un test, pas par la mémoire : `aiguillage.test.ts` vérifie que les deux
formes du même identifiant valent le même geste.

## Ce qui n'est pas fait

Le **mode d'emploi n'est pas supprimé** : il sert encore la vendeuse qui
ouvre sa boutique **sans** article — elle n'a pas eu le menu, et elle a
besoin des mots. Il ne part plus quand l'ouverture a rendu son menu.

Les **liens du fil acheteuse** ne deviennent pas encore des boutons `cta_url`.
La mesure dit que l'API accepte ; que le bouton s'affiche comme un bouton
chez l'acheteuse se voit dans le fil, pas dans une réponse HTTP.
