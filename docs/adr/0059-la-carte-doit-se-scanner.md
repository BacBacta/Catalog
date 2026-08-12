# 0059 — La carte doit se scanner

Date : 2026-08-10
Statut : accepté
Prolonge : l'ADR 0037 (la carte-vitrine) et l'ADR 0016 (le pipeline d'images)
Concerne : `domain/bot/carte-vitrine.ts`, `adapters/carte-vitrine.ts`, `bot.ts`,
`domain/bot/inscription.ts`

## Contexte

La carte de la boutique « Chez oumar », fabriquée au banc du 10/08/2026, est
revenue avec trois reproches : *floue*, *QR illisible*, *les liens semblent
être ceux d'une autre boutique*. Une seule image, trois défauts indépendants —
et un quatrième trouvé en la regardant.

## Ce qui n'était PAS un défaut

Le QR encodait bien `boutique chez-oumar`. Vérifié en re-encodant le lien
attendu et en comparant la matrice module par module aux pixels de l'image
rendue : **1089 / 1089**. Aucune fuite entre boutiques.

L'impression venait d'ailleurs, et elle est justifiée — voir le défaut 4.

## Défaut 1 — le QR était sombre sur fond sombre

Il était tracé en `ENCRE` (#1f2428) **directement sur le bandeau vert**
(#075e54), sans zone de silence. Un lecteur de QR ne lit pas des modules
sombres sur un fond sombre, quelle que soit la définition : c'est le
**contraste** qui porte la lecture, pas les pixels.

Le code repose désormais sur une **plaque blanche** avec **34 px de marge**
tout autour — le standard demande quatre modules, ici ~33 px. Deux tests
tiennent la propriété : la plaque est claire, et elle déborde le code.

## Défaut 2 — la carte passait par le calibrage des photos de catalogue

`reencoderImage` réduit par défaut à **640 px** sur le plus grand côté et vise
**100 Ko**. C'est la règle des photos d'articles, et elle borne le poids de la
boutique publique (ADR 0016).

Appliquée à la carte, elle ramenait un 1080×1920 à **360×640**. Mesuré :

| | Définition | QR | px par module |
|---|---|---|---|
| Avant | 360 × 640 | 80 px | **2,42** |
| Après | 1080 × 1920 | 240 px | **7,27** |

À 2,42 px par module, aucun appareil photo ne lit un QR — et la carte entière
était floue avec lui.

**La carte n'est pas une photo de catalogue.** Elle ne paraît sur aucune page,
elle part une fois dans un fil, et son objet est d'être scannée. Elle garde
donc sa définition et reçoit son propre plafond : **300 Ko**. Mesuré à 71 Ko
en réel — la borne existe pour qu'elle reste une image, pas un téléchargement.

Le budget de 100 Ko de l'ADR 0016 **n'est pas touché** : il continue de
s'appliquer à tout ce qui atteint la boutique publique.

## Défaut 3 — la grille était figée sur trois articles

Une boutique qui n'a qu'un article sortait une carte au tiers remplie, avec
600 px de crème vide entre l'article et le bandeau. Or c'est **la première
carte que fabrique une vendeuse** — juste après son premier article — donc le
cas le plus fréquent, et le plus mal servi.

La grille suit maintenant le nombre : un article prend toute la hauteur, deux
se partagent en bandes, trois gardent la disposition d'origine. Le domaine
dessine et l'adaptateur pose aux **mêmes** emplacements, par la même fonction.

## Défaut 4 — le numéro partagé passait avant le nom de la boutique

Le bandeau écrivait `wa.me/32451055144` en gros, et `puis : boutique
chez-oumar` en petit gris. Or ce numéro est **le même pour toutes les
vendeuses** : lu en premier, il fait croire qu'on regarde la carte de
quelqu'un d'autre. C'est exactement le reproche reçu.

La hiérarchie est inversée : le mot-clé de LA boutique est la ligne la plus
grande du bandeau, le numéro partagé passe en ligne de service. Un test
compare les deux tailles.

## Défaut 5 — « Eau, » gardait sa virgule

`lireLegendeArticle` acceptait `[\s:—–-]` comme séparateur, mais pas la
virgule : « Eau, 1000 » — la façon la plus naturelle de légender une photo —
donnait un article nommé **« Eau, »**, jusque sur la carte imprimée.

La ponctuation de **fin** part avec le séparateur. La ponctuation **interne**
reste : « Eau, sachet » est un nom, pas un accident, et un test le fixe.

## Conséquences

- 11 tests neufs, vus rouges d'abord.
- Les articles déjà enregistrés gardent leur nom : la correction porte sur la
  lecture, pas sur les données. « Eau, » se renomme depuis l'app.
