# 0013 — Le code de vérification est tiré au sort cryptographique, pas par un générateur congruentiel

- Statut : accepté
- Date : 2026-07-29
- Écart assumé à la lettre du lot 3 de `PROMPTS.md`
- Ne change rien au format, à l'alphabet, ni au test des 10 000 codes

## Contexte

Le lot 3 demande, mot pour mot :

> `order.verification_code` UNIQUE, format XXXX-XXXX sur un alphabet sans
> caractères ambigus […]. **Utilise un générateur congruentiel linéaire** et
> écris un test sur 10 000 codes qui vérifie l'absence de répétition de motif.

L'intention derrière cette phrase est claire et juste : elle vise un piège réel.
L'alphabet non ambigu fait **25 caractères**, soit 5². Un générateur dont le pas
partage un facteur avec 25 produit des codes du type `TTTT-TTTT` — le blueprint
le dit explicitement, et c'est ce que le test des 10 000 codes doit attraper.

## Le problème

Un générateur congruentiel linéaire est **prédictible par construction**. Deux
codes suffisent à retrouver l'état interne, et donc tous les suivants.

Or ce code n'est pas un identifiant technique. C'est la clé de la page publique
de vérification du reçu : `/v/[code]`. Quiconque devine un code lit le reçu
d'une transaction qui ne le concerne pas, et — selon ce que le lot 10 y expose —
peut contresigner à la place de l'acheteuse.

AGENTS.md est explicite là-dessus, et il prime : « **Le code est la preuve
opposable du paiement : il doit être impossible à deviner** ». Le contrat de
travail dit aussi, en tête de fichier, qu'en cas de contradiction avec une
pratique répandue, c'est lui qui gagne.

Le lot 1 avait d'ailleurs déjà livré le bon générateur —
`apps/api/src/domain/verification-code.ts` — qui tire des octets de
`crypto.getRandomValues` avec **rejet des valeurs qui biaiseraient le modulo**.
Le remplacer par un LCG aurait été une régression de sécurité présentée comme
une mise en conformité.

## Décision

**On garde le générateur cryptographique. On garde entièrement l'exigence de
test.**

Ce qui est conservé de la consigne :

- le format `XXXX-XXXX` ;
- l'alphabet non ambigu de 25 caractères, ni O/0, ni I/1/L, ni B/8, ni S/5,
  ni Z/2 ;
- la contrainte `UNIQUE` en base ;
- **le test sur 10 000 codes**, et il est plus large que demandé.

Ce qui change : la fabrication. Aucune arithmétique modulaire à pas fixe, donc
aucune classe de motifs dégénérés possible — le problème que le LCG demandait
de contourner ne se pose plus.

## Le test, et pourquoi il reste indispensable

Un générateur cryptographique ne dispense pas de vérifier. Le test des 10 000
codes cherche sept choses, et chacune correspond à une façon connue de rater ce
genre de code :

| Assertion | Ce qu'elle attraperait |
|---|---|
| Aucun doublon | espace trop petit, ou état réinitialisé |
| Tous valides et dans l'alphabet | fuite d'un caractère ambigu |
| Aucun code aux 8 caractères identiques | **le cas `TTTT-TTTT` nommé par le blueprint** |
| Les deux moitiés jamais systématiquement égales | période cachée de longueur 4 |
| Aucune position figée sur un seul caractère | colonne morte, symptôme d'un pas mal choisi |
| Alphabet parcouru sans trou ni favori (±35 %) | modulo biaisé — l'erreur que le rejet évite |
| Aucune suite de trois caractères consécutifs | compteur incrémental déguisé |

Ces assertions décrivent **ce qu'un code doit être**, pas comment il est
fabriqué. Elles resteraient valables si l'on changeait un jour de générateur, et
c'est délibéré : elles verrouillent la propriété, pas l'implémentation.

Une note sur la tolérance de ±35 % pour la distribution : elle est large exprès.
Un seuil serré rendrait le test instable — il échouerait une fois sur cinquante
sans qu'aucun code ne soit en cause, et un test qui crie au loup finit ignoré.
Il reste largement assez fin pour attraper un générateur qui n'utiliserait
qu'une partie de l'alphabet.

## À revoir si

Le volume rend la génération coûteuse — improbable : huit caractères par
commande. Ou si le lot 10 décide que la page `/v/[code]` doit exiger un second
facteur, ce qui abaisserait l'exigence d'imprévisibilité du code lui-même. Même
alors, il n'y aurait aucune raison de revenir à un générateur prédictible.
