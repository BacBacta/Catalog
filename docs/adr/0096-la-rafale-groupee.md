# ADR 0096 — La rafale groupée : n photos, une confirmation

Date : 2026-08-15
Statut : accepté
Lot : P1 de `PROMPTS-premium.md`, sous le cadrage de l'ADR 0095. C'est l'ADR
que la maquette annonçait (« ADR à écrire · la rafale groupée »).

## Contexte — le geste réel, et le mur qu'il produisait

Le geste naturel d'une vendeuse est la **salve de photos**, comme pour un
Statut : cinq articles, cinq photos légendées « nom prix », envoyées en
quelques secondes. Le fil répondait cinq cartes de confirmation — le mur que
l'ADR 0086 interdit, et cinq « Publier » à presser au lieu d'un.

## Décision 1 — le collecteur : un état, une fenêtre, zéro horloge cachée

La **première** photo légendée garde exactement le comportement d'aujourd'hui
(ADR 0035) : confirmation immédiate, boutons « Publier » / « Corriger ». Une
salve d'une seule photo ne voit donc **aucun changement** — pas de carte de
rafale pour rien.

Dès la **deuxième** photo, l'état `article_confirme` devient `rafale` : les
photos s'accumulent en **brouillons** (nom, prix, photo), chaque photo reçue
est accusée d'un 👍 — une réaction, pas une bulle — et rien d'autre ne part.
À la fermeture de la fenêtre de regroupement (`FENETRE_RAFALE_MS`, 30 s
après la dernière photo), **UNE carte récapitulative** : « n articles prêts
à publier », lignes numérotées nom + prix, boutons « ✅ Tout publier » et
« ✏️ Corriger le N ».

Le domaine reste pur : le collecteur (`domain/bot/rafale.ts`) reçoit la
légende déjà lue et ne connaît ni l'horloge ni la base. La fermeture de la
fenêtre est portée par un travail pg-boss **débordé par conception** : chaque
photo replanifie, le travail qui se réveille vérifie sur l'état RÉEL que la
fenêtre est bien échue et que la carte n'est pas déjà partie — même patron
de reprise que la relance (ADR 0033) et l'expiration (ADR 0090).

## Décision 2 — la correction est adressable par numéro

« corriger le 2 » — tapé, ou par le bouton — rouvre le **seul** brouillon 2 :
une question, « nom et prix en un message » (le motif est `lireLegendeArticle`,
réutilisé tel quel — le prix est le dernier groupe de chiffres, on ne
réécrit pas ce motif), une photo légendée pour remplacer aussi l'image. Les
autres brouillons ne bougent pas, et le récapitulatif se re-montre corrigé.

Le bouton ne peut viser qu'UN numéro (trois boutons au plus — ADR 0035) : il
vise le **premier brouillon sans nom** s'il y en a un, sinon le dernier
ajouté — le plus probablement fautif. Le corps de la carte enseigne la forme
tapée, qui vise n'importe quel numéro. La maquette disait « touchez le
numéro » ; les lignes d'un message à boutons ne se touchent pas, la copie
livrée dit donc la forme tapée — la maquette est mise à jour au même commit
(règle de pilotage n° 5).

## Décision 3 — les bornes, et ce qu'on n'invente pas

- **10 brouillons au plus** — la borne des listes (ADR 0035), gardée même
  sur une carte à boutons : au-delà, la photo de trop n'entre pas et la
  carte invite à publier d'abord.
- **Une photo sans légende lisible entre en brouillon « sans nom »**, et la
  carte le dit — on n'invente pas un nom (§7.7). « Tout publier » refuse
  tant qu'un brouillon n'a pas de nom, en nommant le numéro à corriger :
  publier un article « (sans nom) » serait pire que le refus.
- **Idempotence** (ADR 0040) : la réclamation par wamid protège déjà le
  traitement ; le collecteur garde en plus le wamid de chaque brouillon, et
  une photo relivrée ne crée pas de doublon même si la réclamation a expiré.

## Décision 4 — la publication est UNE salve, par la porte existante

« Tout publier » publie chaque brouillon par le **même chemin** que l'article
unitaire (`creerArticleDepuisFil` : ré-encodage, compteurs média ADR 0092,
cause de photo dite — ADR 0092 encore), puis UNE carte de retour :
« Publiés. Votre boutique passe à N articles. » La reconstruction de la
boutique statique est demandée **une fois** — la porte de l'ADR 0065/0068
absorbe le groupement. Le mode d'emploi du premier article (tâche #62) part
comme aujourd'hui quand la salve fait naître le catalogue.

## Ce que ce lot NE fait pas

- La copie vendeuse reste en **français** — ADR 0033 : le fil vendeuse est
  monolingue, la règle « FR + EN » du préambule vaut pour les messages
  acheteuse.
- La poussée de la carte-vitrine après la salve est le lot **P2** (décision
  P0-c) ; ce lot n'envoie aucune carte-vitrine.
- Le stock ne s'annonce pas dans une légende — le formulaire d'article reste
  le seul chemin qui le saisit (ADR 0038).
- L'app vendeuse ne change pas.

## Preuves

- `apps/api/src/domain/bot/__tests__/rafale.test.ts` — la fenêtre qui
  groupe, la borne à 10, la correction par numéro, l'idempotence, la photo
  sans légende, la salve d'une seule photo inchangée, et la séquence de
  messages d'une salve de 3, écrite lisiblement.
- `apps/api/src/__tests__/bot-rafale.test.ts` — le parcours service contre
  une vraie base : deux photos → un état rafale et zéro bulle, le travail
  qui envoie la carte une seule fois, « Tout publier » → les articles en
  base et UNE carte de retour.
- La matrice étape × geste du harnais couvre `rafale` et `rafale_correction`
  dès ce lot (règle de l'ADR 0095).
