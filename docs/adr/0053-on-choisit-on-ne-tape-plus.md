# 0053 — On choisit, on ne tape plus

Date : 2026-08-08
Statut : accepté
Lot D du plan de l'audit — `docs/analyses/2026-08-07-audit-integral-du-bot.md` §5

## Contexte

L'audit a chiffré le mal de fond du produit : **6 états sur 14 (43 %) exigent
une saisie clavier, et 5 n'envoient jamais un seul bouton.** Sur un clavier de
téléphone, à Douala, entre deux clientes, chaque champ libre est un piège.

Les lots A, B et C ont fermé les trois défauts de structure. Celui-ci s'attaque
à l'expérience elle-même.

## Décision 1 — un corps interactif tient sous 1 024, pas sous 4 096

`messages.ts` déclarait `CORPS_MAX = 4096` et l'appliquait à tout. C'est la
limite d'un message **texte**. Celle d'un corps à boutons ou à liste est de
**1 024**.

Un corps entre les deux passait donc la validation locale et **mourait en
HTTP 400 à l'envoi, sans un message pour personne**. Le menu vendeuse mesure
environ 600 caractères ; une fiche article à longue description dépasse 1 400.

Ce défaut n'avait encore rien cassé, mais il devait être corrigé **avant** ce
lot, qui ajoute du contenu dans des corps interactifs.

## Décision 2 — la quantité se choisit dans une liste

Trois boutons couvraient 1, 2, et « un autre nombre ». Pour commander trois
pagnes, il fallait taper. Une **liste** en porte dix, bornée par le stock quand
il est connu : on ne propose jamais ce qui n'existe pas.

La saisie clavier reste acceptée — **on ajoute un chemin, on n'en retire
aucun**. C'est la règle de tout ce lot : quelqu'un dont les boutons ne
s'affichent pas doit continuer de pouvoir acheter.

## Décision 3 — l'invariant du produit tient DANS le tunnel

AGENTS.md §1 : « l'acheteuse et la vendeuse continuent de se parler sur
WhatsApp — c'est un invariant produit ». Le bouton « Parler à la vendeuse »
n'existait qu'à l'accueil, en congés, en réponse FAQ et sur catalogue vide.

**L'invariant était donc suspendu pendant les six tours les plus décisifs** —
quantité, panier, mode, ville, détails, récapitulatif. Il est désormais offert
à chaque étape, à la place d'« Annuler » quand la boutique porte un numéro.
Sans numéro, « Annuler » ou « Menu » : jamais rien.

Un refus de quantité re-propose la liste au lieu de rendre un texte nu — un
cul-de-sac trouvé en écrivant les tests de ce lot.

## Décision 4 — « Corriger » corrige, il ne recommence pas

Au récapitulatif, « Corriger » renvoyait à l'étape **panier**. Rectifier un
chiffre du numéro de téléphone coûtait donc de re-traverser mode, ville et
détails — trois tours pour un chiffre.

Il rouvre maintenant la **saisie de livraison**, là où l'erreur a été faite. La
ville se relit de la livraison déjà analysée : une seule source, pas un champ
dupliqué sur l'état.

Le panier, lui, se retrouve par le mot « panier », qui marche partout.

## Ce que ce lot ne fait PAS

- **Le quartier n'est pas devenu une liste.** `QUARTIERS_SUGGERES` couvre
  Douala et Yaoundé ; depuis l'ADR 0050 la ville de livraison est libre, et la
  liste ne servirait donc qu'à une fraction des acheteuses. La faire coexister
  avec la saisie libre demande de choisir entre un tour de plus pour toutes et
  deux chemins distincts — un arbitrage qui mérite son propre lot, avec la
  mesure du nombre de tours en main.
- **Le panier n'est pas visible depuis l'accueil**, et l'expiration à 24 h ne
  se dit toujours pas. Deux ajouts de confort, sans défaut derrière.

## Conséquences

- 10 tests neufs, vus rouges d'abord. 932 tests API au total.
- **Six tests existants ont été réécrits**, tous parce qu'ils épinglaient un
  comportement que ce lot change délibérément : la troisième sortie du panier
  (« Annuler » → « Parler à la vendeuse »), la quantité passée du bouton à la
  liste, et « Corriger » qui rouvre la saisie. Chacun porte désormais la raison
  du changement dans son corps.
- Les identifiants `qte:1` et `qte:2` sont conservés : aucun message en vol ne
  casse au déploiement.
